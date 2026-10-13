"""Order state machine. Statuses change only through `transition()`; there is no endpoint that accepts a raw status."""

from __future__ import annotations

import logging

from django.db import connection, transaction
from django.utils import timezone

from apps.core import audit
from apps.core.exceptions import DomainError, ErrorCode

from .models import FulfilmentType, Order, OrderStatus, OrderStatusHistory

logger = logging.getLogger(__name__)
S = OrderStatus

TRANSITIONS: dict[str, set[str]] = {
    S.PENDING_PAYMENT: {S.CONFIRMED, S.CANCELLED, S.PAYMENT_FAILED},
    S.CONFIRMED: {S.PICKING, S.CANCELLED},
    S.PICKING: {S.PACKING, S.CANCELLED},
    S.PACKING: {S.READY_FOR_PICKUP, S.READY_FOR_DISPATCH, S.PICKING, S.CANCELLED},
    S.READY_FOR_PICKUP: {S.COMPLETED, S.CANCELLED},
    S.READY_FOR_DISPATCH: {S.OUT_FOR_DELIVERY, S.CANCELLED},
    S.OUT_FOR_DELIVERY: {S.COMPLETED, S.READY_FOR_DISPATCH, S.CANCELLED},
    S.COMPLETED: set(),
    S.CANCELLED: set(),
    S.PAYMENT_FAILED: set(),
}
FULFILMENT_ONLY = {
    S.READY_FOR_PICKUP: FulfilmentType.PICKUP,
    S.READY_FOR_DISPATCH: FulfilmentType.DELIVERY,
    S.OUT_FOR_DELIVERY: FulfilmentType.DELIVERY,
}
TERMINAL = {S.COMPLETED, S.CANCELLED, S.PAYMENT_FAILED}
CUSTOMER_CANCELLABLE = {S.PENDING_PAYMENT, S.CONFIRMED}
TIMESTAMPS = {
    S.CONFIRMED: "confirmed_at",
    S.PICKING: "picking_started_at",
    S.READY_FOR_PICKUP: "ready_at",
    S.READY_FOR_DISPATCH: "ready_at",
    S.OUT_FOR_DELIVERY: "dispatched_at",
    S.COMPLETED: "completed_at",
    S.CANCELLED: "cancelled_at",
}

STATUS_LABELS = dict(OrderStatus.choices)


def actor_label(actor) -> str:
    return getattr(actor, "email", None) or (actor if isinstance(actor, str) else "system")


def lock_order(order_or_id) -> Order:
    pk = getattr(order_or_id, "pk", order_or_id)
    return Order.objects.select_for_update(of=("self",)).select_related("branch", "customer").get(pk=pk)


def allowed_next(order: Order) -> list[str]:
    return sorted(
        t for t in TRANSITIONS[order.status] if FULFILMENT_ONLY.get(t, order.fulfilment_type) == order.fulfilment_type
    )


def transition(order, to: str, *, actor=None, note: str = "", public_note: str = "") -> Order:
    """Move an order to `to`, recording who/when. Must run in a transaction; locks the order row."""
    if not connection.in_atomic_block:
        raise RuntimeError("transition() must run inside transaction.atomic()")
    locked = lock_order(order)
    if (
        to not in TRANSITIONS[locked.status]
        or FULFILMENT_ONLY.get(to, locked.fulfilment_type) != locked.fulfilment_type
    ):
        raise DomainError(
            ErrorCode.INVALID_ORDER_TRANSITION,
            f"Order {locked.number} can't move from {STATUS_LABELS[locked.status]} to {STATUS_LABELS.get(to, to)}.",
            status_code=409,
            details={"from": locked.status, "to": to, "allowed": allowed_next(locked)},
        )
    previous = locked.status
    locked.status = to
    fields = ["status", "updated_at"]
    stamp = TIMESTAMPS.get(to)
    if stamp:
        setattr(locked, stamp, timezone.now())
        fields.append(stamp)
    if to == S.READY_FOR_PICKUP or to == S.READY_FOR_DISPATCH:
        locked.packed_at = timezone.now()
        fields.append("packed_at")
    locked.save(update_fields=fields)
    OrderStatusHistory.objects.create(
        order=locked,
        from_status=previous,
        to_status=to,
        actor=actor if getattr(actor, "pk", None) else None,
        actor_label=actor_label(actor),
        note=note[:400],
        public_note=(public_note or "")[:300],
    )
    logger.info(
        "order_transition", extra={"order": locked.number, "from": previous, "to": to, "actor": actor_label(actor)}
    )
    return locked


def add_history(order, note: str, *, actor=None, public_note: str = "") -> None:
    """Timeline entry that doesn't change status (substitutions, weights, refunds…)."""
    OrderStatusHistory.objects.create(
        order=order,
        from_status=order.status,
        to_status=order.status,
        actor=actor if getattr(actor, "pk", None) else None,
        actor_label=actor_label(actor),
        note=note[:400],
        public_note=public_note[:300],
    )


# ----------------------------------------------------------------------------------------- payment-driven
def confirm_after_payment(order) -> Order:
    from apps.notifications.services import notify_order

    locked = transition(order, S.CONFIRMED, note="Payment authorised", public_note="Payment received — order confirmed")
    Order.objects.filter(pk=locked.pk).update(reservation_expires_at=None)
    locked.reservation_expires_at = None
    notify_order(locked, "PAYMENT_CONFIRMED")
    return locked


def after_payment_failed(order, failed: bool) -> None:
    from apps.notifications.services import notify_order

    add_history(
        order,
        "Payment attempt failed" if failed else "Payment cancelled by customer",
        public_note="Your payment didn't go through — you can try again."
        if failed
        else "Payment was cancelled — you can try again.",
    )
    notify_order(order, "PAYMENT_FAILED")


def _unwind(order: Order, actor) -> None:
    """Give back everything an unfinished order was holding: stock, slot, coupon use, card hold."""
    from apps.inventory import services as inventory
    from apps.payments import services as payments
    from apps.promotions import coupons
    from apps.stores.services import release_slot

    inventory.release_order(order)
    inventory.return_committed_items(order, actor if getattr(actor, "pk", None) else None)
    release_slot(order.slot_id)
    coupons.void_redemption(order)
    payments.void_open_payments(order, actor)


@transaction.atomic
def cancel_order(order, *, actor=None, reason: str, by_customer: bool = False) -> Order:
    from apps.notifications.services import notify_order
    from apps.payments import services as payments
    from apps.payments.models import Payment, PaymentState

    locked = lock_order(order)
    if locked.status in TERMINAL:
        raise DomainError(
            ErrorCode.INVALID_ORDER_TRANSITION,
            f"Order {locked.number} is already {STATUS_LABELS[locked.status].lower()}.",
            status_code=409,
        )
    if by_customer and locked.status not in CUSTOMER_CANCELLABLE:
        raise DomainError(
            ErrorCode.INVALID_ORDER_TRANSITION,
            "We've already started preparing this order, so it can't be cancelled online. Please contact us and we'll help.",
            status_code=409,
        )
    if not reason.strip():
        raise DomainError(ErrorCode.VALIDATION_ERROR, "A cancellation reason is required.")
    _unwind(locked, actor)
    # Money already collected goes back in full through the normal (idempotent) refund path.
    captured = Payment.objects.filter(
        order=locked, state__in=[PaymentState.CAPTURED, PaymentState.PARTIALLY_REFUNDED]
    ).first()
    if captured is not None:
        remaining = captured.captured_amount - captured.refunded_amount
        if remaining > 0:
            payments.request_refund(
                locked, remaining, f"Order cancelled: {reason}", actor, idempotency_key=f"cancel-{locked.number}"
            )
    cancelled = transition(locked, S.CANCELLED, actor=actor, note=reason, public_note="Order cancelled")
    cancelled.cancel_reason = reason[:300]
    cancelled.cancelled_by = actor if getattr(actor, "pk", None) else None
    cancelled.save(update_fields=["cancel_reason", "cancelled_by", "updated_at"])
    audit.record(actor or "customer", "order.cancelled", cancelled, summary=f"{cancelled.number}: {reason}")
    notify_order(
        cancelled,
        "ORDER_CANCELLED",
        detail=f"Your order {cancelled.number} was cancelled. Any payment hold has been released or refunded.",
    )
    return cancelled


@transaction.atomic
def expire_unpaid(order) -> Order | None:
    """Release a card order whose payment never completed. Idempotent; re-checks state under lock."""
    from apps.notifications.services import notify_order

    locked = lock_order(order)
    if (
        locked.status != S.PENDING_PAYMENT
        or locked.reservation_expires_at is None
        or locked.reservation_expires_at > timezone.now()
    ):
        return None
    _unwind(locked, "system")
    expired = transition(
        locked,
        S.PAYMENT_FAILED,
        actor="system",
        note="Reservation expired without payment",
        public_note="Payment wasn't completed in time — items released",
    )
    notify_order(expired, "PAYMENT_EXPIRED")
    return expired
