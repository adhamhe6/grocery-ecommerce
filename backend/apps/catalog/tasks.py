import datetime as dt
import logging

from celery import shared_task
from django.db.models import DecimalField, OuterRef, Subquery, Sum, Value
from django.db.models.functions import Coalesce
from django.utils import timezone

logger = logging.getLogger(__name__)

POPULARITY_WINDOW_DAYS = 30


@shared_task
def refresh_popularity() -> int:
    """Recompute Product.popularity = whole units ordered in the last 30 days on orders that were actually confirmed
    (cancelled, failed and never-paid orders don't count). Measured from order lines, never invented."""
    from apps.orders.models import OrderItem, OrderStatus

    from .models import Product

    since = timezone.now() - dt.timedelta(days=POPULARITY_WINDOW_DAYS)
    counted = OrderItem.objects.filter(
        product=OuterRef("pk"), order__placed_at__gte=since, substitute_for__isnull=True
    ).exclude(order__status__in=[OrderStatus.CANCELLED, OrderStatus.PAYMENT_FAILED, OrderStatus.PENDING_PAYMENT])
    sold = (
        counted.order_by().values("product").annotate(total=Sum("ordered_qty")).values("total")
    )
    updated = Product.objects.update(
        popularity=Coalesce(Subquery(sold, output_field=DecimalField()), Value(0), output_field=DecimalField())
    )
    logger.info("popularity_refreshed", extra={"products": updated})
    return updated
