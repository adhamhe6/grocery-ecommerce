import logging

from celery import shared_task
from django.db.models import F

logger = logging.getLogger(__name__)


@shared_task
def expiry_and_low_stock_scan() -> dict:
    """Hourly housekeeping. Expired batches are flagged (they stay on hand until staff write them off as waste, which
    keeps the ledger honest) and the number of at-or-below-threshold levels is logged for operations monitoring."""
    from .models import StockLevel
    from .services import expire_batches

    expired = expire_batches()
    low = StockLevel.objects.filter(low_stock_threshold__gt=0, on_hand__lte=F("low_stock_threshold")).count()
    logger.info("inventory_scan", extra={"batches_flagged_expired": expired, "levels_at_or_below_threshold": low})
    return {"expired_batches": expired, "low_stock_levels": low}
