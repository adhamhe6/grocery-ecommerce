from django.conf import settings

from .base import InvalidSignature, PaymentProvider, ProviderError, ProviderEvent  # noqa: F401


def get_provider(name: str | None = None) -> PaymentProvider:
    """Instantiate the configured provider. `unconfigured` (production without credentials) fails closed."""
    name = name or settings.PAYMENT_PROVIDER
    if name == "demo":
        from .demo import DemoProvider

        return DemoProvider()
    if name == "stripe":
        from .stripe_provider import StripeProvider

        return StripeProvider()
    raise ProviderError("No payment provider is configured.")
