"""Customer notifications: always recorded in-app; email is queued and its real delivery channel is stored honestly."""

from __future__ import annotations

import logging

from django.db import transaction

from apps.core.money import money

from .models import Notification
from .tasks import send_notification_email

logger = logging.getLogger(__name__)

TEMPLATES = {
    "ORDER_PLACED": (
        "We've received your order {number}",
        "Thanks for your order. We'll confirm it as soon as payment is complete.",
    ),
    "PAYMENT_CONFIRMED": (
        "Order {number} is confirmed",
        "Payment is confirmed. {slot_line}We'll start picking your groceries shortly.",
    ),
    "ORDER_CONFIRMED_COD": (
        "Order {number} is confirmed",
        "Your order is confirmed. You'll pay {total} on {fulfilment}. {slot_line}",
    ),
    "PAYMENT_FAILED": (
        "Payment for order {number} didn't go through",
        "Your payment wasn't completed, so your order isn't confirmed yet. You can try again or choose another method from your order page before your basket is released.",
    ),
    "PAYMENT_EXPIRED": (
        "Order {number} was released",
        "We didn't receive payment in time, so the items were released. Nothing was charged.",
    ),
    "SUBSTITUTION_REQUIRED": ("Order {number}: please choose about a substitution", "{detail}"),
    "SUBSTITUTION_DECIDED": ("Order {number}: substitution update", "{detail}"),
    "ITEM_REMOVED": ("Order {number}: an item is unavailable", "{detail}"),
    "PICKING_STARTED": ("We're picking order {number}", "Our team has started picking your groceries."),
    "ORDER_READY_PICKUP": (
        "Order {number} is ready for pickup",
        "Your order is packed and ready at {branch}. Final total: {total}.",
    ),
    "ORDER_READY_DISPATCH": (
        "Order {number} is packed",
        "Your order is packed and will be on its way in your chosen window. Final total: {total}.",
    ),
    "OUT_FOR_DELIVERY": ("Order {number} is out for delivery", "Your order has left the store. {slot_line}"),
    "ORDER_COMPLETED": (
        "Order {number} is complete",
        "Thanks for shopping with us. Final total: {total}. Something not right? Report a problem from your order page.",
    ),
    "ORDER_CANCELLED": ("Order {number} was cancelled", "{detail}"),
    "REFUND_UPDATED": ("Refund update for order {number}", "{detail}"),
    "SLOT_CHANGED": ("Order {number}: your time slot changed", "{detail}"),
}


def _context(order, extra: dict) -> dict:
    slot_line = ""
    if order.slot_starts_at:
        slot_line = f"Your {'delivery' if order.fulfilment_type == 'DELIVERY' else 'pickup'} window starts {order.slot_starts_at:%a %d %b, %H:%M}. "
    return {
        "number": order.number,
        "total": money(order.final_total if order.final_total is not None else order.total),
        "slot_line": slot_line,
        "branch": order.branch.name,
        "detail": "",
        "fulfilment": "delivery" if order.fulfilment_type == "DELIVERY" else "pickup",
        **extra,
    }


def notify_order(order, kind: str, **extra) -> Notification | None:
    title, body = TEMPLATES[kind]
    ctx = _context(order, extra)
    note = Notification.objects.create(
        user=order.customer,
        email="" if order.customer_id else order.contact_email,
        kind=kind,
        order=order,
        title=title.format(**ctx),
        body=body.format(**ctx).strip(),
    )
    wants_email = order.customer.notify_order_emails if order.customer_id else True
    if wants_email:
        transaction.on_commit(lambda: send_notification_email.delay(note.pk, order.contact_email))
    return note
