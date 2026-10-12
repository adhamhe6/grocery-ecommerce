import logging

from celery import shared_task
from django.conf import settings
from django.core.mail import send_mail

logger = logging.getLogger(__name__)

LOG_ONLY_BACKENDS = {
    "django.core.mail.backends.console.EmailBackend",
    "django.core.mail.backends.locmem.EmailBackend",
    "django.core.mail.backends.dummy.EmailBackend",
    "django.core.mail.backends.filebased.EmailBackend",
}


@shared_task(bind=True, autoretry_for=(OSError,), retry_backoff=True, max_retries=3)
def send_notification_email(self, notification_id: int, recipient: str) -> str:
    """Idempotent: a notification is emailed at most once (channel is checked before sending)."""
    from .models import DeliveryChannel, Notification

    note = Notification.objects.filter(pk=notification_id).first()
    if note is None or note.channel not in (
        DeliveryChannel.IN_APP,
        DeliveryChannel.EMAIL_QUEUED,
        DeliveryChannel.EMAIL_FAILED,
    ):
        return "skipped"
    try:
        send_mail(note.title, note.body, settings.DEFAULT_FROM_EMAIL, [recipient], fail_silently=False)
    except Exception:
        Notification.objects.filter(pk=note.pk).update(channel=DeliveryChannel.EMAIL_FAILED)
        logger.exception("notification_email_failed", extra={"notification_id": notification_id})
        raise
    # Be honest about what actually happened: console/locmem backends do not deliver anything externally.
    channel = (
        DeliveryChannel.EMAIL_LOGGED if settings.EMAIL_BACKEND in LOG_ONLY_BACKENDS else DeliveryChannel.EMAIL_SENT
    )
    Notification.objects.filter(pk=note.pk).update(channel=channel)
    return channel
