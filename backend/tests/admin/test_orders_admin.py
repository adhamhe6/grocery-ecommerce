import datetime as dt
from decimal import Decimal

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.models import AuditLog
from apps.inventory.models import StockLevel
from apps.orders.models import Order
from apps.payments.models import Payment
from tests.admin.conftest import results
from tests.shop import payload, place

pytestmark = pytest.mark.django_db
D = Decimal
BASE = "/api/v1/admin/orders/"


def new_order(product, qty, slot, *, method="COD", email="sam@example.com", **kw):
    c = APIClient()
    c.post("/api/v1/cart/items/", {"product_id": product.id, "quantity": str(qty)})
    data = place(
        c,
        payload(
            slot, payment_method=method, contact={"name": "Sam Shopper", "email": email, "phone": "+1 555 0101"}, **kw
        ),
    ).json()
    return Order.objects.get(number=data["number"])


@pytest.fixture
def order(milk, slot):
    return new_order(milk, 4, slot)


@pytest.fixture
def picker(staff, branch):
    return staff("FULFILMENT_STAFF", branches=[branch])


@pytest.fixture
def manager(staff, branch):
    return staff("STORE_MANAGER", branches=[branch])


def item_id(order, product):
    return order.items.get(product=product).id


class TestAccessAndScoping:
    @pytest.mark.parametrize(
        ("role", "can_read"),
        [
            ("ADMIN", True),
            ("STORE_MANAGER", True),
            ("FULFILMENT_STAFF", True),
            ("CUSTOMER_SUPPORT", True),
            ("INVENTORY_MANAGER", False),
            ("PURCHASING_MANAGER", False),
            ("MARKETING_MANAGER", False),
        ],
    )
    def test_who_can_see_orders(self, staff, branch, order, role, can_read):
        res = staff(role, branches=[branch]).get(BASE)
        assert (res.status_code == 200) is can_read, (role, res.status_code)

    def test_anonymous_and_customers_are_refused(self, order, user):
        assert APIClient().get(BASE).status_code == 401
        c = APIClient()
        c.force_authenticate(user)
        assert c.get(BASE).status_code == 403
        assert c.post(f"{BASE}{order.number}/cancel/", {"reason": "x"}, format="json").status_code == 403

    def test_branch_staff_cannot_see_or_touch_other_branches_orders(
        self, staff, branch, second_branch, order, milk, make_slot, zone
    ):
        north_picker = staff("FULFILMENT_STAFF", branches=[second_branch])
        assert results(north_picker.get(BASE)) == []
        assert north_picker.get(f"{BASE}{order.number}/").status_code == 404
        assert north_picker.post(f"{BASE}{order.number}/start-picking/").status_code == 404
        assert (
            north_picker.post(f"{BASE}{order.number}/cancel/", {"reason": "x"}, format="json").status_code == 403
        )  # no capability at all
        north_manager = staff("STORE_MANAGER", branches=[second_branch])
        assert (
            north_manager.post(f"{BASE}{order.number}/cancel/", {"reason": "x"}, format="json").status_code == 404
        )  # capable, but not their branch
        assert (
            north_manager.post(
                f"{BASE}{order.number}/refund/",
                {"amount": "1", "reason": "x", "idempotency_key": "refund-key-1"},
                format="json",
            ).status_code
            == 404
        )
        order.refresh_from_db()
        assert order.status == "CONFIRMED"
        assert [o["number"] for o in results(staff("STORE_MANAGER", branches=[branch]).get(BASE))] == [order.number]
        assert len(results(staff("ADMIN").get(BASE))) == 1

    def test_capability_split_between_floor_staff_and_managers(self, picker, manager, staff, branch, order, milk):
        support = staff("CUSTOMER_SUPPORT", branches=[branch])
        # pickers pick; they cannot cancel, reassign or refund
        assert picker.post(f"{BASE}{order.number}/start-picking/").status_code == 200
        assert picker.post(f"{BASE}{order.number}/cancel/", {"reason": "x"}, format="json").status_code == 403
        assert (
            picker.post(f"{BASE}{order.number}/assign/", {"user_id": picker.user.id}, format="json").status_code == 403
        )
        assert (
            picker.post(
                f"{BASE}{order.number}/refund/",
                {"amount": "1.00", "reason": "x", "idempotency_key": "refund-key-1"},
                format="json",
            ).status_code
            == 403
        )
        # support can cancel/refund but not pick
        assert support.post(f"{BASE}{order.number}/finish-picking/").status_code == 403
        assert (
            support.post(
                f"{BASE}{order.number}/items/{item_id(order, milk)}/pick/", {"picked_qty": "1"}, format="json"
            ).status_code
            == 403
        )
        assert (
            manager.post(f"{BASE}{order.number}/cancel/", {"reason": "customer asked"}, format="json").status_code
            == 200
        )


class TestFulfilmentThroughTheApi:
    def test_full_cod_delivery_via_endpoints(self, picker, order, milk):
        n = order.number
        assert picker.post(f"{BASE}{n}/start-picking/").json()["status"] == "PICKING"
        assert picker.post(f"{BASE}{n}/finish-picking/").status_code == 409  # items outstanding
        assert (
            picker.post(f"{BASE}{n}/items/{item_id(order, milk)}/pick/", {"picked_qty": "4"}, format="json").status_code
            == 200
        )
        assert picker.post(f"{BASE}{n}/finish-picking/").json()["status"] == "PACKING"
        assert picker.post(f"{BASE}{n}/finish-packing/").json()["status"] == "READY_FOR_DISPATCH"
        assert picker.post(f"{BASE}{n}/dispatch/").json()["status"] == "OUT_FOR_DELIVERY"
        bad = picker.post(f"{BASE}{n}/complete/", {"collected_amount": "1.00"}, format="json")
        assert bad.status_code == 400 and bad.json()["error"]["details"]["due"] == "14.00"
        done = picker.post(
            f"{BASE}{n}/complete/", {"collected_amount": "14.00", "reference": "cash-drawer-3"}, format="json"
        ).json()
        assert done["status"] == "COMPLETED" and done["totals"]["final_total"] == "14.00"
        assert [p["state"] for p in done["payments"]] == ["CAPTURED"]
        assert [h["to"] for h in done["history"] if h["from"] != h["to"]][-1] == "COMPLETED"

    def test_invalid_transitions_explain_what_is_allowed(self, picker, order):
        res = picker.post(f"{BASE}{order.number}/dispatch/")
        assert res.status_code == 409 and res.json()["error"]["code"] == "INVALID_ORDER_TRANSITION"
        assert res.json()["error"]["details"]["allowed"] == ["CANCELLED", "PICKING"]

    def test_no_endpoint_accepts_a_raw_status(self, manager, order):
        for res in (
            manager.patch(f"{BASE}{order.number}/", {"status": "COMPLETED"}, format="json"),
            manager.put(f"{BASE}{order.number}/", {"status": "COMPLETED"}, format="json"),
            manager.post(BASE, {"status": "COMPLETED"}, format="json"),
        ):
            assert res.status_code in (403, 405)
        order.refresh_from_db()
        assert order.status == "CONFIRMED"

    def test_weight_tolerance_and_manager_override(self, picker, manager, cheese, slot):
        o = new_order(cheese, "1.5", slot)
        n, iid = o.number, o.items.get().id
        picker.post(f"{BASE}{n}/start-picking/")
        too_heavy = picker.post(f"{BASE}{n}/items/{iid}/pick/", {"picked_qty": "1.9"}, format="json")
        assert (
            too_heavy.status_code == 422
            and too_heavy.json()["error"]["code"] == "WEIGHT_OUT_OF_TOLERANCE"
            and too_heavy.json()["error"]["details"]["max_allowed"] == "1.65"
        )
        assert (
            picker.post(
                f"{BASE}{n}/items/{iid}/pick/", {"picked_qty": "1.9", "override": True}, format="json"
            ).status_code
            == 403
        )  # pickers cannot override
        ok = manager.post(f"{BASE}{n}/items/{iid}/pick/", {"picked_qty": "1.9", "override": True}, format="json")
        assert ok.status_code == 200 and ok.json()["items"][0]["line_total_final"] == "19.80"
        assert AuditLog.objects.filter(action="order.weight_override").exists()
        detail = picker.get(f"{BASE}{n}/").json()
        assert detail["items"][0]["tolerance"] == {"min": "1.35", "max": "1.65"}

    def test_items_must_belong_to_the_order_in_the_url(self, picker, order, milk, cheese, slot):
        other = new_order(cheese, "1", slot, email="x@example.com")
        picker.post(f"{BASE}{order.number}/start-picking/")
        foreign_item = other.items.get().id
        res = picker.post(f"{BASE}{order.number}/items/{foreign_item}/pick/", {"picked_qty": "1"}, format="json")
        assert res.status_code == 404
        assert other.items.get().picked_qty is None

    def test_substitution_flow(self, picker, manager, category, product_factory, stock_up, slot):
        original = product_factory(sku="PA", name="Penne 500g", price="1.80", category=category)
        alt = product_factory(sku="PB", name="Fusilli 500g", price="1.50", category=category)
        stock_up(original, 10)
        stock_up(alt, 10)
        c = APIClient()
        c.post("/api/v1/cart/items/", {"product_id": original.id, "quantity": "4"})
        c.patch("/api/v1/cart/", {"substitution_policy": "CONTACT"}, format="json")
        o = Order.objects.get(number=place(c, payload(slot, payment_method="COD")).json()["number"])
        n, iid = o.number, o.items.get().id
        picker.post(f"{BASE}{n}/start-picking/")
        assert (
            picker.post(f"{BASE}{n}/items/{iid}/unavailable/", {"reason": "empty shelf"}, format="json").status_code
            == 200
        )
        cands = picker.get(f"{BASE}{n}/items/{iid}/substitutes/").json()
        assert cands["policy"] == "CONTACT" and [x["name"] for x in cands["candidates"]] == ["Fusilli 500g"]
        proposed = picker.post(
            f"{BASE}{n}/items/{iid}/substitute/", {"product_id": alt.id, "reason": "same size"}, format="json"
        )
        assert proposed.status_code == 200 and proposed.json()["substitutions"][0]["status"] == "AWAITING_CUSTOMER"
        assert picker.post(f"{BASE}{n}/finish-picking/").json()["error"]["code"] == "SUBSTITUTION_REQUIRES_APPROVAL"
        sid = proposed.json()["substitutions"][0]["id"]
        assert (
            picker.post(f"{BASE}{n}/substitutions/{sid}/decide/", {"approve": True}, format="json").status_code == 403
        )  # staff need orders.manage
        assert (
            manager.post(f"{BASE}{n}/substitutions/{sid}/decide/", {"approve": True}, format="json").status_code == 400
        )  # must say how the customer answered
        ok = manager.post(
            f"{BASE}{n}/substitutions/{sid}/decide/", {"approve": True, "note": "phoned 10:42"}, format="json"
        )
        assert ok.status_code == 200 and ok.json()["substitutions"][0]["status"] == "APPROVED"

    def test_no_substitutes_policy_blocks_the_proposal_endpoint(
        self, picker, category, product_factory, stock_up, slot
    ):
        original = product_factory(sku="NA", name="Jam A", price="2.00", category=category)
        alt = product_factory(sku="NB", name="Jam B", price="2.00", category=category)
        stock_up(original, 10)
        stock_up(alt, 10)
        c = APIClient()
        c.post("/api/v1/cart/items/", {"product_id": original.id, "quantity": "3"})
        c.patch("/api/v1/cart/", {"substitution_policy": "NONE"}, format="json")
        o = Order.objects.get(number=place(c, payload(slot, payment_method="COD")).json()["number"])
        picker.post(f"{BASE}{o.number}/start-picking/")
        iid = o.items.get().id
        picker.post(f"{BASE}{o.number}/items/{iid}/unavailable/", {"reason": "none"}, format="json")
        res = picker.post(f"{BASE}{o.number}/items/{iid}/substitute/", {"product_id": alt.id}, format="json")
        assert res.status_code == 409 and res.json()["error"]["code"] in ("SUBSTITUTION_NOT_ALLOWED", "INVALID_STATE")
        assert not o.items.filter(substitute_for__isnull=False).exists()


class TestListsQueueAndDetail:
    def test_filters_and_search(self, manager, milk, cheese, slot, make_slot):
        a = new_order(milk, 4, slot, email="anna@example.com")
        b = new_order(cheese, "1", make_slot(days=3), email="bob@example.com")
        Order.objects.filter(pk=b.pk).update(status="PICKING")
        assert [o["number"] for o in results(manager.get(BASE + "?status=PICKING"))] == [b.number]
        assert [o["number"] for o in results(manager.get(BASE + "?search=anna"))] == [a.number]
        assert [o["number"] for o in results(manager.get(BASE + f"?search={a.number[-5:]}"))] == [a.number]
        assert [o["number"] for o in results(manager.get(BASE + f"?slot_date={slot.date.isoformat()}"))] == [a.number]
        assert len(results(manager.get(BASE + "?fulfilment_type=PICKUP"))) == 0
        assert results(manager.get(BASE + "?ordering=bogus;drop"))  # unknown ordering falls back safely

    def test_list_query_count_is_bounded(self, manager, milk, slot, make_slot, django_assert_max_num_queries):
        for i in range(8):
            new_order(
                milk, 3, make_slot(days=2 + i // 4, hour=12 + 2 * (i % 4), capacity=50), email=f"u{i}@example.com"
            )  # 8 x 3 = 24 of 30 in stock
        with django_assert_max_num_queries(8):
            assert len(results(manager.get(BASE))) == 8

    def test_queue_groups_by_window_and_flags_late_orders(self, manager, milk, slot, make_slot):
        a = new_order(milk, 4, slot, email="a@example.com")
        b = new_order(milk, 4, make_slot(days=2, hour=14), email="b@example.com")
        Order.objects.filter(pk=a.pk).update(slot_starts_at=timezone.now() - dt.timedelta(hours=1))
        data = manager.get(BASE + "queue/").json()
        assert data["counts"]["CONFIRMED"] == 2 and len(data["groups"]) == 2
        rows = {r["number"]: r for g in data["groups"] for r in g["orders"]}
        assert (
            rows[a.number]["is_late"] is True
            and rows[b.number]["is_late"] is False
            and rows[a.number]["lines"] == 1
            and rows[a.number]["lines_done"] == 0
        )

    def test_pick_sheet_orders_ambient_then_chilled_then_frozen_and_shows_fefo_lots(
        self, manager, picker, category, product_factory, stock_up, slot
    ):
        frozen = product_factory(sku="FZ", name="Frozen peas", price="2.00", storage_type="FROZEN")
        chilled = product_factory(
            sku="CH", name="Yoghurt", price="2.00", storage_type="CHILLED", tracks_batches=True, is_perishable=True
        )
        ambient = product_factory(sku="AM", name="Pasta", price="2.00")
        for p in (frozen, chilled, ambient):
            stock_up(p, 20)
        stock_up(chilled, 5, lot_code="EARLY", expiry_date=timezone.localdate() + dt.timedelta(days=4))
        c = APIClient()
        for p in (frozen, chilled, ambient):
            c.post("/api/v1/cart/items/", {"product_id": p.id, "quantity": "2"})
        o = Order.objects.get(number=place(c, payload(slot, payment_method="COD")).json()["number"])
        detail = manager.get(f"{BASE}{o.number}/").json()
        assert [i["storage"] for i in detail["items"]] == ["AMBIENT", "CHILLED", "FROZEN"]
        yoghurt = next(i for i in detail["items"] if i["sku"] == "CH")
        assert yoghurt["lots"][0]["lot"] == "EARLY"  # FEFO: the picker is told which lot to take

    def test_refund_endpoints_are_idempotent_and_manual_cod_refunds_need_confirmation(
        self, manager, picker, order, milk
    ):
        from tests.shop import run_to_completion

        run_to_completion(order, picker.user)
        body = {"amount": "2.50", "reason": "leaking bottle", "idempotency_key": "refund-key-0001"}
        first = manager.post(f"{BASE}{order.number}/refund/", body, format="json").json()
        again = manager.post(f"{BASE}{order.number}/refund/", body, format="json").json()
        assert (
            first["refund_result"]["status"] == "PENDING"
            and again["refund_result"]["id"] == first["refund_result"]["id"]
            and len(again["refunds"]) == 1
        )
        assert Payment.objects.get().refunded_amount == 0  # nothing claimed until a human confirms the cash went back
        rid = first["refund_result"]["id"]
        assert (
            manager.post(
                f"{BASE}{order.number}/refunds/{rid}/complete/", {"reference": "RCPT-77"}, format="json"
            ).json()["refunds"][0]["status"]
            == "SUCCEEDED"
        )
        assert Payment.objects.get().refunded_amount == D("2.50")
        over = manager.post(
            f"{BASE}{order.number}/refund/",
            {**body, "amount": "99", "idempotency_key": "refund-key-0002"},
            format="json",
        )
        assert over.status_code == 409 and over.json()["error"]["code"] == "REFUND_NOT_ALLOWED"
        assert StockLevel.objects.filter(product=milk).exists()
