"""Suppliers, purchase orders and the stock/batch/ledger scenarios."""

from __future__ import annotations

import datetime as dt
import zlib
from decimal import ROUND_HALF_UP, Decimal

from django.db.models import F, Sum
from django.utils import timezone

from apps.accounts.models import User
from apps.catalog.models import Product
from apps.inventory.models import (
    Batch,
    BatchStatus,
    ExpiryKind,
    MovementKind,
    QualityStatus,
    StockLevel,
    StockMovement,
    WasteReason,
)
from apps.purchasing.models import (
    POStatus,
    PurchaseOrder,
    PurchaseOrderLine,
    Supplier,
    SupplierProduct,
    SupplierStatus,
)
from apps.stores.models import Branch

from .accounts_data import DEMO_DOMAIN
from .catalog_data import PRODUCT_BY_NAME, PRODUCTS
from .common import DEMO_REF, Tally, day_offset, local_dt, today
from .ops_data import PURCHASE_ORDERS, SINGLE_BRANCH, STOCK_SCENARIOS, SUPPLIER_NOTE, SUPPLIERS

D = Decimal
BASE_QTY = {"kg": 45, "100g": 60, "each": 60, "pack": 40, "box": 36, "bundle": 30, "dozen": 30}
BRANCH_TAG = {"central": "CEN", "north": "NOR"}


def money4(value: Decimal) -> Decimal:
    return value.quantize(D("0.0001"), rounding=ROUND_HALF_UP)


# --------------------------------------------------------------------------- suppliers
def seed_suppliers(
    products: dict[str, Product], tally: Tally
) -> tuple[dict[str, Supplier], dict[str, Supplier], dict[str, Decimal]]:
    suppliers: dict[str, Supplier] = {}
    by_category: dict[str, Supplier] = {}
    for spec in SUPPLIERS:
        existing = Supplier.objects.filter(code=spec["code"]).first()
        if existing is not None and not existing.is_demo:
            tally.skip("Supplier", f"{spec['code']!r} exists and is not demo data; left unchanged")
            continue
        supplier, created = Supplier.objects.update_or_create(
            code=spec["code"],
            defaults={
                "name": spec["name"],
                "contact_name": spec["contact_name"],
                "email": spec["email"],
                "phone": spec["phone"],
                "address": spec["address"],
                "status": SupplierStatus.ACTIVE,
                "lead_time_days": spec["lead_time_days"],
                "notes": SUPPLIER_NOTE,
                "is_demo": True,
            },
        )
        tally.add("Supplier", created)
        suppliers[spec["code"]] = supplier
        for category in spec["categories"]:
            by_category[category] = supplier

    costs: dict[str, Decimal] = {}
    prefix = {s["code"]: s["prefix"] for s in SUPPLIERS}
    for rec in PRODUCTS:
        product = products.get(rec["name"])
        supplier = by_category.get(rec["cat"])
        if product is None or supplier is None:
            continue
        cost = money4(rec["price"] * D(str(rec["cost_factor"])))
        costs[rec["sku"]] = cost
        _, created = SupplierProduct.objects.update_or_create(
            supplier=supplier,
            product=product,
            defaults={"supplier_sku": f"{prefix[supplier.code]}-{rec['sku'][3:]}", "unit_cost": cost},
        )
        tally.add("SupplierProduct", created)
    return suppliers, by_category, costs


def seed_purchase_orders(
    suppliers: dict[str, Supplier],
    branches: dict[str, Branch],
    products: dict[str, Product],
    costs: dict[str, Decimal],
    tally: Tally,
) -> None:
    buyer = User.objects.filter(email__iexact=f"purchasing@{DEMO_DOMAIN}").first()
    now = timezone.now()
    for spec in PURCHASE_ORDERS:
        supplier, branch = suppliers.get(spec["supplier"]), branches.get(spec["branch"])
        if supplier is None or branch is None:
            continue
        po = PurchaseOrder.objects.filter(number=spec["number"]).first()
        if po is not None and not po.is_demo:
            tally.skip("PurchaseOrder", f"{spec['number']} exists and is not demo data; left unchanged")
            continue
        if po is not None and (po.status != spec["status"] or po.receipts.exists()):
            tally.skip("PurchaseOrder", f"{spec['number']} has moved on from {spec['status']}; left unchanged")
            continue
        created = po is None
        po = po or PurchaseOrder(number=spec["number"])
        po.supplier, po.branch, po.status = supplier, branch, POStatus(spec["status"])
        po.expected_date = day_offset(spec["expected_in"])
        po.notes, po.created_by, po.is_demo = spec["notes"], buyer, True
        po.submitted_at = now - dt.timedelta(days=spec["submitted_ago"]) if spec["submitted_ago"] is not None else None
        po.save()
        tally.add("PurchaseOrder", created)
        wanted = []
        for name, qty in spec["lines"]:
            product = products.get(name)
            if product is None:  # the product was not seeded (a real product owns its SKU)
                tally.warn(f"{spec['number']}: line for {name!r} skipped (product not seeded)")
                continue
            wanted.append(product)
            _, line_created = PurchaseOrderLine.objects.update_or_create(
                purchase_order=po,
                product=product,
                defaults={"qty_ordered": D(qty), "unit_cost": costs[PRODUCT_BY_NAME[name]["sku"]]},
            )
            tally.add("PurchaseOrderLine", line_created)
        PurchaseOrderLine.objects.filter(purchase_order=po).exclude(product__in=wanted).delete()


# --------------------------------------------------------------------------- stock planning
def _round_qty(unit: str, value: Decimal) -> Decimal:
    if unit == "kg":
        return (value * 2).quantize(D("1"), rounding=ROUND_HALF_UP) / 2
    return value.quantize(D("1"), rounding=ROUND_HALF_UP)


def base_qty(rec: dict, code: str) -> Decimal:
    crc = zlib.crc32(f"{rec['sku']}:{code}".encode())
    qty = D(BASE_QTY[rec["unit"]]) * D(70 + crc % 61) / 100
    if code == "north":
        qty *= D("0.55")
    return max(_round_qty(rec["unit"], qty), D(rec["qty"][0]) * 4)


def default_batches(rec: dict, total: Decimal) -> list[dict]:
    shelf = rec["shelf"]
    if shelf <= 3 or total <= 6:
        return [{"suffix": "A", "received_ago": 0, "days_left": shelf, "qty": total}]
    older = max(1, min(6, shelf // 4))
    first = _round_qty(rec["unit"], total * D("0.4"))
    return [
        {"suffix": "A", "received_ago": older, "days_left": shelf - older, "qty": first},
        {
            "suffix": "B",
            "received_ago": 0 if shelf < 10 else 1,
            "days_left": shelf - (0 if shelf < 10 else 1),
            "qty": total - first,
        },
    ]


def plan_for(rec: dict, code: str) -> dict | None:
    """Stock plan for one product at one branch (None = not stocked there)."""
    if code == "north" and rec["name"] in SINGLE_BRANCH:
        return None
    spec = STOCK_SCENARIOS.get(rec["name"], {}).get(code, {})
    base = base_qty(rec, code)
    threshold = D(spec["threshold"]) if "threshold" in spec else _round_qty(rec["unit"], base * D("0.2"))
    plan = {"threshold": threshold, "reorder": _round_qty(rec["unit"], base * D("0.8"))}
    tracked_batches = rec["batches"] and not rec["mto"]
    if "batches" in spec:
        plan["batches"] = spec["batches"]
    elif tracked_batches:
        total = D(str(spec["on_hand"])) if "on_hand" in spec else base
        plan["batches"] = default_batches(rec, total) if total > 0 else []
    else:
        plan["batches"] = None
        plan["on_hand"] = D(str(spec["on_hand"])) if "on_hand" in spec else base
    return plan


# --------------------------------------------------------------------------- stock execution
def _movement(product, branch, kind, delta, after, ref_id, when, *, batch=None, cost=None, reason="", note="") -> None:
    row = StockMovement.objects.create(
        product=product,
        branch=branch,
        batch=batch,
        kind=kind,
        qty_delta=delta,
        on_hand_after=after,
        unit_cost=cost,
        reason_code=reason,
        note=note,
        ref_type=DEMO_REF,
        ref_id=ref_id,
    )
    StockMovement.objects.filter(pk=row.pk).update(created_at=when)  # backdate once; the ledger is otherwise immutable


def _restamp(ref_id: str, when) -> None:
    StockMovement.objects.filter(ref_type=DEMO_REF, ref_id=ref_id).update(created_at=when)


def seed_inventory(
    products: dict[str, Product],
    branches: dict[str, Branch],
    costs: dict[str, Decimal],
    by_category: dict[str, Supplier],
    tally: Tally,
) -> None:
    for rec in PRODUCTS:
        product = products.get(rec["name"])
        if product is None or rec["mto"] or rec["state"] == "archived":
            continue
        for code, branch in branches.items():
            plan = plan_for(rec, code)
            if plan is None:
                continue
            level, created = StockLevel.objects.get_or_create(
                product=product,
                branch=branch,
                defaults={
                    "on_hand": D("0"),
                    "reserved": D("0"),
                    "low_stock_threshold": plan["threshold"],
                    "reorder_quantity": plan["reorder"],
                },
            )
            tally.add("StockLevel", created)
            if not created:
                StockLevel.objects.filter(pk=level.pk).update(
                    low_stock_threshold=plan["threshold"], reorder_quantity=plan["reorder"]
                )
            cost = costs.get(rec["sku"])
            events: list[tuple] = []
            added = D("0")
            if plan["batches"] is None:  # shelf-stable product tracked without lots
                ref = f"{rec['sku']}@{code}:RECEIPT"
                ago = 8 + zlib.crc32(ref.encode()) % 20
                when = local_dt(today() - dt.timedelta(days=ago), 9, 0)
                if StockMovement.objects.filter(ref_type=DEMO_REF, ref_id=ref).exists():
                    _restamp(ref, when)
                elif plan["on_hand"] > 0:
                    events.append((when, MovementKind.RECEIPT, plan["on_hand"], None, ref, "", "Demo seed receipt"))
                    added += plan["on_hand"]
            else:
                for spec in plan["batches"]:
                    added += _seed_batch(rec, product, branch, code, spec, by_category, cost, events)
            running = StockMovement.objects.filter(product=product, branch=branch).aggregate(s=Sum("qty_delta"))[
                "s"
            ] or D("0")
            for when, kind, delta, batch, ref, reason, note in sorted(events, key=lambda e: e[0]):
                running += delta
                _movement(
                    product, branch, kind, delta, running, ref, when, batch=batch, cost=cost, reason=reason, note=note
                )
                tally.add("StockMovement", True)
            if added:
                StockLevel.objects.filter(pk=level.pk).update(on_hand=F("on_hand") + added)


def _seed_batch(rec, product, branch, code, spec, by_category, cost, events) -> Decimal:
    """Create (or re-date) one lot. Returns the on-hand quantity the lot added to the stock level."""
    lot = f"LOT-{BRANCH_TAG[code]}-{rec['index']:04d}-{spec['suffix']}"
    received_on = today() - dt.timedelta(days=spec["received_ago"])
    expiry = today() + dt.timedelta(days=spec["days_left"]) if spec.get("days_left") is not None else None
    sellable = expiry - dt.timedelta(days=rec["buffer"]) if expiry else None
    qty = D(str(spec["qty"]))
    waste = D(str(spec.get("waste", 0)))
    receipt_when = local_dt(received_on, 6, 30)
    waste_when = None
    if waste and expiry:
        waste_when = min(timezone.now() - dt.timedelta(hours=1), local_dt(expiry + dt.timedelta(days=1), 7, 0))
    expired = expiry is not None and expiry < today()
    batch = Batch.objects.filter(product=product, branch=branch, lot_code=lot).first()
    if batch is not None:
        if not batch.is_demo:
            return D("0")
        Batch.objects.filter(pk=batch.pk).update(
            received_on=received_on, expiry_date=expiry, sellable_until=sellable, unit_cost=cost
        )
        _restamp(f"{lot}:RECEIPT", receipt_when)
        if waste_when:
            _restamp(f"{lot}:WASTE", waste_when)
        return D("0")
    status = spec.get("status") or (BatchStatus.EXPIRED if expired else BatchStatus.ACTIVE)
    batch = Batch.objects.create(
        product=product,
        branch=branch,
        supplier=by_category.get(rec["cat"]),
        lot_code=lot,
        received_on=received_on,
        expiry_date=expiry,
        expiry_kind=ExpiryKind(rec["expiry"]),
        sellable_until=sellable,
        qty_received=qty,
        qty_remaining=qty - waste,
        qty_reserved=D("0"),
        unit_cost=cost,
        status=BatchStatus(status),
        quality_status=QualityStatus(spec.get("quality", "PASSED")),
        notes=spec.get("note", ""),
        is_demo=True,
    )
    events.append((receipt_when, MovementKind.RECEIPT, qty, batch, f"{lot}:RECEIPT", "", "Demo seed receipt"))
    if waste:
        events.append(
            (
                waste_when or timezone.now() - dt.timedelta(hours=1),
                MovementKind.WASTE,
                -waste,
                batch,
                f"{lot}:WASTE",
                WasteReason.EXPIRED,
                "Written off after expiry (demo)",
            )
        )
    return qty - waste
