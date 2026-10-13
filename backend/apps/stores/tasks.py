from celery import shared_task

from .models import Branch
from .services import generate_slots


@shared_task
def generate_delivery_slots(days_ahead: int = 7) -> int:
    total = 0
    for branch in Branch.objects.filter(is_active=True):
        total += generate_slots(branch, days_ahead=days_ahead)
    return total
