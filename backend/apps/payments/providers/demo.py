"""Demonstration payment adapter — NOT a payment processor.

* Never moves money and says so everywhere it is shown.
* Refuses to run unless `PAYMENTS_ALLOW_DEMO` is explicitly true (it is on in dev/test, off by default in production).
* Its "hosted page" (the storefront's /pay/demo/<reference>) lets a tester choose succeed / fail / cancel. The backend
  then delivers a *signed* event through the very same webhook code path a real provider would use, so signature
  verification, replay tolerance, de-duplication and state transitions are exercised for real.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import time
import uuid
from decimal import Decimal

from django.conf import settings

from .base import CreateResult, InvalidSignature, PaymentProvider, ProviderError, ProviderEvent, RefundResult

SIGNATURE_HEADER = "X-Demo-Signature"
TOLERANCE_SECONDS = 300


def sign(body: bytes, secret: str | None = None, timestamp: int | None = None) -> str:
    secret = secret or settings.PAYMENT_WEBHOOK_SECRET
    ts = int(timestamp if timestamp is not None else time.time())
    digest = hmac.new(secret.encode(), f"{ts}.".encode() + body, hashlib.sha256).hexdigest()
    return f"t={ts},v1={digest}"


class DemoProvider(PaymentProvider):
    name = "demo"
    is_live = False

    def __init__(self):
        if not settings.PAYMENTS_ALLOW_DEMO:
            raise ProviderError("The demo payment adapter is disabled in this environment.")

    def create_payment(self, payment) -> CreateResult:
        reference = f"demo_pi_{uuid.uuid4().hex[:20]}"
        return CreateResult(reference, f"{settings.FRONTEND_URL}/pay/demo/{reference}")

    def capture(self, payment, amount: Decimal) -> None:
        if amount > payment.amount:
            raise ProviderError("Cannot capture more than was authorised.")

    def void(self, payment) -> None:
        return None

    def refund(self, payment, amount: Decimal, idempotency_key: str) -> RefundResult:
        # Deterministic fake id derived from the idempotency key: retries return the same refund, never a second one.
        rid = "demo_re_" + hashlib.sha256(f"{payment.pk}:{idempotency_key}".encode()).hexdigest()[:18]
        return RefundResult("SUCCEEDED", rid, "Simulated refund (demo mode: no money moved).")

    def parse_webhook(self, headers, body: bytes) -> ProviderEvent:
        header = headers.get(SIGNATURE_HEADER) or headers.get("HTTP_X_DEMO_SIGNATURE") or ""
        try:
            parts = dict(p.split("=", 1) for p in header.split(","))
            ts, given = int(parts["t"]), parts["v1"]
        except (KeyError, ValueError):
            raise InvalidSignature("malformed signature header") from None
        if abs(time.time() - ts) > TOLERANCE_SECONDS:
            raise InvalidSignature("timestamp outside tolerance")
        expected = hmac.new(
            settings.PAYMENT_WEBHOOK_SECRET.encode(), f"{ts}.".encode() + body, hashlib.sha256
        ).hexdigest()
        if not hmac.compare_digest(expected, given):
            raise InvalidSignature("signature mismatch")
        try:
            data = json.loads(body)
            amount = Decimal(str(data["amount"])) if data.get("amount") is not None else None
            return ProviderEvent(
                id=str(data["id"]),
                type=str(data["type"]),
                reference=str(data.get("reference", "")),
                payment_id=int(data["payment_id"]) if data.get("payment_id") else None,
                amount=amount,
                refund_id=str(data.get("refund_id", "")),
                raw=data,
            )
        except (KeyError, ValueError, TypeError, ArithmeticError):
            raise InvalidSignature("malformed event body") from None
