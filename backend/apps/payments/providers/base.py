"""Payment provider contract. Providers never touch the database — services own all state changes."""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal


class ProviderError(Exception):
    """The provider could not be reached or refused the request (safe to show a generic message)."""


class InvalidSignature(Exception):
    """Webhook signature missing, malformed, stale or wrong."""


@dataclass
class CreateResult:
    reference: str
    checkout_url: str


@dataclass
class RefundResult:
    status: str  # SUCCEEDED | PENDING | FAILED
    refund_id: str = ""
    message: str = ""


@dataclass
class ProviderEvent:
    id: str
    type: str  # payment.authorized | payment.failed | payment.cancelled | refund.succeeded | refund.failed
    reference: str = ""
    payment_id: int | None = None
    amount: Decimal | None = None
    refund_id: str = ""
    raw: dict = field(default_factory=dict)


class PaymentProvider:
    name = "base"
    is_live = False  # True only for providers that move real money

    def create_payment(self, payment) -> CreateResult:
        raise NotImplementedError

    def capture(self, payment, amount: Decimal) -> None:
        """Capture `amount` (<= authorised) from an authorised payment. Raise ProviderError on failure."""
        raise NotImplementedError

    def void(self, payment) -> None:
        """Release an uncaptured authorisation."""
        raise NotImplementedError

    def cancel_checkout(self, payment) -> None:  # optional
        return None

    def refund(self, payment, amount: Decimal, idempotency_key: str) -> RefundResult:
        raise NotImplementedError

    def parse_webhook(self, headers, body: bytes) -> ProviderEvent:
        """Verify the signature and translate the body. Raise InvalidSignature if it cannot be trusted."""
        raise NotImplementedError
