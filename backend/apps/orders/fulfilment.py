"""Picking, weighing, substitutions, packing and handover.

Policies (see docs/inventory-and-fulfilment.md):

* Weighed items: the picker may record any weight up to `ordered × (1 + tolerance%)`. The customer is charged for the
  weight actually picked at the unit price they saw. Because the card authorisation already includes the same buffer, the
  final amount can never exceed what was authorised. Heavier than the tolerance needs a manager override and is *capped*
  at the tolerance (the store absorbs the excess) — the customer never pays an unexplained amount.
* Substitutions follow the customer's policy (order level, overridable per item). With "no substitutes" a replacement can
  not even be proposed; with "contact me" nothing is substituted until the customer (or staff on the customer's behalf,
  recorded as such) approves. A customer never pays more for a substitute than for the item it replaces.
"""

from __future__ import annotations

import logging
from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from apps.cart import pricing
from apps.cart.models import ItemSubstitutionPref, SubstitutionPolicy
from apps.catalog.models import Product, ProductStatus
from apps.core import audit
from apps.core.exceptions import DomainError, ErrorCode
from apps.core.models import StoreSettings
from apps.core.money import ZERO, money, qty, qty_str
from apps.inventory import services as inventory
from apps.inventory.availability import annotate_availability, compute_availability
from apps.inventory.models import Allocation, AllocationState
from apps.notifications.services import notify_order
from apps.payments import services as payments
from apps.promotions.engine import PromoDef, apply_promo, load_index

from . import workflow
from .models import (
    FulfilmentType,
    Order,
    OrderItem,
    OrderItemStatus,
    OrderStatus,
    Substitution,
    SubstitutionStatus,
)

logger = logging.getLogger(__name__)
HUNDRED = Decimal("100")


def _item_order(item_id: int, *, statuses=None) -> tuple[OrderItem, Order]:
    item = (
        OrderItem.objects.select_for_update(of=("self",))
        .select_related("product__sale_unit", "product__category")
        .get(pk=item_id)
    )
    order = workflow.lock_order(item.order_id)
    if statuses is not None and order.status not in statuses:
        raise DomainError(
            ErrorCode.INVALID_ORDER_TRANSITION,
            f"Order {order.number} isn't in a state where items can be changed ({order.get_status_display()}).",
            status_code=409,
        )
    return item, order


def effective_policy(order: Order, item: OrderItem) -> str:
    if item.substitution_pref == ItemSubstitutionPref.NONE:
        return SubstitutionPolicy.NONE
    if item.substitution_pref == ItemSubstitutionPref.ALLOW:
        return (
            SubstitutionPolicy.ALLOW
            if order.substitution_policy == SubstitutionPolicy.NONE
            else order.substitution_policy
        )
    return order.substitution_policy


# ----------------------------------------------------------------------------------------- weights & totals
def tolerance_bounds(item: OrderItem, store: StoreSettings) -> tuple[Decimal, Decimal]:
    tol = store.weight_tolerance_percent / HUNDRED
    return qty(item.ordered_qty * (1 - tol)), qty(item.ordered_qty * (1 + tol))


def final_line_total(item: OrderItem, charge_qty: Decimal) -> Decimal:
    """Line price for `charge_qty`, honouring the promotion snapshot taken at checkout (e.g. multibuy groups)."""
    if item.promo_kind == "MULTIBUY" and item.promo_params:
        promo = PromoDef(
            id=0,
            label=item.promo_label,
            kind="MULTIBUY",
            percent=None,
            amount_off=None,
            multibuy_qty=int(item.promo_params["multibuy_qty"]),
            multibuy_price=Decimal(item.promo_params["multibuy_price"]),
        )
        applied = apply_promo(promo, item.base_unit_price, charge_qty)
        return applied.line_total if applied else money(item.base_unit_price * charge_qty)
    return money(item.unit_price * charge_qty)


@transaction.atomic
def start_picking(order: Order, actor) -> Order:
    locked = workflow.lock_order(order)
    started = workflow.transition(
        locked, OrderStatus.PICKING, actor=actor, note="Picking started", public_note="We've started picking your order"
    )
    Order.objects.filter(pk=started.pk).update(assigned_to=actor if getattr(actor, "pk", None) else None)
    notify_order(started, "PICKING_STARTED")
    return started


@transaction.atomic
def pick_item(item_id: int, picked_qty, actor, *, note: str = "", override: bool = False) -> OrderItem:
    item, order = _item_order(item_id, statuses={OrderStatus.PICKING})
    if item.status not in (OrderItemStatus.PENDING,):
        raise DomainError(ErrorCode.INVALID_STATE, "This item has already been dealt with.", status_code=409)
    try:
        picked = qty(Decimal(str(picked_qty)))
    except (ArithmeticError, ValueError):
        raise DomainError(ErrorCode.INVALID_QUANTITY, "Enter the picked quantity as a number.") from None
    if picked < 0:
        raise DomainError(ErrorCode.INVALID_QUANTITY, "Picked quantity can't be negative.")
    if picked == 0:
        return mark_unavailable(item_id, actor, note or "Not available")
    store = StoreSettings.load()
    product: Product = item.product
    charge_qty, status = picked, OrderItemStatus.PICKED

    if item.is_variable_weight:
        low, high = tolerance_bounds(item, store)
        if picked > high:
            if not override:
                raise DomainError(
                    ErrorCode.WEIGHT_OUT_OF_TOLERANCE,
                    f"{picked.normalize():f} {item.unit_symbol} is more than the {store.weight_tolerance_percent.normalize():f}% allowed over the "
                    f"{qty_str(item.ordered_qty)} {item.unit_symbol} ordered (max {qty_str(high)}). Pick a smaller piece, or ask a manager to override.",
                    status_code=422,
                    details={"ordered": qty_str(item.ordered_qty), "max_allowed": qty_str(high)},
                )
            charge_qty = high  # manager override: the customer is still only charged up to the tolerance
        elif picked < low:
            status = OrderItemStatus.SHORT
    else:
        if not product.sale_unit.allows_fraction and picked != picked.to_integral_value():
            raise DomainError(ErrorCode.INVALID_QUANTITY, "This item is counted in whole units.")
        if picked > item.ordered_qty:
            raise DomainError(
                ErrorCode.INVALID_QUANTITY,
                f"The customer ordered {qty_str(item.ordered_qty)}; you can't pick more.",
                details={"ordered": qty_str(item.ordered_qty)},
            )
        if picked < item.ordered_qty:
            status = OrderItemStatus.SHORT

    inventory.commit_pick(item, picked, actor)
    item.picked_qty, item.status = picked, status
    item.line_total_final = final_line_total(item, charge_qty)
    item.picker_note, item.picked_by, item.picked_at = (
        note[:300],
        actor if getattr(actor, "pk", None) else None,
        timezone.now(),
    )
    item.save(
        update_fields=[
            "picked_qty",
            "status",
            "line_total_final",
            "picker_note",
            "picked_by",
            "picked_at",
            "updated_at",
        ]
    )
    detail = f"Picked {qty_str(picked)} {item.unit_symbol} of {item.name} (ordered {qty_str(item.ordered_qty)})"
    if charge_qty != picked:
        detail += f"; manager override — charged for {qty_str(charge_qty)}"
        audit.record(actor, "order.weight_override", order, summary=detail)
    workflow.add_history(order, detail, actor=actor)
    return item


@transaction.atomic
def mark_unavailable(item_id: int, actor, reason: str = "Not available") -> OrderItem:
    item, order = _item_order(item_id, statuses={OrderStatus.PICKING})
    if item.status not in (OrderItemStatus.PENDING, OrderItemStatus.UNAVAILABLE):
        raise DomainError(ErrorCode.INVALID_STATE, "This item has already been dealt with.", status_code=409)
    inventory.release_allocations(Allocation.objects.filter(order_item=item, state=AllocationState.RESERVED))
    item.status, item.picker_note = OrderItemStatus.UNAVAILABLE, reason[:300]
    item.save(update_fields=["status", "picker_note", "updated_at"])
    workflow.add_history(order, f"{item.name} marked unavailable: {reason}", actor=actor)
    if effective_policy(order, item) == SubstitutionPolicy.NONE:
        return _remove(item, order, actor, "Unavailable — customer chose no substitutes")
    return item


def _remove(item: OrderItem, order: Order, actor, reason: str) -> OrderItem:
    item.status, item.picked_qty, item.line_total_final = OrderItemStatus.REMOVED, ZERO, ZERO
    item.picker_note = (item.picker_note or reason)[:300]
    item.save(update_fields=["status", "picked_qty", "line_total_final", "picker_note", "updated_at"])
    workflow.add_history(
        order,
        f"{item.name} removed: {reason}",
        actor=actor,
        public_note=f"{item.name} was unavailable and has been removed — you won't be charged for it",
    )
    notify_order(
        order,
        "ITEM_REMOVED",
        detail=f"{item.name} was unavailable, so we've removed it from your order. You won't be charged for it.",
    )
    return item


@transaction.atomic
def remove_item(item_id: int, actor, reason: str) -> OrderItem:
    """Staff: drop an unavailable item when no substitute will be offered (allowed only under ALLOW/CONTACT after it was marked unavailable)."""
    item, order = _item_order(item_id, statuses={OrderStatus.PICKING})
    if item.status != OrderItemStatus.UNAVAILABLE:
        raise DomainError(ErrorCode.INVALID_STATE, "Only unavailable items can be removed.", status_code=409)
    if Substitution.objects.filter(order_item=item, status=SubstitutionStatus.AWAITING_CUSTOMER).exists():
        raise DomainError(
            ErrorCode.SUBSTITUTION_REQUIRES_APPROVAL,
            "A substitute is waiting for the customer's answer.",
            status_code=409,
        )
    return _remove(item, order, actor, reason or "No suitable substitute")


# ----------------------------------------------------------------------------------------- substitutions
def substitution_eligibility(
    original: Product, candidate: Product, branch_id: int, quantity: Decimal | None = None
) -> tuple[bool, str]:
    """Is `candidate` a reasonable replacement for `original`? Returns (ok, reason-if-not)."""
    if candidate.id == original.id:
        return False, "That is the same product."
    if candidate.status != ProductStatus.ACTIVE or not candidate.is_available:
        return False, f"{candidate.name} isn't currently for sale."
    if candidate.sale_unit.kind != original.sale_unit.kind:
        return (
            False,
            f"{candidate.name} is sold differently (by {candidate.sale_unit.kind.lower()}), so it isn't a like-for-like replacement.",
        )
    if candidate.category_id != original.category_id:
        return False, f"{candidate.name} is in a different category."
    original_claims = {c.kind for c in original.claims.all() if c.verified}
    candidate_claims = {c.kind for c in candidate.claims.all() if c.verified}
    if not original_claims <= candidate_claims:
        missing = ", ".join(sorted(original_claims - candidate_claims)).replace("_", " ").lower()
        return False, f"{candidate.name} doesn't carry the verified {missing} claim the customer's item has."
    original_allergens = {a.allergen_id for a in original.allergens.all()}
    candidate_allergens = {a.allergen_id for a in candidate.allergens.all()}
    extra = candidate_allergens - original_allergens
    if extra:
        return False, f"{candidate.name} lists allergens the original doesn't."
    if original.allergen_info_complete and not candidate.allergen_info_complete:
        return False, f"{candidate.name} doesn't have confirmed allergen information."
    if not original.allergen_info_complete and candidate_allergens:
        return False, f"{candidate.name} lists allergens, and the original's allergen information isn't confirmed."
    if (
        original.net_content
        and candidate.net_content
        and original.net_content_unit_id
        and candidate.net_content_unit_id
    ):
        o = original.net_content * original.net_content_unit.to_base
        c = candidate.net_content * candidate.net_content_unit.to_base
        if o and not (Decimal("0.7") <= c / o <= Decimal("1.3")):
            return False, f"{candidate.name} is a very different size."
    if quantity is not None:
        row = annotate_availability(Product.objects.filter(pk=candidate.pk), branch_id).get()
        avail = compute_availability(row, row.avail_qty, row.low_threshold)
        if not avail.can_order or (avail.max_orderable is not None and quantity > avail.max_orderable):
            return False, f"Not enough {candidate.name} in stock."
    return True, ""


def candidate_substitutes(item_id: int, limit: int = 8) -> list[dict]:
    """Eligible replacements for the picker to choose from (same category, in stock, rules satisfied)."""
    item = OrderItem.objects.select_related("order", "product__sale_unit", "product__category").get(pk=item_id)
    original = item.product
    pool = (
        Product.objects.filter(category=original.category, status=ProductStatus.ACTIVE, is_available=True)
        .exclude(pk=original.pk)
        .select_related("sale_unit", "net_content_unit", "brand")
        .prefetch_related("claims", "allergens")
        .order_by("price")[:40]
    )
    out = []
    for cand in pool:
        ok, _ = substitution_eligibility(
            original,
            cand,
            item.order.branch_id,
            item.ordered_qty if cand.sale_unit_id == original.sale_unit_id else cand.qty_min,
        )
        if ok:
            out.append(
                {
                    "product_id": cand.id,
                    "name": cand.name,
                    "brand": cand.brand.name if cand.brand_id else "",
                    "price": str(cand.price),
                    "unit": cand.sale_unit.symbol,
                }
            )
        if len(out) >= limit:
            break
    return out


@transaction.atomic
def propose_substitution(
    item_id: int, substitute_product_id: int, actor, *, quantity=None, reason: str = ""
) -> Substitution:
    item, order = _item_order(item_id, statuses={OrderStatus.PICKING})
    if item.status != OrderItemStatus.UNAVAILABLE:
        raise DomainError(
            ErrorCode.INVALID_STATE, "Mark the item unavailable before proposing a substitute.", status_code=409
        )
    policy = effective_policy(order, item)
    if policy == SubstitutionPolicy.NONE:
        raise DomainError(
            ErrorCode.SUBSTITUTION_NOT_ALLOWED,
            "The customer asked for no substitutions on this item. It must be removed and refunded instead.",
            status_code=409,
        )
    if Substitution.objects.filter(
        order_item=item,
        status__in=[
            SubstitutionStatus.AWAITING_CUSTOMER,
            SubstitutionStatus.APPROVED,
            SubstitutionStatus.AUTO_APPROVED,
        ],
    ).exists():
        raise DomainError(ErrorCode.INVALID_STATE, "This item already has a substitute.", status_code=409)
    candidate = (
        Product.objects.select_related("sale_unit", "category", "net_content_unit")
        .prefetch_related("claims", "allergens")
        .filter(pk=substitute_product_id)
        .first()
    )
    if candidate is None:
        raise DomainError(ErrorCode.NOT_FOUND, "That product doesn't exist.", status_code=404)
    original = item.product
    original = (
        Product.objects.select_related("sale_unit", "net_content_unit")
        .prefetch_related("claims", "allergens")
        .get(pk=original.pk)
    )
    sub_qty = pricing.validate_quantity(
        candidate,
        quantity
        if quantity is not None
        else (item.ordered_qty if candidate.sale_unit_id == original.sale_unit_id else candidate.qty_min),
    )
    ok, why = substitution_eligibility(original, candidate, order.branch_id, sub_qty)
    if not ok:
        raise DomainError(ErrorCode.SUBSTITUTION_NOT_ALLOWED, why, status_code=409)

    store = StoreSettings.load()
    line = pricing.price_items([(candidate, sub_qty)], load_index(use_cache=False))[0]
    list_total = line.line_total
    charged_total = min(list_total, item.line_total_estimated) if store.substitution_price_cap else list_total
    charged_unit = money(charged_total / sub_qty) if sub_qty else line.unit_price
    awaiting = policy == SubstitutionPolicy.CONTACT
    child = OrderItem.objects.create(
        order=order,
        product=candidate,
        substitute_for=item,
        name=candidate.name,
        sku=candidate.sku,
        unit_symbol=candidate.sale_unit.symbol,
        unit_name=candidate.sale_unit.name,
        is_variable_weight=candidate.is_variable_weight,
        tax_rate=candidate.tax_rate,
        base_unit_price=candidate.price,
        unit_price=charged_unit,
        promo_label="Substitute",
        ordered_qty=sub_qty,
        line_total_estimated=money(charged_unit * sub_qty),
        substitution_pref=ItemSubstitutionPref.NONE,
        status=OrderItemStatus.PROPOSED if awaiting else OrderItemStatus.PENDING,
    )
    inventory.reserve(
        [inventory.ReserveRequest(child, candidate, sub_qty)],
        order.branch_id,
        order.slot_starts_at.date() if order.slot_starts_at else None,
    )
    sub = Substitution.objects.create(
        order_item=item,
        substitute_product=candidate,
        substitute_item=child,
        qty=sub_qty,
        list_unit_price=line.unit_price,
        charged_unit_price=charged_unit,
        price_difference=money(list_total - item.line_total_estimated),
        policy_snapshot=policy,
        reason=reason[:300],
        proposed_by=actor if getattr(actor, "pk", None) else None,
        status=SubstitutionStatus.AWAITING_CUSTOMER if awaiting else SubstitutionStatus.AUTO_APPROVED,
        decided_at=None if awaiting else timezone.now(),
    )
    if awaiting:
        workflow.add_history(
            order,
            f"Proposed {candidate.name} for {item.name} — awaiting customer",
            actor=actor,
            public_note=f"We suggested {candidate.name} instead of {item.name} — waiting for your answer",
        )
        notify_order(
            order,
            "SUBSTITUTION_REQUIRED",
            detail=f"{item.name} is unavailable. We suggest {candidate.name}. You'd pay {money(charged_total)} for it (never more than the {money(item.line_total_estimated)} you'd have paid). Please approve or decline from your order page.",
        )
    else:
        item.status = OrderItemStatus.SUBSTITUTED
        item.save(update_fields=["status", "updated_at"])
        workflow.add_history(
            order,
            f"Substituted {item.name} with {candidate.name} (customer allows substitutes)",
            actor=actor,
            public_note=f"{item.name} was unavailable — replaced with {candidate.name}",
        )
        notify_order(
            order,
            "SUBSTITUTION_DECIDED",
            detail=f"{item.name} was unavailable, so as you allowed we're substituting {candidate.name}. You'll pay {money(charged_total)}, never more than the original.",
        )
    return sub


@transaction.atomic
def decide_substitution(substitution_id: int, approve: bool, actor=None, *, on_behalf_note: str = "") -> Substitution:
    """The customer's answer (or staff recording it on their behalf — e.g. by phone — which is logged as such)."""
    sub = (
        Substitution.objects.select_for_update(of=("self",))
        .select_related("order_item", "substitute_item")
        .get(pk=substitution_id)
    )
    item, order = _item_order(sub.order_item_id, statuses={OrderStatus.PICKING, OrderStatus.CONFIRMED})
    if sub.status != SubstitutionStatus.AWAITING_CUSTOMER:
        raise DomainError(ErrorCode.INVALID_STATE, "This substitution has already been answered.", status_code=409)
    child = sub.substitute_item
    sub.decided_by, sub.decided_at = (actor if getattr(actor, "pk", None) else None), timezone.now()
    suffix = f" (recorded by staff on the customer's behalf: {on_behalf_note})" if on_behalf_note else ""
    if approve:
        sub.status = SubstitutionStatus.APPROVED
        child.status = OrderItemStatus.PENDING
        child.save(update_fields=["status", "updated_at"])
        item.status = OrderItemStatus.SUBSTITUTED
        item.save(update_fields=["status", "updated_at"])
        workflow.add_history(
            order,
            f"Customer approved {child.name} for {item.name}{suffix}",
            actor=actor,
            public_note=f"You approved {child.name} instead of {item.name}",
        )
        notify_order(order, "SUBSTITUTION_DECIDED", detail=f"Thanks — we'll pack {child.name} instead of {item.name}.")
    else:
        sub.status = SubstitutionStatus.REJECTED
        inventory.release_allocations(Allocation.objects.filter(order_item=child, state=AllocationState.RESERVED))
        child.status, child.picked_qty, child.line_total_final = OrderItemStatus.REMOVED, ZERO, ZERO
        child.save(update_fields=["status", "picked_qty", "line_total_final", "updated_at"])
        workflow.add_history(
            order,
            f"Customer declined {child.name} for {item.name}{suffix}",
            actor=actor,
            public_note=f"You declined the substitute — {item.name} has been removed and won't be charged",
        )
        _remove(item, order, actor, "Customer declined the substitute")
    sub.save(update_fields=["status", "decided_by", "decided_at", "updated_at"])
    return sub


# ----------------------------------------------------------------------------------------- finalising
_OPEN_ITEM = (OrderItemStatus.PENDING, OrderItemStatus.PROPOSED, OrderItemStatus.UNAVAILABLE)


def finalize_totals(order: Order) -> Order:
    """Recompute the order from what was actually picked. Discounts follow delivered items and can only shrink;
    the result is capped at the authorised amount."""
    store = StoreSettings.load()
    items = list(order.items.select_related("product"))
    subtotal = ZERO
    coupon_total = tax = ZERO
    for it in items:
        if it.status in (OrderItemStatus.REMOVED, OrderItemStatus.SUBSTITUTED):
            it.coupon_share = ZERO
            it.line_total_final = ZERO if it.line_total_final is None else it.line_total_final
            it.save(update_fields=["coupon_share", "line_total_final", "updated_at"])
            continue
        final = it.line_total_final if it.line_total_final is not None else it.line_total_estimated
        ratio = min(Decimal("1"), final / it.line_total_estimated) if it.line_total_estimated else Decimal("1")
        share = money(it.coupon_share * ratio)
        it.coupon_share = share
        it.save(update_fields=["coupon_share", "updated_at"])
        subtotal += final
        coupon_total += share
        rate = it.tax_rate
        if rate:
            base = final - share
            tax += money(base * rate / (HUNDRED + rate)) if store.prices_include_tax else money(base * rate / HUNDRED)
    total = money(subtotal - coupon_total + order.delivery_fee + (ZERO if store.prices_include_tax else tax))
    order.final_total = min(total, order.authorized_amount)
    order.subtotal = money(subtotal)
    order.coupon_discount = money(coupon_total)
    order.tax_total = money(tax)
    order.weights_finalized_at = timezone.now()
    order.save(
        update_fields=["final_total", "subtotal", "coupon_discount", "tax_total", "weights_finalized_at", "updated_at"]
    )
    return order


@transaction.atomic
def finish_picking(order: Order, actor) -> Order:
    locked = workflow.lock_order(order)
    if locked.status != OrderStatus.PICKING:
        raise DomainError(ErrorCode.INVALID_ORDER_TRANSITION, "This order isn't being picked.", status_code=409)
    items = list(locked.items.all())
    awaiting = Substitution.objects.filter(
        order_item__order=locked, status=SubstitutionStatus.AWAITING_CUSTOMER
    ).exists()
    if awaiting:
        raise DomainError(
            ErrorCode.SUBSTITUTION_REQUIRES_APPROVAL,
            "A substitute is still waiting for the customer's answer.",
            status_code=409,
        )
    open_items = [i for i in items if i.status in _OPEN_ITEM]
    if open_items:
        names = ", ".join(i.name for i in open_items[:3])
        raise DomainError(
            ErrorCode.INVALID_STATE,
            f"Finish every item before packing: {names}.",
            status_code=409,
            details={"item_ids": [i.id for i in open_items]},
        )
    if not any(i.status in (OrderItemStatus.PICKED, OrderItemStatus.SHORT) for i in items):
        cancelled = workflow.cancel_order(
            locked, actor=actor, reason="None of the items could be supplied", by_customer=False
        )
        return cancelled
    finalize_totals(locked)
    packing = workflow.transition(
        locked, OrderStatus.PACKING, actor=actor, note="Picking complete", public_note="Picked — now packing your order"
    )
    return packing


@transaction.atomic
def reopen_picking(order: Order, actor) -> Order:
    locked = workflow.lock_order(order)
    if locked.status != OrderStatus.PACKING or locked.payments.filter(state="CAPTURED").exists():
        raise DomainError(
            ErrorCode.INVALID_ORDER_TRANSITION,
            "Picking can only be reopened before payment is captured.",
            status_code=409,
        )
    return workflow.transition(locked, OrderStatus.PICKING, actor=actor, note="Picking reopened")


@transaction.atomic
def finish_packing(order: Order, actor) -> Order:
    locked = workflow.lock_order(order)
    if locked.status != OrderStatus.PACKING:
        raise DomainError(ErrorCode.INVALID_ORDER_TRANSITION, "This order isn't being packed.", status_code=409)
    if locked.final_total is None:
        raise DomainError(ErrorCode.INVALID_STATE, "Totals haven't been finalised yet.", status_code=409)
    if (
        locked.payment_method == "CARD"
        and payments.capture_for_order(locked, locked.final_total, actor) is None
        and locked.final_total > 0
    ):
        raise DomainError(
            ErrorCode.PAYMENT_FAILED,
            "There's no authorised card payment to capture for this order.",
            status_code=409,
        )
    target = (
        OrderStatus.READY_FOR_PICKUP
        if locked.fulfilment_type == FulfilmentType.PICKUP
        else OrderStatus.READY_FOR_DISPATCH
    )
    ready = workflow.transition(
        locked,
        target,
        actor=actor,
        note="Packed",
        public_note="Packed and ready" if target == OrderStatus.READY_FOR_PICKUP else "Packed — ready for dispatch",
    )
    notify_order(ready, "ORDER_READY_PICKUP" if target == OrderStatus.READY_FOR_PICKUP else "ORDER_READY_DISPATCH")
    return ready


@transaction.atomic
def dispatch(order: Order, actor) -> Order:
    out = workflow.transition(
        workflow.lock_order(order),
        OrderStatus.OUT_FOR_DELIVERY,
        actor=actor,
        note="Left the store",
        public_note="Out for delivery",
    )
    notify_order(out, "OUT_FOR_DELIVERY")
    return out


@transaction.atomic
def complete(order: Order, actor, *, collected_amount=None, reference: str = "") -> Order:
    locked = workflow.lock_order(order)
    if locked.payment_method == "COD":
        if collected_amount is None:
            raise DomainError(
                ErrorCode.VALIDATION_ERROR,
                f"Record the amount collected ({locked.final_total}).",
                details={"due": str(locked.final_total)},
            )
        payments.mark_cod_collected(locked, Decimal(str(collected_amount)), actor, reference)
    done = workflow.transition(
        locked,
        OrderStatus.COMPLETED,
        actor=actor,
        note="Handed over",
        public_note="Delivered — thank you!"
        if locked.fulfilment_type == FulfilmentType.DELIVERY
        else "Collected — thank you!",
    )
    notify_order(done, "ORDER_COMPLETED")
    return done
