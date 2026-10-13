"""Inventory operations. Every function here must run inside a database transaction.

Strategy (documented in docs/inventory-and-fulfilment.md):

* **Reserve** when an order is placed → `StockLevel.reserved` (and `Batch.qty_reserved` for batch-tracked
  products, allocated FEFO) goes up; `on_hand` is untouched.
* **Commit** when the picker records the picked quantity → `on_hand` goes down, a SALE movement is written,
  unused reservation is released.
* **Release** on cancellation / payment expiry / short-pick.

Concurrency: rows are locked with `SELECT … FOR UPDATE` in a deterministic order (stock levels by product id,
batches by id), so concurrent checkouts serialise instead of deadlocking, and the CHECK constraint
`reserved <= on_hand` is the last line of defence against overselling.
"""

from __future__ import annotations

import datetime as dt
import logging
from collections.abc import Iterable
from dataclasses import dataclass
from decimal import Decimal

from django.db import connection, transaction
from django.db.models import F, Sum
from django.utils import timezone

from apps.core.exceptions import DomainError, ErrorCode
from apps.core.money import ZERO, qty, qty_str

from .availability import sellable_batch_q
from .models import (
    Allocation,
    AllocationState,
    Batch,
    BatchStatus,
    ExpiryKind,
    MovementKind,
    QualityStatus,
    StockLevel,
    StockMovement,
    WasteReason,
)

logger = logging.getLogger(__name__)


def _require_transaction() -> None:
    if not connection.in_atomic_block:
        raise RuntimeError("inventory operations must run inside transaction.atomic()")


@dataclass
class ReserveRequest:
    order_item: object  # orders.OrderItem
    product: object  # catalog.Product
    qty: Decimal


# ----------------------------------------------------------------------------------------- locking helpers
def lock_levels(product_ids: Iterable[int], branch_id: int) -> dict[int, StockLevel]:
    ids = sorted(set(product_ids))
    if not ids:
        return {}
    existing = set(
        StockLevel.objects.filter(branch_id=branch_id, product_id__in=ids).values_list("product_id", flat=True)
    )
    missing = [i for i in ids if i not in existing]
    if missing:  # race-safe: unique(product, branch) + ignore_conflicts
        StockLevel.objects.bulk_create(
            [StockLevel(product_id=i, branch_id=branch_id) for i in missing], ignore_conflicts=True
        )
    rows = StockLevel.objects.select_for_update().filter(branch_id=branch_id, product_id__in=ids).order_by("product_id")
    return {row.product_id: row for row in rows}


def _fefo_batches(product_id: int, branch_id: int, on_date: dt.date, lock: bool = True):
    qs = Batch.objects.filter(product_id=product_id, branch_id=branch_id).filter(sellable_batch_q(on_date))
    qs = qs.annotate(free=F("qty_remaining") - F("qty_reserved")).filter(free__gt=0)
    qs = qs.order_by(F("sellable_until").asc(nulls_last=True), "received_on", "id")
    return qs.select_for_update() if lock else qs


# ----------------------------------------------------------------------------------------- reserve / release
def reserve(requests: list[ReserveRequest], branch_id: int, on_date: dt.date | None = None) -> list[Allocation]:
    """Reserve stock for order lines or raise `INSUFFICIENT_STOCK` listing *every* short line."""
    _require_transaction()
    on_date = on_date or timezone.localdate()
    counted = [r for r in requests if r.product.stock_mode == "TRACKED" and r.qty > 0]
    levels = lock_levels((r.product.id for r in counted), branch_id)
    shortages: list[dict] = []
    created: list[Allocation] = []
    level_delta: dict[int, Decimal] = {}

    for req in sorted(counted, key=lambda r: (r.product.id, getattr(r.order_item, "id", 0))):
        product, need = req.product, qty(req.qty)
        level = levels[product.id]
        free_on_level = level.on_hand - level.reserved - level_delta.get(product.id, ZERO)
        plan: list[tuple[Batch | None, Decimal]] = []
        if product.tracks_batches:
            remaining = need
            for batch in _fefo_batches(product.id, branch_id, on_date):
                batch_free = batch.qty_remaining - batch.qty_reserved - _planned_on_batch(created, batch.id)
                if batch_free <= 0:
                    continue
                take = min(batch_free, remaining)
                plan.append((batch, take))
                remaining -= take
                if remaining <= 0:
                    break
            if remaining > 0:
                shortages.append(_shortage(product, need, need - remaining))
                continue
        else:
            if free_on_level < need:
                shortages.append(_shortage(product, need, max(free_on_level, ZERO)))
                continue
            plan.append((None, need))
        if free_on_level < need:  # level and batches disagree — never oversell on the aggregate
            shortages.append(_shortage(product, need, max(free_on_level, ZERO)))
            continue
        for batch, amount in plan:
            created.append(
                Allocation(
                    order_item=req.order_item,
                    product=product,
                    branch_id=branch_id,
                    batch=batch,
                    qty=amount,
                    state=AllocationState.RESERVED,
                )
            )
        level_delta[product.id] = level_delta.get(product.id, ZERO) + need

    if shortages:
        names = ", ".join(s["name"] for s in shortages[:3])
        raise DomainError(
            ErrorCode.INSUFFICIENT_STOCK,
            f"Not enough stock for: {names}. Please reduce the quantity or remove the item.",
            status_code=409,
            details={"items": shortages},
        )

    saved = Allocation.objects.bulk_create(created)
    for alloc in saved:
        if alloc.batch_id:
            Batch.objects.filter(pk=alloc.batch_id).update(qty_reserved=F("qty_reserved") + alloc.qty)
    for product_id, amount in level_delta.items():
        StockLevel.objects.filter(pk=levels[product_id].pk).update(reserved=F("reserved") + amount)
    return saved


def _planned_on_batch(planned: list[Allocation], batch_id: int) -> Decimal:
    return sum((a.qty for a in planned if a.batch_id == batch_id), ZERO)


def _shortage(product, requested: Decimal, available: Decimal) -> dict:
    return {
        "product_id": product.id,
        "name": product.name,
        "requested": str(requested),
        "available": str(max(available, ZERO)),
    }


def release_allocations(allocations: Iterable[Allocation]) -> int:
    """Release RESERVED allocations (cancel, expiry, rejected substitution). Idempotent."""
    _require_transaction()
    allocs = list(allocations)
    if not allocs:
        return 0
    ids = [a.id for a in allocs]
    locked = list(
        Allocation.objects.select_for_update().filter(pk__in=ids, state=AllocationState.RESERVED).order_by("id")
    )
    if not locked:
        return 0
    branch_id = locked[0].branch_id
    lock_levels((a.product_id for a in locked), branch_id)
    batch_ids = sorted({a.batch_id for a in locked if a.batch_id})
    if batch_ids:
        list(Batch.objects.select_for_update().filter(pk__in=batch_ids).order_by("id"))
    by_product: dict[int, Decimal] = {}
    for alloc in locked:
        by_product[alloc.product_id] = by_product.get(alloc.product_id, ZERO) + alloc.qty
        if alloc.batch_id:
            Batch.objects.filter(pk=alloc.batch_id).update(qty_reserved=F("qty_reserved") - alloc.qty)
    for product_id, amount in by_product.items():
        StockLevel.objects.filter(product_id=product_id, branch_id=branch_id).update(reserved=F("reserved") - amount)
    Allocation.objects.filter(pk__in=[a.id for a in locked]).update(state=AllocationState.RELEASED)
    return len(locked)


def release_order(order) -> int:
    from apps.orders.models import OrderItem

    items = OrderItem.objects.filter(order=order).values_list("id", flat=True)
    allocs = Allocation.objects.filter(order_item_id__in=list(items), state=AllocationState.RESERVED)
    return release_allocations(allocs)


# ----------------------------------------------------------------------------------------- commit (pick)
def _movement(
    product_id,
    branch_id,
    kind,
    delta,
    on_hand_after,
    *,
    batch=None,
    actor=None,
    reason="",
    note="",
    ref_type="",
    ref_id="",
    unit_cost=None,
) -> StockMovement:
    return StockMovement.objects.create(
        product_id=product_id,
        branch_id=branch_id,
        batch=batch,
        kind=kind,
        qty_delta=delta,
        on_hand_after=on_hand_after,
        reason_code=reason,
        note=note[:300],
        actor=actor,
        ref_type=ref_type,
        ref_id=str(ref_id),
        unit_cost=unit_cost,
    )


def commit_pick(order_item, picked_qty: Decimal, actor=None, on_date: dt.date | None = None) -> Decimal:
    """Turn the reservation for `order_item` into a sale of `picked_qty`. Returns the quantity committed.

    * picked < reserved → the unused reservation is released.
    * picked > reserved (checkout reserves only the *ordered* quantity — the weight tolerance buffer applies to the card
      authorisation, not to stock) → the difference is taken from available (unreserved) stock or the call fails with
      INSUFFICIENT_STOCK.
    * Reservations on batches that were blocked/expired since the order was placed are re-allocated first.
    Idempotent: a second call finds no RESERVED allocations and raises INVALID_STATE.
    """
    _require_transaction()
    picked_qty = qty(picked_qty)
    on_date = on_date or timezone.localdate()
    product = order_item.product
    order = order_item.order
    branch_id = order.branch_id
    if product.stock_mode != "TRACKED":
        return picked_qty

    allocs = list(
        Allocation.objects.select_for_update()
        .filter(order_item=order_item, state=AllocationState.RESERVED)
        .order_by("id")
    )
    if not allocs:
        raise DomainError(
            ErrorCode.INVALID_STATE, "This item has no stock reserved (already picked or released).", status_code=409
        )
    levels = lock_levels([product.id], branch_id)
    level = levels[product.id]
    batch_ids = sorted({a.batch_id for a in allocs if a.batch_id})
    batches = {b.id: b for b in Batch.objects.select_for_update().filter(pk__in=batch_ids).order_by("id")}

    # Re-allocate reservations sitting on batches that can no longer be sold.
    blocked = [a for a in allocs if a.batch_id and not _batch_sellable(batches[a.batch_id], on_date)]
    if blocked:
        need = sum((a.qty for a in blocked), ZERO)
        release_allocations(blocked)
        level.refresh_from_db()
        fresh = reserve([ReserveRequest(order_item, product, need)], branch_id, on_date)
        allocs = [a for a in allocs if a not in blocked] + fresh
        batches.update(
            {
                b.id: b
                for b in Batch.objects.select_for_update()
                .filter(pk__in=[a.batch_id for a in fresh if a.batch_id])
                .order_by("id")
            }
        )
        level.refresh_from_db()

    reserved_total = sum((a.qty for a in allocs), ZERO)
    extra = picked_qty - reserved_total
    if extra > 0:  # picked more than reserved: take the difference from free stock
        extra_allocs = reserve([ReserveRequest(order_item, product, extra)], branch_id, on_date)
        allocs.extend(extra_allocs)
        batches.update(
            {
                b.id: b
                for b in Batch.objects.select_for_update()
                .filter(pk__in=[a.batch_id for a in extra_allocs if a.batch_id])
                .order_by("id")
            }
        )
        level.refresh_from_db()

    to_pick = picked_qty
    total_reserved = sum((a.qty for a in allocs), ZERO)

    def fefo_key(alloc: Allocation):
        batch = batches.get(alloc.batch_id) if alloc.batch_id else None
        return (batch.sellable_until if batch and batch.sellable_until else dt.date.max, alloc.id)

    consumed: dict[int | None, Decimal] = {}  # batch id (None = unbatched) -> quantity sold, in FEFO order
    for alloc in sorted(allocs, key=fefo_key):
        use = min(alloc.qty, to_pick)
        to_pick -= use
        batch = batches.get(alloc.batch_id) if alloc.batch_id else None
        if batch is not None:
            batch.qty_reserved -= alloc.qty  # the whole reservation on this batch is consumed or released
        if use > 0:
            consumed[alloc.batch_id] = consumed.get(alloc.batch_id, ZERO) + use
            if batch is not None:
                batch.qty_remaining -= use
                if batch.qty_remaining == 0:
                    batch.status = BatchStatus.DEPLETED
            Allocation.objects.filter(pk=alloc.pk).update(qty=use, state=AllocationState.COMMITTED)
        else:
            Allocation.objects.filter(pk=alloc.pk).update(state=AllocationState.RELEASED)
        if batch is not None:
            batch.save(update_fields=["qty_remaining", "qty_reserved", "status", "updated_at"])
    for batch_id, used in consumed.items():  # one ledger row per batch per pick
        level.on_hand -= used
        _movement(
            product.id,
            branch_id,
            MovementKind.SALE,
            -used,
            level.on_hand,
            batch=batches.get(batch_id) if batch_id else None,
            actor=actor,
            ref_type="order",
            ref_id=order.number,
        )
    level.reserved -= total_reserved
    level.save(update_fields=["on_hand", "reserved", "updated_at"])
    return picked_qty


def _batch_sellable(batch: Batch, on_date: dt.date) -> bool:
    return (
        batch.status == BatchStatus.ACTIVE
        and batch.quality_status == QualityStatus.PASSED
        and (batch.sellable_until is None or batch.sellable_until >= on_date)
    )


# ----------------------------------------------------------------------------------------- receiving / adjustments
def _reactivate_if_depleted(batch: Batch, today: dt.date | None = None) -> None:
    """A lot that holds units again must not keep claiming to be used up.

    `DEPLETED` only ever means "nothing left", so it is replaced by `ACTIVE` — or by `EXPIRED` when the lot's date has
    already passed, so it shows up on the expiry worklist straight away instead of waiting for the hourly scan.
    Quarantine, expiry and a failed inspection are separate flags (`status` QUARANTINED/EXPIRED, `quality_status`) that
    are never touched here, so a blocked lot stays blocked: `sellable_batch_q` still requires ACTIVE *and* PASSED.
    Does not save; the caller includes `status` in its `update_fields`.
    """
    if batch.status != BatchStatus.DEPLETED or batch.qty_remaining <= 0:
        return
    today = today or timezone.localdate()
    expired = batch.expiry_date is not None and batch.expiry_date < today
    batch.status = BatchStatus.EXPIRED if expired else BatchStatus.ACTIVE


def compute_sellable_until(product, expiry_date: dt.date | None) -> dt.date | None:
    if expiry_date is None:
        return None
    return expiry_date - dt.timedelta(days=product.sell_buffer_days)


def receive_stock(
    product,
    branch_id: int,
    quantity: Decimal,
    *,
    actor=None,
    lot_code: str = "",
    expiry_date: dt.date | None = None,
    expiry_kind: str = ExpiryKind.BEST_BEFORE,
    supplier=None,
    unit_cost: Decimal | None = None,
    quality_status: str = QualityStatus.PASSED,
    received_on: dt.date | None = None,
    ref_type: str = "",
    ref_id: str = "",
    note: str = "",
    is_demo: bool = False,
) -> Batch | None:
    """Add stock. Batch-tracked products require a lot code and expiry date."""
    _require_transaction()
    quantity = qty(quantity)
    if quantity <= 0:
        raise DomainError(ErrorCode.INVALID_QUANTITY, "Received quantity must be greater than zero.")
    levels = lock_levels([product.id], branch_id)
    level = levels[product.id]
    batch = None
    if product.tracks_batches:
        if not lot_code or expiry_date is None:
            raise DomainError(ErrorCode.VALIDATION_ERROR, f"{product.name} needs a lot code and an expiry date.")
        batch = (
            Batch.objects.select_for_update().filter(product=product, branch_id=branch_id, lot_code=lot_code).first()
        )
        if batch is None:
            batch = Batch.objects.create(
                product=product,
                branch_id=branch_id,
                supplier=supplier,
                lot_code=lot_code,
                received_on=received_on or timezone.localdate(),
                expiry_date=expiry_date,
                expiry_kind=expiry_kind,
                sellable_until=compute_sellable_until(product, expiry_date),
                qty_received=quantity,
                qty_remaining=quantity,
                unit_cost=unit_cost,
                quality_status=quality_status,
                is_demo=is_demo,
                notes=note[:300],
            )
        else:
            if batch.expiry_date != expiry_date:
                raise DomainError(
                    ErrorCode.VALIDATION_ERROR, f"Lot {lot_code} already exists with a different expiry date."
                )
            batch.qty_received += quantity
            batch.qty_remaining += quantity
            _reactivate_if_depleted(batch)
            batch.save(update_fields=["qty_received", "qty_remaining", "status", "updated_at"])
    level.on_hand += quantity
    level.save(update_fields=["on_hand", "updated_at"])
    _movement(
        product.id,
        branch_id,
        MovementKind.RECEIPT,
        quantity,
        level.on_hand,
        batch=batch,
        actor=actor,
        ref_type=ref_type,
        ref_id=ref_id,
        note=note,
        unit_cost=unit_cost,
    )
    return batch


def adjust_stock(
    product,
    branch_id: int,
    *,
    delta: Decimal | None = None,
    target: Decimal | None = None,
    reason: str,
    actor=None,
    batch: Batch | None = None,
    note: str = "",
) -> StockMovement | None:
    """Manual correction (stock-take). Either a signed `delta` or an absolute `target` count; always audited."""
    _require_transaction()
    if not reason.strip():
        raise DomainError(ErrorCode.VALIDATION_ERROR, "A reason is required for every stock adjustment.")
    if (delta is None) == (target is None):
        raise DomainError(ErrorCode.VALIDATION_ERROR, "Provide either a change or a counted quantity.")
    levels = lock_levels([product.id], branch_id)
    level = levels[product.id]
    if product.tracks_batches:
        if batch is None:
            raise DomainError(ErrorCode.VALIDATION_ERROR, "Choose the batch to adjust for a batch-tracked product.")
        batch = Batch.objects.select_for_update().get(pk=batch.pk, product=product, branch_id=branch_id)
        current = batch.qty_remaining
    else:
        current = level.on_hand
    change = qty(delta) if delta is not None else qty(target) - current
    if change == 0:
        return None
    new_value = current + change
    floor = batch.qty_reserved if batch is not None else level.reserved
    if new_value < floor:
        raise DomainError(
            ErrorCode.INSUFFICIENT_STOCK,
            f"Can't reduce stock below the {floor} already reserved for customer orders.",
            status_code=409,
            details={"reserved": str(floor)},
        )
    if batch is not None:
        batch.qty_remaining = new_value
        if new_value == 0 and batch.status == BatchStatus.ACTIVE:
            batch.status = BatchStatus.DEPLETED
        elif new_value > 0 and batch.status == BatchStatus.DEPLETED:
            batch.status = BatchStatus.ACTIVE
        batch.save(update_fields=["qty_remaining", "status", "updated_at"])
    level.on_hand += change
    level.save(update_fields=["on_hand", "updated_at"])
    return _movement(
        product.id,
        branch_id,
        MovementKind.ADJUSTMENT,
        change,
        level.on_hand,
        batch=batch,
        actor=actor,
        reason="ADJUSTMENT",
        note=f"{reason}: {note}".strip(": "),
    )


def _move_reservations_off_batch(batch: Batch, *, shortfall: Decimal, today: dt.date) -> None:
    """Free at least `shortfall` reserved units on a batch that can no longer be sold, by re-planning whole reservations
    (newest first) onto other sellable lots, FEFO, at the later of today and the order's slot date.

    Each moved reservation is released and re-reserved through the normal `release_allocations` / `reserve` path, so the
    allocation rows and the batch and level counters always change together. All-or-nothing: if the other lots cannot
    cover what has to move, nothing changes and INSUFFICIENT_STOCK names the orders in the way (the work is done in a
    savepoint, so a caller that catches the error and carries on in the same transaction sees consistent counters).
    """
    open_allocs = list(
        Allocation.objects.select_for_update(of=("self",))
        .select_related("order_item__order__slot", "product")
        .filter(batch=batch, state=AllocationState.RESERVED)
        .order_by("-id")
    )
    chosen: list[Allocation] = []
    freed = ZERO
    for alloc in open_allocs:
        if freed >= shortfall:
            break
        chosen.append(alloc)
        freed += alloc.qty
    try:
        with transaction.atomic():
            for alloc in chosen:
                order = alloc.order_item.order
                when = max(today, order.slot.date) if order.slot_id else today
                release_allocations([alloc])
                reserve([ReserveRequest(alloc.order_item, alloc.product, alloc.qty)], batch.branch_id, when)
    except DomainError as exc:
        if exc.code != ErrorCode.INSUFFICIENT_STOCK:
            raise
        orders = sorted({a.order_item.order.number for a in open_allocs})
        writable = batch.qty_remaining - batch.qty_reserved
        shown = ", ".join(orders[:5]) + (f" and {len(orders) - 5} more" if len(orders) > 5 else "")
        raise DomainError(
            ErrorCode.INSUFFICIENT_STOCK,
            f"Lot {batch.lot_code} has {qty_str(batch.qty_reserved)} reserved for open customer orders ({shown}) and "
            f"there isn't enough other sellable stock to move them to, so at most {qty_str(writable)} can be written "
            "off now. Pick or cancel those orders first, or receive replacement stock.",
            status_code=409,
            details={
                "reserved": qty_str(batch.qty_reserved),
                "writable_off": qty_str(writable),
                "orders": orders,
            },
        ) from exc


def record_waste(
    product,
    branch_id: int,
    quantity: Decimal,
    *,
    reason_code: str = WasteReason.OTHER,
    actor=None,
    batch: Batch | None = None,
    note: str = "",
    on_date: dt.date | None = None,
) -> StockMovement:
    """Write stock off. The reserved counters and the RESERVED allocation rows are never allowed to drift apart.

    * A sellable lot can only lose its unreserved part: those units are promised to customer orders.
    * A lot that can no longer be sold (EXPIRED, QUARANTINED, failed inspection, past its sell-by date) may be written
      off below its reserved quantity only after the affected reservations have been re-planned onto other sellable
      lots (see `_move_reservations_off_batch`); if other stock can't cover them the write-off is refused with a message
      naming the orders. Either way, afterwards Σ open allocations per level and per batch equal the reserved counters,
      so the affected orders still pick and cancel normally.
    """
    _require_transaction()
    quantity = qty(quantity)
    if quantity <= 0:
        raise DomainError(ErrorCode.INVALID_QUANTITY, "Waste quantity must be greater than zero.")
    if reason_code not in WasteReason.values:
        raise DomainError(ErrorCode.VALIDATION_ERROR, "Unknown waste reason.")
    levels = lock_levels([product.id], branch_id)
    level = levels[product.id]
    if product.tracks_batches:
        if batch is None:
            raise DomainError(ErrorCode.VALIDATION_ERROR, "Choose the batch the waste came from.")
        batch = Batch.objects.select_for_update().get(pk=batch.pk, product=product, branch_id=branch_id)
        if batch.qty_remaining < quantity:
            raise DomainError(
                ErrorCode.INSUFFICIENT_STOCK, f"Batch only has {batch.qty_remaining} left.", status_code=409
            )
        shortfall = batch.qty_reserved - (batch.qty_remaining - quantity)
        if shortfall > 0:  # the write-off would eat into units promised to customer orders
            today = on_date or timezone.localdate()
            if _batch_sellable(batch, today):
                raise DomainError(
                    ErrorCode.INSUFFICIENT_STOCK, "That quantity is reserved for customer orders.", status_code=409
                )
            _move_reservations_off_batch(batch, shortfall=shortfall, today=today)
            batch.refresh_from_db()
            level.refresh_from_db()
        batch.qty_remaining -= quantity
        if batch.qty_remaining == 0 and batch.status == BatchStatus.ACTIVE:
            batch.status = BatchStatus.DEPLETED
        batch.save(update_fields=["qty_remaining", "status", "updated_at"])
    elif level.on_hand - quantity < level.reserved:
        raise DomainError(
            ErrorCode.INSUFFICIENT_STOCK, "That quantity is reserved for customer orders.", status_code=409
        )
    if level.on_hand < quantity:
        raise DomainError(ErrorCode.INSUFFICIENT_STOCK, f"Only {level.on_hand} on hand.", status_code=409)
    level.on_hand -= quantity
    level.save(update_fields=["on_hand", "updated_at"])
    return _movement(
        product.id,
        branch_id,
        MovementKind.WASTE,
        -quantity,
        level.on_hand,
        batch=batch,
        actor=actor,
        reason=reason_code,
        note=note,
    )


def _require_mergeable(dest: Batch, src: Batch, src_status: str) -> None:
    """A transfer into a lot code that already exists at the destination merges the units into it, so both must describe
    the same goods — the rule `receive_stock` applies to the expiry date, plus the blocking state: units of a quarantined
    or failed lot must not turn sellable by joining a live one, nor good units become blocked by joining a blocked one.
    A DEPLETED destination holds nothing, so it counts as ACTIVE (and is revived by the merge)."""
    if dest.expiry_date != src.expiry_date:
        raise DomainError(
            ErrorCode.VALIDATION_ERROR,
            f"Lot {src.lot_code} already exists at the destination with a different expiry date.",
        )
    dest_status = BatchStatus.ACTIVE if dest.status == BatchStatus.DEPLETED else dest.status
    if (dest_status, dest.quality_status) != (src_status, src.quality_status):
        raise DomainError(
            ErrorCode.VALIDATION_ERROR,
            f"Lot {src.lot_code} already exists at the destination with a different status "
            f"({BatchStatus(dest_status).label}, inspection {QualityStatus(dest.quality_status).label.lower()}) from "
            f"this one ({BatchStatus(src_status).label}, inspection {QualityStatus(src.quality_status).label.lower()}), "
            "so the two can't be merged. Resolve the status of both lots first.",
        )


def transfer_stock(
    product,
    from_branch_id: int,
    to_branch_id: int,
    quantity: Decimal,
    *,
    actor=None,
    batch: Batch | None = None,
    note: str = "",
) -> tuple[StockMovement, StockMovement]:
    """Immediate branch-to-branch transfer (no in-transit state). Batches keep their lot code and expiry."""
    _require_transaction()
    if from_branch_id == to_branch_id:
        raise DomainError(ErrorCode.VALIDATION_ERROR, "Choose two different branches.")
    quantity = qty(quantity)
    if quantity <= 0:
        raise DomainError(ErrorCode.INVALID_QUANTITY, "Transfer quantity must be greater than zero.")
    first, second = sorted([from_branch_id, to_branch_id])
    lock_levels([product.id], first)
    lock_levels([product.id], second)
    src = StockLevel.objects.select_for_update().get(product=product, branch_id=from_branch_id)
    dest_batch = None
    src_status = None
    if product.tracks_batches:
        if batch is None:
            raise DomainError(ErrorCode.VALIDATION_ERROR, "Choose the batch to transfer.")
        batch = Batch.objects.select_for_update().get(pk=batch.pk, product=product, branch_id=from_branch_id)
        if batch.qty_remaining - batch.qty_reserved < quantity:
            raise DomainError(
                ErrorCode.INSUFFICIENT_STOCK, "Not enough unreserved stock in that batch.", status_code=409
            )
        # Look at the destination before touching anything, so a refused merge leaves both branches exactly as they were.
        dest_batch = (
            Batch.objects.select_for_update()
            .filter(product=product, branch_id=to_branch_id, lot_code=batch.lot_code)
            .first()
        )
        # The lot's state *before* this transfer: depleting the source must not leak into the destination lot.
        src_status = BatchStatus.ACTIVE if batch.status == BatchStatus.DEPLETED else batch.status
        if dest_batch is not None:
            _require_mergeable(dest_batch, batch, src_status)
        batch.qty_remaining -= quantity
        if batch.qty_remaining == 0 and batch.status == BatchStatus.ACTIVE:  # a blocked lot keeps its blocking status
            batch.status = BatchStatus.DEPLETED
        batch.save(update_fields=["qty_remaining", "status", "updated_at"])
    elif src.on_hand - src.reserved < quantity:
        raise DomainError(ErrorCode.INSUFFICIENT_STOCK, "Not enough unreserved stock to transfer.", status_code=409)
    src.on_hand -= quantity
    src.save(update_fields=["on_hand", "updated_at"])
    out = _movement(
        product.id,
        from_branch_id,
        MovementKind.TRANSFER_OUT,
        -quantity,
        src.on_hand,
        batch=batch,
        actor=actor,
        note=note,
        ref_type="transfer",
        ref_id=to_branch_id,
    )
    dest_level = StockLevel.objects.select_for_update().get(product=product, branch_id=to_branch_id)
    if batch is not None:
        if dest_batch is None:
            dest_batch = Batch.objects.create(
                product=product,
                branch_id=to_branch_id,
                supplier=batch.supplier,
                lot_code=batch.lot_code,
                received_on=timezone.localdate(),
                expiry_date=batch.expiry_date,
                expiry_kind=batch.expiry_kind,
                sellable_until=batch.sellable_until,
                qty_received=quantity,
                qty_remaining=quantity,
                unit_cost=batch.unit_cost,
                quality_status=batch.quality_status,
                status=src_status,
                is_demo=batch.is_demo,
            )
        else:
            dest_batch.qty_received += quantity
            dest_batch.qty_remaining += quantity
            _reactivate_if_depleted(dest_batch)
            dest_batch.save(update_fields=["qty_received", "qty_remaining", "status", "updated_at"])
    dest_level.on_hand += quantity
    dest_level.save(update_fields=["on_hand", "updated_at"])
    into = _movement(
        product.id,
        to_branch_id,
        MovementKind.TRANSFER_IN,
        quantity,
        dest_level.on_hand,
        batch=dest_batch,
        actor=actor,
        note=note,
        ref_type="transfer",
        ref_id=from_branch_id,
    )
    return out, into


def set_batch_status(
    batch: Batch, *, status: str | None = None, quality_status: str | None = None, actor=None
) -> Batch:
    """Quarantine / release / fail a batch. Blocked batches are excluded from new allocations immediately."""
    _require_transaction()
    batch = Batch.objects.select_for_update().get(pk=batch.pk)
    if status is not None:
        batch.status = status
    if quality_status is not None:
        batch.quality_status = quality_status
    batch.save(update_fields=["status", "quality_status", "updated_at"])
    return batch


# ----------------------------------------------------------------------------------------- scheduled maintenance
def expire_batches(today: dt.date | None = None) -> int:
    """Mark batches whose expiry date has passed as EXPIRED (they stay on hand until written off as waste)."""
    today = today or timezone.localdate()
    return Batch.objects.filter(status=BatchStatus.ACTIVE, expiry_date__lt=today).update(
        status=BatchStatus.EXPIRED, updated_at=timezone.now()
    )


def check_invariants() -> list[str]:
    """Return human-readable descriptions of every inconsistency between levels, batches, allocations and the ledger."""
    problems: list[str] = []
    batch_tracked = {}
    for level in StockLevel.objects.select_related("product", "branch"):
        key = (level.product_id, level.branch_id)
        label = f"{level.product.sku}@{level.branch.code}"
        ledger = (
            StockMovement.objects.filter(product_id=level.product_id, branch_id=level.branch_id).aggregate(
                s=Sum("qty_delta")
            )["s"]
            or ZERO
        )
        if ledger != level.on_hand:
            problems.append(f"{label}: ledger {ledger} != on_hand {level.on_hand}")
        if level.product.tracks_batches:
            agg = Batch.objects.filter(product_id=level.product_id, branch_id=level.branch_id).aggregate(
                r=Sum("qty_remaining"), v=Sum("qty_reserved")
            )
            if (agg["r"] or ZERO) != level.on_hand:
                problems.append(f"{label}: batches hold {agg['r'] or ZERO} but on_hand is {level.on_hand}")
            if (agg["v"] or ZERO) != level.reserved:
                problems.append(f"{label}: batches reserve {agg['v'] or ZERO} but level reserves {level.reserved}")
            batch_tracked[key] = True
        reserved_allocs = (
            Allocation.objects.filter(
                product_id=level.product_id, branch_id=level.branch_id, state=AllocationState.RESERVED
            ).aggregate(s=Sum("qty"))["s"]
            or ZERO
        )
        if reserved_allocs != level.reserved:
            problems.append(f"{label}: open allocations {reserved_allocs} != reserved {level.reserved}")
    return problems


def return_committed_items(order, actor=None) -> int:
    """Put picked stock back on the shelf when an order is cancelled after picking began (RETURN movements)."""
    _require_transaction()
    count = 0
    for alloc in (
        Allocation.objects.select_for_update()
        .filter(order_item__order=order, state=AllocationState.COMMITTED)
        .order_by("id")
    ):
        levels = lock_levels([alloc.product_id], alloc.branch_id)
        level = levels[alloc.product_id]
        batch = Batch.objects.select_for_update().filter(pk=alloc.batch_id).first() if alloc.batch_id else None
        if batch is not None:
            batch.qty_remaining += alloc.qty
            if batch.status == BatchStatus.DEPLETED:
                batch.status = BatchStatus.ACTIVE
            batch.save(update_fields=["qty_remaining", "status", "updated_at"])
        level.on_hand += alloc.qty
        level.save(update_fields=["on_hand", "updated_at"])
        _movement(
            alloc.product_id,
            alloc.branch_id,
            MovementKind.RETURN,
            alloc.qty,
            level.on_hand,
            batch=batch,
            actor=actor,
            ref_type="order",
            ref_id=order.number,
            note="Order cancelled after picking",
        )
        Allocation.objects.filter(pk=alloc.pk).update(state=AllocationState.RELEASED)
        count += 1
    return count
