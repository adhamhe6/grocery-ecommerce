import datetime as dt
import json
import uuid
from decimal import Decimal

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.payments.providers.demo import sign
from apps.stores.models import DeliverySlot

D = Decimal
PASSWORD = "Orchard-Row-9!x"
ADDRESS = {
    "recipient_name": "Sam Shopper",
    "phone": "+1 555 0101",
    "line1": "12 Elm Street",
    "city": "Riverton",
    "postal_code": "RW1 4AB",
}


@pytest.fixture
def make_slot(branch, zone):
    def _make(kind="DELIVERY", *, days=2, hour=10, capacity=5, fee="4.00", branch_obj=None, zone_obj="default"):
        b = branch_obj or branch
        z = zone if zone_obj == "default" else zone_obj
        day = (timezone.now() + dt.timedelta(days=days)).date()
        return DeliverySlot.objects.create(
            branch=b,
            zone=z if kind == "DELIVERY" else None,
            kind=kind,
            date=day,
            start_time=dt.time(hour, 0),
            end_time=dt.time(hour + 2, 0),
            capacity=capacity,
            fee=D(fee),
        )

    return _make


@pytest.fixture
def slot(make_slot):
    return make_slot()


@pytest.fixture
def pickup_slot(make_slot):
    return make_slot("PICKUP", fee="0.00", hour=14)


@pytest.fixture
def milk(product_factory, stock_up):
    p = product_factory(sku="MILK", name="Whole milk 2L", price="2.50", qty_max=D("12"))
    stock_up(p, 30)
    return p


@pytest.fixture
def cheese(product_factory, stock_up):
    p = product_factory(
        sku="CHS",
        name="Mature cheddar",
        unit="kg",
        price="12.00",
        qty_min=D("0.25"),
        qty_step=D("0.25"),
        qty_max=D("3"),
        is_variable_weight=True,
    )
    stock_up(p, 10)
    return p


@pytest.fixture
def shop_client(milk):
    """A guest client with 4 x milk (10.00) in the basket."""
    c = APIClient()
    c.post("/api/v1/cart/items/", {"product_id": milk.id, "quantity": "4"})
    return c


def payload(slot, **kw):
    base = {
        "fulfilment_type": "DELIVERY",
        "slot_id": slot.id,
        "payment_method": "CARD",
        "address": ADDRESS,
        "contact": {"name": "Sam Shopper", "email": "sam@example.com", "phone": "+1 555 0101"},
    }
    base.update(kw)
    return base


def place(client, data, key=None):
    return client.post("/api/v1/checkout/", data, format="json", HTTP_IDEMPOTENCY_KEY=key or uuid.uuid4().hex)


def deliver(client, event, *, secret=None, ts=None, signature=None, provider="demo"):
    body = json.dumps(event, separators=(",", ":"), sort_keys=True).encode()
    sig = signature or sign(body, secret=secret, timestamp=ts)
    return client.generic(
        "POST",
        f"/api/v1/payments/webhook/{provider}/",
        data=body,
        content_type="application/json",
        HTTP_X_DEMO_SIGNATURE=sig,
    )


def event_for(payment, kind="payment.authorized", *, event_id=None, amount="same", **extra):
    return {
        "id": event_id or f"evt_{uuid.uuid4().hex}",
        "type": kind,
        "reference": payment.provider_reference,
        "payment_id": payment.pk,
        "amount": str(payment.amount) if amount == "same" else amount,
        **extra,
    }


def pay(client, order_number, outcome="succeed"):
    from apps.payments.models import Payment

    p = (
        Payment.objects.filter(order__number=order_number)
        .exclude(provider_reference="")
        .order_by("-created_at")
        .first()
    )
    return client.post(f"/api/v1/payments/demo/{p.provider_reference}/", {"outcome": outcome})


def run_to_completion(order, picker, picks=None, *, collected=None):
    """Drive an order through pick → pack → handover with the real fulfilment services. `picks` = {item_id: qty}."""
    from apps.orders import fulfilment as ful

    ful.start_picking(order, picker)
    for item in order.items.filter(substitute_for__isnull=True):
        ful.pick_item(item.id, (picks or {}).get(item.id, item.ordered_qty), picker)
    ful.finish_picking(order, picker)
    ful.finish_packing(order, picker)
    order.refresh_from_db()
    if order.fulfilment_type == "DELIVERY":
        ful.dispatch(order, picker)
    order.refresh_from_db()
    due = order.final_total if order.payment_method == "COD" else None
    return ful.complete(order, picker, collected_amount=collected if collected is not None else due)
