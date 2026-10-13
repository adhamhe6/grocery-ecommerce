import datetime as dt
from decimal import Decimal

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.cart.models import Cart, CartItem
from apps.catalog.models import ProductStatus
from apps.promotions.models import Coupon, Promotion

pytestmark = pytest.mark.django_db
D = Decimal


def add(client, product, quantity):
    return client.post("/api/v1/cart/items/", {"product_id": product.id, "quantity": str(quantity)})


def err(res):
    return res.json()["error"]


@pytest.fixture
def apples(product_factory, stock_up):
    p = product_factory(
        sku="APL",
        name="Gala apples",
        unit="kg",
        price="3.00",
        qty_min=D("0.5"),
        qty_step=D("0.25"),
        qty_max=D("5"),
        is_variable_weight=True,
    )
    stock_up(p, 20)
    return p


@pytest.fixture
def bread(product_factory, stock_up):
    p = product_factory(sku="BRD", name="Sourdough loaf", unit="each", price="4.50", qty_max=D("10"))
    stock_up(p, 6)
    return p


class TestGuestCart:
    def test_guest_cart_persists_through_cookie(self, api, apples, bread):
        res = add(api, apples, "1.5")
        assert res.status_code == 201
        assert res.cookies["gc_cart"]["httponly"]
        add(api, bread, 2)
        cart = api.get("/api/v1/cart/").json()
        assert cart["item_count"] == 2 and cart["can_checkout"] is True
        by_slug = {ln["product"]["slug"]: ln for ln in cart["lines"]}
        assert (
            by_slug["apl"]["quantity"] == "1.5"
            and by_slug["apl"]["line_total"] == "4.50"
            and by_slug["apl"]["is_estimate"] is True
        )
        assert by_slug["brd"]["line_total"] == "9.00"
        assert cart["totals"]["subtotal"] == "13.50" and cart["totals"]["has_estimated_lines"] is True

    def test_empty_cart_without_cookie_creates_nothing(self, api):
        assert api.get("/api/v1/cart/").json()["lines"] == []
        assert Cart.objects.count() == 0

    def test_garbage_cookie_is_ignored(self, api):
        api.cookies["gc_cart"] = "not-a-uuid"
        assert api.get("/api/v1/cart/").status_code == 200

    def test_adding_same_product_sums_and_revalidates_total(self, api, apples):
        add(api, apples, "2")
        assert add(api, apples, "2").status_code == 201
        assert api.get("/api/v1/cart/").json()["lines"][0]["quantity"] == "4"
        over = add(api, apples, "2")  # 6 > qty_max 5
        assert over.status_code == 400 and err(over)["code"] == "INVALID_QUANTITY"
        assert api.get("/api/v1/cart/").json()["lines"][0]["quantity"] == "4"

    def test_client_cannot_inject_prices(self, api, bread):
        res = api.post(
            "/api/v1/cart/items/",
            {"product_id": bread.id, "quantity": "2", "price": "0.01", "unit_price": "0.01", "line_total": "0.02"},
        )
        assert res.status_code == 201
        cart = api.get("/api/v1/cart/").json()
        assert cart["lines"][0]["unit_price"] == "4.50" and cart["totals"]["subtotal"] == "9.00"
        assert CartItem.objects.get().unit_price_seen == D("4.50")


class TestQuantityRules:
    @pytest.mark.parametrize("qty", ["-1", "0", "abc", "0.1", "0.3", "1.2345", "6", "1e3", "NaN", "Infinity"])
    def test_invalid_weight_quantities_rejected(self, api, apples, qty):
        res = add(api, apples, qty)
        assert res.status_code == 400
        assert err(res)["code"] in ("INVALID_QUANTITY", "VALIDATION_ERROR")
        assert CartItem.objects.count() == 0

    @pytest.mark.parametrize("qty", ["0.5", "0.75", "1", "5"])
    def test_valid_weight_quantities_accepted(self, api, apples, qty):
        assert add(api, apples, qty).status_code == 201

    def test_count_units_must_be_whole(self, api, bread):
        res = add(api, bread, "1.5")
        assert res.status_code == 400 and err(res)["code"] == "INVALID_QUANTITY"

    def test_error_explains_the_rule(self, api, apples):
        res = add(api, apples, "0.3")
        assert "steps of 0.25 kg" in err(res)["message"] and err(res)["details"]["step"] == "0.250"

    def test_unknown_inactive_and_hidden_products(self, api, product_factory, stock_up):
        assert add(api, type("P", (), {"id": 999999}), 1).status_code == 404
        for status, available in (
            (ProductStatus.ARCHIVED, True),
            (ProductStatus.INACTIVE, True),
            (ProductStatus.ACTIVE, False),
        ):
            p = product_factory(
                sku=f"X{status}{available}", name=f"Hidden {status}{available}", status=status, is_available=available
            )
            stock_up(p, 5)
            res = add(api, p, 1)
            assert res.status_code == 404 and err(res)["code"] == "PRODUCT_UNAVAILABLE"

    def test_out_of_stock_cannot_be_added_and_over_stock_is_explained(self, api, product_factory, stock_up):
        gone = product_factory(sku="GONE", name="Gone")
        res = add(api, gone, 1)
        assert res.status_code == 409 and err(res)["code"] == "PRODUCT_UNAVAILABLE"
        few = product_factory(sku="FEW", name="Few left")
        stock_up(few, 3)
        res = add(api, few, 5)
        assert (
            res.status_code == 409
            and err(res)["code"] == "INSUFFICIENT_STOCK"
            and err(res)["details"]["max_orderable"] == "3"
        )

    def test_set_quantity_and_remove(self, api, apples, bread):
        add(api, apples, 1)
        add(api, bread, 1)
        api.patch(f"/api/v1/cart/items/{apples.id}/", {"quantity": "2.25"})
        assert {ln["product"]["slug"]: ln["quantity"] for ln in api.get("/api/v1/cart/").json()["lines"]}[
            "apl"
        ] == "2.25"
        assert api.patch(f"/api/v1/cart/items/{bread.id}/", {"quantity": "0"}).json()["item_count"] == 1
        assert api.delete(f"/api/v1/cart/items/{apples.id}/").json()["item_count"] == 0
        assert api.patch(f"/api/v1/cart/items/{apples.id}/", {"quantity": "-3"}).status_code == 400


class TestPromotionsInCart:
    def test_percent_and_multibuy_totals_are_exact(self, api, apples, bread):
        pct = Promotion.objects.create(name="Apples", label="20% off", kind="PERCENT_OFF", percent=D("20"))
        pct.products.add(apples)
        mb = Promotion.objects.create(
            name="Bread 3 for", label="3 for 12.00", kind="MULTIBUY", multibuy_qty=3, multibuy_price=D("12.00")
        )
        mb.products.add(bread)
        add(api, apples, "1.25")
        add(api, bread, 4)
        cart = api.get("/api/v1/cart/").json()
        lines = {ln["product"]["slug"]: ln for ln in cart["lines"]}
        assert lines["apl"]["unit_price"] == "2.40" and lines["apl"]["line_total"] == "3.00"  # 2.40 * 1.25
        assert lines["brd"]["line_total"] == "16.50"  # 3 for 12.00 + 1 at 4.50
        assert cart["totals"]["subtotal"] == "19.50"
        assert cart["totals"]["promo_savings"] == "2.25"  # 0.75 on apples + 1.50 on bread


class TestCoupons:
    @pytest.fixture
    def basket(self, api, apples, bread):
        add(api, apples, "2")  # 6.00
        add(api, bread, 4)  # 18.00
        return api

    def coupon(self, **kw):
        defaults = dict(code="SAVE10", kind="PERCENT", value=D("10"))
        defaults.update(kw)
        return Coupon.objects.create(**defaults)

    def apply(self, client, code):
        return client.post("/api/v1/cart/coupon/", {"code": code})

    def test_percent_coupon_applies_and_shows_in_totals(self, basket):
        self.coupon()
        res = self.apply(basket, "save10")  # case-insensitive
        assert res.status_code == 200
        cart = res.json()
        assert cart["coupon"] == {
            "code": "SAVE10",
            "valid": True,
            "description": "10% off",
            "discount": "2.40",
            "free_delivery": False,
        }
        assert cart["totals"]["coupon_discount"] == "2.40" and cart["totals"]["estimated_total"] == "21.60"

    @pytest.mark.parametrize(
        ("kw", "fragment"),
        [
            (dict(is_active=False), "isn't active"),
            (dict(starts_at=timezone.now() + dt.timedelta(days=1)), "isn't active yet"),
            (dict(ends_at=timezone.now() - dt.timedelta(minutes=1)), "expired"),
            (dict(usage_limit=1, used_count=1), "fully redeemed"),
            (dict(min_order_value=D("100")), "away"),
        ],
    )
    def test_invalid_coupons_are_refused_with_a_reason(self, basket, kw, fragment):
        self.coupon(**kw)
        res = self.apply(basket, "SAVE10")
        assert res.status_code == 400 and err(res)["code"] == "INVALID_COUPON" and fragment in err(res)["message"]
        assert basket.get("/api/v1/cart/").json()["coupon"] is None

    def test_unknown_code(self, basket):
        assert err(self.apply(basket, "NOPE"))["code"] == "INVALID_COUPON"

    def test_fixed_discount_never_exceeds_eligible_subtotal(self, api, bread):
        add(api, bread, 1)  # 4.50
        self.coupon(code="BIG", kind="FIXED", value=D("50"))
        cart = self.apply(api, "BIG").json()
        assert cart["totals"]["coupon_discount"] == "4.50" and cart["totals"]["estimated_total"] == "0.00"

    def test_max_discount_cap(self, basket):
        self.coupon(code="CAPPED", value=D("50"), max_discount=D("5.00"))
        assert self.apply(basket, "CAPPED").json()["totals"]["coupon_discount"] == "5.00"

    def test_category_scope_and_discounted_items_excluded(self, basket, apples, bread):
        self.coupon(code="BREADONLY", scope="PRODUCTS")
        Coupon.objects.get(code="BREADONLY").products.add(bread)
        assert self.apply(basket, "BREADONLY").json()["totals"]["coupon_discount"] == "1.80"  # 10% of bread only
        promo = Promotion.objects.create(name="bread promo", label="25% off", kind="PERCENT_OFF", percent=D("25"))
        promo.products.add(bread)
        res = self.apply(basket, "BREADONLY")  # bread now already discounted → coupon excludes it → nothing eligible
        assert res.status_code == 400 and "doesn't apply" in err(res)["message"]

    def test_per_customer_limit_and_first_order_only(self, api, user, apples, bread, order_factory):
        from apps.promotions.models import CouponRedemption

        self.coupon(code="ONCE", per_customer_limit=1)
        self.coupon(code="FIRST", first_order_only=True, per_customer_limit=None)
        client = APIClient()
        client.force_authenticate(user)
        add(client, bread, 2)
        assert self.apply(client, "ONCE").status_code == 200
        order, _ = order_factory([(bread, 1)], customer=user)
        CouponRedemption.objects.create(coupon=Coupon.objects.get(code="ONCE"), order=order, user=user, amount=D("1"))
        res = self.apply(client, "ONCE")
        assert res.status_code == 400 and "already used" in err(res)["message"]
        res = self.apply(client, "FIRST")
        assert res.status_code == 400 and "first orders" in err(res)["message"]

    def test_free_delivery_coupon_has_no_basket_discount(self, basket):
        self.coupon(code="SHIP", kind="FREE_DELIVERY", value=D("0"))
        cart = self.apply(basket, "SHIP").json()
        assert cart["coupon"]["free_delivery"] is True and cart["totals"]["coupon_discount"] == "0.00"

    def test_coupon_that_expires_later_is_flagged_not_silently_dropped(self, basket):
        c = self.coupon()
        self.apply(basket, "SAVE10")
        c.ends_at = timezone.now() - dt.timedelta(minutes=1)
        c.save()
        cart = basket.get("/api/v1/cart/").json()
        assert (
            cart["coupon"]["valid"] is False
            and "expired" in cart["coupon"]["message"]
            and cart["totals"]["coupon_discount"] == "0.00"
        )

    def test_coupon_can_be_removed(self, basket):
        self.coupon()
        self.apply(basket, "SAVE10")
        assert basket.delete("/api/v1/cart/coupon/").json()["coupon"] is None

    def test_allocation_shares_sum_exactly(self):
        from apps.promotions.coupons import _allocate

        for total, weights in [
            (D("0.10"), [(1, D("3.33")), (2, D("3.33")), (3, D("3.34"))]),
            (D("7.77"), [(1, D("1.01")), (2, D("9.99")), (3, D("0.03"))]),
        ]:
            shares = _allocate(total, weights)
            assert sum(shares.values()) == total and all(v >= 0 for v in shares.values())


class TestLoginMergeAndIsolation:
    def test_guest_basket_merges_into_account_basket_on_login(self, api, user, apples, bread):
        add(api, apples, "2")
        add(api, bread, 1)
        owner = CartItem  # account already holds 4 apples → merged total 6 > max 5 → clipped
        acct = Cart.objects.create(user=user)
        owner.objects.create(cart=acct, product=apples, quantity=D("4"))
        res = api.post("/api/v1/auth/login/", {"email": user.email, "password": "Orchard-Row-9!x"})
        assert res.status_code == 200
        cart = api.get("/api/v1/cart/").json()
        qty = {ln["product"]["slug"]: ln["quantity"] for ln in cart["lines"]}
        assert qty == {"apl": "5", "brd": "1"}
        assert Cart.objects.filter(user__isnull=True, status="MERGED").count() == 1

    def test_registration_also_merges_the_guest_basket(self, api, bread):
        add(api, bread, 3)
        api.post(
            "/api/v1/auth/register/",
            {"email": "fresh@example.com", "password": "Orchard-Row-9!x", "full_name": "Fresh Shopper"},
        )
        assert api.get("/api/v1/cart/").json()["lines"][0]["quantity"] == "3"

    def test_user_cannot_see_another_users_cart(self, user, other_user, bread):
        a, b = APIClient(), APIClient()
        a.force_authenticate(user)
        b.force_authenticate(other_user)
        add(a, bread, 2)
        assert b.get("/api/v1/cart/").json()["lines"] == []
        # a guest holding the *owner's* token cookie gets nothing: carts that belong to users are not reachable by token
        c = APIClient()
        c.cookies["gc_cart"] = str(Cart.objects.get(user=user).token)
        assert c.get("/api/v1/cart/").json()["lines"] == []

    def test_cart_writes_require_csrf_even_for_guests(self, csrf_api, bread):
        res = csrf_api.post("/api/v1/cart/items/", {"product_id": bread.id, "quantity": "1"})
        assert res.status_code == 403
        token = csrf_api.get("/api/v1/auth/csrf/").json()["csrfToken"]
        assert (
            csrf_api.post(
                "/api/v1/cart/items/", {"product_id": bread.id, "quantity": "1"}, HTTP_X_CSRFTOKEN=token
            ).status_code
            == 201
        )


class TestChangesAreExplained:
    def test_price_change_is_surfaced_until_acknowledged(self, api, bread):
        add(api, bread, 2)
        bread.price = D("5.00")
        bread.save()
        line = api.get("/api/v1/cart/").json()["lines"][0]
        assert line["unit_price"] == "5.00" and line["line_total"] == "10.00"
        issue = line["issues"][0]
        assert (
            issue["code"] == "PRICE_CHANGED"
            and issue["from"] == "4.50"
            and issue["to"] == "5.00"
            and issue["blocking"] is False
        )
        api.post("/api/v1/cart/acknowledge/")
        assert api.get("/api/v1/cart/").json()["lines"][0]["issues"] == []

    def test_stock_drop_blocks_checkout_and_fix_explains_what_changed(self, api, bread, apples, stock_up, branch):
        from apps.inventory.models import StockLevel

        add(api, bread, 5)
        add(api, apples, "2")
        StockLevel.objects.filter(product=bread).update(on_hand=D("2"))
        StockLevel.objects.filter(product=apples).update(on_hand=D("0"))
        cart = api.get("/api/v1/cart/").json()
        codes = {ln["product"]["slug"]: [i["code"] for i in ln["issues"]] for ln in cart["lines"]}
        assert codes == {"brd": ["REDUCED_AVAILABILITY"], "apl": ["OUT_OF_STOCK"]} and cart["can_checkout"] is False
        fixed = api.post("/api/v1/cart/fix/").json()
        assert fixed["can_checkout"] is True
        lines = {ln["product"]["slug"]: ln["quantity"] for ln in fixed["lines"]}
        assert lines == {"brd": "2"}
        assert any("Reduced Sourdough loaf from 5 to 2" in n for n in fixed["notices"]) and any(
            "Removed Gala apples" in n for n in fixed["notices"]
        )

    def test_product_deactivated_after_adding(self, api, bread):
        add(api, bread, 1)
        bread.status = ProductStatus.INACTIVE
        bread.save()
        cart = api.get("/api/v1/cart/").json()
        assert cart["can_checkout"] is False
        assert [i["code"] for i in cart["lines"][0]["issues"]] == ["UNAVAILABLE"]


class TestFavoritesComparisonLists:
    def test_favorites_are_private_and_idempotent(self, user, other_user, bread, apples):
        a, b = APIClient(), APIClient()
        a.force_authenticate(user)
        b.force_authenticate(other_user)
        a.post("/api/v1/favorites/", {"product_id": bread.id})
        a.post("/api/v1/favorites/", {"product_id": bread.id})
        assert a.get("/api/v1/favorites/").json()["ids"] == [bread.id]
        assert b.get("/api/v1/favorites/").json()["ids"] == []
        b.delete(f"/api/v1/favorites/{bread.id}/")  # someone else's favourite is untouched
        assert a.get("/api/v1/favorites/").json()["ids"] == [bread.id]
        a.delete(f"/api/v1/favorites/{bread.id}/")
        assert a.get("/api/v1/favorites/").json()["products"] == []
        assert a.post("/api/v1/favorites/", {"product_id": 99999}).status_code == 404

    def test_favorites_require_login(self, api, bread):
        assert api.get("/api/v1/favorites/").status_code == 401

    def test_comparison_uses_unit_prices_only_when_comparable(self, api, product_factory, units, stock_up):
        pasta_a = product_factory(
            sku="PA", name="Pasta A", unit="pack", price="1.50", net_content=D("500"), net_content_unit=units["g"]
        )
        pasta_b = product_factory(
            sku="PB", name="Pasta B", unit="pack", price="2.40", net_content=D("1000"), net_content_unit=units["g"]
        )
        juice = product_factory(
            sku="JU", name="Juice", unit="each", price="2.00", net_content=D("1"), net_content_unit=units["l"]
        )
        for p in (pasta_a, pasta_b, juice):
            stock_up(p, 5)
        ok = api.get(f"/api/v1/compare/?ids={pasta_a.id},{pasta_b.id}").json()
        assert ok["unit_price_comparable"] is True and ok["best_value_id"] == pasta_b.id  # 2.40/kg < 3.00/kg
        mixed = api.get(f"/api/v1/compare/?ids={pasta_a.id},{juice.id}").json()
        assert mixed["unit_price_comparable"] is False and mixed["best_value_id"] is None and mixed["warnings"]

    def test_comparison_is_capped_and_ignores_junk(self, api, product_factory, stock_up):
        ps = [product_factory(sku=f"C{i}", name=f"C{i}") for i in range(6)]
        for p in ps:
            stock_up(p, 1)
        ids = ",".join([str(p.id) for p in ps] + ["abc", "-3"])
        assert len(api.get(f"/api/v1/compare/?ids={ids}").json()["products"]) == 4

    def test_saved_comparison_roundtrip(self, auth_api, bread, apples):
        assert auth_api.put("/api/v1/account/comparison/", {"ids": [bread.id, apples.id, 424242]}).json()["ids"] == [
            bread.id,
            apples.id,
        ]
        assert auth_api.get("/api/v1/account/comparison/").json()["ids"] == [bread.id, apples.id]

    def test_shopping_lists_are_private_and_move_to_cart_with_validation(self, user, other_user, bread, apples):
        a, b = APIClient(), APIClient()
        a.force_authenticate(user)
        b.force_authenticate(other_user)
        lst = a.post("/api/v1/lists/", {"name": "Weekly"}).json()
        a.put(f"/api/v1/lists/{lst['id']}/items/{bread.id}/", {"quantity": "2"})
        a.put(
            f"/api/v1/lists/{lst['id']}/items/{apples.id}/", {"quantity": "0.3"}
        )  # invalid step → skipped when moving to cart
        assert b.get(f"/api/v1/lists/{lst['id']}/").status_code == 404
        assert b.delete(f"/api/v1/lists/{lst['id']}/").status_code == 404
        assert a.post("/api/v1/lists/", {"name": "weekly"}).status_code == 400  # duplicate name
        res = a.post(f"/api/v1/lists/{lst['id']}/add-to-cart/").json()
        assert (
            res["list_result"]["added"] == ["Sourdough loaf"]
            and res["list_result"]["skipped"][0]["name"] == "Gala apples"
        )


class TestReorder:
    def test_reorder_revalidates_price_and_stock(self, user, other_user, bread, apples, order_factory, stock_up):
        from apps.inventory.models import StockLevel

        order, _ = order_factory([(bread, 3), (apples, D("1.5"))], customer=user, status="COMPLETED")
        bread.price = D("5.00")
        bread.save()
        StockLevel.objects.filter(product=apples).update(on_hand=D("0"))
        client = APIClient()
        client.force_authenticate(user)
        res = client.post(f"/api/v1/cart/reorder/{order.number}/").json()
        assert [a["name"] for a in res["reorder"]["added"]] == ["Sourdough loaf"] and res["reorder"]["skipped"][0][
            "name"
        ] == "Gala apples"
        assert res["lines"][0]["unit_price"] == "5.00"  # today's price, not the historic one
        stranger = APIClient()
        stranger.force_authenticate(other_user)
        assert stranger.post(f"/api/v1/cart/reorder/{order.number}/").status_code == 404


class TestCartAgreesWithCheckoutAndStorefront:
    def test_a_product_in_a_switched_off_category_blocks_the_basket_instead_of_failing_at_checkout(
        self, api, product_factory, stock_up, category
    ):
        p = product_factory(sku="CAT1", name="Pear", category=category)
        stock_up(p, 10)
        assert api.post("/api/v1/cart/items/", {"product_id": p.id, "quantity": "1"}, format="json").status_code == 201
        type(category).objects.filter(pk=category.pk).update(is_active=False)
        cart = api.get("/api/v1/cart/").json()
        assert cart["can_checkout"] is False
        assert [i["code"] for i in cart["lines"][0]["issues"]] == ["UNAVAILABLE"]

    def test_a_product_whose_parent_department_is_switched_off_is_unavailable_too(
        self, api, product_factory, stock_up, category
    ):
        p = product_factory(sku="CAT2", name="Plum", category=category)
        stock_up(p, 10)
        api.post("/api/v1/cart/items/", {"product_id": p.id, "quantity": "1"}, format="json")
        type(category).objects.filter(pk=category.parent_id).update(is_active=False)
        assert api.get("/api/v1/cart/").json()["can_checkout"] is False

    def test_a_reorder_line_reduced_for_stock_is_reported_once_as_adjusted_not_also_as_added(
        self, user, order_factory, product_factory, stock_up
    ):
        from rest_framework.test import APIClient

        scarce = product_factory(sku="SCR", name="Scarce jam", price="3.00")
        plenty = product_factory(sku="PLN", name="Plenty tea", price="2.00")
        stock_up(scarce, 2)
        stock_up(plenty, 50)
        order, _ = order_factory([(scarce, 6), (plenty, 4)], customer=user, status="COMPLETED")
        client = APIClient()
        client.force_authenticate(user)
        result = client.post(f"/api/v1/cart/reorder/{order.number}/").json()["reorder"]
        assert [a["name"] for a in result["adjusted"]] == ["Scarce jam"]
        assert result["adjusted"][0]["added"] == "2.000" or result["adjusted"][0]["added"] == "2"
        assert [a["name"] for a in result["added"]] == ["Plenty tea"]
