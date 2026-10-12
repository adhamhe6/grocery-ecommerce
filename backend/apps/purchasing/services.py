"""Purchase orders and goods receiving.

Receiving is idempotent (`GoodsReceipt.idempotency_key` is unique per PO) and all-or-nothing: stock, batches, PO progress
and the receipt rows are written in one transaction, so a double submit can never put the same delivery on the shelf twice.
"""

from __future__ import annotations

import datetime as dt
import secrets
from collections.abc import Iterable
from decimal import Decimal

from django.db import transaction
from django.db.models import F, Sum
from django.utils import timezone

from apps.catalog.models import Product
from apps.core import audit
from apps.core.exceptions import DomainError, ErrorCode
from apps.core.money import ZERO, qty
from apps.inventory import services as inventory
from apps.inventory.models import MovementKind, StockLevel, StockMovement

from .models import (
    GoodsReceipt,
    GoodsReceiptLine,
    POStatus,
    PurchaseOrder,
    PurchaseOrderLine,
    Supplier,
    SupplierProduct,
    SupplierStatus,
)

OVER_RECEIPT_TOLERANCE = Decimal("1.10")  # a supplier may ship up to 10% over; more must be rejected or the PO amended
RECEIVABLE = (POStatus.SUBMITTED, POStatus.CONFIRMED, POStatus.PARTIALLY_RECEIVED)
_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def _number(prefix: str) -> str:
    return f"{prefix}-{timezone.now():%y%m%d}-" + "".join(secrets.choice(_ALPHABET) for _ in range(4))


@transaction.atomic
def create_po(*, supplier: Supplier, branch_id: int, lines: Iterable[dict], actor, expected_date: dt.date | None = None, notes: str = "") -> PurchaseOrder:
    if supplier.status != SupplierStatus.ACTIVE:
        raise DomainError(ErrorCode.VALIDATION_ERROR, f"{supplier.name} is {supplier.get_status_display().lower()} and can't receive new orders.")
    po = PurchaseOrder.objects.create(
        number=_number("PO"), supplier=supplier, branch_id=branch_id, expected_date=expected_date
        or (timezone.localdate() + dt.timedelta(days=supplier.lead_time_days)), notes=notes, created_by=actor,
    )
    set_lines(po, lines)
    audit.record(actor, "po.created", po, summary=f"{po.number} to {supplier.name}")
    return po


@transaction.atomic
def set_lines(po: PurchaseOrder, lines: Iterable[dict]) -> PurchaseOrder:
    po = PurchaseOrder.objects.select_for_update().get(pk=po.pk)
    if po.status != POStatus.DRAFT:
        raise DomainError(ErrorCode.INVALID_STATE, "Only draft purchase orders can be edited.", status_code=409)
    rows, seen = [], set()
    for row in lines:
        product = Product.objects.filter(pk=row["product_id"]).first()
        if product is None:
            raise DomainError(ErrorCode.NOT_FOUND, "Unknown product on the purchase order.", status_code=404)
        if product.id in seen:
            raise DomainError(ErrorCode.VALIDATION_ERROR, f"{product.name} appears twice. Combine the quantities.")
        seen.add(product.id)
        quantity, cost = qty(row["qty_ordered"]), Decimal(str(row["unit_cost"]))
        if quantity <= 0 or cost < 0:
            raise DomainError(ErrorCode.VALIDATION_ERROR, f"Check the quantity and cost for {product.name}.")
        rows.append(PurchaseOrderLine(purchase_order=po, product=product, qty_ordered=quantity, unit_cost=cost))
    po.lines.all().delete()
    PurchaseOrderLine.objects.bulk_create(rows)
    return po


def _transition(po: PurchaseOrder, allowed_from: tuple, to: str, actor, action: str) -> PurchaseOrder:
    po = PurchaseOrder.objects.select_for_update().get(pk=po.pk)
    if po.status not in allowed_from:
        raise DomainError(ErrorCode.INVALID_STATE, f"{po.number} is {po.get_status_display().lower()} and can't move to {POStatus(to).label.lower()}.", status_code=409)
    po.status = to
    fields = ["status", "updated_at"]
    if to == POStatus.SUBMITTED:
        po.submitted_at = timezone.now()
        fields.append("submitted_at")
    po.save(update_fields=fields)
    audit.record(actor, action, po, summary=f"{po.number} → {to}")
    return po


@transaction.atomic
def submit_po(po: PurchaseOrder, actor) -> PurchaseOrder:
    if not po.lines.exists():
        raise DomainError(ErrorCode.VALIDATION_ERROR, "Add at least one line before submitting.")
    return _transition(po, (POStatus.DRAFT,), POStatus.SUBMITTED, actor, "po.submitted")


@transaction.atomic
def confirm_po(po: PurchaseOrder, actor) -> PurchaseOrder:
    return _transition(po, (POStatus.SUBMITTED,), POStatus.CONFIRMED, actor, "po.confirmed")


@transaction.atomic
def cancel_po(po: PurchaseOrder, actor, reason: str) -> PurchaseOrder:
    locked = PurchaseOrder.objects.select_for_update().get(pk=po.pk)
    if locked.receipts.exists():
        raise DomainError(ErrorCode.INVALID_STATE, "Goods have already been received against this order. Close it instead of cancelling.", status_code=409)
    if not reason.strip():
        raise DomainError(ErrorCode.VALIDATION_ERROR, "A cancellation reason is required.")
    out = _transition(po, (POStatus.DRAFT, POStatus.SUBMITTED, POStatus.CONFIRMED), POStatus.CANCELLED, actor, "po.cancelled")
    out.notes = (out.notes + f"\nCancelled: {reason}").strip()
    out.save(update_fields=["notes", "updated_at"])
    return out


@transaction.atomic
def receive_goods(po: PurchaseOrder, lines: list[dict], *, idempotency_key: str, actor, delivery_note: str = "", notes: str = "") -> tuple[GoodsReceipt, bool]:
    """Record a delivery. Returns (receipt, replayed). Each line: po_line_id, qty_accepted, qty_rejected, reject_reason,
    lot_code, expiry_date, expiry_kind. Accepted quantity becomes stock (batched if the product is batch-tracked)."""
    if not idempotency_key or len(idempotency_key) < 8:
        raise DomainError(ErrorCode.IDEMPOTENCY_KEY_REQUIRED, "A receiving key is required so a double submit can't count a delivery twice.")
    locked = PurchaseOrder.objects.select_for_update().select_related("supplier", "branch").get(pk=po.pk)
    existing = GoodsReceipt.objects.filter(purchase_order=locked, idempotency_key=idempotency_key).first()
    if existing is not None:
        return existing, True
    if locked.status not in RECEIVABLE:
        raise DomainError(ErrorCode.DUPLICATE_RECEIPT if locked.status == POStatus.RECEIVED else ErrorCode.INVALID_STATE,
                          f"{locked.number} is {locked.get_status_display().lower()}; nothing more can be received against it.", status_code=409)
    if not lines:
        raise DomainError(ErrorCode.VALIDATION_ERROR, "Enter what was delivered.")

    po_lines = {pl.id: pl for pl in PurchaseOrderLine.objects.select_for_update().select_related("product").filter(purchase_order=locked)}
    receipt = GoodsReceipt.objects.create(
        purchase_order=locked, number=_number("GR"), idempotency_key=idempotency_key, received_by=actor, delivery_note=delivery_note[:120], notes=notes[:300],
    )
    touched = 0
    for row in lines:
        pl = po_lines.get(row["po_line_id"])
        if pl is None:
            raise DomainError(ErrorCode.VALIDATION_ERROR, "A received line doesn't belong to this purchase order.")
        accepted, rejected = qty(row.get("qty_accepted", 0)), qty(row.get("qty_rejected", 0))
        if accepted < 0 or rejected < 0 or (accepted == 0 and rejected == 0):
            continue
        outstanding = pl.qty_ordered - pl.qty_received
        if accepted > max(outstanding, ZERO) * OVER_RECEIPT_TOLERANCE:
            raise DomainError(
                ErrorCode.VALIDATION_ERROR,
                f"{pl.product.name}: {accepted.normalize():f} is more than the {outstanding.normalize():f} still outstanding (up to 10% over is accepted). "
                "If this delivery was already entered, don't enter it again.",
                status_code=409, details={"outstanding": str(outstanding)},
            )
        if rejected and not str(row.get("reject_reason", "")).strip():
            raise DomainError(ErrorCode.VALIDATION_ERROR, f"Give a reason for the rejected {pl.product.name}.")
        batch = None
        if accepted > 0:
            batch = inventory.receive_stock(
                pl.product, locked.branch_id, accepted, actor=actor, lot_code=row.get("lot_code", "") or "", expiry_date=row.get("expiry_date"),
                expiry_kind=row.get("expiry_kind") or "BEST_BEFORE", supplier=locked.supplier, unit_cost=pl.unit_cost, ref_type="receipt",
                ref_id=receipt.number, note=f"Delivery {delivery_note}".strip(),
            )
        GoodsReceiptLine.objects.create(
            receipt=receipt, po_line=pl, qty_accepted=accepted, qty_rejected=rejected, reject_reason=str(row.get("reject_reason", ""))[:200],
            lot_code=row.get("lot_code", "") or "", expiry_date=row.get("expiry_date"), expiry_kind=row.get("expiry_kind") or "BEST_BEFORE", batch=batch,
        )
        pl.qty_received += accepted
        pl.qty_rejected += rejected
        pl.save(update_fields=["qty_received", "qty_rejected"])
        touched += 1
    if touched == 0:
        raise DomainError(ErrorCode.VALIDATION_ERROR, "Nothing was received: enter an accepted or rejected quantity on at least one line.")
    complete = all(pl.qty_received >= pl.qty_ordered for pl in po_lines.values())
    locked.status = POStatus.RECEIVED if complete else POStatus.PARTIALLY_RECEIVED
    locked.save(update_fields=["status", "updated_at"])
    audit.record(actor, "po.received", locked, summary=f"{receipt.number}: {touched} line(s)")
    return receipt, False


def replenishment_suggestions(branch_id: int, *, velocity_days: int = 30) -> list[dict]:
    """Products at or below their low-stock threshold, with measured sales velocity — nothing is estimated from thin air."""
    since = timezone.now() - dt.timedelta(days=velocity_days)
    levels = (
        StockLevel.objects.filter(branch_id=branch_id, low_stock_threshold__gt=0, product__status="ACTIVE")
        .annotate(free=F("on_hand") - F("reserved")).filter(free__lte=F("low_stock_threshold")).select_related("product__sale_unit").order_by("free")
    )
    sold = dict(
        StockMovement.objects.filter(branch_id=branch_id, kind=MovementKind.SALE, created_at__gte=since, product_id__in=[lv.product_id for lv in levels])
        .values_list("product_id").annotate(s=Sum("qty_delta"))
    )
    suppliers: dict[int, list] = {}
    for sp in SupplierProduct.objects.filter(product_id__in=[lv.product_id for lv in levels], supplier__status=SupplierStatus.ACTIVE).select_related("supplier"):
        suppliers.setdefault(sp.product_id, []).append({"id": sp.supplier_id, "name": sp.supplier.name, "unit_cost": str(sp.unit_cost) if sp.unit_cost is not None else None, "lead_time_days": sp.supplier.lead_time_days})
    open_qty = dict(
        PurchaseOrderLine.objects.filter(purchase_order__branch_id=branch_id, purchase_order__status__in=[POStatus.SUBMITTED, POStatus.CONFIRMED, POStatus.PARTIALLY_RECEIVED])
        .values_list("product_id").annotate(q=Sum(F("qty_ordered") - F("qty_received")))
    )
    out = []
    for lv in levels:
        per_day = abs(sold.get(lv.product_id) or ZERO) / velocity_days
        suggested = max(lv.reorder_quantity, lv.low_stock_threshold * 2 - lv.free)
        out.append({
            "product_id": lv.product_id, "sku": lv.product.sku, "name": lv.product.name, "unit": lv.product.sale_unit.symbol, "available": str(lv.free),
            "threshold": str(lv.low_stock_threshold), "on_order": str(open_qty.get(lv.product_id) or ZERO),
            "avg_daily_sales": str(qty(per_day)) if sold.get(lv.product_id) else None,
            "days_of_cover": str(round(float(lv.free) / float(per_day), 1)) if per_day else None,
            "suggested_qty": str(qty(suggested)), "suppliers": suppliers.get(lv.product_id, []),
        })
    return out


def supplier_performance(supplier: Supplier, *, since: dt.date | None = None) -> dict:
    """Measured from real receipts only: fill rate, rejection rate, on-time share. None when there is no data."""
    pos = PurchaseOrder.objects.filter(supplier=supplier).exclude(status__in=[POStatus.DRAFT, POStatus.CANCELLED])
    if since:
        pos = pos.filter(submitted_at__date__gte=since)
    lines = PurchaseOrderLine.objects.filter(purchase_order__in=pos)
    agg = lines.aggregate(ordered=Sum("qty_ordered"), received=Sum("qty_received"), rejected=Sum("qty_rejected"))
    ordered, received, rejected = (agg["ordered"] or ZERO), (agg["received"] or ZERO), (agg["rejected"] or ZERO)
    receipts = GoodsReceipt.objects.filter(purchase_order__in=pos).select_related("purchase_order")
    on_time = sum(1 for r in receipts if r.purchase_order.expected_date and r.created_at.date() <= r.purchase_order.expected_date)
    n_receipts = receipts.count()
    return {
        "orders": pos.count(), "receipts": n_receipts,
        "fill_rate": str(round(received / ordered * 100, 1)) if ordered else None,
        "rejection_rate": str(round(rejected / (received + rejected) * 100, 1)) if (received + rejected) else None,
        "on_time_rate": str(round(Decimal(on_time) / n_receipts * 100, 1)) if n_receipts else None,
    }


