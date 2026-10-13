"""What happens when Redis or the Celery broker is unavailable: shopping and ordering must keep working."""

import pytest
from django.core.cache import caches

from tests.shop import ADDRESS, payload, place

pytestmark = pytest.mark.django_db

DEAD_REDIS = {
    "default": {
        "BACKEND": "django_redis.cache.RedisCache",
        "LOCATION": "redis://127.0.0.1:1/0",  # nothing listens here
        "OPTIONS": {
            "CLIENT_CLASS": "django_redis.client.DefaultClient",
            "IGNORE_EXCEPTIONS": True,
            "SOCKET_CONNECT_TIMEOUT": 0.2,
            "SOCKET_TIMEOUT": 0.2,
        },
    }
}


@pytest.fixture
def redis_down(settings):
    settings.CACHES = DEAD_REDIS
    settings.DJANGO_REDIS_IGNORE_EXCEPTIONS = True
    caches["default"]  # force the handler to rebuild with the new settings
    yield
    caches["default"].close() if hasattr(caches["default"], "close") else None


def test_browsing_works_without_redis(api, milk, redis_down):
    assert api.get("/api/v1/products/").status_code == 200
    assert api.get("/api/v1/home/").status_code == 200
    assert api.get("/api/v1/categories/").status_code == 200
    assert api.get("/api/v1/store/").status_code == 200


def test_readiness_reports_degraded_not_down_without_redis(api, redis_down):
    body = api.get("/readyz").json()
    assert body["checks"]["database"] == "ok"
    assert body["checks"]["cache"] == "degraded"
    assert body["status"] == "degraded"
    assert api.get("/readyz").status_code == 200  # still ready to serve: the database is the only hard dependency
    assert api.get("/healthz").status_code == 200


def test_cart_and_card_checkout_work_without_redis(shop_client, slot, milk, redis_down):
    cart = shop_client.get("/api/v1/cart/").json()
    assert cart["item_count"] == 1
    resp = place(shop_client, payload(slot))
    assert resp.status_code == 201, resp.content
    assert resp.json()["status"] == "PENDING_PAYMENT"


def test_sign_in_works_without_redis(api, user, redis_down):
    resp = api.post("/api/v1/auth/login/", {"email": user.email, "password": "Orchard-Row-9!x"}, format="json")
    assert resp.status_code == 200


@pytest.mark.django_db(transaction=True, serialized_rollback=True)  # on_commit callbacks only run for real commits
def test_order_is_still_placed_when_the_task_broker_is_down(shop_client, slot, milk, monkeypatch):
    """The confirmation email is queued after the order commits; a dead broker must not turn a placed order into a 500."""
    from apps.notifications import tasks

    def broker_down(*args, **kwargs):
        raise ConnectionError("broker unavailable")

    monkeypatch.setattr(tasks.send_notification_email, "delay", broker_down)
    resp = place(shop_client, payload(slot, payment_method="COD"))
    assert resp.status_code == 201, resp.content
    assert resp.json()["status"] == "CONFIRMED"
    from apps.orders.models import Order

    assert Order.objects.filter(number=resp.json()["number"]).exists()


@pytest.mark.django_db(transaction=True, serialized_rollback=True)
def test_idempotent_replay_after_a_broker_failure_returns_the_same_order(shop_client, slot, milk, monkeypatch):
    from apps.notifications import tasks
    from apps.orders.models import Order

    monkeypatch.setattr(
        tasks.send_notification_email, "delay", lambda *a, **k: (_ for _ in ()).throw(ConnectionError("down"))
    )
    first = place(shop_client, payload(slot, payment_method="COD"), key="resilience-key-0001")
    second = place(shop_client, payload(slot, payment_method="COD"), key="resilience-key-0001")
    assert first.status_code == 201 and second.status_code == 200
    assert first.json()["number"] == second.json()["number"]
    assert Order.objects.count() == 1


@pytest.mark.django_db(transaction=True, serialized_rollback=True)
def test_email_lost_to_a_broker_outage_is_recorded_as_queued_and_later_requeued(
    shop_client, slot, milk, monkeypatch, settings
):
    import datetime as dt

    from django.utils import timezone

    from apps.notifications import tasks
    from apps.notifications.models import DeliveryChannel, Notification

    monkeypatch.setattr(
        tasks.send_notification_email, "delay", lambda *a, **k: (_ for _ in ()).throw(ConnectionError("down"))
    )
    resp = place(shop_client, payload(slot, payment_method="COD"))
    assert resp.status_code == 201
    note = Notification.objects.get(order__number=resp.json()["number"])
    assert note.channel == DeliveryChannel.EMAIL_QUEUED  # honest: nothing has been sent yet

    # Too fresh to be considered lost…
    assert tasks.requeue_stalled_emails() == 0
    # …but once it has been queued for longer than the grace period, the sweeper picks it up when the broker is back.
    Notification.objects.filter(pk=note.pk).update(created_at=timezone.now() - dt.timedelta(minutes=30))
    monkeypatch.undo()
    assert tasks.requeue_stalled_emails() == 1  # CELERY_TASK_ALWAYS_EAGER in tests: runs the send inline
    note.refresh_from_db()
    assert note.channel == DeliveryChannel.EMAIL_LOGGED or note.channel == DeliveryChannel.EMAIL_SENT


def test_password_reset_answers_identically_when_the_broker_is_down(api, user, monkeypatch):
    from apps.accounts import views

    monkeypatch.setattr(
        views.send_password_reset_email, "delay", lambda *a, **k: (_ for _ in ()).throw(ConnectionError("down"))
    )
    real = api.post("/api/v1/auth/password-reset/", {"email": user.email}, format="json")
    ghost = api.post("/api/v1/auth/password-reset/", {"email": "nobody@example.com"}, format="json")
    assert real.status_code == ghost.status_code == 202
    assert real.json() == ghost.json()


def test_customer_who_opted_out_of_email_gets_an_in_app_notice_only(user, milk, slot):
    from rest_framework.test import APIClient

    from apps.notifications.models import DeliveryChannel, Notification

    user.notify_order_emails = False
    user.save(update_fields=["notify_order_emails"])
    client = APIClient()
    client.force_authenticate(user)
    assert (
        client.post("/api/v1/cart/items/", {"product_id": milk.id, "quantity": "2"}, format="json").status_code == 201
    )
    resp = place(
        client, {"fulfilment_type": "DELIVERY", "slot_id": slot.id, "payment_method": "COD", "address": ADDRESS}
    )
    assert resp.status_code == 201, resp.content
    assert Notification.objects.get(order__number=resp.json()["number"]).channel == DeliveryChannel.IN_APP
