"""Stripe adapter (Checkout Sessions with manual capture + signed webhooks).

STATUS: implemented against the official SDK but **not verified against a live Stripe sandbox** (no credentials were
available while building this). Webhook signature verification is exercised in tests using the SDK's own
`construct_event` with locally generated signatures; network calls are stubbed at the SDK boundary.
Before enabling in production: add sandbox keys, run an end-to-end test payment, then switch to live keys.
"""

from __future__ import annotations

from decimal import Decimal

from django.conf import settings

from .base import CreateResult, InvalidSignature, PaymentProvider, ProviderError, ProviderEvent, RefundResult

ZERO_DECIMAL = {
    "BIF",
    "CLP",
    "DJF",
    "GNF",
    "JPY",
    "KMF",
    "KRW",
    "MGA",
    "PYG",
    "RWF",
    "UGX",
    "VND",
    "VUV",
    "XAF",
    "XOF",
    "XPF",
}
THREE_DECIMAL = {"BHD", "JOD", "KWD", "OMR", "TND"}


def to_minor(amount: Decimal, currency: str) -> int:
    c = currency.upper()
    exp = 0 if c in ZERO_DECIMAL else 3 if c in THREE_DECIMAL else 2
    return int((amount * (10**exp)).to_integral_value())


def from_minor(amount: int, currency: str) -> Decimal:
    c = currency.upper()
    exp = 0 if c in ZERO_DECIMAL else 3 if c in THREE_DECIMAL else 2
    return Decimal(amount) / (10**exp)


class StripeProvider(PaymentProvider):
    name = "stripe"

    def __init__(self):
        if not settings.STRIPE_SECRET_KEY:
            raise ProviderError("Stripe is not configured (STRIPE_SECRET_KEY is empty).")
        import stripe

        self.stripe = stripe
        self.stripe.api_key = settings.STRIPE_SECRET_KEY
        self.is_live = settings.STRIPE_SECRET_KEY.startswith("sk_live_")

    def create_payment(self, payment) -> CreateResult:
        order = payment.order
        meta = {"payment_id": str(payment.pk), "order_number": order.number}
        try:
            session = self.stripe.checkout.Session.create(
                mode="payment",
                client_reference_id=order.number,
                customer_email=order.contact_email,
                line_items=[
                    {
                        "quantity": 1,
                        "price_data": {
                            "currency": payment.currency.lower(),
                            "unit_amount": to_minor(payment.amount, payment.currency),
                            "product_data": {"name": f"Order {order.number} (maximum authorised amount)"},
                        },
                    }
                ],
                payment_intent_data={"capture_method": "manual", "metadata": meta},
                metadata=meta,
                success_url=f"{settings.FRONTEND_URL}/orders/{order.number}?payment=return",
                cancel_url=f"{settings.FRONTEND_URL}/orders/{order.number}?payment=cancelled",
                idempotency_key=f"payment-{payment.pk}-create",
            )
        except self.stripe.StripeError as exc:
            raise ProviderError(str(exc)) from exc
        return CreateResult(session.id, session.url)

    def _intent_id(self, payment) -> str:
        try:
            session = self.stripe.checkout.Session.retrieve(payment.provider_reference)
            return session.payment_intent
        except self.stripe.StripeError as exc:
            raise ProviderError(str(exc)) from exc

    def capture(self, payment, amount: Decimal) -> None:
        try:
            self.stripe.PaymentIntent.capture(
                self._intent_id(payment),
                amount_to_capture=to_minor(amount, payment.currency),
                idempotency_key=f"payment-{payment.pk}-capture-{to_minor(amount, payment.currency)}",
            )
        except self.stripe.StripeError as exc:
            raise ProviderError(str(exc)) from exc

    def void(self, payment) -> None:
        try:
            self.stripe.PaymentIntent.cancel(self._intent_id(payment), idempotency_key=f"payment-{payment.pk}-void")
        except self.stripe.StripeError as exc:
            raise ProviderError(str(exc)) from exc

    def cancel_checkout(self, payment) -> None:
        try:
            self.stripe.checkout.Session.expire(payment.provider_reference)
        except self.stripe.StripeError:
            return None

    def refund(self, payment, amount: Decimal, idempotency_key: str) -> RefundResult:
        try:
            refund = self.stripe.Refund.create(
                payment_intent=self._intent_id(payment),
                amount=to_minor(amount, payment.currency),
                idempotency_key=f"refund-{payment.pk}-{idempotency_key}",
            )
        except self.stripe.StripeError as exc:
            return RefundResult("FAILED", "", str(exc))
        status = {"succeeded": "SUCCEEDED", "pending": "PENDING"}.get(refund.status, "FAILED")
        return RefundResult(status, refund.id)

    def parse_webhook(self, headers, body: bytes) -> ProviderEvent:
        signature = headers.get("Stripe-Signature") or headers.get("HTTP_STRIPE_SIGNATURE") or ""
        try:
            event = self.stripe.Webhook.construct_event(body, signature, settings.STRIPE_WEBHOOK_SECRET)
        except (ValueError, self.stripe.SignatureVerificationError) as exc:
            raise InvalidSignature(str(exc)) from exc
        obj = event["data"]["object"]
        meta = obj.get("metadata") or {}
        kind = {
            "payment_intent.amount_capturable_updated": "payment.authorized",
            "payment_intent.payment_failed": "payment.failed",
            "payment_intent.canceled": "payment.cancelled",
            "checkout.session.expired": "payment.cancelled",
            "charge.refunded": "refund.succeeded",
        }.get(event["type"], f"ignored.{event['type']}")
        amount = None
        if event["type"] == "payment_intent.amount_capturable_updated":
            amount = from_minor(obj.get("amount_capturable", 0), obj.get("currency", "usd"))
        return ProviderEvent(
            id=event["id"],
            type=kind,
            reference=obj.get("id", ""),
            payment_id=int(meta["payment_id"]) if meta.get("payment_id") else None,
            amount=amount,
            raw={"type": event["type"]},
        )
