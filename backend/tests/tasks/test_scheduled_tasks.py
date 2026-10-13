import datetime as dt
from decimal import Decimal

import pytest
from django.db import transaction
from django.utils import timezone

from apps.catalog.models import Product
from apps.catalog.tasks import refresh_popularity
from apps.inventory import services as inv
from apps.inventory.models import BatchStatus, StockLevel
from apps.inventory.tasks import expiry_and_low_stock_scan
from tests.shop import pay, payload, place

pytestmark = pytest.mark.django_db
D = Decimal


@pytest.fixture
def yoghurt(product_factory):
    return product_factory(sku="YOG", name="Natural yoghurt", price="1.80", tracks_batches=True)


def _receive(product, branch, qty, lot, days):
    with transaction.atomic():
        return inv.receive_stock(
            product, branch.id, D(qty), lot_code=lot, expiry_date=timezone.localdate() + dt.timedelta(days=days)
        )


def test_scan_flags_expired_batches_but_keeps_them_on_hand(yoghurt, branch):
    old = _receive(yoghurt, branch, "5", "OLD", -1)
    fresh = _receive(yoghurt, branch, "5", "NEW", 20)
    result = expiry_and_low_stock_scan()
    assert result["expired_batches"] == 1
    old.refresh_from_db()
    fresh.refresh_from_db()
    assert old.status == BatchStatus.EXPIRED
    assert old.qty_remaining == D("5")  # stays on hand until staff write it off as waste
    assert fresh.status == BatchStatus.ACTIVE
    assert StockLevel.objects.get(product=yoghurt, branch=branch).on_hand == D("10")


def test_scan_is_idempotent(yoghurt, branch):
    _receive(yoghurt, branch, "3", "OLD", -2)
    assert expiry_and_low_stock_scan()["expired_batches"] == 1
    assert expiry_and_low_stock_scan()["expired_batches"] == 0


def test_scan_counts_levels_at_or_below_their_threshold(milk, branch):
    StockLevel.objects.filter(product=milk, branch=branch).update(low_stock_threshold=D("100"))
    assert expiry_and_low_stock_scan()["low_stock_levels"] == 1
    StockLevel.objects.filter(product=milk, branch=branch).update(low_stock_threshold=D("0"))
    assert expiry_and_low_stock_scan()["low_stock_levels"] == 0  # a threshold of 0 means "not monitored"


def test_popularity_counts_only_orders_that_were_really_placed(shop_client, slot, milk):
    # Paid order of 4 units counts.
    resp = place(shop_client, payload(slot))
    assert resp.status_code == 201, resp.content
    assert pay(shop_client, resp.json()["number"]).status_code == 200
    refresh_popularity()
    milk.refresh_from_db()
    assert milk.popularity == 4


def test_popularity_ignores_unpaid_and_cancelled_orders(shop_client, slot, milk):
    resp = place(shop_client, payload(slot))  # PENDING_PAYMENT: not a sale yet
    assert resp.status_code == 201
    refresh_popularity()
    milk.refresh_from_db()
    assert milk.popularity == 0
    pay(shop_client, resp.json()["number"], outcome="cancel")
    refresh_popularity()
    milk.refresh_from_db()
    assert milk.popularity == 0


def test_popularity_drops_to_zero_for_products_not_sold_when_others_were(
    shop_client, slot, milk, product_factory, stock_up
):
    other = product_factory(sku="OTH", name="Other", price="1.00")
    stock_up(other, 5)
    Product.objects.filter(pk=other.pk).update(popularity=99)
    resp = place(shop_client, payload(slot))
    pay(shop_client, resp.json()["number"])
    refresh_popularity()
    other.refresh_from_db()
    milk.refresh_from_db()
    assert milk.popularity == 4
    assert other.popularity == 0  # measured, not remembered


def test_popularity_is_left_alone_when_there_are_no_sales_at_all(milk):
    Product.objects.filter(pk=milk.pk).update(popularity=42)
    assert refresh_popularity() == 0
    milk.refresh_from_db()
    assert milk.popularity == 42  # a fresh/demo store keeps its starting ranking
