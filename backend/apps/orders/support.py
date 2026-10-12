"""Customer complaints (support cases) — staff resolution lives in the admin API."""

from __future__ import annotations

from django.utils import timezone

from apps.core.exceptions import DomainError, ErrorCode
from apps.core.models import StoreSettings

from .models import OrderItem, OrderStatus, SupportCase

ELIGIBLE = {OrderStatus.OUT_FOR_DELIVERY, OrderStatus.READY_FOR_PICKUP, OrderStatus.COMPLETED}


def open_case(order, user, *, kind: str, description: str, order_item_id: int | None = None) -> SupportCase:
    if order.status not in ELIGIBLE:
        raise DomainError(
            ErrorCode.INVALID_STATE,
            "You can report a problem once your order is on its way or has been received.",
            status_code=409,
        )
    window = StoreSettings.load().complaint_window_hours
    if order.completed_at and (timezone.now() - order.completed_at).total_seconds() > window * 3600:
        raise DomainError(
            ErrorCode.INVALID_STATE,
            f"Problems with fresh groceries need to be reported within {window} hours of receiving the order. Please contact us if you need help.",
            status_code=409,
        )
    item = None
    if order_item_id:
        item = OrderItem.objects.filter(pk=order_item_id, order=order).first()  # the item must belong to this order
        if item is None:
            raise DomainError(ErrorCode.VALIDATION_ERROR, "That item isn't part of this order.")
    return SupportCase.objects.create(
        order=order, customer=user, order_item=item, kind=kind, description=description.strip()
    )
