"""Workflows 2 and 3 from the brief: variable-weight produce, and unavailable items / substitution policy."""

from decimal import Decimal

import pytest
from rest_framework.test import APIClient

from apps.catalog.models import Allergen, ProductAllergen, ProductClaim
from apps.inventory import services as inv
from apps.inventory.models import MovementKind, StockLevel, StockMovement
from apps.notifications.models import Notification
from apps.orders import fulfilment as ful
from apps.orders import workflow
from apps.orders.models import Order, Substitution
from apps.payments import services as pay_services
from apps.payments.models import Payment, Refund
from tests.conftest import make_user
from tests.orders.conftest import pay, payload, place

pytestmark = pytest.mark.django_db
D = Decimal


def err_code(excinfo):
    return excinfo.value.code


@pytest.fixture
def picker():
    return make_user(email="picker@example.com", role="FULFILMENT_STAFF")


@pytest.fixture
def manager():
    return make_user(email="manager@example.com", role="STORE_MANAGER")


def checkout(client, slot, *, method="CARD", **kw):
    number = place(client, payload(slot, payment_method=method, **kw)).json()["number"]
    if method == "CARD":
        pay(client, number, "succeed")
    return Order.objects.get(number=number)


def basket(items):
    c = APIClient()
    for product, quantity in items:
        assert c.post("/api/v1/cart/items/", {"product_id": product.id, "quantity": str(quantity)}).status_code == 201
    return c


def item_of(order, product):
    return order.items.get(product=product, substitute_for__isnull=True)


# =============================================================================== Workflow 2: variable weight
class TestVariableWeightProduce:
    @pytest.fixture
    def order(self, cheese, milk, slot, picker):
        # 1.5 kg cheese @ 12.00 = 18.00 estimated; 2 milk @ 2.50 = 5.00; delivery 4.00 → total 27.00
        order = checkout(basket([(cheese, "1.5"), (milk, 2)]), slot)
        ful.start_picking(order, picker)
        return order

    def test_estimate_authorisation_and_policy_are_visible_to_the_customer_up_front(self, order):
        order.refresh_from_db()
        assert (order.total, order.authorized_amount) == (D("27.00"), D("28.80"))  # +10% of the 18.00 weighed line
        assert Payment.objects.get().amount == D("28.80")

    def test_final_price_follows_the_picked_weight_within_tolerance(self, order, cheese, milk, picker):
        ci, mi = item_of(order, cheese), item_of(order, milk)
        ful.pick_item(ci.id, "1.62", picker, note="nice piece")  # 8% over the 1.5 kg ordered; max allowed 1.65
        ful.pick_item(mi.id, 2, picker)
        ful.finish_picking(order, picker)
        order.refresh_from_db()
        ci.refresh_from_db()
        assert (ci.ordered_qty, ci.picked_qty, ci.line_total_estimated, ci.line_total_final) == (D("1.5"), D("1.62"), D("18.00"), D("19.44"))
        assert order.final_total == D("28.44")  # 19.44 + 5.00 + 4.00
        assert order.final_total <= order.authorized_amount  # the guarantee: never above what the customer authorised

    def test_capture_is_the_final_amount_and_never_exceeds_authorisation(self, order, cheese, milk, picker, monkeypatch):
        calls = []
        from apps.payments.providers.demo import DemoProvider

        monkeypatch.setattr(DemoProvider, "capture", lambda self, payment, amount: calls.append(amount))
        ful.pick_item(item_of(order, cheese).id, "1.65", picker)  # exactly the upper tolerance
        ful.pick_item(item_of(order, milk).id, 2, picker)
        ful.finish_picking(order, picker)
        ful.finish_packing(order, picker)
        payment = Payment.objects.get()
        assert calls == [D("28.80")] and payment.state == "CAPTURED" and payment.captured_amount == D("28.80") <= payment.amount
        order.refresh_from_db()
        assert (order.status, order.payment_status, order.final_total) == ("READY_FOR_DISPATCH", "PAID", D("28.80"))

    def test_weight_beyond_tolerance_is_refused_with_an_explanation(self, order, cheese, picker):
        with pytest.raises(Exception) as exc:  # noqa: PT011
            ful.pick_item(item_of(order, cheese).id, "1.9", picker)
        assert err_code(exc) == "WEIGHT_OUT_OF_TOLERANCE"
        assert "max 1.65" in exc.value.message and exc.value.details["max_allowed"] == "1.65"
        assert item_of(order, cheese).picked_qty is None and StockMovement.objects.filter(kind=MovementKind.SALE).count() == 0

    def test_manager_override_is_capped_at_tolerance_and_audited(self, order, cheese, manager):
        from apps.core.models import AuditLog

        ful.pick_item(item_of(order, cheese).id, "1.9", manager, override=True)
        it = item_of(order, cheese)
        assert it.picked_qty == D("1.9") and it.line_total_final == D("19.80")  # charged 1.65 kg, not 1.9 kg
        assert AuditLog.objects.filter(action="order.weight_override").count() == 1
        assert StockLevel.objects.get(product=cheese).on_hand == D("8.1")  # but all 1.9 kg really left the shelf

    def test_underweight_is_cheaper_and_flagged_short(self, order, cheese, milk, picker):
        ful.pick_item(item_of(order, cheese).id, "1.2", picker, note="small piece")
        it = item_of(order, cheese)
        assert (it.status, it.line_total_final) == ("SHORT", D("14.40"))
        ful.pick_item(item_of(order, milk).id, 2, picker)
        ful.finish_picking(order, picker)
        order.refresh_from_db()
        assert order.final_total == D("23.40") and order.final_total < order.total

    def test_stock_ledger_records_the_actual_weight(self, order, cheese, picker):
        ful.pick_item(item_of(order, cheese).id, "1.62", picker)
        mv = StockMovement.objects.get(kind=MovementKind.SALE, product=cheese)
        assert mv.qty_delta == D("-1.62") and mv.ref_id == order.number and mv.on_hand_after == D("8.38")
        assert inv.check_invariants() == []

    def test_picking_more_than_free_stock_fails_cleanly(self, order, cheese, picker):
        StockLevel.objects.filter(product=cheese).update(on_hand=D("1.55"), reserved=D("1.5"))
        with pytest.raises(Exception) as exc:  # noqa: PT011
            ful.pick_item(item_of(order, cheese).id, "1.62", picker)
        assert err_code(exc) == "INSUFFICIENT_STOCK"

    def test_customer_sees_both_ordered_and_final_figures(self, order, cheese, milk, picker):
        ful.pick_item(item_of(order, cheese).id, "1.62", picker)
        ful.pick_item(item_of(order, milk).id, 2, picker)
        ful.finish_picking(order, picker)
        data = APIClient().get(f"/api/v1/orders/{order.number}/?token={order.tracking_token}").json()
        line = next(i for i in data["items"] if i["name"] == "Mature cheddar")
        assert (line["ordered_qty"], line["picked_qty"], line["line_total_estimated"], line["line_total_final"]) == ("1.5", "1.62", "18.00", "19.44")
        assert "weight we actually pick" in line["price_note"]
        assert (data["totals"]["total"], data["totals"]["final_total"], data["totals"]["difference"]) == ("27.00", "28.44", "1.44")

    def test_count_items_cannot_be_over_picked_and_short_picks_are_cheaper(self, order, milk, cheese, picker):
        mi = item_of(order, milk)
        with pytest.raises(Exception) as exc:  # noqa: PT011
            ful.pick_item(mi.id, 3, picker)
        assert err_code(exc) == "INVALID_QUANTITY"
        ful.pick_item(mi.id, 1, picker, note="only one on the shelf")
        mi.refresh_from_db()
        assert (mi.status, mi.line_total_final) == ("SHORT", D("2.50"))
        assert StockLevel.objects.get(product=milk).reserved == 0  # the unused reservation was released

    def test_cod_final_total_must_match_the_amount_collected(self, cheese, milk, slot, picker):
        order = checkout(basket([(cheese, "1.5")]), slot, method="COD")
        ful.start_picking(order, picker)
        ful.pick_item(item_of(order, cheese).id, "1.62", picker)
        ful.finish_picking(order, picker)
        ful.finish_packing(order, picker)
        ful.dispatch(order, picker)
        with pytest.raises(Exception) as exc:  # noqa: PT011
            ful.complete(order, picker, collected_amount="18.00")  # the estimate, not the final amount
        assert err_code(exc) == "VALIDATION_ERROR" and exc.value.details["due"] == "23.44"
        done = ful.complete(order, picker, collected_amount="23.44")
        assert done.status == "COMPLETED" and Payment.objects.get().state == "CAPTURED"


# =============================================================================== end-to-end happy path
class TestFullFulfilment:
    def test_confirmed_to_completed_with_consistent_stock_money_and_history(self, cheese, milk, slot, picker):
        order = checkout(basket([(cheese, "1"), (milk, 3)]), slot)
        ful.start_picking(order, picker)
        ful.pick_item(item_of(order, cheese).id, "1.05", picker)
        ful.pick_item(item_of(order, milk).id, 3, picker)
        ful.finish_picking(order, picker)
        ful.finish_packing(order, picker)
        ful.dispatch(order, picker)
        order = ful.complete(order, picker)
        assert order.status == "COMPLETED" and order.completed_at
        assert order.final_total == D("12.60") + D("7.50") + D("4.00")
        assert Payment.objects.get().captured_amount == order.final_total
        status_changes = [h.to_status for h in order.history.all() if h.from_status != h.to_status]
        assert status_changes == ["PENDING_PAYMENT", "CONFIRMED", "PICKING", "PACKING", "READY_FOR_DISPATCH", "OUT_FOR_DELIVERY", "COMPLETED"]
        assert StockLevel.objects.get(product=milk).on_hand == 27 and StockLevel.objects.get(product=cheese).on_hand == D("8.95")
        assert inv.check_invariants() == []
        kinds = set(Notification.objects.filter(order=order).values_list("kind", flat=True))
        assert {"ORDER_PLACED", "PAYMENT_CONFIRMED", "PICKING_STARTED", "ORDER_READY_DISPATCH", "OUT_FOR_DELIVERY", "ORDER_COMPLETED"} <= kinds

    def test_pickup_order_goes_ready_for_pickup_then_completed(self, milk, pickup_slot, branch, picker):
        c = basket([(milk, 4)])
        number = place(c, {"fulfilment_type": "PICKUP", "branch_id": branch.id, "slot_id": pickup_slot.id, "payment_method": "COD",
                           "contact": {"name": "Pat", "email": "pat@example.com", "phone": "555-0100"}}).json()["number"]
        order = Order.objects.get(number=number)
        ful.start_picking(order, picker)
        ful.pick_item(item_of(order, milk).id, 4, picker)
        ful.finish_picking(order, picker)
        ready = ful.finish_packing(order, picker)
        assert ready.status == "READY_FOR_PICKUP"
        with pytest.raises(Exception) as exc:  # noqa: PT011
            ful.dispatch(order, picker)  # no dispatch for pickup orders
        assert err_code(exc) == "INVALID_ORDER_TRANSITION"
        assert ful.complete(order, picker, collected_amount="10.00").status == "COMPLETED"

    def test_cannot_finish_packing_or_picking_out_of_order(self, milk, slot, picker):
        order = checkout(basket([(milk, 3)]), slot)
        with pytest.raises(Exception) as exc:  # noqa: PT011
            ful.pick_item(item_of(order, milk).id, 3, picker)  # not in PICKING yet
        assert err_code(exc) == "INVALID_ORDER_TRANSITION"
        ful.start_picking(order, picker)
        with pytest.raises(Exception) as exc:  # noqa: PT011
            ful.finish_picking(order, picker)  # item still unpicked
        assert err_code(exc) == "INVALID_STATE"
        with pytest.raises(Exception) as exc:  # noqa: PT011
            ful.finish_packing(order, picker)
        assert err_code(exc) == "INVALID_ORDER_TRANSITION"

    def test_staff_cancel_after_picking_returns_stock_and_refunds_captured_money(self, milk, cheese, slot, picker, manager):
        order = checkout(basket([(milk, 3)]), slot)
        ful.start_picking(order, picker)
        ful.pick_item(item_of(order, milk).id, 3, picker)
        ful.finish_picking(order, picker)
        ful.finish_packing(order, picker)  # card captured
        cancelled = workflow.cancel_order(order, actor=manager, reason="Customer unreachable at door", by_customer=False)
        assert cancelled.status == "CANCELLED"
        assert StockLevel.objects.get(product=milk).on_hand == 30  # picked stock went back on the shelf
        assert StockMovement.objects.filter(kind=MovementKind.RETURN).count() == 1
        payment = Payment.objects.get()
        refund = Refund.objects.get()
        assert refund.status == "SUCCEEDED" and payment.refunded_amount == payment.captured_amount and payment.state == "REFUNDED"
        assert inv.check_invariants() == []


# =============================================================================== Workflow 3: unavailable → substitution
class TestSubstitutionPolicies:
    @pytest.fixture
    def shelf(self, category, product_factory, stock_up):
        original = product_factory(sku="OJ-A", name="Orange juice 1L", price="3.00", category=category)
        pricey = product_factory(sku="OJ-B", name="Premium orange juice 1L", price="4.20", category=category)
        cheap = product_factory(sku="OJ-C", name="Value orange juice 1L", price="2.40", category=category)
        for p in (original, pricey, cheap):
            stock_up(p, 20)
        return original, pricey, cheap

    def order_with(self, shelf, slot, picker, policy, **kw):
        original, *_ = shelf
        c = basket([(original, 3)])
        c.patch("/api/v1/cart/", {"substitution_policy": policy})
        order = checkout(c, slot, **kw)
        ful.start_picking(order, picker)
        return order

    def test_no_substitutes_never_replaces_and_refunds_the_item(self, shelf, slot, picker):
        original, pricey, cheap = shelf
        order = self.order_with(shelf, slot, picker, "NONE")
        it = item_of(order, original)
        ful.mark_unavailable(it.id, picker, "none on shelf")
        it.refresh_from_db()
        assert it.status == "REMOVED" and it.line_total_final == 0  # removed automatically
        with pytest.raises(Exception) as exc:  # noqa: PT011
            ful.propose_substitution(it.id, cheap.id, picker)
        assert err_code(exc) in ("SUBSTITUTION_NOT_ALLOWED", "INVALID_STATE")
        assert not Substitution.objects.exists() and order.items.count() == 1
        assert StockLevel.objects.get(product=original).reserved == 0
        result = ful.finish_picking(order, picker)  # nothing could be supplied → the order is cancelled, not "packed"
        order.refresh_from_db()
        assert result.status == order.status == "CANCELLED" and "None of the items" in order.cancel_reason
        assert Payment.objects.get().state == "VOIDED" and Payment.objects.get().captured_amount == 0  # never charged

    def test_no_substitutes_item_level_override_beats_an_allow_policy(self, shelf, slot, picker):
        original, _, cheap = shelf
        order = self.order_with(shelf, slot, picker, "ALLOW")
        it = item_of(order, original)
        it.substitution_pref = "NONE"
        it.save()
        ful.mark_unavailable(it.id, picker)
        it.refresh_from_db()
        assert it.status == "REMOVED"

    def test_allow_policy_substitutes_immediately_and_never_costs_more(self, shelf, slot, picker):
        original, pricey, cheap = shelf
        order = self.order_with(shelf, slot, picker, "ALLOW")
        it = item_of(order, original)
        ful.mark_unavailable(it.id, picker, "dropped & damaged")
        sub = ful.propose_substitution(it.id, pricey.id, picker, reason="same size, same style")
        assert sub.status == "AUTO_APPROVED" and sub.list_unit_price == D("4.20") and sub.charged_unit_price == D("3.00") and sub.price_difference == D("3.60")
        child = sub.substitute_item
        assert (child.status, child.ordered_qty, child.unit_price) == ("PENDING", 3, D("3.00"))
        assert StockLevel.objects.get(product=pricey).reserved == 3
        ful.pick_item(child.id, 3, picker)
        ful.finish_picking(order, picker)
        order.refresh_from_db()
        it.refresh_from_db()
        assert it.status == "SUBSTITUTED" and order.final_total == D("9.00") + D("4.00")  # pays the ORIGINAL price for the dearer product
        assert Notification.objects.filter(order=order, kind="SUBSTITUTION_DECIDED").exists()

    def test_cheaper_substitute_passes_the_saving_on(self, shelf, slot, picker):
        original, pricey, cheap = shelf
        order = self.order_with(shelf, slot, picker, "ALLOW")
        it = item_of(order, original)
        ful.mark_unavailable(it.id, picker)
        sub = ful.propose_substitution(it.id, cheap.id, picker)
        assert sub.charged_unit_price == D("2.40")
        ful.pick_item(sub.substitute_item.id, 3, picker)
        ful.finish_picking(order, picker)
        order.refresh_from_db()
        assert order.final_total == D("7.20") + D("4.00")

    def test_contact_me_policy_waits_for_the_customer_and_blocks_packing(self, shelf, slot, picker):
        original, pricey, cheap = shelf
        order = self.order_with(shelf, slot, picker, "CONTACT")
        it = item_of(order, original)
        ful.mark_unavailable(it.id, picker)
        sub = ful.propose_substitution(it.id, cheap.id, picker)
        assert sub.status == "AWAITING_CUSTOMER" and sub.substitute_item.status == "PROPOSED"
        assert Notification.objects.filter(order=order, kind="SUBSTITUTION_REQUIRED").exists()
        with pytest.raises(Exception) as exc:  # noqa: PT011
            ful.finish_picking(order, picker)
        assert err_code(exc) == "SUBSTITUTION_REQUIRES_APPROVAL"
        with pytest.raises(Exception) as exc:  # noqa: PT011
            ful.pick_item(sub.substitute_item.id, 3, picker)  # cannot pick an unapproved substitute
        assert err_code(exc) == "INVALID_STATE"
        # the customer sees it on their order page and approves
        client = APIClient()
        view = client.get(f"/api/v1/orders/{order.number}/?token={order.tracking_token}").json()
        pending = view["pending_substitutions"][0]
        assert pending["original"] == "Orange juice 1L" and pending["substitute"] == "Value orange juice 1L" and pending["charged_unit_price"] == "2.40"
        res = client.post(f"/api/v1/orders/{order.number}/substitutions/{pending['id']}/?token={order.tracking_token}", {"approve": True}, format="json")
        assert res.status_code == 200 and res.json()["pending_substitutions"] == []
        ful.pick_item(sub.substitute_item.id, 3, picker)
        ful.finish_picking(order, picker)
        order.refresh_from_db()
        assert order.final_total == D("11.20") and item_of(order, original).status == "SUBSTITUTED"

    def test_customer_can_decline_and_is_not_charged_for_the_item(self, shelf, slot, picker):
        original, pricey, cheap = shelf
        order = self.order_with(shelf, slot, picker, "CONTACT")
        it = item_of(order, original)
        ful.mark_unavailable(it.id, picker)
        sub = ful.propose_substitution(it.id, cheap.id, picker)
        client = APIClient()
        client.post(f"/api/v1/orders/{order.number}/substitutions/{sub.pk}/?token={order.tracking_token}", {"approve": False}, format="json")
        it.refresh_from_db()
        sub.refresh_from_db()
        assert sub.status == "REJECTED" and it.status == "REMOVED" and sub.substitute_item.status == "REMOVED"
        assert StockLevel.objects.get(product=cheap).reserved == 0  # the held substitute stock was released
        again = client.post(f"/api/v1/orders/{order.number}/substitutions/{sub.pk}/?token={order.tracking_token}", {"approve": True}, format="json")
        assert again.status_code == 409  # one answer only

    def test_staff_can_record_a_phone_approval_and_it_is_logged_as_such(self, shelf, slot, picker):
        original, pricey, cheap = shelf
        order = self.order_with(shelf, slot, picker, "CONTACT")
        it = item_of(order, original)
        ful.mark_unavailable(it.id, picker)
        sub = ful.propose_substitution(it.id, cheap.id, picker)
        ful.decide_substitution(sub.pk, True, picker, on_behalf_note="phoned, agreed at 10:42")
        assert order.history.filter(note__contains="on the customer's behalf").exists()

    def test_other_customers_cannot_answer_for_you(self, shelf, slot, picker):
        original, pricey, cheap = shelf
        order = self.order_with(shelf, slot, picker, "CONTACT")
        it = item_of(order, original)
        ful.mark_unavailable(it.id, picker)
        sub = ful.propose_substitution(it.id, cheap.id, picker)
        stranger = APIClient()
        stranger.force_authenticate(make_user(email="evil@example.com"))
        assert stranger.post(f"/api/v1/orders/{order.number}/substitutions/{sub.pk}/", {"approve": True}, format="json").status_code == 404
        assert Substitution.objects.get().status == "AWAITING_CUSTOMER"

    def test_staff_can_remove_when_no_good_substitute_exists(self, shelf, slot, picker):
        original, *_ = shelf
        order = self.order_with(shelf, slot, picker, "ALLOW")
        it = item_of(order, original)
        ful.mark_unavailable(it.id, picker)
        ful.remove_item(it.id, picker, "nothing comparable in stock")
        it.refresh_from_db()
        assert it.status == "REMOVED" and Notification.objects.filter(order=order, kind="ITEM_REMOVED").exists()

    def test_candidate_list_only_contains_eligible_products(self, shelf, slot, picker):
        original, pricey, cheap = shelf
        order = self.order_with(shelf, slot, picker, "ALLOW")
        names = {c["name"] for c in ful.candidate_substitutes(item_of(order, original).id)}
        assert names == {"Premium orange juice 1L", "Value orange juice 1L"}


class TestSubstitutionEligibility:
    @pytest.fixture
    def pair(self, category, product_factory, stock_up):
        a = product_factory(sku="E-A", name="Oat drink A", price="2.00", category=category, allergen_info_complete=True)
        b = product_factory(sku="E-B", name="Oat drink B", price="2.00", category=category, allergen_info_complete=True)
        for p in (a, b):
            stock_up(p, 10)
        return a, b

    def check(self, a, b, branch):
        from apps.catalog.models import Product

        fresh = lambda p: Product.objects.select_related("sale_unit", "net_content_unit").prefetch_related("claims", "allergens").get(pk=p.pk)  # noqa: E731
        return ful.substitution_eligibility(fresh(a), fresh(b), branch.id, D("1"))

    def test_baseline_is_eligible(self, pair, branch):
        assert self.check(*pair, branch) == (True, "")

    def test_cannot_drop_a_verified_dietary_claim(self, pair, branch):
        a, b = pair
        ProductClaim.objects.create(product=a, kind="VEGAN", verified=True, evidence="label")
        ok, why = self.check(a, b, branch)
        assert not ok and "vegan" in why
        ProductClaim.objects.create(product=b, kind="VEGAN", verified=False)  # unverified doesn't count
        assert not self.check(a, b, branch)[0]
        ProductClaim.objects.filter(product=b).update(verified=True)
        assert self.check(a, b, branch)[0]

    def test_cannot_introduce_new_allergens_or_unconfirmed_allergen_data(self, pair, branch):
        a, b = pair
        ProductAllergen.objects.create(product=b, allergen=Allergen.objects.get(code="peanuts"))
        ok, why = self.check(a, b, branch)
        assert not ok and "allergens" in why
        ProductAllergen.objects.filter(product=b).delete()
        b.allergen_info_complete = False
        b.save()
        ok, why = self.check(a, b, branch)
        assert not ok and "confirmed allergen" in why

    def test_must_be_in_stock_same_category_and_same_kind(self, pair, branch, product_factory, units):
        a, b = pair
        StockLevel.objects.filter(product=b).update(on_hand=D("0"))
        assert not self.check(a, b, branch)[0]
        other = product_factory(sku="E-C", name="Different kind", unit="kg", price="2.00")
        assert "sold differently" in self.check(a, other, branch)[1]

    def test_size_must_be_comparable(self, pair, branch, units):
        a, b = pair
        for p, grams in ((a, 500), (b, 2000)):
            p.net_content, p.net_content_unit = D(grams), units["g"]
            p.save()
        assert "different size" in self.check(a, b, branch)[1]


# =============================================================================== refunds & complaints
class TestRefundsAndComplaints:
    @pytest.fixture
    def delivered(self, milk, slot, picker):
        order = checkout(basket([(milk, 4)]), slot)
        ful.start_picking(order, picker)
        ful.pick_item(item_of(order, milk).id, 4, picker)
        ful.finish_picking(order, picker)
        ful.finish_packing(order, picker)
        ful.dispatch(order, picker)
        return ful.complete(order, picker)

    def test_partial_then_full_refund_updates_the_ledger_truthfully(self, delivered, manager):
        order = delivered
        r1 = pay_services.request_refund(order, D("3.00"), "damaged milk", manager, "k1")
        payment = Payment.objects.get()
        assert r1.status == "SUCCEEDED" and payment.refunded_amount == D("3.00") and payment.state == "PARTIALLY_REFUNDED"
        order.refresh_from_db()
        assert order.payment_status == "PARTIALLY_REFUNDED"
        r2 = pay_services.request_refund(order, D("11.00"), "rest", manager, "k2")
        payment.refresh_from_db()
        assert r2.status == "SUCCEEDED" and payment.state == "REFUNDED" and payment.refunded_amount == payment.captured_amount == D("14.00")

    def test_refund_retry_with_same_key_is_not_a_second_refund(self, delivered, manager):
        a = pay_services.request_refund(delivered, D("2.00"), "x", manager, "same-key")
        b = pay_services.request_refund(delivered, D("2.00"), "x", manager, "same-key")
        assert a.pk == b.pk and Refund.objects.count() == 1 and Payment.objects.get().refunded_amount == D("2.00")

    def test_cannot_refund_more_than_was_collected(self, delivered, manager):
        with pytest.raises(Exception) as exc:  # noqa: PT011
            pay_services.request_refund(delivered, D("14.01"), "too much", manager, "k")
        assert err_code(exc) == "REFUND_NOT_ALLOWED" and exc.value.details["refundable"] == "14.00"
        pay_services.request_refund(delivered, D("10.00"), "ok", manager, "k1")
        with pytest.raises(Exception) as exc:  # noqa: PT011
            pay_services.request_refund(delivered, D("5.00"), "over the remainder", manager, "k2")
        assert exc.value.details["refundable"] == "4.00"

    def test_provider_failure_never_marks_a_refund_as_done(self, delivered, manager, monkeypatch):
        from apps.payments.providers.base import ProviderError
        from apps.payments.providers.demo import DemoProvider

        def down(self, payment, amount, key):
            raise ProviderError("timeout")

        monkeypatch.setattr(DemoProvider, "refund", down)
        refund = pay_services.request_refund(delivered, D("2.00"), "x", manager, "k")
        payment = Payment.objects.get()
        assert refund.status == "PENDING" and "unreachable" in refund.failure_message and payment.refunded_amount == 0 and payment.state == "CAPTURED"
        monkeypatch.undo()
        retried = pay_services.request_refund(delivered, D("2.00"), "x", manager, "k")  # same key → provider call is repeated safely
        assert retried.pk == refund.pk  # existing PENDING row returned; settle path is the provider event / retry job
        assert Refund.objects.count() == 1

    def test_pay_on_delivery_refunds_are_manual_and_need_a_reference(self, milk, slot, picker, manager):
        order = checkout(basket([(milk, 4)]), slot, method="COD")
        ful.start_picking(order, picker)
        ful.pick_item(item_of(order, milk).id, 4, picker)
        ful.finish_picking(order, picker)
        ful.finish_packing(order, picker)
        ful.dispatch(order, picker)
        ful.complete(order, picker, collected_amount="14.00")
        refund = pay_services.request_refund(order, D("2.50"), "one bottle leaked", manager, "cod-1")
        assert refund.method == "MANUAL" and refund.status == "PENDING" and Payment.objects.get().refunded_amount == 0  # nothing claimed yet
        with pytest.raises(Exception) as exc:  # noqa: PT011
            pay_services.complete_manual_refund(refund, "  ", manager)
        assert err_code(exc) == "VALIDATION_ERROR"
        done = pay_services.complete_manual_refund(refund, "CASH-RECEIPT-0042", manager)
        assert done.status == "SUCCEEDED" and done.reference == "CASH-RECEIPT-0042" and Payment.objects.get().refunded_amount == D("2.50")

    def test_unpaid_orders_cannot_be_refunded(self, milk, slot, manager):
        order = checkout(basket([(milk, 4)]), slot)
        with pytest.raises(Exception) as exc:  # noqa: PT011
            pay_services.request_refund(order, D("1.00"), "nope", manager, "k")
        assert err_code(exc) == "REFUND_NOT_ALLOWED"

    def test_customer_can_report_a_problem_within_the_window_for_their_own_order(self, delivered, other_user, user):
        client = APIClient()
        client.force_authenticate(delivered.customer or user)
        c = APIClient()
        res = c.post(f"/api/v1/orders/{delivered.number}/cases/?token={delivered.tracking_token}", {"kind": "DAMAGED", "description": "A bottle leaked in transit"}, format="json")
        assert res.status_code == 201 and res.json()["status"] == "OPEN"
        # an item from a different order cannot be attached
        res = c.post(f"/api/v1/orders/{delivered.number}/cases/?token={delivered.tracking_token}", {"kind": "MISSING", "description": "x", "order_item_id": 9999999}, format="json")
        assert res.status_code == 400
        stranger = APIClient()
        stranger.force_authenticate(other_user)
        assert stranger.post(f"/api/v1/orders/{delivered.number}/cases/", {"kind": "OTHER", "description": "hi"}, format="json").status_code == 404

    def test_complaints_are_closed_after_the_window_and_before_receipt(self, delivered, milk, slot, settings_obj):
        from django.utils import timezone

        Order.objects.filter(pk=delivered.pk).update(completed_at=timezone.now() - timezone.timedelta(hours=settings_obj.complaint_window_hours + 1))
        c = APIClient()
        res = c.post(f"/api/v1/orders/{delivered.number}/cases/?token={delivered.tracking_token}", {"kind": "DAMAGED", "description": "late"}, format="json")
        assert res.status_code == 409 and "within 24 hours" in res.json()["error"]["message"]
        fresh = checkout(basket([(milk, 3)]), slot, method="COD")
        res = APIClient().post(f"/api/v1/orders/{fresh.number}/cases/?token={fresh.tracking_token}", {"kind": "OTHER", "description": "early"}, format="json")
        assert res.status_code == 409
