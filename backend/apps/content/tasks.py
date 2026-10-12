from urllib.parse import quote

from celery import shared_task
from django.conf import settings
from django.core.mail import send_mail

from apps.core.models import StoreSettings


@shared_task(bind=True, autoretry_for=(OSError,), retry_backoff=True, max_retries=3)
def send_newsletter_confirmation(self, email: str, token: str) -> None:
    """Double opt-in: nobody is on the mailing list until they click the link in this email. Idempotent."""
    store = StoreSettings.load()
    link = f"{settings.FRONTEND_URL}/newsletter/confirm?token={quote(token)}"
    send_mail(
        subject=f"Please confirm your {store.name} newsletter subscription",
        message=(
            f"Someone (hopefully you) asked to receive the {store.name} newsletter at this address.\n\n"
            f"Confirm your subscription: {link}\n\n"
            "If you didn't ask for this, ignore this email — you won't be subscribed and we won't write again."
        ),
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[email],
    )
