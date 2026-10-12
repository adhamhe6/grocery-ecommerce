import datetime as dt
from decimal import Decimal

import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.catalog.models import (
    Allergen,
    AllergenLevel,
    Brand,
    Category,
    NutritionFact,
    Product,
    ProductAllergen,
    ProductClaim,
    ProductStatus,
)
from apps.inventory.models import Batch, BatchStatus, QualityStatus, StockLevel
from apps.promotions.models import Promotion

pytestmark = pytest.mark.django_db


def stock(product, branch, on_hand="10", reserved="0", threshold="0"):
    return StockLevel.objects.create(
        product=product,
        branch=branch,
        on_hand=Decimal(on_hand),
        reserved=Decimal(reserved),
        low_stock_threshold=Decimal(threshold),
    )


def listing(api, **params):
    res = api.get("/api/v1/products/", params)
    assert res.status_code == 200, res.content
    return res.json()


def names(payload):
    return [r["name"] for r in payload["results"]]


# ------------------------------------------------------------------ constraints & unit prices
class TestProductRules:
    def test_sku_and_slug_unique(self, product_factory):
        product_factory(sku="A1", name="Apple", slug="apple")
        with pytest.raises(IntegrityError), transaction.atomic():
            product_factory(sku="A1", name="Other", slug="other")
        with pytest.raises(IntegrityError), transaction.atomic():
            product_factory(sku="A2", name="Apple 2", slug="apple")

    @pytest.mark.parametrize(
        "kw", [dict(price="-1"), dict(qty_min="0"), dict(qty_step="0"), dict(qty_min="2", qty_max="1")]
    )
    def test_check_constraints(self, product_factory, kw):
        kw = {k: Decimal(v) for k, v in kw.items()}
        with pytest.raises(IntegrityError), transaction.atomic():
            product_factory(sku="BAD", name="Bad", **kw)

    def test_variable_weight_requires_weight_unit(self, product_factory):
        p = product_factory(sku="VW", name="Chicken", unit="each", is_variable_weight=True)
        with pytest.raises(ValidationError):
            p.full_clean()
        ok = product_factory(sku="VW2", name="Bananas", unit="kg", is_variable_weight=True)
        ok.full_clean()

    def test_unit_price_per_kg_for_weight_and_pack(self, product_factory, units):
        loose = product_factory(sku="K1", name="Apples", unit="kg", price="3.20")
        assert loose.unit_price == {"amount": Decimal("3.20"), "per": "kg", "kind": "WEIGHT"}
        pack = product_factory(
            sku="P1", name="Pasta", unit="pack", price="1.50", net_content=Decimal("500"), net_content_unit=units["g"]
        )
        assert pack.unit_price["amount"] == Decimal("3.00") and pack.unit_price["per"] == "kg"
        milk = product_factory(
            sku="M1", name="Milk", unit="each", price="1.20", net_content=Decimal("2"), net_content_unit=units["l"]
        )
        assert milk.unit_price["amount"] == Decimal("0.60") and milk.unit_price["per"] == "L"
        loaf = product_factory(sku="B1", name="Loaf", unit="each", price="2.00")
        assert loaf.unit_price is None  # unknown content → no made-up comparison

    def test_per_100g_unit_normalises_to_kg(self, product_factory):
        p = product_factory(sku="H1", name="Ham", unit="100g", price="1.10")
        assert p.unit_price["amount"] == Decimal("11.00")


# ------------------------------------------------------------------ listing, pagination, validation
class TestListing:
    def test_only_active_available_products_listed_and_server_side_pagination(self, api, product_factory, branch):
        for i in range(30):
            stock(product_factory(sku=f"L{i:02d}", name=f"Item {i:02d}"), branch)
        product_factory(sku="HID1", name="Hidden archived", status=ProductStatus.ARCHIVED)
        product_factory(sku="HID2", name="Hidden switched off", is_available=False)
        page1 = listing(api, page_size=12)
        assert page1["count"] == 30 and len(page1["results"]) == 12 and page1["total_pages"] == 3
        assert "Hidden archived" not in names(listing(api, page_size=100))
        page3 = listing(api, page_size=12, page=3)
        assert len(page3["results"]) == 6

    def test_invalid_params_return_structured_400(self, api):
        res = api.get("/api/v1/products/", {"price_min": "abc", "sort": "bogus", "page_size": "9999"})
        body = res.json()["error"]
        assert (
            res.status_code == 400
            and body["code"] == "VALIDATION_ERROR"
            and {"price_min", "sort"} <= set(body["details"])
        )

    def test_page_size_is_capped(self, api, product_factory):
        for i in range(3):
            product_factory(sku=f"C{i}", name=f"Cap {i}")
        assert listing(api, page_size=9999)["page_size"] <= 100

    def test_listing_query_count_does_not_grow_with_page_size(
        self, api, product_factory, branch, django_assert_max_num_queries
    ):
        for i in range(40):
            p = product_factory(sku=f"Q{i:02d}", name=f"Query item {i:02d}")
            stock(p, branch)
        with django_assert_max_num_queries(10):
            assert len(listing(api, page_size=40)["results"]) == 40
        with django_assert_max_num_queries(10):
            assert len(listing(api, page_size=5)["results"]) == 5

    def test_card_exposes_unit_pricing_quantity_rules_and_availability(self, api, product_factory, branch, units):
        p = product_factory(
            sku="W1",
            name="Loose Tomatoes",
            unit="kg",
            price="4.00",
            qty_min=Decimal("0.5"),
            qty_step=Decimal("0.25"),
            qty_max=Decimal("5"),
            is_variable_weight=True,
        )
        stock(p, branch, on_hand="3", threshold="5")
        card = listing(api)["results"][0]
        assert card["price"] == "4.00" and card["unit_price"] == {"amount": "4.00", "per": "kg"}
        assert card["quantity"] == {"min": "0.5", "step": "0.25", "max": "5"} and card["is_variable_weight"] is True
        assert card["availability"] == {"status": "LOW_STOCK", "max_orderable": "3", "can_order": True}
        assert "PRICED_BY_WEIGHT" in card["badges"] and card["sale_unit"]["symbol"] == "kg"


# ------------------------------------------------------------------ search
class TestSearch:
    @pytest.fixture(autouse=True)
    def seed(self, product_factory, branch, brand, category):
        self.tomato = product_factory(sku="T1", name="Vine Tomatoes", unit="kg", brand=brand)
        self.cheese = product_factory(sku="C1", name="Mature Cheddar", unit="pack")
        self.milk = product_factory(
            sku="M1", name="Whole Milk", unit="each", description="Fresh dairy milk from the chilled aisle"
        )
        self.rice = product_factory(sku="R1", name="Basmati Rice", unit="pack")
        for p in (self.tomato, self.cheese, self.milk, self.rice):
            stock(p, branch)

    def test_prefix_matches_as_you_type(self, api):
        assert names(listing(api, q="toma")) == ["Vine Tomatoes"]
        assert names(listing(api, q="Mat ched")) == ["Mature Cheddar"]

    def test_typo_tolerant_via_trigram(self, api):
        assert "Vine Tomatoes" in names(listing(api, q="tomatos"))
        assert "Basmati Rice" in names(listing(api, q="basmatti rice"))

    def test_brand_description_and_sku_are_searchable(self, api):
        assert "Vine Tomatoes" in names(listing(api, q="test farm"))
        assert "Whole Milk" in names(listing(api, q="chilled aisle"))
        assert names(listing(api, q="R1")) == ["Basmati Rice"]

    def test_absurdly_long_query_is_rejected_cleanly(self, api):
        res = api.get("/api/v1/products/", {"q": "a" * 5000})
        assert res.status_code == 400 and res.json()["error"]["code"] == "VALIDATION_ERROR"

    def test_no_results_is_an_empty_list_not_an_error(self, api):
        payload = listing(api, q="xyzzyqq")
        assert payload["count"] == 0 and payload["results"] == []

    @pytest.mark.parametrize(
        "q", ["'; DROP TABLE catalog_product;--", "tom & | ! ( ) :* <->", "%%%", "a" * 500, "'' OR 1=1 --"]
    )
    def test_hostile_queries_are_harmless(self, api, q):
        res = api.get("/api/v1/products/", {"q": q})
        assert res.status_code == 200
        assert Product.objects.count() == 4

    def test_relevance_prefers_name_over_description(self, api, product_factory, branch):
        deco = product_factory(sku="D1", name="Gift Hamper", description="includes cheddar and chutney")
        stock(deco, branch)
        assert names(listing(api, q="cheddar", sort="relevance"))[0] == "Mature Cheddar"

    def test_suggest_endpoint(self, api):
        res = api.get("/api/v1/search/suggest/", {"q": "chedd"})
        assert res.status_code == 200 and res.json()["products"][0]["name"] == "Mature Cheddar"
        assert api.get("/api/v1/search/suggest/", {"q": "c"}).json()["products"] == []


# ------------------------------------------------------------------ filters & sorting
class TestFilters:
    @pytest.fixture(autouse=True)
    def seed(self, product_factory, branch, brand, category, units):
        self.other_brand = Brand.objects.create(name="Other Co", slug="other-co")
        dairy_parent = Category.objects.create(name="Dairy", slug="dairy")
        self.milk_cat = Category.objects.create(name="Milk", slug="milk", parent=dairy_parent)
        self.apple = product_factory(sku="A", name="Apple", unit="kg", price="3.00", brand=brand)
        self.pear = product_factory(sku="P", name="Pear", unit="kg", price="5.00", brand=self.other_brand)
        self.milk = product_factory(sku="M", name="Milk 1L", unit="each", price="1.50", category=self.milk_cat)
        self.out = product_factory(sku="O", name="Sold out thing", unit="each", price="2.00")
        for p in (self.apple, self.pear, self.milk):
            stock(p, branch)
        stock(self.out, branch, on_hand="0")

    def test_category_filter_includes_children_via_department_slug(self, api):
        assert names(listing(api, category="dairy")) == ["Milk 1L"]
        assert names(listing(api, category="milk")) == ["Milk 1L"]

    def test_brand_and_price_filters(self, api):
        assert names(listing(api, brand="other-co")) == ["Pear"]
        assert set(names(listing(api, brand="other-co,test-farm"))) == {"Apple", "Pear"}
        assert names(listing(api, price_min="2.50", price_max="3.00")) == ["Apple"]
        assert set(names(listing(api, price_min="4"))) == {"Pear"}

    def test_in_stock_filter_uses_branch_stock(self, api):
        in_stock = set(names(listing(api, in_stock="true")))
        assert in_stock == {"Apple", "Pear", "Milk 1L"} and "Sold out thing" not in in_stock

    def test_unit_filter(self, api):
        assert set(names(listing(api, unit="kg"))) == {"Apple", "Pear"}

    def test_only_verified_claims_filter_and_display(self, api):
        ProductClaim.objects.create(product=self.apple, kind="VEGAN", verified=True, evidence="plain fruit")
        ProductClaim.objects.create(product=self.pear, kind="VEGAN", verified=False)
        ProductClaim.objects.create(product=self.pear, kind="ORGANIC", verified=False, evidence="awaiting certificate")
        assert names(listing(api, claim="VEGAN")) == ["Apple"]
        detail = api.get(f"/api/v1/products/{self.pear.slug}/").json()
        assert detail["claims"] == []  # unverified claims are never shown
        assert [c["kind"] for c in api.get(f"/api/v1/products/{self.apple.slug}/").json()["claims"]] == ["VEGAN"]

    def test_on_offer_filter_and_effective_price(self, api):
        promo = Promotion.objects.create(name="Pear deal", label="20% off", kind="PERCENT_OFF", percent=Decimal("20"))
        promo.products.add(self.pear)
        assert names(listing(api, on_offer="true")) == ["Pear"]
        card = listing(api, on_offer="true")["results"][0]
        assert (
            card["base_price"] == "5.00"
            and card["price"] == "4.00"
            and card["promotion"]["label"] == "20% off"
            and "OFFER" in card["badges"]
        )

    def test_category_promotion_covers_child_categories(self, api):
        promo = Promotion.objects.create(
            name="Dairy week", label="10% off", kind="PERCENT_OFF", percent=Decimal("10"), scope="CATEGORIES"
        )
        promo.categories.add(Category.objects.get(slug="dairy"))
        assert names(listing(api, on_offer="true")) == ["Milk 1L"]

    def test_expired_and_inactive_promotions_do_not_apply(self, api):
        past = timezone.now() - dt.timedelta(days=3)
        old = Promotion.objects.create(
            name="Old",
            label="x",
            kind="PERCENT_OFF",
            percent=Decimal("50"),
            starts_at=past - dt.timedelta(days=2),
            ends_at=past,
        )
        old.products.add(self.apple)
        off = Promotion.objects.create(
            name="Off", label="y", kind="PERCENT_OFF", percent=Decimal("50"), is_active=False
        )
        off.products.add(self.apple)
        assert listing(api, on_offer="true")["count"] == 0
        assert next(r for r in listing(api)["results"] if r["name"] == "Apple")["price"] == "3.00"

    def test_multibuy_label_and_best_promotion_wins(self, api):
        multi = Promotion.objects.create(
            name="3 for", label="3 for 4.00", kind="MULTIBUY", multibuy_qty=3, multibuy_price=Decimal("4.00")
        )
        multi.products.add(self.milk)
        card = next(r for r in listing(api)["results"] if r["name"] == "Milk 1L")
        assert (
            card["price"] == "1.50" and card["promotion"]["kind"] == "MULTIBUY"
        )  # shelf price unchanged; offer is labelled

    def test_promotion_that_does_not_save_money_is_ignored(self, api):
        bad = Promotion.objects.create(
            name="3 for dearer", label="3 for 5.00", kind="MULTIBUY", multibuy_qty=3, multibuy_price=Decimal("5.00")
        )
        bad.products.add(self.milk)  # 3 x 1.50 = 4.50 < 5.00
        card = next(r for r in listing(api)["results"] if r["name"] == "Milk 1L")
        assert card["promotion"] is None

    def test_sorting(self, api):
        assert names(listing(api, sort="price_asc")) == ["Milk 1L", "Sold out thing", "Apple", "Pear"]
        assert names(listing(api, sort="price_desc")) == ["Pear", "Apple", "Sold out thing", "Milk 1L"]
        assert names(listing(api, sort="name")) == ["Apple", "Milk 1L", "Pear", "Sold out thing"]

    def test_facets(self, api):
        facets = listing(api, facets="true")["facets"]
        assert {b["slug"] for b in facets["brands"]} >= {"test-farm", "other-co"}
        assert facets["price"]["min"] == "1.50" and facets["price"]["max"] == "5.00"
        # selecting a brand must not hide the other brand options (own filter skipped)
        only = listing(api, facets="true", brand="other-co")["facets"]
        assert {b["slug"] for b in only["brands"]} >= {"test-farm", "other-co"}


# ------------------------------------------------------------------ availability rules
class TestAvailability:
    def card(self, api, p):
        return next(r for r in listing(api, page_size=100)["results"] if r["slug"] == p.slug)["availability"]

    def test_reserved_stock_is_not_available(self, api, product_factory, branch):
        p = product_factory(sku="S1", name="Reserved item")
        stock(p, branch, on_hand="5", reserved="5")
        assert self.card(api, p)["status"] == "OUT_OF_STOCK"

    def test_no_stock_row_means_out_of_stock(self, api, product_factory):
        p = product_factory(sku="S2", name="Never stocked")
        assert self.card(api, p)["status"] == "OUT_OF_STOCK"

    def test_made_to_order_is_always_available(self, api, product_factory):
        p = product_factory(sku="S3", name="Fresh cake", stock_mode="MADE_TO_ORDER", product_type="PREPARED")
        assert self.card(api, p) == {"status": "IN_STOCK", "max_orderable": None, "can_order": True}

    def test_max_orderable_respects_step_and_qty_max(self, api, product_factory, branch):
        p = product_factory(
            sku="S4", name="Mince", unit="kg", qty_min=Decimal("0.5"), qty_step=Decimal("0.5"), qty_max=Decimal("2")
        )
        stock(p, branch, on_hand="1.8")
        assert self.card(api, p)["max_orderable"] == "1.5"
        stock_level = StockLevel.objects.get(product=p)
        stock_level.on_hand = Decimal("9")
        stock_level.save()
        assert self.card(api, p)["max_orderable"] == "2"

    def test_batch_tracked_excludes_expired_quarantined_and_failed_qc(self, api, product_factory, branch):
        p = product_factory(sku="B1", name="Chilled yoghurt", tracks_batches=True, is_perishable=True)
        stock(p, branch, on_hand="40")
        today = timezone.localdate()

        def batch(lot, qty, days, **kw):
            return Batch.objects.create(
                product=p,
                branch=branch,
                lot_code=lot,
                received_on=today,
                expiry_date=today + dt.timedelta(days=days),
                sellable_until=today + dt.timedelta(days=days - 1),
                qty_received=Decimal(qty),
                qty_remaining=Decimal(qty),
                **kw,
            )

        batch("EXPIRED", 10, -2)
        batch("QUARANTINE", 10, 5, status=BatchStatus.QUARANTINED)
        batch("QC-FAIL", 10, 5, quality_status=QualityStatus.FAILED)
        assert self.card(api, p)["status"] == "OUT_OF_STOCK"
        good = batch("GOOD", 6, 5)
        assert self.card(api, p)["max_orderable"] == "6"
        good.qty_reserved = Decimal("4")
        good.save()
        assert self.card(api, p)["max_orderable"] == "2"

    def test_stock_is_per_branch(self, api, product_factory, branch, second_branch):
        p = product_factory(sku="PB", name="Branch item")
        stock(p, branch, on_hand="5")
        stock(p, second_branch, on_hand="0")
        res = api.get("/api/v1/products/", {"branch": second_branch.id}).json()["results"][0]
        assert res["availability"]["status"] == "OUT_OF_STOCK"


# ------------------------------------------------------------------ detail & trust data
class TestDetail:
    def test_detail_lists_unknown_information_instead_of_inventing_it(self, api, product_factory, branch):
        p = product_factory(sku="D1", name="Mystery item", unit="each")
        stock(p, branch)
        data = api.get(f"/api/v1/products/{p.slug}/").json()
        assert set(data["unknowns"]) >= {"origin", "nutrition", "ingredients", "allergens", "storage"}
        assert data["allergens"]["confirmed"] is False and data["nutrition"] is None and data["origin"] is None

    def test_allergens_nutrition_origin_when_provided(self, api, product_factory, branch):
        p = product_factory(
            sku="D2",
            name="Peanut bar",
            ingredients="Peanuts, oats",
            origin_country="Spain",
            allergen_info_complete=True,
            storage_instructions="Cool dry place",
        )
        stock(p, branch)
        ProductAllergen.objects.create(
            product=p, allergen=Allergen.objects.get(code="peanuts"), level=AllergenLevel.CONTAINS
        )
        ProductAllergen.objects.create(
            product=p, allergen=Allergen.objects.get(code="milk"), level=AllergenLevel.MAY_CONTAIN
        )
        NutritionFact.objects.create(
            product=p,
            basis="per 100 g",
            energy_kcal=Decimal("480.0"),
            protein=Decimal("12.50"),
            source="Supplier label",
        )
        data = api.get(f"/api/v1/products/{p.slug}/").json()
        assert data["allergens"] == {"contains": ["Peanuts"], "may_contain": ["Milk"], "confirmed": True}
        assert (
            data["nutrition"]["values"] == {"energy_kcal": "480", "protein": "12.5"}
            and data["origin"]["country"] == "Spain"
        )
        assert data["unknowns"] == []

    def test_archived_product_is_404(self, api, product_factory):
        p = product_factory(sku="D3", name="Gone", status=ProductStatus.ARCHIVED)
        res = api.get(f"/api/v1/products/{p.slug}/")
        assert res.status_code == 404 and res.json()["error"]["code"] == "NOT_FOUND"

    def test_related_products_exclude_self(self, api, product_factory, branch):
        a, b = product_factory(sku="R1", name="Rel A"), product_factory(sku="R2", name="Rel B")
        for p in (a, b):
            stock(p, branch)
        related = api.get(f"/api/v1/products/{a.slug}/").json()["related"]
        assert [r["name"] for r in related] == ["Rel B"]


class TestCategoriesAndCaching:
    def test_empty_categories_are_hidden_and_cache_invalidates(self, api, product_factory, category, branch):
        assert api.get("/api/v1/categories/").json() == []
        p = product_factory(sku="CC1", name="First product")
        tree = api.get("/api/v1/categories/").json()
        assert (
            tree[0]["slug"] == "fresh-produce"
            and tree[0]["children"][0]["slug"] == "fruit"
            and tree[0]["children"][0]["count"] == 1
        )
        p.status = ProductStatus.ARCHIVED
        p.save()
        assert api.get("/api/v1/categories/").json() == []  # signal bumped the namespace

    def test_store_settings_endpoint_is_public_and_labels_payment_mode(self, api, settings_obj):
        data = api.get("/api/v1/store/").json()
        assert data["name"] == "Orchard Row" and data["payment"]["mode"] == "demo"


def test_decimals_are_never_serialised_as_floats():
    """Regression: DRF's stock encoder renders a raw Decimal as a float; ours renders the exact string."""
    import json
    from decimal import Decimal

    from rest_framework.response import Response
    from rest_framework.test import APIRequestFactory
    from rest_framework.views import APIView

    class V(APIView):
        authentication_classes: list = []
        permission_classes: list = []

        def get(self, request):
            return Response({"price": Decimal("51.94"), "tiny": Decimal("0.10")})

    res = V.as_view()(APIRequestFactory().get("/"))
    res.render()
    assert json.loads(res.content) == {"price": "51.94", "tiny": "0.10"}
