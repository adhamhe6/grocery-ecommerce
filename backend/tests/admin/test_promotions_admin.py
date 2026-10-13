"""Staff marketing API: automatic promotions and coupons (`promotions.manage`)."""

import datetime as dt
from decimal import Decimal

import pytest
from django.core.cache import cache
from django.utils import timezone

from apps.catalog.models import Category
from apps.core import rbac
from apps.core.models import AuditLog
from apps.orders.models import Order
from apps.promotions.models import Coupon, CouponRedemption, Promotion
from tests.admin.conftest import results
from tests.admin.helpers import STAFF_ROLES, details

pytestmark = pytest.mark.django_db
D = Decimal
PROMOS = "/api/v1/admin/promotions/"
COUPONS = "/api/v1/admin/coupons/"
MARKETERS = {"SUPER_ADMIN", "ADMIN", "MARKETING_MANAGER"}


def audits(action):
    return AuditLog.objects.filter(action=action)


@pytest.fixture
def apple(product_factory, stock_up):
    p = product_factory(sku="APL", name="Apple", price="2.00", unit="each")
    stock_up(p, 100)
    return p


def percent(apple, **kw):
    return {
        "name": "Apple week",
        "label": "20% off",
        "kind": "PERCENT_OFF",
        "percent": "20",
        "products": [apple.id],
        **kw,
    }


class TestPromotionAccess:
    def test_matrix_matches_rbac(self):
        assert {r for r in rbac.STAFF_ROLES if rbac.role_has(r, "promotions.manage")} == MARKETERS

    @pytest.mark.parametrize("role", STAFF_ROLES)
    def test_only_promotion_managers_can_read_or_write(self, role, staff, apple):
        c = staff(role)
        allowed = role in MARKETERS
        assert c.get(PROMOS).status_code == (200 if allowed else 403)
        assert c.get(COUPONS).status_code == (200 if allowed else 403)
        res = c.post(PROMOS, percent(apple), format="json")
        assert res.status_code == (201 if allowed else 403), (role, res.content)
        res = c.post(COUPONS, {"code": f"C{role}", "kind": "PERCENT", "value": "10"}, format="json")
        assert res.status_code == (201 if allowed else 403), (role, res.content)

    def test_anonymous_and_customers_are_refused(self, api, user, auth_api):
        assert api.get(PROMOS).status_code == 401 and api.get(COUPONS).status_code == 401
        assert auth_api.get(PROMOS).status_code == 403 and auth_api.get(COUPONS).status_code == 403


class TestPromotionValidation:
    @pytest.mark.parametrize(
        ("overrides", "field"),
        [
            ({"percent": "0"}, "percent"),
            ({"percent": "100.01"}, "percent"),
            ({"percent": "-5"}, "percent"),
            ({"percent": None}, "percent"),
            ({"kind": "AMOUNT_OFF", "percent": None, "amount_off": "0"}, "amount_off"),
            ({"kind": "AMOUNT_OFF", "percent": None, "amount_off": "-1"}, "amount_off"),
            ({"kind": "AMOUNT_OFF", "percent": None}, "amount_off"),
            ({"kind": "MULTIBUY", "percent": None, "multibuy_qty": 1, "multibuy_price": "3"}, "multibuy_qty"),
            ({"kind": "MULTIBUY", "percent": None, "multibuy_qty": 3, "multibuy_price": "-1"}, "multibuy_price"),
            ({"kind": "MULTIBUY", "percent": None, "multibuy_price": "3"}, "multibuy_qty"),
            ({"products": []}, "products"),
            ({"scope": "CATEGORIES"}, "categories"),  # products supplied but the scope is categories
            ({"scope": "BRANDS", "products": []}, "brands"),
            ({"starts_at": "2026-12-02T10:00:00Z", "ends_at": "2026-12-01T10:00:00Z"}, "ends_at"),
            ({"starts_at": "2026-12-02T10:00:00Z", "ends_at": "2026-12-02T10:00:00Z"}, "ends_at"),
            ({"amount_off": "1.00"}, "amount_off"),  # belongs to another kind
            ({"label": ""}, "label"),
            ({"kind": "FREEBIE"}, "kind"),
        ],
    )
    def test_rules_per_kind_and_scope(self, admin, apple, overrides, field):
        res = admin.post(PROMOS, percent(apple, **overrides), format="json")
        assert res.status_code == 400 and res.json()["error"]["code"] == "VALIDATION_ERROR"
        assert field in details(res), res.content
        assert not Promotion.objects.exists()

    def test_valid_multibuy_amount_and_percent_are_accepted(self, admin, apple):
        assert admin.post(PROMOS, percent(apple, percent="100"), format="json").status_code == 201
        amount = percent(apple, kind="AMOUNT_OFF", percent=None, amount_off="0.50", label="50p off")
        assert admin.post(PROMOS, amount, format="json").status_code == 201
        multi = percent(apple, kind="MULTIBUY", percent=None, multibuy_qty=3, multibuy_price="5.00", label="3 for 5")
        res = admin.post(PROMOS, multi, format="json")
        assert res.status_code == 201 and res.json()["multibuy_qty"] == 3 and res.json()["multibuy_price"] == "5.00"

    def test_scope_targets_are_validated_against_the_scope(self, admin, apple, category, brand):
        by_category = {
            "name": "Fruit",
            "label": "10% off",
            "kind": "PERCENT_OFF",
            "percent": "10",
            "scope": "CATEGORIES",
            "categories": [category.id],
        }
        assert admin.post(PROMOS, by_category, format="json").status_code == 201
        by_brand = {**by_category, "scope": "BRANDS", "brands": [brand.id], "categories": []}
        assert admin.post(PROMOS, by_brand, format="json").status_code == 201
        assert admin.post(PROMOS, {**by_brand, "brands": [999999]}, format="json").status_code == 400
        mixed = admin.post(PROMOS, {**by_brand, "products": [apple.id]}, format="json")
        assert mixed.status_code == 400 and "products" in details(mixed)

    def test_server_owned_fields_are_not_assignable(self, admin, apple):
        res = admin.post(PROMOS, percent(apple, is_demo=True, id=99, created_at="2001-01-01T00:00:00Z"), format="json")
        promo = Promotion.objects.get()
        assert res.status_code == 201 and promo.is_demo is False and promo.id != 99 and promo.created_at.year != 2001


class TestPromotionBehaviour:
    def test_create_update_delete_are_audited_with_targets_and_before_after(self, admin, apple, product_factory):
        pear = product_factory(sku="PER", name="Pear")
        created = admin.post(PROMOS, percent(apple), format="json").json()
        assert created["products"] == [apple.id] and created["is_running"] is True
        assert audits("promotion.created").get().after["products"] == [apple.id]
        res = admin.patch(
            f"{PROMOS}{created['id']}/",
            {"percent": "25", "label": "25% off", "products": [apple.id, pear.id]},
            format="json",
        )
        assert res.status_code == 200 and sorted(res.json()["products"]) == sorted([apple.id, pear.id])
        entry = audits("promotion.updated").get()
        assert entry.before["percent"] == "20.00" and entry.after["percent"] == "25.00"
        assert entry.before["products"] == [apple.id] and sorted(entry.after["products"]) == sorted([apple.id, pear.id])
        assert admin.delete(f"{PROMOS}{created['id']}/").status_code == 204
        assert audits("promotion.deleted").get().before["name"] == "Apple week"

    def test_changing_the_kind_clears_the_old_kinds_fields(self, admin, apple):
        pk = admin.post(PROMOS, percent(apple), format="json").json()["id"]
        res = admin.patch(
            f"{PROMOS}{pk}/", {"kind": "AMOUNT_OFF", "amount_off": "0.50", "label": "50p off"}, format="json"
        )
        assert res.status_code == 200 and res.json()["percent"] is None and res.json()["amount_off"] == "0.50"
        assert (
            admin.patch(f"{PROMOS}{pk}/", {"kind": "MULTIBUY"}, format="json").status_code == 400
        )  # needs its own fields

    def test_changing_the_scope_requires_targets_and_drops_the_old_ones(self, admin, apple, category):
        pk = admin.post(PROMOS, percent(apple), format="json").json()["id"]
        no_targets = admin.patch(f"{PROMOS}{pk}/", {"scope": "CATEGORIES"}, format="json")
        assert no_targets.status_code == 400 and "categories" in details(no_targets)
        res = admin.patch(f"{PROMOS}{pk}/", {"scope": "CATEGORIES", "categories": [category.id]}, format="json")
        assert res.status_code == 200 and res.json()["products"] == [] and res.json()["categories"] == [category.id]

    def test_storefront_prices_follow_every_save_immediately(self, admin, apple, api):
        def card():
            return next(p for p in api.get("/api/v1/products/").json()["results"] if p["sku"] == "APL")

        assert card()["promotion"] is None and card()["price"] == "2.00"  # warms the 30 s promotion index
        version = cache.get("ver:promos")
        pk = admin.post(PROMOS, percent(apple), format="json").json()["id"]
        assert cache.get("ver:promos") != version
        assert card()["price"] == "1.60" and card()["promotion"]["label"] == "20% off"
        admin.patch(f"{PROMOS}{pk}/", {"percent": "50", "label": "Half price"}, format="json")
        assert card()["price"] == "1.00"
        admin.patch(f"{PROMOS}{pk}/", {"is_active": False}, format="json")
        assert card()["promotion"] is None
        admin.patch(f"{PROMOS}{pk}/", {"is_active": True}, format="json")
        assert card()["promotion"] is not None
        admin.delete(f"{PROMOS}{pk}/")
        assert card()["promotion"] is None and card()["price"] == "2.00"

    def test_changing_targets_invalidates_the_caches_too(self, admin, apple, product_factory, stock_up, api):
        pear = product_factory(sku="PER", name="Pear", price="3.00", unit="each")
        stock_up(pear, 10)
        pk = admin.post(PROMOS, percent(apple), format="json").json()["id"]
        prices = lambda: {p["sku"]: p["price"] for p in api.get("/api/v1/products/").json()["results"]}  # noqa: E731
        assert prices()["PER"] == "3.00"
        admin.patch(f"{PROMOS}{pk}/", {"products": [apple.id, pear.id]}, format="json")
        assert prices()["PER"] == "2.40"

    def test_list_filters(self, admin, apple):
        admin.post(PROMOS, percent(apple), format="json")
        past = percent(apple, name="Old", starts_at="2020-01-01T00:00:00Z", ends_at="2020-02-01T00:00:00Z")
        admin.post(PROMOS, past, format="json")
        assert len(results(admin.get(PROMOS))) == 2
        assert [p["name"] for p in results(admin.get(PROMOS, {"running": "true"}))] == ["Apple week"]
        assert [p["name"] for p in results(admin.get(PROMOS, {"search": "old"}))] == ["Old"]
        assert results(admin.get(PROMOS, {"kind": "multibuy"})) == []
        assert (
            "warnings" in results(admin.get(PROMOS))[0] and results(admin.get(PROMOS))[0]["warnings"] == []
        )  # computed on detail only


class TestPromotionWarnings:
    def test_multibuy_that_costs_more_than_shelf_price_warns(self, admin, apple):
        # 3 apples at 2.00 = 6.00 on the shelf; "3 for 7.00" is worse, so the engine would silently ignore it
        body = percent(apple, kind="MULTIBUY", percent=None, multibuy_qty=3, multibuy_price="7.00", label="3 for 7")
        res = admin.post(PROMOS, body, format="json")
        assert res.status_code == 201
        assert len(res.json()["warnings"]) == 1
        assert "Apple (2.00)" in res.json()["warnings"][0] and "doesn't save money" in res.json()["warnings"][0]

    def test_a_saving_multibuy_has_no_warnings(self, admin, apple):
        body = percent(apple, kind="MULTIBUY", percent=None, multibuy_qty=3, multibuy_price="5.00", label="3 for 5")
        assert admin.post(PROMOS, body, format="json").json()["warnings"] == []

    def test_percent_that_rounds_to_no_saving_warns(self, admin, product_factory):
        cheap = product_factory(sku="CHP", name="Cheap sweet", price="0.30", unit="each")
        res = admin.post(PROMOS, percent(cheap, percent="1", label="1% off"), format="json")
        assert res.status_code == 201 and "does not lower the price" in res.json()["warnings"][0]

    def test_amount_off_that_makes_products_free_or_does_nothing_warns(self, admin, product_factory):
        freebie = product_factory(sku="FRE", name="Sample", price="0.40", unit="each")
        res = admin.post(
            PROMOS, percent(freebie, kind="AMOUNT_OFF", percent=None, amount_off="0.50", label="50p off"), format="json"
        )
        assert any("become free" in w for w in res.json()["warnings"])
        zero = product_factory(sku="ZER", name="Free gift", price="0.00", unit="each")
        res = admin.post(
            PROMOS, percent(zero, kind="AMOUNT_OFF", percent=None, amount_off="0.50", label="50p off"), format="json"
        )
        assert any("does not lower the price" in w for w in res.json()["warnings"])

    def test_warnings_are_recomputed_on_update_and_detail(self, admin, apple):
        body = percent(apple, kind="MULTIBUY", percent=None, multibuy_qty=3, multibuy_price="7.00", label="3 for 7")
        pk = admin.post(PROMOS, body, format="json").json()["id"]
        assert admin.get(f"{PROMOS}{pk}/").json()["warnings"]
        assert admin.patch(f"{PROMOS}{pk}/", {"multibuy_price": "4.00"}, format="json").json()["warnings"] == []

    def test_ended_and_empty_promotions_are_flagged(self, admin, apple):
        past = percent(apple, starts_at="2020-01-01T00:00:00Z", ends_at="2020-02-01T00:00:00Z")
        assert any("already ended" in w for w in admin.post(PROMOS, past, format="json").json()["warnings"])
        empty_cat = Category.objects.create(name="Empty", slug="empty")
        body = {
            "name": "Nothing",
            "label": "10%",
            "kind": "PERCENT_OFF",
            "percent": "10",
            "scope": "CATEGORIES",
            "categories": [empty_cat.id],
        }
        assert any("No active products" in w for w in admin.post(PROMOS, body, format="json").json()["warnings"])


# =============================================================================================== coupons
def coupon(**kw):
    return {"code": "save10", "kind": "PERCENT", "value": "10", **kw}


class TestCouponRules:
    def test_codes_are_uppercased_trimmed_and_unique_ignoring_case(self, admin):
        res = admin.post(COUPONS, coupon(code="  save10 "), format="json")
        assert res.status_code == 201 and res.json()["code"] == "SAVE10" and Coupon.objects.get().code == "SAVE10"
        dup = admin.post(COUPONS, coupon(code="Save10"), format="json")
        assert dup.status_code == 400 and "code" in details(dup)
        other = admin.post(COUPONS, coupon(code="SAVE20"), format="json").json()["id"]
        clash = admin.patch(f"{COUPONS}{other}/", {"code": "save10"}, format="json")
        assert clash.status_code == 400 and "code" in details(clash)

    @pytest.mark.parametrize("code", ["", "ab", "has space", "bad!char", "x" * 41])
    def test_code_shape(self, admin, code):
        res = admin.post(COUPONS, coupon(code=code), format="json")
        assert res.status_code == 400 and "code" in details(res)

    @pytest.mark.parametrize(
        ("overrides", "field"),
        [
            ({"value": "0"}, "value"),
            ({"value": "101"}, "value"),
            ({"kind": "FIXED", "value": "0"}, "value"),
            ({"kind": "FIXED", "value": "-3"}, "value"),
            ({"max_discount": "-1"}, "max_discount"),
            ({"kind": "FIXED", "value": "5", "max_discount": "3"}, "max_discount"),
            ({"min_order_value": "-1"}, "min_order_value"),
            ({"usage_limit": 0}, "usage_limit"),
            ({"per_customer_limit": 0}, "per_customer_limit"),
            ({"scope": "PRODUCTS"}, "products"),
            ({"scope": "CATEGORIES"}, "categories"),
            ({"kind": "FREE_DELIVERY", "value": "0", "scope": "PRODUCTS"}, "scope"),
            ({"starts_at": "2026-12-02T00:00:00Z", "ends_at": "2026-12-01T00:00:00Z"}, "ends_at"),
        ],
    )
    def test_value_scope_and_limit_validation(self, admin, overrides, field):
        res = admin.post(COUPONS, coupon(**overrides), format="json")
        assert res.status_code == 400 and field in details(res), res.content
        assert not Coupon.objects.exists()

    def test_scope_targets_are_validated(self, admin, apple, category):
        assert (
            admin.post(COUPONS, coupon(code="PROD1", scope="PRODUCTS", products=[apple.id]), format="json").status_code
            == 201
        )
        assert (
            admin.post(
                COUPONS, coupon(code="CAT1", scope="CATEGORIES", categories=[category.id]), format="json"
            ).status_code
            == 201
        )
        assert (
            admin.post(COUPONS, coupon(code="PROD2", scope="PRODUCTS", products=[999999]), format="json").status_code
            == 400
        )
        wrong = admin.post(COUPONS, coupon(code="PROD3", scope="ALL", products=[apple.id]), format="json")
        assert wrong.status_code == 400 and "products" in details(wrong)
        both = admin.post(
            COUPONS,
            coupon(code="PROD4", scope="PRODUCTS", products=[apple.id], excluded_products=[apple.id]),
            format="json",
        )
        assert both.status_code == 400 and "excluded_products" in details(both)

    def test_a_percentage_cap_is_dropped_when_the_coupon_stops_being_a_percentage(self, admin):
        pk = admin.post(COUPONS, coupon(code="CAPPED", max_discount="5.00"), format="json").json()["id"]
        assert Coupon.objects.get(pk=pk).max_discount == D("5.00")
        res = admin.patch(f"{COUPONS}{pk}/", {"kind": "FIXED", "value": "3.00"}, format="json")
        assert res.status_code == 200 and res.json()["max_discount"] is None

    def test_free_delivery_ignores_any_value(self, admin):
        res = admin.post(COUPONS, coupon(code="SHIPFREE", kind="FREE_DELIVERY", value="15"), format="json")
        assert res.status_code == 201 and res.json()["value"] == "0.00"

    def test_server_owned_fields_are_not_assignable(self, admin):
        res = admin.post(COUPONS, coupon(used_count=50, is_demo=True), format="json")
        c = Coupon.objects.get()
        assert res.status_code == 201 and c.used_count == 0 and c.is_demo is False
        admin.patch(f"{COUPONS}{c.id}/", {"used_count": 7}, format="json")
        c.refresh_from_db()
        assert c.used_count == 0


def place(order_factory, product, email):
    order, _ = order_factory([(product, 1)])
    Order.objects.filter(pk=order.pk).update(contact_email=email)
    return order


@pytest.fixture
def redeemed(admin, order_factory, product_factory):
    """A coupon that one order has already used."""
    pk = admin.post(COUPONS, coupon(code="WELCOME", usage_limit=5), format="json").json()["id"]
    c = Coupon.objects.get(pk=pk)
    order = place(order_factory, product_factory(sku="R1", name="Redeemed thing"), "alice@example.com")
    CouponRedemption.objects.create(coupon=c, order=order, email="alice@example.com", amount=D("1.50"))
    Coupon.objects.filter(pk=c.pk).update(used_count=1)
    c.refresh_from_db()
    return c


class TestCouponImmutability:
    def test_code_cannot_change_once_redeemed(self, admin, redeemed):
        res = admin.patch(f"{COUPONS}{redeemed.id}/", {"code": "RENAMED"}, format="json")
        assert res.status_code == 400 and "already been redeemed" in str(details(res)["code"])
        redeemed.refresh_from_db()
        assert redeemed.code == "WELCOME"
        same = admin.patch(f"{COUPONS}{redeemed.id}/", {"code": "welcome", "description": "Thanks"}, format="json")
        assert same.status_code == 200 and same.json()["is_redeemed"] is True  # same code (any case) is fine

    def test_voided_redemptions_still_pin_the_code(self, admin, redeemed):
        CouponRedemption.objects.update(status="VOID")
        Coupon.objects.filter(pk=redeemed.pk).update(used_count=0)
        assert admin.patch(f"{COUPONS}{redeemed.id}/", {"code": "OTHER"}, format="json").status_code == 400

    def test_unredeemed_codes_can_be_renamed(self, admin):
        pk = admin.post(COUPONS, coupon(code="TYPO"), format="json").json()["id"]
        res = admin.patch(f"{COUPONS}{pk}/", {"code": "fixed"}, format="json")
        assert res.status_code == 200 and res.json()["code"] == "FIXED"
        assert audits("coupon.updated").get().before["code"] == "TYPO"

    def test_usage_limit_cannot_drop_below_the_times_it_was_used(self, admin, redeemed):
        Coupon.objects.filter(pk=redeemed.pk).update(used_count=3)
        low = admin.patch(f"{COUPONS}{redeemed.id}/", {"usage_limit": 2}, format="json")
        assert low.status_code == 400 and "3 time" in str(details(low)["usage_limit"])
        assert admin.patch(f"{COUPONS}{redeemed.id}/", {"usage_limit": 3}, format="json").status_code == 200
        assert (
            admin.patch(f"{COUPONS}{redeemed.id}/", {"usage_limit": None}, format="json").status_code == 200
        )  # unlimited

    def test_redeemed_coupons_are_deactivated_not_deleted(self, admin, redeemed):
        res = admin.delete(f"{COUPONS}{redeemed.id}/")
        assert res.status_code == 409 and res.json()["error"]["code"] == "INVALID_STATE"
        assert admin.patch(f"{COUPONS}{redeemed.id}/", {"is_active": False}, format="json").status_code == 200
        fresh = admin.post(COUPONS, coupon(code="UNUSED"), format="json").json()["id"]
        assert (
            admin.delete(f"{COUPONS}{fresh}/").status_code == 204
            and audits("coupon.deleted").get().before["code"] == "UNUSED"
        )

    def test_audit_trail_for_create_and_update(self, admin):
        pk = admin.post(COUPONS, coupon(code="TRAIL", value="5"), format="json").json()["id"]
        admin.patch(f"{COUPONS}{pk}/", {"value": "15"}, format="json")
        assert audits("coupon.created").get().after["code"] == "TRAIL"
        entry = audits("coupon.updated").get()
        assert entry.before["value"] == "5.00" and entry.after["value"] == "15.00" and entry.actor == admin.user


class TestCouponStats:
    def test_counts_totals_and_masked_recent_redemptions(self, admin, redeemed, order_factory, product_factory):
        thing = product_factory(sku="R2", name="Another")
        order2 = place(order_factory, thing, "bob.smith@shop.example.org")
        CouponRedemption.objects.create(
            coupon=redeemed, order=order2, email="bob.smith@shop.example.org", amount=D("2.25"), status="VOID"
        )
        res = admin.get(f"{COUPONS}{redeemed.id}/stats/")
        assert res.status_code == 200
        data = res.json()
        assert data["redemptions"] == {"active": 1, "void": 1} and data["used_count"] == 1 and data["usage_limit"] == 5
        assert (
            data["total_discount"] == "1.50" and data["voided_discount"] == "2.25"
        )  # voided discounts were given back
        masked = {r["email"] for r in data["last_redemptions"]}
        assert masked == {"a***@example.com", "b***@shop.example.org"}
        assert "alice" not in res.content.decode() and "bob.smith" not in res.content.decode()
        assert {r["order_number"] for r in data["last_redemptions"]} == {
            order2.number,
            CouponRedemption.objects.get(status="ACTIVE").order.number,
        }

    def test_only_the_last_twenty_are_listed_newest_first(self, admin, redeemed, order_factory, product_factory):
        thing = product_factory(sku="R3", name="Bulk")
        for n in range(24):
            order = place(order_factory, thing, f"c{n}@example.com")
            CouponRedemption.objects.create(coupon=redeemed, order=order, email=f"c{n}@example.com", amount=D("1.00"))
        data = admin.get(f"{COUPONS}{redeemed.id}/stats/").json()
        assert len(data["last_redemptions"]) == 20 and data["redemptions"]["active"] == 25
        assert data["last_redemptions"][0]["email"] == "c***@example.com"
        stamps = [r["created_at"] for r in data["last_redemptions"]]
        assert stamps == sorted(stamps, reverse=True)

    def test_empty_coupon_and_staff_without_the_capability(self, admin, staff):
        pk = admin.post(COUPONS, coupon(code="NEWONE"), format="json").json()["id"]
        data = admin.get(f"{COUPONS}{pk}/stats/").json()
        assert (
            data["redemptions"] == {"active": 0, "void": 0}
            and data["total_discount"] == "0.00"
            and data["last_redemptions"] == []
        )
        assert staff("STORE_MANAGER").get(f"{COUPONS}{pk}/stats/").status_code == 403

    def test_list_filters_and_search(self, admin):
        admin.post(COUPONS, coupon(code="SPRING"), format="json")
        admin.post(COUPONS, coupon(code="SHIPPING", kind="FREE_DELIVERY", value="0", is_active=False), format="json")
        assert [c["code"] for c in results(admin.get(COUPONS, {"search": "spr"}))] == ["SPRING"]
        assert [c["code"] for c in results(admin.get(COUPONS, {"kind": "free_delivery"}))] == ["SHIPPING"]
        assert [c["code"] for c in results(admin.get(COUPONS, {"is_active": "false"}))] == ["SHIPPING"]


def test_mutating_the_window_of_a_running_promotion_keeps_it_visible(admin, apple):
    now = timezone.now()
    body = percent(
        apple, starts_at=(now - dt.timedelta(days=1)).isoformat(), ends_at=(now + dt.timedelta(days=1)).isoformat()
    )
    assert admin.post(PROMOS, body, format="json").json()["is_running"] is True
