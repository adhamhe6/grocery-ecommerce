"""'Today' means the store's today — not the server's — for everything that depends on dates."""

import datetime as dt
import zoneinfo

import pytest
from django.utils import timezone

from apps.core.middleware import StoreTimezoneMiddleware, activate_store_tz, store_timezone
from apps.core.models import StoreSettings
from apps.inventory import services as inv

pytestmark = pytest.mark.django_db
NY = zoneinfo.ZoneInfo("America/New_York")
# 22:00 on 12 Oct in New York is already 02:00 on 13 Oct in UTC.
LATE_EVENING_NY = dt.datetime(2026, 10, 13, 2, 0, tzinfo=dt.UTC)


@pytest.fixture
def ny_store(settings):
    settings.TIME_ZONE = "UTC"
    StoreSettings.objects.update_or_create(pk=1, defaults={"timezone": "America/New_York"})
    yield


def test_store_timezone_falls_back_to_the_process_default_when_invalid(settings):
    StoreSettings.objects.update_or_create(pk=1, defaults={"timezone": "Not/AZone"})
    assert store_timezone() == timezone.get_default_timezone()


def test_middleware_activates_the_store_timezone_for_the_request(ny_store):
    seen = {}

    def view(request):
        seen["tz"] = timezone.get_current_timezone_name()
        return object()

    StoreTimezoneMiddleware(view)(object())
    assert seen["tz"] == "America/New_York"
    assert timezone.get_current_timezone_name() == "UTC"  # restored afterwards


def test_celery_hook_activates_the_store_timezone(ny_store):
    try:
        activate_store_tz()
        assert timezone.get_current_timezone_name() == "America/New_York"
    finally:
        timezone.deactivate()


def test_a_lot_selling_until_store_today_is_still_sellable_in_the_store_evening(
    ny_store, api, monkeypatch, product_factory, branch
):
    """Regression: with TIME_ZONE=UTC the server's 'today' flips at 20:00 New York time, hiding lots that are still
    sellable (sell-by = store today) for the rest of the evening."""
    from django.db import transaction

    product = product_factory(sku="YOG", name="Natural yoghurt", price="1.80", tracks_batches=True)
    with transaction.atomic():
        batch = inv.receive_stock(product, branch.id, 5, lot_code="L1", expiry_date=dt.date(2026, 10, 14))
    type(batch).objects.filter(pk=batch.pk).update(sellable_until=dt.date(2026, 10, 12))
    monkeypatch.setattr(timezone, "now", lambda: LATE_EVENING_NY)
    body = api.get(f"/api/v1/products/{product.slug}/", {"branch": branch.id}).json()
    assert body["availability"]["can_order"] is True
    # …and from the next store day it is no longer offered.
    monkeypatch.setattr(timezone, "now", lambda: LATE_EVENING_NY + dt.timedelta(hours=6))
    body = api.get(f"/api/v1/products/{product.slug}/", {"branch": branch.id}).json()
    assert body["availability"]["can_order"] is False
