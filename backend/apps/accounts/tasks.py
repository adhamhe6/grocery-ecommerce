from celery import shared_task
from django.conf import settings
from django.core.mail import send_mail

from apps.core.models import StoreSettings


@shared_task(bind=True, autoretry_for=(OSError,), retry_backoff=True, max_retries=3)
def send_password_reset_email(self, email: str, uid: str, token: str) -> None:
    store = StoreSettings.load()
    link = f"{settings.FRONTEND_URL}/account/reset-password?uid={uid}&token={token}"
    send_mail(
        subject=f"Reset your {store.name} password",
        message=(
            f"We received a request to reset your {store.name} password.\n\n"
            f"Choose a new password: {link}\n\n"
            "This link expires in 2 hours. If you didn't ask for this, you can ignore this email — your password won't change."
        ),
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[email],
    )
