from datetime import timedelta

from celery import shared_task
from django.utils import timezone

from .models import IdempotencyRecord


@shared_task
def cleanup_idempotency_keys(days: int = 7) -> int:
    cutoff = timezone.now() - timedelta(days=days)
    deleted, _ = IdempotencyRecord.objects.filter(created_at__lt=cutoff).delete()
    return deleted
