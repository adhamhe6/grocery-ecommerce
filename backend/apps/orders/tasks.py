import logging

from celery import shared_task
from django.utils import timezone

logger = logging.getLogger(__name__)


@shared_task
def release_expired_reservations() -> int:
    """Release card orders whose payment window ended. Each order is handled in its own transaction and re-checked
    under lock, so overlapping runs (or a payment arriving at the same moment) are safe."""
    from .models import Order, OrderStatus
    from .workflow import expire_unpaid

    released = 0
    due = Order.objects.filter(
        status=OrderStatus.PENDING_PAYMENT, reservation_expires_at__lt=timezone.now()
    ).values_list("pk", flat=True)
    for pk in list(due):
        try:
            if expire_unpaid(Order(pk=pk)) is not None:
                released += 1
        except Exception:
            logger.exception("reservation_release_failed", extra={"order_id": pk})
    return released
