"""Business metrics. Every number is computed from persisted rows; nothing is estimated.

DEFINITIONS (also documented in docs/reports.md)
* Accepted order  – confirmed and not cancelled/failed: CONFIRMED … COMPLETED. Counted by `placed_at`.
* Gross sales     – Σ amount due of accepted orders (the final weighed total once known, else the estimate). Includes delivery and tax.
* Discounts       – Σ coupon discounts + Σ promotion savings on accepted orders (money the customer did NOT pay).
* Refunds         – Σ refunds with status SUCCEEDED, counted by completion date. Pending or failed refunds are never counted.
* Settled revenue – cash basis: Σ captured/collected payments (by capture date) minus refunds completed in the same period.
* Net sales       – gross sales of COMPLETED orders (by completion date) minus refunds completed in the period.
* AOV             – gross sales ÷ accepted orders.
* Waste value     – Σ |WASTE movements| × unit cost where a cost is on record; movements with no cost are counted separately.
* Inventory value – Σ remaining batch quantity × batch unit cost, plus unbatched stock at the average cost of its RECEIPT movements.
                    Lines with no cost on record are excluded and reported as `unvalued_lines`.
"""

from __future__ import annotations

import datetime as dt
import zoneinfo
from decimal import Decimal

from django.db.models import Avg, Case, Count, DecimalField, F, Q, Sum, Value, When
from django.db.models.functions import Coalesce, TruncDate
from django.utils import timezone

from apps.catalog.models import Product
from apps.core.models import StoreSettings
from apps.core.money import ZERO, money, qty_str
from apps.inventory.models import Batch, BatchStatus, MovementKind, StockLevel, StockMovement
from apps.orders.models import FulfilmentType, Order, OrderItem, OrderItemStatus, OrderStatus
from apps.payments.models import Payment, PaymentState, Refund, RefundStatus
from apps.promotions.models import CouponRedemption, RedemptionStatus
from apps.purchasing.models import Supplier
from apps.purchasing.services import supplier_performance
from apps.stores.models import DeliverySlot

ACCEPTED = [
    OrderStatus.CONFIRMED,
    OrderStatus.PICKING,
    OrderStatus.PACKING,
    OrderStatus.READY_FOR_PICKUP,
    OrderStatus.READY_FOR_DISPATCH,
    OrderStatus.OUT_FOR_DELIVERY,
    OrderStatus.COMPLETED,
]
OPEN = [s for s in ACCEPTED if s != OrderStatus.COMPLETED]
MONEY = DecimalField(max_digits=14, decimal_places=2)
QTY = DecimalField(max_digits=14, decimal_places=3)
AMOUNT_DUE = Coalesce("final_total", "total", output_field=MONEY)
LINE_VALUE = Coalesce("line_total_final", "line_total_estimated", output_field=MONEY)
HUNDRED = Decimal("100")


class Period:
    """[start, end) in the store's timezone, plus the previous period of equal length for comparisons."""

    def __init__(self, date_from: dt.date | None, date_to: dt.date | None):
        self.tz = zoneinfo.ZoneInfo(StoreSettings.load().timezone or "UTC")
        today = timezone.now().astimezone(self.tz).date()
        self.date_to = date_to or today
        self.date_from = date_from or (self.date_to - dt.timedelta(days=29))
        if self.date_from > self.date_to:
            self.date_from, self.date_to = self.date_to, self.date_from
        self.start = dt.datetime.combine(self.date_from, dt.time.min, tzinfo=self.tz)
        self.end = dt.datetime.combine(self.date_to + dt.timedelta(days=1), dt.time.min, tzinfo=self.tz)
        span = self.end - self.start
        self.prev_start, self.prev_end = self.start - span, self.start

    @property
    def days(self) -> int:
        return (self.date_to - self.date_from).days + 1

    def as_dict(self) -> dict:
        return {"from": self.date_from.isoformat(), "to": self.date_to.isoformat(), "days": self.days}


def scope(qs, branch_ids: list[int] | None, field: str = "branch_id"):
    return qs if branch_ids is None else qs.filter(**{f"{field}__in": branch_ids})


def _sum(qs, expr) -> Decimal:
    return qs.aggregate(v=Coalesce(Sum(expr), ZERO, output_field=MONEY))["v"] or ZERO


def pct(part, whole) -> Decimal | None:
    return round(Decimal(part) / Decimal(whole) * HUNDRED, 1) if whole else None


def orders_in(start, end, branch_ids, *, statuses=ACCEPTED, date_field="placed_at"):
    qs = Order.objects.filter(status__in=statuses, **{f"{date_field}__gte": start, f"{date_field}__lt": end})
    return scope(qs, branch_ids)


def accepted_items(start, end, branch_ids):
    """Order lines of accepted orders placed in the period, excluding removed/substituted-away originals."""
    qs = OrderItem.objects.filter(order__status__in=ACCEPTED, order__placed_at__gte=start, order__placed_at__lt=end)
    qs = qs.exclude(status__in=[OrderItemStatus.REMOVED, OrderItemStatus.SUBSTITUTED, OrderItemStatus.PROPOSED])
    return scope(qs, branch_ids, "order__branch_id")


# ----------------------------------------------------------------------------------------- summaries
def sales_summary(start, end, branch_ids) -> dict:
    accepted = orders_in(start, end, branch_ids)
    agg = accepted.aggregate(
        orders=Count("id"),
        gross=Coalesce(Sum(AMOUNT_DUE), ZERO, output_field=MONEY),
        coupon=Coalesce(Sum("coupon_discount"), ZERO, output_field=MONEY),
        promo=Coalesce(Sum("promo_savings"), ZERO, output_field=MONEY),
        delivery=Coalesce(Sum("delivery_fee"), ZERO, output_field=MONEY),
    )
    refunds = scope(
        Refund.objects.filter(status=RefundStatus.SUCCEEDED, completed_at__gte=start, completed_at__lt=end),
        branch_ids,
        "order__branch_id",
    )
    refund_total = _sum(refunds, "amount")
    captured = scope(
        Payment.objects.filter(captured_at__gte=start, captured_at__lt=end), branch_ids, "order__branch_id"
    )
    completed = orders_in(start, end, branch_ids, statuses=[OrderStatus.COMPLETED], date_field="completed_at")
    gross, n = agg["gross"], agg["orders"]
    return {
        "orders": n,
        "gross_sales": money(gross),
        "aov": money(gross / n) if n else None,
        "discounts": money(agg["coupon"] + agg["promo"]),
        "coupon_discounts": money(agg["coupon"]),
        "promo_savings": money(agg["promo"]),
        "delivery_fees": money(agg["delivery"]),
        "refunds": money(refund_total),
        "settled_revenue": money(_sum(captured, "captured_amount") - refund_total),
        "net_sales": money(_sum(completed, AMOUNT_DUE) - refund_total),
        "completed_orders": completed.count(),
    }


def waste_summary(start, end, branch_ids) -> dict:
    rows = scope(
        StockMovement.objects.filter(kind=MovementKind.WASTE, created_at__gte=start, created_at__lt=end), branch_ids
    ).select_related("batch")
    value, units, unknown, n = ZERO, ZERO, 0, 0
    for mv in rows:
        n += 1
        units += -mv.qty_delta
        cost = mv.unit_cost if mv.unit_cost is not None else (mv.batch.unit_cost if mv.batch_id else None)
        if cost is None:
            unknown += 1
        else:
            value += -mv.qty_delta * cost
    return {"movements": n, "value": money(value), "units": qty_str(units), "unknown_cost_movements": unknown}


def fulfilment_summary(start, end, branch_ids) -> dict:
    done = orders_in(start, end, branch_ids, statuses=[OrderStatus.COMPLETED], date_field="completed_at")
    deliveries = done.filter(fulfilment_type=FulfilmentType.DELIVERY, slot_ends_at__isnull=False)
    n = deliveries.count()
    on_time = deliveries.filter(completed_at__lte=F("slot_ends_at")).count()
    avg = done.filter(picking_started_at__isnull=False, ready_at__isnull=False).aggregate(
        d=Avg(F("ready_at") - F("picking_started_at"))
    )["d"]
    return {
        "completed_deliveries": n,
        "on_time_rate": pct(on_time, n),
        "avg_pick_to_ready_minutes": round(avg.total_seconds() / 60, 1) if avg is not None else None,
    }


def stock_health(branch_ids) -> dict:
    levels = scope(
        StockLevel.objects.filter(product__status="ACTIVE", product__stock_mode="TRACKED"), branch_ids
    ).annotate(free=F("on_hand") - F("reserved"))
    out = levels.filter(free__lte=0).count()
    low = levels.filter(free__gt=0, low_stock_threshold__gt=0, free__lte=F("low_stock_threshold")).count()
    total = levels.count()
    return {"total_lines": total, "out_of_stock": out, "low_stock": low, "healthy": total - out - low}


def expiry_risk(branch_ids, today: dt.date | None = None) -> list[dict]:
    today = today or timezone.localdate()
    live = scope(
        Batch.objects.filter(qty_remaining__gt=0, expiry_date__isnull=False).exclude(status=BatchStatus.DEPLETED),
        branch_ids,
    )
    buckets = [
        ("expired", "Expired", Q(expiry_date__lt=today)),
        (
            "today_tomorrow",
            "Expires within 1 day",
            Q(expiry_date__gte=today, expiry_date__lte=today + dt.timedelta(days=1)),
        ),
        (
            "within_3",
            "Expires in 2–3 days",
            Q(expiry_date__gt=today + dt.timedelta(days=1), expiry_date__lte=today + dt.timedelta(days=3)),
        ),
        (
            "within_7",
            "Expires in 4–7 days",
            Q(expiry_date__gt=today + dt.timedelta(days=3), expiry_date__lte=today + dt.timedelta(days=7)),
        ),
    ]
    out = []
    for key, label, cond in buckets:
        rows = live.filter(cond)
        value = _sum(rows.filter(unit_cost__isnull=False), F("qty_remaining") * F("unit_cost"))
        out.append(
            {
                "key": key,
                "label": label,
                "batches": rows.count(),
                "quantity": qty_str(_sum_q(rows, "qty_remaining")),
                "value": str(money(value)),
            }
        )
    return out


def _sum_q(qs, field) -> Decimal:
    return qs.aggregate(v=Coalesce(Sum(field), ZERO, output_field=QTY))["v"] or ZERO


def kpis(period: Period, branch_ids) -> dict:
    cur = sales_summary(period.start, period.end, branch_ids)
    prev = sales_summary(period.prev_start, period.prev_end, branch_ids)
    today = timezone.localdate()
    low = scope(
        StockLevel.objects.filter(product__status="ACTIVE", low_stock_threshold__gt=0)
        .annotate(free=F("on_hand") - F("reserved"))
        .filter(free__lte=F("low_stock_threshold")),
        branch_ids,
    ).count()
    live = scope(Batch.objects.filter(qty_remaining__gt=0, expiry_date__isnull=False), branch_ids)
    slots = scope(
        DeliverySlot.objects.filter(date__gte=period.date_from, date__lte=period.date_to, is_open=True), branch_ids
    ).aggregate(c=Sum("capacity"), b=Sum("booked"))
    ful = fulfilment_summary(period.start, period.end, branch_ids)

    def delta(key):
        a, b = cur[key], prev[key]
        if a is None or b is None or not b:
            return None
        return float(round((Decimal(a) - Decimal(b)) / Decimal(b) * HUNDRED, 1))

    return {
        **cur,
        "previous": {k: prev[k] for k in ("orders", "gross_sales", "aov", "settled_revenue")},
        "change_pct": {"orders": delta("orders"), "gross_sales": delta("gross_sales"), "aov": delta("aov")},
        "pending_orders": scope(Order.objects.filter(status__in=OPEN), branch_ids).count(),
        "cancelled_orders": orders_in(
            period.start, period.end, branch_ids, statuses=[OrderStatus.CANCELLED], date_field="cancelled_at"
        ).count(),
        "payment_failures": scope(
            Payment.objects.filter(state=PaymentState.FAILED, created_at__gte=period.start, created_at__lt=period.end),
            branch_ids,
            "order__branch_id",
        ).count(),
        "active_products": Product.objects.filter(status="ACTIVE", is_available=True).count(),
        "low_stock_products": low,
        "near_expiry_batches": live.filter(
            status=BatchStatus.ACTIVE, expiry_date__gte=today, expiry_date__lte=today + dt.timedelta(days=3)
        ).count(),
        "expired_batches_on_hand": live.filter(expiry_date__lt=today).count(),
        "waste": waste_summary(period.start, period.end, branch_ids),
        "slot_utilization_pct": pct(slots["b"] or 0, slots["c"]),
        "fulfilment": ful,
    }


# ----------------------------------------------------------------------------------------- dashboard series
def dashboard(period: Period, branch_ids) -> dict:
    tz = period.tz
    by_day = {
        r["d"]: r
        for r in orders_in(period.start, period.end, branch_ids)
        .annotate(d=TruncDate("placed_at", tzinfo=tz))
        .values("d")
        .annotate(orders=Count("id"), gross=Coalesce(Sum(AMOUNT_DUE), ZERO, output_field=MONEY))
    }
    series, day = [], period.date_from
    while day <= period.date_to:
        r = by_day.get(day)
        series.append(
            {
                "date": day.isoformat(),
                "orders": r["orders"] if r else 0,
                "gross_sales": str(money(r["gross"])) if r else "0.00",
            }
        )
        day += dt.timedelta(days=1)

    status_rows = (
        scope(Order.objects.filter(placed_at__gte=period.start, placed_at__lt=period.end), branch_ids)
        .values("status")
        .annotate(n=Count("id"))
    )
    items = accepted_items(period.start, period.end, branch_ids)
    by_category = (
        items.values(category_name=F("product__category__name"))
        .annotate(revenue=Coalesce(Sum(LINE_VALUE), ZERO, output_field=MONEY))
        .order_by("-revenue")[:8]
    )
    top = (
        items.values("product_id", "name", "unit_symbol")
        .annotate(
            units=Coalesce(Sum(Coalesce("picked_qty", "ordered_qty", output_field=QTY)), ZERO, output_field=QTY),
            revenue=Coalesce(Sum(LINE_VALUE), ZERO, output_field=MONEY),
        )
        .order_by("-revenue")[:8]
    )
    branches = (
        orders_in(period.start, period.end, branch_ids)
        .values("branch__name")
        .annotate(orders=Count("id"), gross=Coalesce(Sum(AMOUNT_DUE), ZERO, output_field=MONEY))
        .order_by("-gross")
    )
    waste_by_day = (
        scope(
            StockMovement.objects.filter(
                kind=MovementKind.WASTE, created_at__gte=period.start, created_at__lt=period.end
            ),
            branch_ids,
        )
        .annotate(d=TruncDate("created_at", tzinfo=tz))
        .values("d")
        .annotate(units=Sum(-F("qty_delta")))
        .order_by("d")
    )
    return {
        "period": period.as_dict(),
        "kpis": kpis(period, branch_ids),
        "sales_by_day": series,
        "orders_by_status": [
            {"status": r["status"], "label": OrderStatus(r["status"]).label, "count": r["n"]} for r in status_rows
        ],
        "sales_by_category": [
            {"category": r["category_name"], "revenue": str(money(r["revenue"]))} for r in by_category
        ],
        "top_products": [
            {
                "product_id": r["product_id"],
                "name": r["name"],
                "unit": r["unit_symbol"],
                "units": qty_str(r["units"]),
                "revenue": str(money(r["revenue"])),
            }
            for r in top
        ],
        "branch_performance": [
            {"branch": r["branch__name"], "orders": r["orders"], "gross_sales": str(money(r["gross"]))}
            for r in branches
        ],
        "stock_health": stock_health(branch_ids),
        "expiry_risk": expiry_risk(branch_ids),
        "waste_by_day": [{"date": r["d"].isoformat(), "units": qty_str(r["units"])} for r in waste_by_day],
    }


# ----------------------------------------------------------------------------------------- tabular reports
def _col(key, label, kind="text"):
    return {"key": key, "label": label, "type": kind}


def _report(columns, rows, summary=None) -> dict:
    return {"columns": columns, "rows": rows, "summary": summary or {}}


def report_sales(period, branch_ids):
    accepted = orders_in(period.start, period.end, branch_ids).annotate(d=TruncDate("placed_at", tzinfo=period.tz))
    rows = []
    refunds = {
        r["d"]: r["v"]
        for r in scope(
            Refund.objects.filter(
                status=RefundStatus.SUCCEEDED, completed_at__gte=period.start, completed_at__lt=period.end
            ),
            branch_ids,
            "order__branch_id",
        )
        .annotate(d=TruncDate("completed_at", tzinfo=period.tz))
        .values("d")
        .annotate(v=Sum("amount"))
    }
    for r in (
        accepted.values("d")
        .annotate(
            orders=Count("id"),
            gross=Sum(AMOUNT_DUE),
            disc=Sum("coupon_discount") + Sum("promo_savings"),
            delivery=Sum("delivery_fee"),
        )
        .order_by("d")
    ):
        rows.append(
            {
                "date": r["d"].isoformat(),
                "orders": r["orders"],
                "gross_sales": str(money(r["gross"])),
                "aov": str(money(r["gross"] / r["orders"])),
                "discounts": str(money(r["disc"])),
                "delivery_fees": str(money(r["delivery"])),
                "refunds": str(money(refunds.get(r["d"], ZERO))),
            }
        )
    s = sales_summary(period.start, period.end, branch_ids)
    cols = [
        _col("date", "Date", "date"),
        _col("orders", "Orders", "int"),
        _col("gross_sales", "Gross sales", "money"),
        _col("aov", "Avg order value", "money"),
        _col("discounts", "Discounts", "money"),
        _col("delivery_fees", "Delivery fees", "money"),
        _col("refunds", "Refunds", "money"),
    ]
    return _report(cols, rows, {k: str(v) if v is not None else None for k, v in s.items()})


def _group_report(period, branch_ids, group_field, label_key, label):
    items = accepted_items(period.start, period.end, branch_ids)
    data = (
        items.values(key=F(group_field))
        .annotate(
            orders=Count("order_id", distinct=True),
            units=Coalesce(Sum(Coalesce("picked_qty", "ordered_qty", output_field=QTY)), ZERO, output_field=QTY),
            revenue=Coalesce(Sum(LINE_VALUE), ZERO, output_field=MONEY),
        )
        .order_by("-revenue")[:500]
    )
    total = sum((r["revenue"] for r in data), ZERO)
    rows = [
        {
            label_key: r["key"] or "—",
            "orders": r["orders"],
            "units": qty_str(r["units"]),
            "revenue": str(money(r["revenue"])),
            "share_pct": str(pct(r["revenue"], total) or "0.0"),
        }
        for r in data
    ]
    cols = [
        _col(label_key, label),
        _col("orders", "Orders", "int"),
        _col("units", "Units sold", "qty"),
        _col("revenue", "Revenue (line totals)", "money"),
        _col("share_pct", "Share %", "pct"),
    ]
    return _report(cols, rows, {"revenue": str(money(total))})


def report_products(period, branch_ids):
    items = accepted_items(period.start, period.end, branch_ids)
    data = (
        items.values(
            "product_id",
            "sku",
            "name",
            "unit_symbol",
            cat=F("product__category__name"),
            brand=F("product__brand__name"),
        )
        .annotate(
            orders=Count("order_id", distinct=True),
            units=Coalesce(Sum(Coalesce("picked_qty", "ordered_qty", output_field=QTY)), ZERO, output_field=QTY),
            revenue=Coalesce(Sum(LINE_VALUE), ZERO, output_field=MONEY),
        )
        .order_by("-revenue")[:500]
    )
    rows = [
        {
            "sku": r["sku"],
            "name": r["name"],
            "category": r["cat"],
            "brand": r["brand"] or "—",
            "unit": r["unit_symbol"],
            "orders": r["orders"],
            "units": qty_str(r["units"]),
            "revenue": str(money(r["revenue"])),
        }
        for r in data
    ]
    cols = [
        _col("sku", "SKU"),
        _col("name", "Product"),
        _col("category", "Category"),
        _col("brand", "Brand"),
        _col("unit", "Unit"),
        _col("orders", "Orders", "int"),
        _col("units", "Units sold", "qty"),
        _col("revenue", "Revenue", "money"),
    ]
    return _report(cols, rows)


def report_categories(period, branch_ids):
    return _group_report(period, branch_ids, "product__category__name", "category", "Category")


def report_brands(period, branch_ids):
    return _group_report(period, branch_ids, "product__brand__name", "brand", "Brand")


def report_branches(period, branch_ids):
    rows = []
    for r in (
        orders_in(period.start, period.end, branch_ids)
        .values("branch_id", "branch__name")
        .annotate(orders=Count("id"), gross=Sum(AMOUNT_DUE))
        .order_by("-gross")
    ):
        ful = fulfilment_summary(period.start, period.end, [r["branch_id"]])
        cancelled = orders_in(
            period.start, period.end, [r["branch_id"]], statuses=[OrderStatus.CANCELLED], date_field="cancelled_at"
        ).count()
        rows.append(
            {
                "branch": r["branch__name"],
                "orders": r["orders"],
                "gross_sales": str(money(r["gross"])),
                "aov": str(money(r["gross"] / r["orders"])),
                "cancelled": cancelled,
                "on_time_rate": str(ful["on_time_rate"]) if ful["on_time_rate"] is not None else "",
                "avg_pick_minutes": str(ful["avg_pick_to_ready_minutes"] or ""),
            }
        )
    cols = [
        _col("branch", "Branch"),
        _col("orders", "Orders", "int"),
        _col("gross_sales", "Gross sales", "money"),
        _col("aov", "AOV", "money"),
        _col("cancelled", "Cancelled", "int"),
        _col("on_time_rate", "On-time deliveries %", "pct"),
        _col("avg_pick_minutes", "Avg pick→ready (min)", "qty"),
    ]
    return _report(cols, rows)


def report_inventory_valuation(period, branch_ids):
    rows, total, unvalued = [], ZERO, 0
    levels = (
        scope(StockLevel.objects.filter(on_hand__gt=0), branch_ids)
        .select_related("product", "branch")
        .order_by("branch__name", "product__name")
    )
    avg_cost = {
        (r["product_id"], r["branch_id"]): r["c"]
        for r in StockMovement.objects.filter(kind=MovementKind.RECEIPT, unit_cost__isnull=False)
        .values("product_id", "branch_id")
        .annotate(c=Avg("unit_cost"))
    }
    batch_value = {
        (r["product_id"], r["branch_id"]): (r["v"], r["q"])
        for r in Batch.objects.filter(qty_remaining__gt=0, unit_cost__isnull=False)
        .values("product_id", "branch_id")
        .annotate(v=Sum(F("qty_remaining") * F("unit_cost")), q=Sum("qty_remaining"))
    }
    for lv in levels:
        key = (lv.product_id, lv.branch_id)
        if lv.product.tracks_batches and key in batch_value:
            value, costed = batch_value[key]
            cost = value / costed if costed else None
        elif key in avg_cost:
            cost = avg_cost[key]
            value = lv.on_hand * cost
        else:
            cost, value = None, None
            unvalued += 1
        if value is not None:
            total += value
        rows.append(
            {
                "branch": lv.branch.name,
                "sku": lv.product.sku,
                "name": lv.product.name,
                "on_hand": qty_str(lv.on_hand),
                "unit_cost": str(money(cost)) if cost is not None else "",
                "value": str(money(value)) if value is not None else "",
            }
        )
    cols = [
        _col("branch", "Branch"),
        _col("sku", "SKU"),
        _col("name", "Product"),
        _col("on_hand", "On hand", "qty"),
        _col("unit_cost", "Avg unit cost", "money"),
        _col("value", "Value", "money"),
    ]
    return _report(cols, rows, {"total_value": str(money(total)), "unvalued_lines": unvalued})


def report_stock_adjustments(period, branch_ids):
    mv = (
        scope(
            StockMovement.objects.filter(
                created_at__gte=period.start,
                created_at__lt=period.end,
                kind__in=[
                    MovementKind.ADJUSTMENT,
                    MovementKind.TRANSFER_IN,
                    MovementKind.TRANSFER_OUT,
                    MovementKind.RETURN,
                ],
            ),
            branch_ids,
        )
        .select_related("product", "branch", "actor", "batch")
        .order_by("-created_at")[:2000]
    )
    rows = [
        {
            "when": m.created_at.astimezone(period.tz).strftime("%Y-%m-%d %H:%M"),
            "branch": m.branch.name,
            "sku": m.product.sku,
            "name": m.product.name,
            "kind": m.get_kind_display(),
            "change": qty_str(m.qty_delta),
            "on_hand_after": qty_str(m.on_hand_after),
            "lot": m.batch.lot_code if m.batch_id else "",
            "by": m.actor.email if m.actor_id else "system",
            "note": m.note,
        }
        for m in mv
    ]
    cols = [
        _col("when", "When"),
        _col("branch", "Branch"),
        _col("sku", "SKU"),
        _col("name", "Product"),
        _col("kind", "Type"),
        _col("change", "Change", "qty"),
        _col("on_hand_after", "On hand after", "qty"),
        _col("lot", "Lot"),
        _col("by", "By"),
        _col("note", "Reason / note"),
    ]
    return _report(cols, rows)


def report_expiry_losses(period, branch_ids):
    mv = (
        scope(
            StockMovement.objects.filter(
                kind=MovementKind.WASTE, created_at__gte=period.start, created_at__lt=period.end
            ),
            branch_ids,
        )
        .select_related("product", "branch", "batch", "actor")
        .order_by("-created_at")[:2000]
    )
    rows, total, unknown = [], ZERO, 0
    for m in mv:
        cost = m.unit_cost if m.unit_cost is not None else (m.batch.unit_cost if m.batch_id else None)
        value = -m.qty_delta * cost if cost is not None else None
        if value is None:
            unknown += 1
        else:
            total += value
        rows.append(
            {
                "when": m.created_at.astimezone(period.tz).strftime("%Y-%m-%d %H:%M"),
                "branch": m.branch.name,
                "sku": m.product.sku,
                "name": m.product.name,
                "quantity": qty_str(-m.qty_delta),
                "reason": m.reason_code,
                "lot": m.batch.lot_code if m.batch_id else "",
                "expiry": m.batch.expiry_date.isoformat() if m.batch_id and m.batch.expiry_date else "",
                "value": str(money(value)) if value is not None else "",
                "by": m.actor.email if m.actor_id else "system",
            }
        )
    cols = [
        _col("when", "When"),
        _col("branch", "Branch"),
        _col("sku", "SKU"),
        _col("name", "Product"),
        _col("quantity", "Quantity", "qty"),
        _col("reason", "Reason"),
        _col("lot", "Lot"),
        _col("expiry", "Expiry"),
        _col("value", "Value at cost", "money"),
        _col("by", "Recorded by"),
    ]
    return _report(cols, rows, {"total_value": str(money(total)), "movements_without_cost": unknown})


def report_suppliers(period, branch_ids):
    rows = []
    for s in Supplier.objects.order_by("name"):
        perf = supplier_performance(s, since=period.date_from)
        rows.append(
            {
                "supplier": s.name,
                "status": s.get_status_display(),
                "orders": perf["orders"],
                "receipts": perf["receipts"],
                "fill_rate": perf["fill_rate"] or "",
                "rejection_rate": perf["rejection_rate"] or "",
                "on_time_rate": perf["on_time_rate"] or "",
                "lead_time_days": s.lead_time_days,
            }
        )
    cols = [
        _col("supplier", "Supplier"),
        _col("status", "Status"),
        _col("orders", "Orders", "int"),
        _col("receipts", "Receipts", "int"),
        _col("fill_rate", "Fill rate %", "pct"),
        _col("rejection_rate", "Rejected %", "pct"),
        _col("on_time_rate", "On time %", "pct"),
        _col("lead_time_days", "Quoted lead time (days)", "int"),
    ]
    return _report(cols, rows)


def report_promotions(period, branch_ids):
    coupons = (
        scope(
            CouponRedemption.objects.filter(
                status=RedemptionStatus.ACTIVE, created_at__gte=period.start, created_at__lt=period.end
            ),
            branch_ids,
            "order__branch_id",
        )
        .values(code=F("coupon__code"))
        .annotate(uses=Count("id"), discount=Sum("amount"))
        .order_by("-discount")
    )
    rows = [
        {"type": "Coupon", "name": r["code"], "uses": r["uses"], "customer_saving": str(money(r["discount"]))}
        for r in coupons
    ]
    promos = (
        accepted_items(period.start, period.end, branch_ids)
        .exclude(promo_label="")
        .exclude(promo_label="Substitute")
        .values(label=F("promo_label"))
        .annotate(
            uses=Count("id"),
            saved=Sum(F("base_unit_price") * Coalesce("picked_qty", "ordered_qty", output_field=QTY) - LINE_VALUE),
        )
        .order_by("-saved")
    )
    rows += [
        {"type": "Promotion", "name": r["label"], "uses": r["uses"], "customer_saving": str(money(r["saved"] or ZERO))}
        for r in promos
    ]
    cols = [
        _col("type", "Type"),
        _col("name", "Code / label"),
        _col("uses", "Uses", "int"),
        _col("customer_saving", "Customer saving", "money"),
    ]
    return _report(cols, rows)


def report_refunds(period, branch_ids):
    refunds = (
        scope(
            Refund.objects.filter(created_at__gte=period.start, created_at__lt=period.end),
            branch_ids,
            "order__branch_id",
        )
        .select_related("order", "requested_by")
        .order_by("-created_at")[:2000]
    )
    rows = [
        {
            "when": r.created_at.astimezone(period.tz).strftime("%Y-%m-%d %H:%M"),
            "order": r.order.number,
            "type": "Refund",
            "amount": str(r.amount),
            "status": r.get_status_display(),
            "method": r.get_method_display(),
            "reason": r.reason,
            "by": r.requested_by.email if r.requested_by_id else "system",
        }
        for r in refunds
    ]
    cancelled = orders_in(
        period.start, period.end, branch_ids, statuses=[OrderStatus.CANCELLED], date_field="cancelled_at"
    ).select_related("cancelled_by")[:2000]
    rows += [
        {
            "when": o.cancelled_at.astimezone(period.tz).strftime("%Y-%m-%d %H:%M"),
            "order": o.number,
            "type": "Cancellation",
            "amount": str(o.total),
            "status": "Cancelled",
            "method": "",
            "reason": o.cancel_reason,
            "by": o.cancelled_by.email if o.cancelled_by_id else "customer/system",
        }
        for o in cancelled
    ]
    cols = [
        _col("when", "When"),
        _col("order", "Order"),
        _col("type", "Type"),
        _col("amount", "Amount", "money"),
        _col("status", "Status"),
        _col("method", "Method"),
        _col("reason", "Reason"),
        _col("by", "By"),
    ]
    ok = _sum(
        scope(
            Refund.objects.filter(
                status=RefundStatus.SUCCEEDED, completed_at__gte=period.start, completed_at__lt=period.end
            ),
            branch_ids,
            "order__branch_id",
        ),
        "amount",
    )
    return _report(cols, rows, {"refunds_completed": str(money(ok))})


def report_delivery(period, branch_ids):
    slots = (
        scope(DeliverySlot.objects.filter(date__gte=period.date_from, date__lte=period.date_to), branch_ids)
        .values("date", "kind", "branch__name")
        .annotate(cap=Sum("capacity"), booked=Sum("booked"))
        .order_by("date", "branch__name", "kind")
    )
    rows = [
        {
            "date": s["date"].isoformat(),
            "branch": s["branch__name"],
            "kind": s["kind"].title(),
            "capacity": s["cap"],
            "booked": s["booked"],
            "utilization_pct": str(pct(s["booked"], s["cap"]) or "0.0"),
        }
        for s in slots
    ]
    cols = [
        _col("date", "Date", "date"),
        _col("branch", "Branch"),
        _col("kind", "Type"),
        _col("capacity", "Capacity", "int"),
        _col("booked", "Booked", "int"),
        _col("utilization_pct", "Utilisation %", "pct"),
    ]
    return _report(
        cols,
        rows,
        {
            k: (str(v) if v is not None else None)
            for k, v in fulfilment_summary(period.start, period.end, branch_ids).items()
        },
    )


def report_customers(period, branch_ids):
    per_customer = (
        orders_in(period.start, period.end, branch_ids)
        .values("customer_id", "contact_email")
        .annotate(orders=Count("id"), spend=Sum(AMOUNT_DUE))
        .order_by("-spend")
    )
    freq: dict[int, int] = {}
    rows = []
    for r in per_customer[:500]:
        freq[min(r["orders"], 5)] = freq.get(min(r["orders"], 5), 0) + 1
        local, _, domain = r["contact_email"].partition("@")
        rows.append(
            {
                "customer": f"{local[:1]}***@{domain}",
                "registered": "Yes" if r["customer_id"] else "Guest",
                "orders": r["orders"],
                "spend": str(money(r["spend"])),
            }
        )
    total_customers = per_customer.count()
    repeat = sum(1 for r in per_customer if r["orders"] > 1)
    cols = [
        _col("customer", "Customer (masked)"),
        _col("registered", "Account"),
        _col("orders", "Orders in period", "int"),
        _col("spend", "Spend", "money"),
    ]
    return _report(
        cols,
        rows,
        {
            "customers": total_customers,
            "repeat_customers": repeat,
            "repeat_rate_pct": str(pct(repeat, total_customers) or "0.0"),
            "orders_per_customer_distribution": {str(k): v for k, v in sorted(freq.items())},
        },
    )


REPORTS = {
    "sales": ("Sales by day", report_sales),
    "products": ("Product performance", report_products),
    "categories": ("Category performance", report_categories),
    "brands": ("Brand performance", report_brands),
    "branches": ("Branch performance", report_branches),
    "inventory-valuation": ("Inventory valuation", report_inventory_valuation),
    "stock-adjustments": ("Stock adjustments & transfers", report_stock_adjustments),
    "expiry-losses": ("Waste & expiry losses", report_expiry_losses),
    "suppliers": ("Supplier receiving performance", report_suppliers),
    "promotions": ("Promotion & coupon usage", report_promotions),
    "refunds": ("Refunds & cancellations", report_refunds),
    "delivery": ("Delivery performance & slot utilisation", report_delivery),
    "customers": ("Customer order frequency", report_customers),
}

_ = (Case, Value, When)
