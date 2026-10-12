"""Availability queries. Stock is always read from authoritative tables, never from a cache."""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from decimal import ROUND_FLOOR, Decimal

from django.db.models import Case, DecimalField, ExpressionWrapper, F, OuterRef, Q, Subquery, Sum, Value, When
from django.db.models.functions import Coalesce
from django.utils import timezone

from .models import Batch, BatchStatus, QualityStatus, StockLevel

DEC = DecimalField(max_digits=14, decimal_places=3)
ZERO = Decimal("0")


def sellable_batch_q(on_date: dt.date | None = None) -> Q:
    """Batches that may be allocated: active, inspected OK, and not past their last sell date."""
    on_date = on_date or timezone.localdate()
    return Q(status=BatchStatus.ACTIVE, quality_status=QualityStatus.PASSED) & (
        Q(sellable_until__isnull=True) | Q(sellable_until__gte=on_date)
    )


def annotate_availability(qs, branch_id: int | None, on_date: dt.date | None = None):
    """Adds `avail_qty` (None = unlimited made-to-order) and `low_threshold` to a Product queryset."""
    if branch_id is None:  # no branch configured yet: counted stock is unknown (0), made-to-order is still sellable
        return qs.annotate(
            avail_qty=Case(
                When(stock_mode="MADE_TO_ORDER", then=Value(None, output_field=DEC)),
                default=Value(ZERO, output_field=DEC),
                output_field=DEC,
            ),
            low_threshold=Value(ZERO, output_field=DEC),
        )
    level = StockLevel.objects.filter(product=OuterRef("pk"), branch_id=branch_id)
    level_avail = level.annotate(a=ExpressionWrapper(F("on_hand") - F("reserved"), output_field=DEC)).values("a")[:1]
    batch_avail = (
        Batch.objects.filter(product=OuterRef("pk"), branch_id=branch_id)
        .filter(sellable_batch_q(on_date))
        .values("product")
        .annotate(a=Sum(F("qty_remaining") - F("qty_reserved"), output_field=DEC))
        .values("a")[:1]
    )
    return qs.annotate(
        avail_qty=Case(
            When(stock_mode="MADE_TO_ORDER", then=Value(None, output_field=DEC)),
            When(
                tracks_batches=True,
                then=Coalesce(Subquery(batch_avail, output_field=DEC), Value(ZERO, output_field=DEC)),
            ),
            default=Coalesce(Subquery(level_avail, output_field=DEC), Value(ZERO, output_field=DEC)),
            output_field=DEC,
        ),
        low_threshold=Coalesce(
            Subquery(level.values("low_stock_threshold")[:1], output_field=DEC), Value(ZERO, output_field=DEC)
        ),
    )


@dataclass(frozen=True)
class Availability:
    status: str  # IN_STOCK | LOW_STOCK | OUT_OF_STOCK | UNAVAILABLE
    max_orderable: Decimal | None  # None = no stock-based limit
    available_qty: Decimal | None

    @property
    def can_order(self) -> bool:
        return self.status in ("IN_STOCK", "LOW_STOCK")


def _floor_to_step(value: Decimal, minimum: Decimal, step: Decimal) -> Decimal:
    if value < minimum:
        return ZERO
    return minimum + ((value - minimum) / step).to_integral_value(rounding=ROUND_FLOOR) * step


def compute_availability(product, avail_qty: Decimal | None, low_threshold: Decimal = ZERO) -> Availability:
    if not product.is_purchasable:
        return Availability("UNAVAILABLE", ZERO, ZERO)
    cap = product.qty_max
    if avail_qty is None:  # made to order
        return Availability("IN_STOCK", cap, None)
    if avail_qty < product.qty_min:
        return Availability("OUT_OF_STOCK", ZERO, avail_qty)
    limit = _floor_to_step(min(avail_qty, cap) if cap is not None else avail_qty, product.qty_min, product.qty_step)
    status = "LOW_STOCK" if low_threshold > 0 and avail_qty <= low_threshold else "IN_STOCK"
    return Availability(status, limit, avail_qty)


def availability_map(products, branch_id: int | None, on_date: dt.date | None = None) -> dict[int, Availability]:
    """Batch availability for already-loaded products (cart lines, comparison). Two queries total."""
    from apps.catalog.models import Product

    ids = [p.id for p in products]
    if not ids:
        return {}
    annotated = {p.id: p for p in annotate_availability(Product.objects.filter(pk__in=ids), branch_id, on_date)}
    out = {}
    for p in products:
        a = annotated[p.id]
        out[p.id] = compute_availability(p, a.avail_qty, a.low_threshold)
    return out
