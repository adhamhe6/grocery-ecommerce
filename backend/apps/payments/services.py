"""Payment state machine, webhook processing, capture/void/refund.

Invariants (enforced here and by DB constraints):
* One *open* payment (REQUIRES_ACTION / AUTHORIZED / PENDING_COLLECTION) per order.
* A provider event id is applied at most once (`unique(provider, event_id)`), and its side effects are in the same
  transaction as the event row — if processing fails the row rolls back and the provider's retry re-processes it.
* We never trust a browser redirect as proof of payment: only a verified provider event authorises an order.
* The amount captured can never exceed the amount the customer authorised.
"""

from __future__ import annotations

import contextlib
import json
import logging
from decimal import Decimal

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.core import audit
from apps.core.exceptions import DomainError, ErrorCode
from apps.core.logging import scrub
from apps.core.money import ZERO, money

from .models import (
    OPEN_STATES,
    EventOutcome,
    Payment,
    PaymentEvent,
    PaymentState,
    Provider,
    Refund,
    RefundMethod,
    RefundStatus,
)
from .providers import InvalidSignature, ProviderError, ProviderEvent, get_provider

logger = logging.getLogger(__name__)

ORDER_PAYMENT_STATUS = {
    PaymentState.REQUIRES_ACTION: "UNPAID",
    PaymentState.AUTHORIZED: "AUTHORIZED",
    PaymentState.CAPTURED: "PAID",
    PaymentState.PENDING_COLLECTION: "PENDING_COLLECTION",
    PaymentState.FAILED: "FAILED",
    PaymentState.CANCELLED: "UNPAID",
    PaymentState.VOIDED: "VOIDED",
    PaymentState.PARTIALLY_REFUNDED: "PARTIALLY_REFUNDED",
    PaymentState.REFUNDED: "REFUNDED",
}


def _sync_order(payment: Payment) -> None:
    order = payment.order
    new = ORDER_PAYMENT_STATUS[payment.state]
    if order.payment_status != new:
        order.payment_status = new
        order.save(update_fields=["payment_status", "updated_at"])


def card_provider_name() -> str | None:
    name = settings.PAYMENT_PROVIDER
    return name if name in ("demo", "stripe") else None


# ----------------------------------------------------------------------------------------- creating payments
def create_payment_attempt(order, method: str) -> Payment:
    """Create the payment row for an order (inside the caller's transaction). No external calls here."""
    if method == "COD":
        provider, state = Provider.COD, PaymentState.PENDING_COLLECTION
    else:
        name = card_provider_name()
        if name is None:
            raise DomainError(
                ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE,
                "Card payments aren't available right now. Please choose another payment method.",
                status_code=503,
            )
        provider, state = Provider(name), PaymentState.REQUIRES_ACTION
    attempt = order.payments.count() + 1
    payment = Payment.objects.create(
        order=order,
        provider=provider,
        method=method,
        state=state,
        amount=order.authorized_amount,
        currency=order.currency,
        attempt=attempt,
        is_demo=provider == Provider.DEMO,
    )
    _sync_order(payment)
    return payment


def init_with_provider(payment_id: int) -> Payment:
    """Ask the provider for a hosted checkout. Runs OUTSIDE any DB transaction; safe to repeat."""
    payment = Payment.objects.select_related("order").get(pk=payment_id)
    if payment.provider_reference or payment.state != PaymentState.REQUIRES_ACTION:
        return payment
    provider = get_provider(payment.provider)
    result = provider.create_payment(payment)  # may raise ProviderError
    with transaction.atomic():
        locked = Payment.objects.select_for_update(of=("self",)).select_related("order").get(pk=payment_id)
        if not locked.provider_reference and locked.state == PaymentState.REQUIRES_ACTION:
            locked.provider_reference, locked.checkout_url = result.reference, result.checkout_url
            locked.save(update_fields=["provider_reference", "checkout_url", "updated_at"])
        return locked


# ----------------------------------------------------------------------------------------- webhook
def _scrubbed(event: ProviderEvent) -> dict:
    return scrub(
        {
            "type": event.type,
            "reference": event.reference,
            "payment_id": event.payment_id,
            "amount": str(event.amount) if event.amount is not None else None,
        }
    )


def handle_webhook(provider_name: str, headers, body: bytes) -> tuple[int, dict]:
    """Verify → de-duplicate → apply. Returns (http_status, json). Never raises."""
    try:
        provider = get_provider(provider_name)
        event = provider.parse_webhook(headers, body)
    except ProviderError:
        return 503, {"status": "provider_unavailable"}
    except InvalidSignature as exc:
        logger.warning("webhook_rejected", extra={"provider": provider_name, "reason": str(exc)})
        return 400, {"status": "invalid_signature"}
    if event.type.startswith("ignored."):
        return 200, {"status": "ignored"}
    try:
        with transaction.atomic():
            try:
                with transaction.atomic():
                    row = PaymentEvent.objects.create(
                        provider=provider_name, event_id=event.id, event_type=event.type, payload=_scrubbed(event)
                    )
            except IntegrityError:
                logger.info("webhook_duplicate", extra={"provider": provider_name, "event_id": event.id})
                return 200, {"status": "duplicate"}
            outcome, payment, message = apply_event(provider_name, event)
            row.outcome, row.payment, row.error = outcome, payment, message[:300]
            row.save(update_fields=["outcome", "payment", "error"])
        return 200, {"status": outcome.lower()}
    except Exception:  # noqa: BLE001 - the event row rolled back with the transaction, so the provider's retry will re-process it
        logger.exception("webhook_processing_failed", extra={"provider": provider_name, "event_id": event.id})
        return 500, {"status": "error"}


def _find_payment(provider_name: str, event: ProviderEvent) -> Payment | None:
    qs = Payment.objects.select_for_update(of=("self",)).select_related("order__branch", "order__customer")
    if event.payment_id:
        return qs.filter(pk=event.payment_id, provider=provider_name).first()
    if event.reference:
        return qs.filter(provider=provider_name, provider_reference=event.reference).first()
    return None


def apply_event(provider_name: str, event: ProviderEvent) -> tuple[str, Payment | None, str]:
    from apps.orders import workflow

    if event.type.startswith("refund."):
        return _apply_refund_event(provider_name, event)
    payment = _find_payment(provider_name, event)
    if payment is None:
        return EventOutcome.IGNORED, None, "no matching payment"
    order = payment.order

    if event.type == "payment.authorized":
        if payment.state in (
            PaymentState.AUTHORIZED,
            PaymentState.CAPTURED,
            PaymentState.PARTIALLY_REFUNDED,
            PaymentState.REFUNDED,
        ):
            return EventOutcome.IGNORED, payment, "already authorised"
        if payment.state == PaymentState.REQUIRES_ACTION and order.status == "PENDING_PAYMENT":
            if event.amount is not None and money(event.amount) != money(payment.amount):
                logger.error("payment_amount_mismatch", extra={"payment_id": payment.pk})
                return EventOutcome.ERROR, payment, "authorised amount differs from expected; order not confirmed"
            payment.state = PaymentState.AUTHORIZED
            payment.save(update_fields=["state", "updated_at"])
            _sync_order(payment)
            workflow.confirm_after_payment(order)
            return EventOutcome.APPLIED, payment, ""
        # Late or orphaned authorisation — the order is no longer waiting on this payment: release the hold.
        provider = get_provider(provider_name)
        provider.void(payment)
        payment.state = PaymentState.VOIDED
        payment.failure_message = "Authorisation arrived after the order was released; hold released."
        payment.save(update_fields=["state", "failure_message", "updated_at"])
        audit.record("system", "payment.late_authorization_voided", payment, summary=f"Order {order.number}")
        return EventOutcome.APPLIED, payment, "late authorisation voided"

    if event.type in ("payment.failed", "payment.cancelled"):
        if payment.state != PaymentState.REQUIRES_ACTION:
            return EventOutcome.IGNORED, payment, f"payment already {payment.state}"
        failed = event.type == "payment.failed"
        payment.state = PaymentState.FAILED if failed else PaymentState.CANCELLED
        payment.failure_code = event.raw.get("failure_code", "") if isinstance(event.raw, dict) else ""
        payment.failure_message = (event.raw.get("message") if isinstance(event.raw, dict) else "") or (
            "Payment was declined." if failed else "Payment was cancelled."
        )
        payment.save(update_fields=["state", "failure_code", "failure_message", "updated_at"])
        if order.status == "PENDING_PAYMENT":
            order.payment_status = "FAILED" if failed else "UNPAID"
            order.save(update_fields=["payment_status", "updated_at"])
            workflow.after_payment_failed(order, failed)
        return EventOutcome.APPLIED, payment, ""

    return EventOutcome.IGNORED, payment, f"unhandled event type {event.type}"


def _apply_refund_event(provider_name: str, event: ProviderEvent):
    refund = (
        Refund.objects.select_for_update(of=("self",))
        .filter(payment__provider=provider_name, provider_refund_id=event.refund_id or event.reference)
        .first()
    )
    if refund is None:
        return EventOutcome.IGNORED, None, "no matching refund"
    if refund.status != RefundStatus.PENDING:
        return EventOutcome.IGNORED, refund.payment, "refund already settled"
    if event.type == "refund.succeeded":
        _complete_refund(refund)
    else:
        refund.status, refund.failure_message = RefundStatus.FAILED, "Provider reported the refund failed."
        refund.save(update_fields=["status", "failure_message", "updated_at"])
    return EventOutcome.APPLIED, refund.payment, ""


# ----------------------------------------------------------------------------------------- capture / void / cancel
def capture_for_order(order, amount: Decimal, actor=None) -> Payment | None:
    """Capture the final amount of an authorised card payment (never more than authorised). COD → None."""
    payment = Payment.objects.select_for_update(of=("self",)).filter(order=order, state=PaymentState.AUTHORIZED).first()
    if payment is None:
        return None
    amount = min(money(amount), payment.amount)
    if amount <= 0:
        void_open_payments(order)
        return None
    try:
        get_provider(payment.provider).capture(payment, amount)
    except ProviderError as exc:
        logger.error("payment_capture_failed", extra={"payment_id": payment.pk, "error": str(exc)})
        raise DomainError(
            ErrorCode.PAYMENT_FAILED,
            "We couldn't complete the payment capture. Please try again, or contact support if it keeps failing.",
            status_code=502,
        ) from exc
    payment.state, payment.captured_amount, payment.captured_at = PaymentState.CAPTURED, amount, timezone.now()
    payment.save(update_fields=["state", "captured_amount", "captured_at", "updated_at"])
    _sync_order(payment)
    audit.record(actor or "system", "payment.captured", payment, summary=f"{order.number} {amount}")
    return payment


def void_open_payments(order, actor=None) -> int:
    """Release holds / abandon unpaid attempts when an order is cancelled or expires. Idempotent."""
    count = 0
    for payment in Payment.objects.select_for_update(of=("self",)).filter(order=order, state__in=OPEN_STATES):
        if payment.state == PaymentState.AUTHORIZED:
            try:
                get_provider(payment.provider).void(payment)
            except ProviderError as exc:
                raise DomainError(
                    ErrorCode.PAYMENT_FAILED,
                    "We couldn't release the card authorisation. Please try again.",
                    status_code=502,
                ) from exc
            payment.state = PaymentState.VOIDED
        else:
            if (
                payment.state == PaymentState.REQUIRES_ACTION
                and payment.provider_reference
                and payment.provider != Provider.COD
            ):
                with contextlib.suppress(ProviderError):  # best effort: the order is released either way
                    get_provider(payment.provider).cancel_checkout(payment)
            payment.state = PaymentState.CANCELLED
        payment.save(update_fields=["state", "updated_at"])
        _sync_order(payment)
        audit.record(actor or "system", "payment.released", payment, summary=order.number)
        count += 1
    return count


def mark_cod_collected(order, amount: Decimal, actor, reference: str = "") -> Payment:
    payment = (
        Payment.objects.select_for_update(of=("self",))
        .filter(order=order, state=PaymentState.PENDING_COLLECTION)
        .first()
    )
    if payment is None:
        raise DomainError(
            ErrorCode.INVALID_STATE, "There's no payment waiting to be collected for this order.", status_code=409
        )
    due = order.final_total if order.final_total is not None else order.total
    if money(amount) != money(due):
        raise DomainError(
            ErrorCode.VALIDATION_ERROR,
            f"The amount collected must match the amount due ({money(due)}).",
            details={"due": str(money(due))},
        )
    payment.state, payment.captured_amount, payment.captured_at = PaymentState.CAPTURED, money(amount), timezone.now()
    payment.provider_reference = payment.provider_reference or reference[:120]
    payment.save(update_fields=["state", "captured_amount", "captured_at", "provider_reference", "updated_at"])
    _sync_order(payment)
    audit.record(actor, "payment.cod_collected", payment, summary=f"{order.number} {money(amount)}")
    return payment


# ----------------------------------------------------------------------------------------- refunds
def _refundable(payment: Payment) -> Decimal:
    pending = sum((r.amount for r in payment.refunds.filter(status=RefundStatus.PENDING)), ZERO)
    return payment.captured_amount - payment.refunded_amount - pending


def _complete_refund(refund: Refund) -> None:
    payment = Payment.objects.select_for_update(of=("self",)).select_related("order").get(pk=refund.payment_id)
    refund.status, refund.completed_at = RefundStatus.SUCCEEDED, timezone.now()
    refund.save(update_fields=["status", "completed_at", "updated_at"])
    payment.refunded_amount += refund.amount
    payment.state = (
        PaymentState.REFUNDED if payment.refunded_amount >= payment.captured_amount else PaymentState.PARTIALLY_REFUNDED
    )
    payment.save(update_fields=["refunded_amount", "state", "updated_at"])
    _sync_order(payment)
    from apps.notifications.services import notify_order

    notify_order(
        payment.order,
        "REFUND_UPDATED",
        detail=f"A refund of {refund.amount} has been issued for order {payment.order.number}.",
    )


def _same_refund_or_conflict(refund: Refund, amount: Decimal) -> Refund:
    """An idempotency key identifies *one* request. Replaying it returns that refund; reusing it for a different amount is
    a client bug that must not silently succeed with the wrong figure."""
    if money(amount) != refund.amount:
        raise DomainError(
            ErrorCode.IDEMPOTENCY_CONFLICT,
            "This request key was already used for a refund of a different amount. Please refresh and try again.",
            status_code=422,
        )
    return refund


def request_refund(
    order, amount: Decimal, reason: str, actor, idempotency_key: str, *, support_case=None, manual: bool = False
) -> Refund:
    """Refund part or all of what was *actually captured*. Never changes a status without the provider (or a staff
    confirmation for manual refunds) saying the money moved."""
    # A retry of a request that already fully refunded the order must return that refund, not "nothing left to refund".
    previous = Refund.objects.filter(order=order, idempotency_key=idempotency_key).first()
    if previous:
        return _same_refund_or_conflict(previous, amount)
    payment = (
        Payment.objects.select_for_update(of=("self",))
        .filter(order=order, state__in=[PaymentState.CAPTURED, PaymentState.PARTIALLY_REFUNDED])
        .order_by("-created_at")
        .first()
    )
    if payment is None:
        raise DomainError(
            ErrorCode.REFUND_NOT_ALLOWED, "Only payments that have been collected can be refunded.", status_code=409
        )
    existing = Refund.objects.filter(payment=payment, idempotency_key=idempotency_key).first()
    if existing:
        return _same_refund_or_conflict(existing, amount)  # retry of the same request: never a second refund
    amount = money(amount)
    if amount <= 0:
        raise DomainError(ErrorCode.VALIDATION_ERROR, "Refund amount must be greater than zero.")
    if amount > _refundable(payment):
        raise DomainError(
            ErrorCode.REFUND_NOT_ALLOWED,
            f"At most {money(_refundable(payment))} can still be refunded on this order.",
            status_code=409,
            details={"refundable": str(money(_refundable(payment)))},
        )
    use_manual = manual or payment.provider == Provider.COD
    refund = Refund.objects.create(
        payment=payment,
        order=order,
        amount=amount,
        reason=reason[:300],
        idempotency_key=idempotency_key,
        requested_by=actor,
        support_case=support_case,
        method=RefundMethod.MANUAL if use_manual else RefundMethod.PROVIDER,
    )
    audit.record(actor, "refund.requested", refund, summary=f"{order.number} {amount}: {reason}")
    if use_manual:
        return refund  # PENDING until staff record the reference with complete_manual_refund
    try:
        result = get_provider(payment.provider).refund(payment, amount, idempotency_key)
    except ProviderError as exc:
        refund.failure_message = f"Provider unreachable: {exc}"[:300]
        refund.save(update_fields=["failure_message", "updated_at"])
        return refund  # stays PENDING; retrying with the same key is safe
    refund.provider_refund_id = result.refund_id
    if result.status == "SUCCEEDED":
        _complete_refund(refund)
    elif result.status == "FAILED":
        refund.status, refund.failure_message = RefundStatus.FAILED, result.message[:300]
    refund.save(update_fields=["provider_refund_id", "status", "failure_message", "updated_at"])
    return refund


def complete_manual_refund(refund: Refund, reference: str, actor) -> Refund:
    refund = Refund.objects.select_for_update(of=("self",)).get(pk=refund.pk)
    if refund.method != RefundMethod.MANUAL or refund.status != RefundStatus.PENDING:
        raise DomainError(
            ErrorCode.INVALID_STATE, "This refund isn't waiting for manual confirmation.", status_code=409
        )
    if not reference.strip():
        raise DomainError(ErrorCode.VALIDATION_ERROR, "Enter the receipt or reference for the refund you handed over.")
    refund.reference = reference.strip()[:120]
    refund.save(update_fields=["reference", "updated_at"])
    _complete_refund(refund)
    audit.record(actor, "refund.manual_completed", refund, summary=f"{refund.order.number} ref {refund.reference}")
    refund.refresh_from_db()
    return refund


def webhook_body(payload: dict) -> bytes:
    return json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
