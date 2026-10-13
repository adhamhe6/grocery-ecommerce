"""`supplier_performance.on_time_rate` compares the receipt's date with the PO's calendar `expected_date`: both must be
dates in the store's timezone, not the UTC date of the receipt timestamp."""

import datetime as dt

import pytest

from apps.core.models import StoreSettings
from apps.purchasing import services as po_svc
from apps.purchasing.models import GoodsReceipt, Supplier
from tests.conftest import make_user
from tests.purchasing.test_purchasing import line_row, make_po

pytestmark = pytest.mark.django_db


@pytest.fixture
def supplier():
    return Supplier.objects.create(code="dairy-co", name="Millbrook Dairy", lead_time_days=2)


@pytest.fixture
def rice(product_factory):
    return product_factory(sku="RICE", name="Basmati rice 1kg", price="3.10")


def receipt_at(supplier, branch, rice, expected: dt.date, arrived: dt.datetime, key="rcpt-tz-00001"):
    buyer = make_user(email=f"buyer-{key}@example.com", role="PURCHASING_MANAGER")
    po = make_po(supplier, branch, buyer, [{"product_id": rice.id, "qty_ordered": 5, "unit_cost": "1.9"}])
    po.expected_date = expected
    po.save(update_fields=["expected_date"])
    receipt, _ = po_svc.receive_goods(po, [line_row(po, rice, 5)], idempotency_key=key, actor=buyer)
    GoodsReceipt.objects.filter(pk=receipt.pk).update(created_at=arrived)
    return po


def set_store_tz(name):
    StoreSettings.objects.update_or_create(pk=1, defaults={"timezone": name})


def test_an_evening_delivery_west_of_utc_on_the_due_day_is_on_time(supplier, branch, rice):
    set_store_tz("America/New_York")
    # 22:00 on 12 Oct in New York is 02:00 on 13 Oct UTC: the UTC date is a day late, the store's date is not.
    receipt_at(supplier, branch, rice, dt.date(2026, 10, 12), dt.datetime(2026, 10, 13, 2, 0, tzinfo=dt.UTC))
    assert po_svc.supplier_performance(supplier)["on_time_rate"] == "100.0"


def test_a_morning_delivery_east_of_utc_the_day_after_is_late(supplier, branch, rice):
    set_store_tz("Pacific/Auckland")
    # 09:00 on 12 Oct in Auckland (UTC+13) is 20:00 on 11 Oct UTC: the UTC date looks on time, the store's date is a day late.
    receipt_at(supplier, branch, rice, dt.date(2026, 10, 11), dt.datetime(2026, 10, 11, 20, 0, tzinfo=dt.UTC))
    assert po_svc.supplier_performance(supplier)["on_time_rate"] == "0.0"


def test_utc_store_is_unchanged(supplier, branch, rice):
    set_store_tz("UTC")
    receipt_at(supplier, branch, rice, dt.date(2026, 10, 12), dt.datetime(2026, 10, 12, 23, 59, tzinfo=dt.UTC))
    receipt_at(
        supplier,
        branch,
        rice,
        dt.date(2026, 10, 12),
        dt.datetime(2026, 10, 13, 0, 1, tzinfo=dt.UTC),
        key="rcpt-tz-00002",
    )
    assert po_svc.supplier_performance(supplier)["on_time_rate"] == "50.0"


def test_the_result_does_not_depend_on_the_active_timezone_of_the_caller(supplier, branch, rice):
    """A Celery task, a shell and a request may each have a different active timezone; the store's is what counts."""
    from django.utils import timezone

    set_store_tz("America/New_York")
    receipt_at(supplier, branch, rice, dt.date(2026, 10, 12), dt.datetime(2026, 10, 13, 2, 0, tzinfo=dt.UTC))
    with timezone.override("Pacific/Kiritimati"):  # UTC+14
        assert po_svc.supplier_performance(supplier)["on_time_rate"] == "100.0"
