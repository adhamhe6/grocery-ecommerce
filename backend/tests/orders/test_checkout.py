import datetime as dt
import threading
from decimal import Decimal

import pytest
from django.db import close_old_connections, connection
from django.utils import timezone
from rest_framework.test import APIClient

from apps.cart.models import Cart
from apps.inventory import services as inv
from apps.inventory.models import Allocation, StockLevel
from apps.orders import workflow
from apps.orders.models import Order, OrderItem, OrderStatus
from apps.payments.models import Payment, PaymentEvent
from apps.promotions.models import Coupon, CouponRedemption
from apps.stores.models import DeliverySlot
from tests.shop import ADDRESS, PASSWORD, deliver, event_for, pay, payload, place

pytestmark = pytest.mark.django_db
D = Decimal


def err(res):
    return res.json()["error"]


def level(product):
    return StockLevel.objects.get(product=product)


class TestHappyPath:
    def test_card_checkout_reserves_stock_books_slot_and_waits_for_verified_payment(self, shop_client, slot, milk):
        quote = shop_client.post("/api/v1/checkout/quote/", payload(slot), format="json").json()
        assert (
            quote["subtotal"] == "10.00"
            and quote["delivery_fee"] == "4.00"
            and quote["total"] == "14.00"
            and quote["max_charge"] == "14.00"
        )
        res = place(shop_client, payload(slot, expected_total=quote["total"]))
        assert res.status_code == 201, res.content
        data = res.json()
        assert data["status"] == "PENDING_PAYMENT" and data["payment_status"] == "UNPAID"
        assert (
            data["totals"]["total"] == "14.00"
            and data["payment"]["mode"] == "demo"
            and data["payment"]["state"] == "REQUIRES_ACTION"
        )
        assert data["payment"]["checkout_url"].endswith("/pay/demo/" + Payment.objects.get().provider_reference)
        assert data["tracking_token"]
        # stock is reserved, not yet sold; slot has one fewer place; basket is gone
        lv = level(milk)
        assert (lv.on_hand, lv.reserved) == (30, 4)
        slot.refresh_from_db()
        assert slot.booked == 1
        assert Cart.objects.get().status == "CONVERTED" and shop_client.get("/api/v1/cart/").json()["lines"] == []
        order = Order.objects.get()
        assert order.reservation_expires_at is not None and order.slot_id == slot.id
        item = OrderItem.objects.get()
        assert (item.name, item.ordered_qty, item.unit_price, item.line_total_estimated) == (
            "Whole milk 2L",
            4,
            D("2.50"),
            D("10.00"),
        )
        assert inv.check_invariants() == []

    def test_redirect_alone_never_confirms_the_order(self, shop_client, slot):
        number = place(shop_client, payload(slot)).json()["number"]
        # The customer "returns" from the payment page (GET order) without a provider event → still unpaid.
        again = shop_client.get(f"/api/v1/orders/{number}/?token={Order.objects.get().tracking_token}").json()
        assert again["status"] == "PENDING_PAYMENT" and again["payment_status"] == "UNPAID"

    def test_verified_webhook_confirms_exactly_once(self, shop_client, slot, milk):
        number = place(shop_client, payload(slot)).json()["number"]
        res = pay(shop_client, number, "succeed")
        assert res.status_code == 200 and res.json()["result"] == "applied"
        order = Order.objects.get()
        payment = Payment.objects.get()
        assert (order.status, order.payment_status, payment.state) == ("CONFIRMED", "AUTHORIZED", "AUTHORIZED")
        assert order.reservation_expires_at is None and order.confirmed_at is not None
        assert order.history.filter(to_status="CONFIRMED").count() == 1
        # replaying the very same event id is a no-op
        ev = PaymentEvent.objects.get()
        replay = deliver(
            APIClient(),
            {
                "id": ev.event_id,
                "type": "payment.authorized",
                "reference": payment.provider_reference,
                "payment_id": payment.pk,
                "amount": str(payment.amount),
            },
        )
        assert replay.status_code == 200 and replay.json()["status"] == "duplicate"
        # a *different* event id for the same already-authorised payment is ignored too
        again = deliver(APIClient(), event_for(payment))
        assert again.json()["status"] == "ignored"
        assert (
            Order.objects.get().history.filter(to_status="CONFIRMED").count() == 1 and PaymentEvent.objects.count() == 2
        )
        assert level(milk).reserved == 4  # side effects happened once

    def test_cash_on_delivery_confirms_immediately_with_pending_collection(self, shop_client, slot):
        data = place(shop_client, payload(slot, payment_method="COD")).json()
        assert (
            data["status"] == "CONFIRMED"
            and data["payment_status"] == "PENDING_COLLECTION"
            and data["payment"]["mode"] == "cod"
        )
        assert Payment.objects.get().state == "PENDING_COLLECTION"

    def test_pickup_order_has_no_address_or_delivery_fee(self, shop_client, pickup_slot, branch):
        data = place(
            shop_client,
            {
                "fulfilment_type": "PICKUP",
                "branch_id": branch.id,
                "slot_id": pickup_slot.id,
                "payment_method": "COD",
                "contact": {"name": "Pat", "email": "pat@example.com", "phone": "555-0100"},
            },
        ).json()
        assert (
            data["status"] == "CONFIRMED"
            and data["address"] is None
            and data["totals"]["delivery_fee"] == "0.00"
            and data["totals"]["total"] == "10.00"
        )

    def test_signed_in_customer_uses_saved_address_and_profile_contact(self, user, milk, slot):
        c = APIClient()
        c.force_authenticate(user)
        addr = c.post("/api/v1/addresses/", ADDRESS).json()
        c.post("/api/v1/cart/items/", {"product_id": milk.id, "quantity": "2"})
        data = place(
            c, {"fulfilment_type": "DELIVERY", "slot_id": slot.id, "address_id": addr["id"], "payment_method": "COD"}
        ).json()
        assert data["contact"]["email"] == user.email and data["address"]["line1"] == "12 Elm Street"
        assert Order.objects.get().customer == user
        assert c.get("/api/v1/orders/").json()["results"][0]["number"] == data["number"]


class TestIdempotency:
    def test_same_key_returns_same_order_without_side_effects(self, shop_client, slot, milk):
        body = payload(slot)
        first = place(shop_client, body, key="key-123456789")
        second = place(shop_client, body, key="key-123456789")
        assert first.status_code == 201 and second.status_code == 200
        assert first.json()["number"] == second.json()["number"] and second.json()["replayed"] is True
        assert Order.objects.count() == 1 and Payment.objects.count() == 1 and level(milk).reserved == 4
        slot.refresh_from_db()
        assert slot.booked == 1

    def test_same_key_with_different_details_is_rejected(self, shop_client, slot):
        place(shop_client, payload(slot), key="key-abcdefgh")
        res = place(shop_client, payload(slot, customer_note="changed"), key="key-abcdefgh")
        assert res.status_code == 422 and err(res)["code"] == "IDEMPOTENCY_CONFLICT"
        assert Order.objects.count() == 1

    def test_idempotency_key_is_required(self, shop_client, slot):
        res = shop_client.post("/api/v1/checkout/", payload(slot), format="json")
        assert res.status_code == 400 and err(res)["code"] == "IDEMPOTENCY_KEY_REQUIRED"

    def test_failed_attempt_does_not_burn_the_key(self, shop_client, slot, milk):
        StockLevel.objects.filter(product=milk).update(on_hand=D("1"))
        assert place(shop_client, payload(slot), key="retry-key-0001").status_code == 409
        StockLevel.objects.filter(product=milk).update(on_hand=D("30"))
        assert place(shop_client, payload(slot), key="retry-key-0001").status_code == 201


class TestServerIsAuthoritative:
    def test_client_supplied_prices_are_ignored(self, shop_client, slot):
        body = payload(
            slot,
            total="0.01",
            subtotal="0.01",
            delivery_fee="0",
            unit_price="0.01",
            items=[{"product_id": 1, "price": "0.01"}],
        )
        data = place(shop_client, body).json()
        assert data["totals"]["total"] == "14.00" and data["items"][0]["unit_price"] == "2.50"

    def test_stale_expected_total_returns_409_with_fresh_quote(self, shop_client, slot, milk):
        milk.price = D("3.00")
        milk.save()
        res = place(shop_client, payload(slot, expected_total="14.00"))
        body = err(res)
        assert res.status_code == 409 and body["code"] == "CART_CHANGED"
        assert body["details"]["current_total"] == "16.00" and body["details"]["quote"]["subtotal"] == "12.00"
        assert Order.objects.count() == 0 and level(milk).reserved == 0

    def test_coupon_must_still_be_valid_at_checkout(self, shop_client, slot):
        c = Coupon.objects.create(code="OFF5", kind="FIXED", value=D("5"))
        assert shop_client.post("/api/v1/cart/coupon/", {"code": "OFF5"}).status_code == 200
        c.ends_at = timezone.now() - dt.timedelta(minutes=1)
        c.save()
        res = place(shop_client, payload(slot))
        assert res.status_code == 400 and err(res)["code"] == "INVALID_COUPON"
        assert Order.objects.count() == 0

    def test_coupon_discount_and_redemption_are_stored_on_the_order(self, shop_client, slot):
        Coupon.objects.create(code="TEN", kind="PERCENT", value=D("10"))
        shop_client.post("/api/v1/cart/coupon/", {"code": "TEN"})
        data = place(shop_client, payload(slot)).json()
        assert (
            data["totals"]["coupon_code"] == "TEN"
            and data["totals"]["coupon_discount"] == "1.00"
            and data["totals"]["total"] == "13.00"
        )
        coupon = Coupon.objects.get(code="TEN")
        assert coupon.used_count == 1 and CouponRedemption.objects.get().amount == D("1.00")
        coupon.value = D("50")  # later edits to the coupon must not change history
        coupon.save()
        assert Order.objects.get().coupon_discount == D("1.00")

    def test_free_delivery_threshold_applies(self, shop_client, slot, milk, zone):
        zone.free_delivery_threshold = D("10.00")
        zone.save()
        assert (
            shop_client.post("/api/v1/checkout/quote/", payload(slot), format="json").json()["delivery_fee"] == "0.00"
        )

    def test_minimum_order_is_enforced_with_a_helpful_message(self, shop_client, slot, zone):
        zone.min_order_value = D("20.00")
        zone.save()
        res = place(shop_client, payload(slot))
        assert (
            res.status_code == 409
            and err(res)["code"] == "MIN_ORDER_NOT_MET"
            and err(res)["details"]["shortfall"] == "10.00"
        )

    def test_weighed_items_show_estimate_and_max_charge(self, milk, cheese, slot):
        c = APIClient()
        c.post("/api/v1/cart/items/", {"product_id": cheese.id, "quantity": "1.5"})  # 18.00 estimated
        q = c.post("/api/v1/checkout/quote/", payload(slot), format="json").json()
        assert q["has_weighed_items"] is True and q["subtotal"] == "18.00" and q["total"] == "22.00"
        assert q["weight_buffer"] == "1.80" and q["max_charge"] == "23.80"  # 10% of 18.00 on top of the 22.00 estimate


class TestValidation:
    def test_unserviceable_address(self, shop_client, slot):
        res = place(shop_client, payload(slot, address={**ADDRESS, "postal_code": "ZZ9 9ZZ"}))
        assert res.status_code == 400 and err(res)["code"] == "ADDRESS_NOT_SERVICEABLE"

    def test_coverage_by_area_name_works_too(self, shop_client, slot):
        res = place(shop_client, payload(slot, address={**ADDRESS, "postal_code": "", "area": "Old Town"}))
        assert res.status_code == 201

    def test_address_must_belong_to_the_customer(self, user, other_user, milk, slot):
        from apps.accounts.models import Address

        foreign = Address.objects.create(
            user=other_user,
            recipient_name="X",
            phone="12345678",
            line1="9 Secret Rd",
            city="Riverton",
            postal_code="RW1 1AA",
        )
        c = APIClient()
        c.force_authenticate(user)
        c.post("/api/v1/cart/items/", {"product_id": milk.id, "quantity": "1"})
        res = place(
            c, {"fulfilment_type": "DELIVERY", "slot_id": slot.id, "address_id": foreign.id, "payment_method": "COD"}
        )
        assert res.status_code == 404 and Order.objects.count() == 0

    def test_slot_must_match_branch_zone_and_kind(self, shop_client, make_slot, second_branch, pickup_slot, branch):
        other = make_slot(branch_obj=second_branch, zone_obj=None)
        assert place(shop_client, payload(other)).status_code == 409
        assert (
            err(place(shop_client, payload(pickup_slot)))["code"] == "DELIVERY_SLOT_UNAVAILABLE"
        )  # pickup slot for a delivery order
        assert Order.objects.count() == 0

    def test_full_slot_closed_slot_and_slot_too_soon(self, shop_client, make_slot, branch):
        full = make_slot(capacity=1, hour=8)
        DeliverySlot.objects.filter(pk=full.pk).update(booked=1)
        closed = make_slot(hour=9)
        DeliverySlot.objects.filter(pk=closed.pk).update(is_open=False)
        for s in (full, closed):
            res = place(shop_client, payload(s))
            assert res.status_code == 409 and err(res)["code"] == "DELIVERY_SLOT_UNAVAILABLE", res.content
        soon = make_slot(days=2, hour=11)
        branch.prep_minutes = 60 * 24 * 3  # the store needs three days' notice, so a slot two days out is too soon
        branch.save()
        res = place(shop_client, payload(soon))
        assert res.status_code == 409 and "too soon" in err(res)["message"]
        assert Order.objects.count() == 0

    def test_empty_basket(self, api, slot):
        res = place(api, payload(slot))
        assert res.status_code == 409 and err(res)["code"] == "CART_EMPTY"

    def test_items_sold_out_after_adding_are_reported_per_item(self, shop_client, slot, milk):
        StockLevel.objects.filter(product=milk).update(on_hand=D("2"))
        res = place(shop_client, payload(slot))
        assert res.status_code == 409 and err(res)["code"] == "CART_CHANGED"
        assert err(res)["details"]["items"][0]["code"] == "INSUFFICIENT_STOCK" and Order.objects.count() == 0

    def test_guest_must_supply_contact_details(self, shop_client, slot):
        body = payload(slot)
        body["contact"] = {"name": "Only Name"}
        res = place(shop_client, body)
        assert res.status_code == 400 and "contact.email" in err(res)["details"]

    def test_guest_checkout_can_be_disabled(self, shop_client, slot, settings_obj):
        settings_obj.allow_guest_checkout = False
        settings_obj.save()
        assert err(place(shop_client, payload(slot)))["code"] == "GUEST_CHECKOUT_DISABLED"

    def test_card_refused_when_no_provider_is_configured(self, shop_client, slot, settings):
        settings.PAYMENT_PROVIDER = "unconfigured"
        res = place(shop_client, payload(slot))
        assert res.status_code == 503 and err(res)["code"] == "PAYMENT_PROVIDER_UNAVAILABLE"
        assert place(shop_client, payload(slot, payment_method="COD")).status_code == 201

    def test_demo_adapter_is_inert_unless_explicitly_allowed(self, settings):
        from apps.payments.providers import ProviderError, get_provider

        settings.PAYMENTS_ALLOW_DEMO = False
        with pytest.raises(ProviderError):
            get_provider("demo")


class TestPaymentFailureAndRecovery:
    """Workflow 6: fail → clear state → retry → provider confirms → one order, one stock reservation."""

    def test_failed_payment_then_retry_then_success(self, shop_client, slot, milk):
        number = place(shop_client, payload(slot)).json()["number"]
        token = Order.objects.get().tracking_token
        assert pay(shop_client, number, "fail").json()["result"] == "applied"
        order = Order.objects.get()
        assert (order.status, order.payment_status) == (
            "PENDING_PAYMENT",
            "FAILED",
        ) and Payment.objects.get().state == "FAILED"
        detail = shop_client.get(f"/api/v1/orders/{number}/?token={token}").json()
        assert detail["payment"]["can_retry"] is True and "declined" in detail["payment"]["failure_message"]
        retry = shop_client.post(f"/api/v1/payments/orders/{number}/retry/?token={token}", {"method": "CARD"})
        assert (
            retry.status_code == 200
            and retry.json()["payment"]["attempt"] == 2
            and retry.json()["payment"]["state"] == "REQUIRES_ACTION"
        )
        assert pay(shop_client, number, "succeed").json()["result"] == "applied"
        pay_again = pay(shop_client, number, "succeed")  # duplicate success for the same attempt
        assert pay_again.json()["result"] == "ignored"
        order.refresh_from_db()
        assert (order.status, order.payment_status) == ("CONFIRMED", "AUTHORIZED")
        assert (
            Order.objects.count() == 1
            and Payment.objects.count() == 2
            and Payment.objects.filter(state="AUTHORIZED").count() == 1
        )
        assert level(milk).reserved == 4  # reserved once across both attempts
        slot.refresh_from_db()
        assert slot.booked == 1

    def test_cancelled_at_provider_then_switch_to_pay_on_delivery(self, shop_client, slot):
        number = place(shop_client, payload(slot)).json()["number"]
        token = Order.objects.get().tracking_token
        pay(shop_client, number, "cancel")
        assert Payment.objects.get().state == "CANCELLED"
        res = shop_client.post(f"/api/v1/payments/orders/{number}/retry/?token={token}", {"method": "COD"})
        assert res.status_code == 200 and res.json()["status"] == "CONFIRMED" and res.json()["payment"]["mode"] == "cod"
        assert Payment.objects.filter(state="PENDING_COLLECTION").count() == 1

    def test_failure_event_after_authorisation_cannot_unconfirm_an_order(self, shop_client, slot):
        number = place(shop_client, payload(slot)).json()["number"]
        pay(shop_client, number, "succeed")
        payment = Payment.objects.get()
        res = deliver(APIClient(), event_for(payment, "payment.failed"))
        assert res.json()["status"] == "ignored" and Order.objects.get().status == "CONFIRMED"

    def test_expired_reservation_releases_everything_and_late_payment_is_voided(self, shop_client, slot, milk):
        from apps.orders.tasks import release_expired_reservations

        Coupon.objects.create(code="TEN", kind="PERCENT", value=D("10"), usage_limit=5)
        shop_client.post("/api/v1/cart/coupon/", {"code": "TEN"})
        number = place(shop_client, payload(slot)).json()["number"]
        assert release_expired_reservations() == 0  # not expired yet
        Order.objects.update(reservation_expires_at=timezone.now() - dt.timedelta(minutes=1))
        assert release_expired_reservations() == 1
        assert release_expired_reservations() == 0  # idempotent
        order = Order.objects.get()
        assert order.status == "PAYMENT_FAILED"
        assert (
            level(milk).reserved,
            DeliverySlot.objects.get(pk=slot.pk).booked,
            Coupon.objects.get(code="TEN").used_count,
        ) == (0, 0, 0)
        assert Payment.objects.get().state == "CANCELLED" and inv.check_invariants() == []
        # the customer paid at the very last second: the hold must be released, not silently honoured
        late = deliver(APIClient(), event_for(Payment.objects.get()))
        assert late.status_code == 200
        assert Payment.objects.get().state == "VOIDED" and Order.objects.get().status == "PAYMENT_FAILED"
        assert number == order.number


class TestWebhookSecurity:
    @pytest.fixture
    def pending(self, shop_client, slot):
        place(shop_client, payload(slot))
        return Payment.objects.get()

    def test_bad_signature_is_rejected_and_changes_nothing(self, pending):
        res = deliver(APIClient(), event_for(pending), secret="not-the-secret")
        assert res.status_code == 400 and res.json()["status"] == "invalid_signature"
        assert Order.objects.get().status == "PENDING_PAYMENT" and PaymentEvent.objects.count() == 0

    def test_missing_or_malformed_signature(self, pending):
        assert deliver(APIClient(), event_for(pending), signature="garbage").status_code == 400
        assert deliver(APIClient(), event_for(pending), signature="t=1,v1=abc").status_code == 400

    def test_stale_timestamp_is_rejected_replay_protection(self, pending):
        old = int(timezone.now().timestamp()) - 3600
        assert deliver(APIClient(), event_for(pending), ts=old).status_code == 400

    def test_tampered_body_is_rejected(self, pending):
        import json

        from apps.payments.providers.demo import sign

        body = json.dumps(event_for(pending), separators=(",", ":"), sort_keys=True).encode()
        sig = sign(body)
        tampered = body.replace(b"payment.authorized", b"payment.authorised")
        res = APIClient().generic(
            "POST",
            "/api/v1/payments/webhook/demo/",
            data=tampered,
            content_type="application/json",
            HTTP_X_DEMO_SIGNATURE=sig,
        )
        assert res.status_code == 400

    def test_amount_mismatch_never_confirms(self, pending):
        res = deliver(APIClient(), event_for(pending, amount="0.01"))
        assert res.json()["status"] == "error" and Order.objects.get().status == "PENDING_PAYMENT"
        assert PaymentEvent.objects.get().outcome == "ERROR"

    def test_unknown_payment_is_ignored_not_an_error(self, pending):
        res = deliver(
            APIClient(),
            {"id": "evt_x1", "type": "payment.authorized", "reference": "nope", "payment_id": 999999, "amount": "1.00"},
        )
        assert res.status_code == 200 and res.json()["status"] == "ignored"

    def test_unknown_provider_and_demo_endpoint_disabled_in_non_demo_mode(self, pending, settings):
        assert deliver(APIClient(), event_for(pending), provider="nope").status_code == 503
        settings.PAYMENT_PROVIDER = "unconfigured"
        assert APIClient().get(f"/api/v1/payments/demo/{pending.provider_reference}/").status_code == 404

    def test_processing_failure_rolls_back_the_event_so_the_provider_retry_works(self, pending, monkeypatch):
        from apps.orders import workflow as wf

        def boom(order):
            raise RuntimeError("db hiccup")

        monkeypatch.setattr(wf, "confirm_after_payment", boom)
        ev = event_for(pending)
        assert deliver(APIClient(), ev).status_code == 500
        assert PaymentEvent.objects.count() == 0 and Payment.objects.get().state == "REQUIRES_ACTION"
        monkeypatch.undo()
        assert deliver(APIClient(), ev).json()["status"] == "applied"  # same event id, processed on retry
        assert Order.objects.get().status == "CONFIRMED"


class TestCancellation:
    def test_customer_can_cancel_before_picking_and_everything_is_released(self, shop_client, slot, milk):
        Coupon.objects.create(code="TEN", kind="PERCENT", value=D("10"), usage_limit=5)
        shop_client.post("/api/v1/cart/coupon/", {"code": "TEN"})
        number = place(shop_client, payload(slot)).json()["number"]
        pay(shop_client, number, "succeed")
        token = Order.objects.get().tracking_token
        res = shop_client.post(f"/api/v1/orders/{number}/cancel/?token={token}", {"reason": "Changed my mind"})
        assert res.status_code == 200 and res.json()["status"] == "CANCELLED"
        assert (
            Payment.objects.get().state == "VOIDED" and Order.objects.get().payment_status == "VOIDED"
        )  # hold released, nothing captured
        assert (
            level(milk).reserved,
            DeliverySlot.objects.get(pk=slot.pk).booked,
            Coupon.objects.get(code="TEN").used_count,
        ) == (0, 0, 0)
        assert inv.check_invariants() == []
        again = shop_client.post(f"/api/v1/orders/{number}/cancel/?token={token}", {})
        assert again.status_code == 409 and err(again)["code"] == "INVALID_ORDER_TRANSITION"

    def test_customer_cannot_cancel_once_picking_started(self, shop_client, slot):
        number = place(shop_client, payload(slot, payment_method="COD")).json()["number"]
        order = Order.objects.get()
        from django.db import transaction

        with transaction.atomic():
            workflow.transition(order, OrderStatus.PICKING, actor="staff")
        res = shop_client.post(f"/api/v1/orders/{number}/cancel/?token={order.tracking_token}", {})
        assert res.status_code == 409 and "already started preparing" in err(res)["message"]

    def test_unpaid_card_order_can_be_cancelled(self, shop_client, slot, milk):
        number = place(shop_client, payload(slot)).json()["number"]
        shop_client.post(f"/api/v1/orders/{number}/cancel/?token={Order.objects.get().tracking_token}", {})
        assert (
            Order.objects.get().status == "CANCELLED"
            and Payment.objects.get().state == "CANCELLED"
            and level(milk).reserved == 0
        )


class TestStateMachine:
    @pytest.mark.parametrize(
        ("start", "target", "ok"),
        [
            ("CONFIRMED", "PICKING", True),
            ("CONFIRMED", "COMPLETED", False),
            ("CONFIRMED", "PACKING", False),
            ("PICKING", "PACKING", True),
            ("PICKING", "READY_FOR_PICKUP", False),
            ("PACKING", "READY_FOR_DISPATCH", True),
            ("READY_FOR_DISPATCH", "OUT_FOR_DELIVERY", True),
            ("READY_FOR_DISPATCH", "COMPLETED", False),
            ("COMPLETED", "CANCELLED", False),
            ("CANCELLED", "CONFIRMED", False),
            ("PAYMENT_FAILED", "CONFIRMED", False),
        ],
    )
    def test_delivery_order_transitions(self, shop_client, slot, start, target, ok):
        from django.db import transaction

        place(shop_client, payload(slot, payment_method="COD"))
        Order.objects.update(status=start)
        order = Order.objects.get()
        with transaction.atomic():
            if ok:
                assert workflow.transition(order, target).status == target
            else:
                with pytest.raises(Exception) as exc:  # noqa: PT011
                    workflow.transition(order, target)
                assert getattr(exc.value, "code", "") == "INVALID_ORDER_TRANSITION"

    def test_pickup_and_delivery_specific_states_are_not_interchangeable(self, shop_client, pickup_slot, branch):
        from django.db import transaction

        place(
            shop_client,
            {
                "fulfilment_type": "PICKUP",
                "branch_id": branch.id,
                "slot_id": pickup_slot.id,
                "payment_method": "COD",
                "contact": {"name": "Pat", "email": "pat@example.com", "phone": "555-0100"},
            },
        )
        Order.objects.update(status="PACKING")
        order = Order.objects.get()
        with transaction.atomic():
            with pytest.raises(Exception) as exc:  # noqa: PT011
                workflow.transition(order, OrderStatus.READY_FOR_DISPATCH)
            assert exc.value.code == "INVALID_ORDER_TRANSITION"
        with transaction.atomic():
            assert workflow.transition(order, OrderStatus.READY_FOR_PICKUP).status == "READY_FOR_PICKUP"

    def test_no_api_accepts_an_arbitrary_status(self, shop_client, slot):
        number = place(shop_client, payload(slot, payment_method="COD")).json()["number"]
        token = Order.objects.get().tracking_token
        for method in ("patch", "put"):
            res = getattr(shop_client, method)(f"/api/v1/orders/{number}/?token={token}", {"status": "COMPLETED"})
            assert res.status_code in (404, 405)
        assert Order.objects.get().status == "CONFIRMED"


class TestOrderAccess:
    def test_owner_only_for_signed_in_orders(self, user, other_user, milk, slot):
        c = APIClient()
        c.force_authenticate(user)
        c.post("/api/v1/cart/items/", {"product_id": milk.id, "quantity": "3"})
        number = place(
            c, {"fulfilment_type": "DELIVERY", "slot_id": slot.id, "address": ADDRESS, "payment_method": "COD"}
        ).json()["number"]
        stranger = APIClient()
        stranger.force_authenticate(other_user)
        assert stranger.get(f"/api/v1/orders/{number}/").status_code == 404
        assert stranger.get("/api/v1/orders/").json()["results"] == []
        assert stranger.post(f"/api/v1/orders/{number}/cancel/", {}).status_code == 404
        assert c.get(f"/api/v1/orders/{number}/").status_code == 200

    def test_guest_access_needs_the_tracking_token_or_email(self, shop_client, slot):
        number = place(shop_client, payload(slot, payment_method="COD")).json()["number"]
        token = Order.objects.get().tracking_token
        anon = APIClient()
        assert anon.get(f"/api/v1/orders/{number}/").status_code == 404
        assert anon.get(f"/api/v1/orders/{number}/?token=wrong").status_code == 404
        assert anon.get(f"/api/v1/orders/{number}/?token={token}").status_code == 200
        assert anon.post("/api/v1/orders/track/", {"number": number, "email": "SAM@example.com"}).status_code == 200
        assert anon.post("/api/v1/orders/track/", {"number": number, "email": "other@example.com"}).status_code == 404


class TestConcurrency:
    pytestmark = [pytest.mark.django_db(transaction=True, serialized_rollback=True), pytest.mark.concurrency]

    def _race(self, n, worker):
        results, barrier = [], threading.Barrier(n)

        def run(i):
            close_old_connections()
            try:
                barrier.wait(timeout=15)
                results.append(worker(i))
            except Exception as exc:  # noqa: BLE001
                results.append(("crash", repr(exc)))
            finally:
                connection.close()

        threads = [threading.Thread(target=run, args=(i,)) for i in range(n)]
        [t.start() for t in threads]
        [t.join(60) for t in threads]
        return results

    def _shopper(self, product, n):
        clients = []
        for i in range(n):
            c = APIClient()
            assert c.post("/api/v1/cart/items/", {"product_id": product.id, "quantity": "1"}).status_code == 201
            clients.append(c)
        return clients

    def test_double_click_double_submit_creates_one_order(self, shop_client, slot, milk):
        key = "double-click-key-1"
        body = payload(slot)

        def worker(i):
            return place(shop_client, body, key=key).status_code

        results = self._race(6, worker)
        assert sorted(set(results)) in ([200, 201], [201]) and results.count(201) == 1, results
        assert Order.objects.count() == 1 and Payment.objects.count() == 1
        assert level(milk).reserved == 4 and DeliverySlot.objects.get(pk=slot.pk).booked == 1

    def test_last_slot_place_is_won_by_exactly_one_checkout(self, product_factory, stock_up, make_slot, branch):
        p = product_factory(sku="RACE1", name="Race item", price="6.00")
        stock_up(p, 50)
        slot = make_slot(capacity=1)
        clients = self._shopper(p, 8)

        def worker(i):
            res = place(
                clients[i],
                payload(
                    slot, payment_method="COD", contact={"name": "S", "email": f"s{i}@example.com", "phone": "555-0100"}
                ),
            )
            return res.status_code, (res.json().get("error") or {}).get("code")

        results = self._race(8, worker)
        assert not [r for r in results if r[0] == "crash"], results
        assert [r[0] for r in results].count(201) == 1
        assert all(r[1] == "DELIVERY_SLOT_UNAVAILABLE" for r in results if r[0] != 201), results
        assert DeliverySlot.objects.get(pk=slot.pk).booked == 1 and Order.objects.count() == 1
        assert level(p).reserved == 1 and inv.check_invariants() == []

    def test_stock_cannot_be_oversold_across_concurrent_checkouts(self, product_factory, stock_up, make_slot):
        p = product_factory(sku="RACE2", name="Scarce item", price="6.00")
        stock_up(p, 3)
        slot = make_slot(capacity=50)
        clients = self._shopper(p, 9)

        def worker(i):
            res = place(
                clients[i],
                payload(
                    slot, payment_method="COD", contact={"name": "S", "email": f"t{i}@example.com", "phone": "555-0100"}
                ),
            )
            return res.status_code, (res.json().get("error") or {}).get("code")

        results = self._race(9, worker)
        assert not [r for r in results if r[0] == "crash"], results
        assert [r[0] for r in results].count(201) == 3
        assert {r[1] for r in results if r[0] != 201} <= {"CART_CHANGED", "INSUFFICIENT_STOCK"}, results
        lv = level(p)
        assert (lv.on_hand, lv.reserved) == (3, 3) and DeliverySlot.objects.get(pk=slot.pk).booked == 3
        assert Allocation.objects.filter(state="RESERVED").count() == 3 and inv.check_invariants() == []

    def test_coupon_usage_limit_holds_under_concurrency(self, product_factory, stock_up, make_slot):
        p = product_factory(sku="RACE3", name="Coupon item", price="10.00")
        stock_up(p, 50)
        slot = make_slot(capacity=50)
        Coupon.objects.create(code="ONLYONE", kind="FIXED", value=D("2"), usage_limit=1, per_customer_limit=None)
        clients = self._shopper(p, 6)
        for c in clients:
            assert c.post("/api/v1/cart/coupon/", {"code": "ONLYONE"}).status_code == 200

        def worker(i):
            res = place(
                clients[i],
                payload(
                    slot, payment_method="COD", contact={"name": "S", "email": f"u{i}@example.com", "phone": "555-0100"}
                ),
            )
            return res.status_code, (res.json().get("error") or {}).get("code")

        results = self._race(6, worker)
        assert not [r for r in results if r[0] == "crash"], results
        assert [r[0] for r in results].count(201) == 1 and Coupon.objects.get(code="ONLYONE").used_count == 1
        assert CouponRedemption.objects.count() == 1 and {r[1] for r in results if r[0] != 201} == {"INVALID_COUPON"}


class TestNotifications:
    def test_in_app_notification_and_honest_email_channel(self, shop_client, slot, django_capture_on_commit_callbacks):
        from apps.notifications.models import Notification

        with django_capture_on_commit_callbacks(execute=True):
            place(shop_client, payload(slot))
        note = Notification.objects.get(kind="ORDER_PLACED")
        assert note.email == "sam@example.com" and "received your order" in note.title
        assert (
            note.channel == "EMAIL_LOGGED"
        )  # test mail backend delivers nothing externally — we must not claim "sent"

    def test_registered_customer_can_opt_out_of_email_not_in_app(
        self, user, milk, slot, django_capture_on_commit_callbacks
    ):
        from django.core import mail

        from apps.notifications.models import Notification

        user.notify_order_emails = False
        user.save()
        c = APIClient()
        c.force_authenticate(user)
        c.post("/api/v1/cart/items/", {"product_id": milk.id, "quantity": "3"})
        with django_capture_on_commit_callbacks(execute=True):
            place(c, {"fulfilment_type": "DELIVERY", "slot_id": slot.id, "address": ADDRESS, "payment_method": "COD"})
        assert Notification.objects.filter(user=user).count() == 1 and len(mail.outbox) == 0


def test_password_constant_is_used():
    assert PASSWORD
