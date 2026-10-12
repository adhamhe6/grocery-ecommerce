"""Staff catalog API: products, nested editing (claims / allergens / nutrition / images), archive-vs-delete."""

from decimal import Decimal

import pytest
from rest_framework.test import APIClient

from apps.catalog.models import (
    Allergen,
    NutritionFact,
    Product,
    ProductClaim,
    ProductImage,
)
from apps.core import rbac
from apps.core.models import AuditLog
from tests.admin.conftest import results
from tests.admin.helpers import BAD_UPLOADS, STAFF_ROLES, details, stored_files, upload

pytestmark = pytest.mark.django_db


@pytest.fixture
def media(settings, tmp_path):
    """Point uploads at a throw-away folder so the test can assert exactly which files exist."""
    settings.MEDIA_ROOT = str(tmp_path)
    return tmp_path


D = Decimal
URL = "/api/v1/admin/products/"

WRITERS = {"SUPER_ADMIN", "ADMIN"}
AVAILABILITY = {"SUPER_ADMIN", "ADMIN", "STORE_MANAGER", "INVENTORY_MANAGER"}
MERCHANDISERS = {"SUPER_ADMIN", "ADMIN", "MARKETING_MANAGER"}


def payload(category, units, **kw):
    return {
        "sku": "TOM-1", "name": "Heirloom tomatoes", "category": category.id, "sale_unit": units["kg"].id,
        "price": "4.50", "qty_min": "0.5", "qty_step": "0.5", **kw,
    }  # fmt: skip


@pytest.fixture
def product(product_factory, units):
    return product_factory(
        sku="APL-1", name="Gala apples", price="2.00", unit="kg", qty_min=D("0.5"), qty_step=D("0.5")
    )


def audits(action):
    return AuditLog.objects.filter(action=action)


class TestAccessControl:
    @pytest.mark.parametrize(
        "url", ["products", "categories", "brands", "collections", "units", "allergens", "reviews"]
    )
    def test_anonymous_gets_401_and_customers_get_403(self, url, user):
        assert APIClient().get(f"/api/v1/admin/{url}/").status_code == 401
        c = APIClient()
        c.force_authenticate(user)
        res = c.get(f"/api/v1/admin/{url}/")
        assert res.status_code == 403 and res.json()["error"]["code"] == "FORBIDDEN"

    def test_documented_matrix_matches_rbac(self):
        def holders(cap):
            return {r for r in rbac.STAFF_ROLES if rbac.role_has(r, cap)}

        assert holders("catalog.write") == WRITERS
        assert holders("catalog.availability") == AVAILABILITY
        assert holders("catalog.merchandise") == MERCHANDISERS
        assert holders("catalog.read") == set(rbac.STAFF_ROLES)

    @pytest.mark.parametrize("role", STAFF_ROLES)
    def test_every_staff_role_can_read_but_only_catalog_writers_can_write(self, role, staff, category, units, product):
        c = staff(role)
        assert c.get(URL).status_code == 200
        assert c.get(f"{URL}{product.id}/").status_code == 200
        res = c.post(URL, payload(category, units, sku=f"S-{role}"), format="json")
        assert res.status_code == (201 if role in WRITERS else 403), (role, res.content)
        res = c.patch(f"{URL}{product.id}/", {"name": f"Renamed by {role}"}, format="json")
        assert res.status_code == (200 if role in WRITERS else 403)
        res = c.delete(f"{URL}{product.id}/?archive=true")
        assert res.status_code == (200 if role in WRITERS else 403)

    @pytest.mark.parametrize("role", STAFF_ROLES)
    def test_narrow_switches_follow_their_own_capabilities(self, role, staff, product):
        c = staff(role)
        res = c.patch(f"{URL}{product.id}/availability/", {"is_available": False}, format="json")
        assert res.status_code == (200 if role in AVAILABILITY else 403), (role, res.content)
        res = c.patch(f"{URL}{product.id}/merchandising/", {"is_featured": True}, format="json")
        assert res.status_code == (200 if role in MERCHANDISERS else 403), (role, res.content)
        res = c.put(f"{URL}{product.id}/claims/", [], format="json")
        assert res.status_code == (200 if role in WRITERS else 403)
        res = c.put(f"{URL}{product.id}/allergens/", {"allergens": []}, format="json")
        assert res.status_code == (200 if role in WRITERS else 403)
        res = c.put(f"{URL}{product.id}/nutrition/", {"source": "label"}, format="json")
        assert res.status_code == (200 if role in WRITERS else 403)


class TestCreateAndUpdate:
    def test_creates_a_product_with_all_the_grocery_fields_and_audits_it(self, admin, category, brand, units):
        body = payload(
            category, units, brand=brand.id, barcode="5012345678900", short_description="Ripe, sweet",
            product_type="LOOSE_PRODUCE", storage_type="AMBIENT", qty_max="10", net_content=None,
            is_variable_weight=True, tracks_batches=True, is_perishable=True, sell_buffer_days=2,
            origin_country="Italy", origin_note="Sicily", storage_instructions="Keep cool", ingredients="Tomatoes",
            packaging="Paper bag", manufacturer="Test Farm Ltd", tax_rate="5.00",
        )  # fmt: skip
        res = admin.post(URL, body, format="json")
        assert res.status_code == 201, res.content
        data = res.json()
        assert data["slug"] == "heirloom-tomatoes" and data["price"] == "4.50"
        assert data["qty_min"] == "0.5" and data["qty_step"] == "0.5" and data["qty_max"] == "10"  # canonical strings
        assert (
            data["is_variable_weight"] is True and data["brand_name"] == "Test Farm" and data["sale_unit_code"] == "kg"
        )
        assert data["unit_price"] == {"amount": "4.50", "per": "kg"}
        entry = audits("product.created").get()
        assert entry.actor.role == "ADMIN" and entry.after["sku"] == "TOM-1" and entry.after["price"] == "4.50"
        assert "search_vector" not in entry.after

    def test_slugs_are_generated_and_kept_unique(self, admin, category, units):
        first = admin.post(URL, payload(category, units, sku="A1", name="Red onions"), format="json").json()
        second = admin.post(URL, payload(category, units, sku="A2", name="Red onions"), format="json").json()
        assert first["slug"] == "red-onions" and second["slug"] == "red-onions-2"

    @pytest.mark.parametrize(
        ("overrides", "field"),
        [
            (
                {"sale_unit": "each", "is_variable_weight": True},
                "is_variable_weight",
            ),  # variable weight needs a weight unit
            ({"qty_min": "2", "qty_max": "1"}, "qty_max"),
            ({"qty_step": "0"}, "qty_step"),
            ({"qty_min": "0"}, "qty_min"),
            ({"price": "-1"}, "price"),
            ({"net_content": "500"}, "net_content"),  # content without its unit
            ({"tracks_batches": True, "stock_mode": "MADE_TO_ORDER"}, "tracks_batches"),
            ({"sale_unit": "each", "qty_min": "1", "qty_step": "0.5"}, "qty_step"),  # 'each' can't be sold in halves
            ({"barcode": "12ab"}, "barcode"),
            ({"tax_rate": "101"}, "tax_rate"),
            ({"status": "DELETED"}, "status"),
            ({"name": ""}, "name"),
        ],
    )
    def test_validation_errors_use_the_standard_body_and_name_the_field(self, admin, category, units, overrides, field):
        body = payload(category, units)
        if overrides.get("sale_unit") in units:
            overrides = {**overrides, "sale_unit": units[overrides["sale_unit"]].id}
        res = admin.post(URL, {**body, **overrides}, format="json")
        assert res.status_code == 400
        assert res.json()["error"]["code"] == "VALIDATION_ERROR" and field in details(res), res.content
        assert not Product.objects.filter(sku="TOM-1").exists()

    def test_net_content_must_be_a_weight_or_volume_unit(self, admin, category, units):
        res = admin.post(
            URL, payload(category, units, net_content="2", net_content_unit=units["pack"].id), format="json"
        )
        assert res.status_code == 400 and "net_content_unit" in details(res)

    def test_sku_barcode_uniqueness_and_blank_barcodes_are_stored_as_null(self, admin, category, units):
        assert admin.post(URL, payload(category, units, barcode="5012345678900"), format="json").status_code == 201
        dup_sku = admin.post(URL, payload(category, units, name="Other", barcode=None), format="json")
        assert dup_sku.status_code == 400 and "sku" in details(dup_sku)
        dup_barcode = admin.post(
            URL, payload(category, units, sku="X2", name="Other", barcode="5012345678900"), format="json"
        )
        assert dup_barcode.status_code == 400 and "barcode" in details(dup_barcode)
        for n in range(2):  # blanks must not collide on the partial unique index
            res = admin.post(URL, payload(category, units, sku=f"B{n}", name=f"Blank {n}", barcode=""), format="json")
            assert res.status_code == 201 and res.json()["barcode"] is None

    def test_privileged_and_derived_fields_cannot_be_mass_assigned(self, admin, category, units, product):
        res = admin.post(
            URL,
            payload(category, units, popularity=999, rating_count=50, rating_avg="5.00", is_demo=True, id=12345),
            format="json",
        )
        assert res.status_code == 201
        created = Product.objects.get(sku="TOM-1")
        assert created.popularity == 0 and created.rating_count == 0 and created.rating_avg is None
        assert created.is_demo is False and created.id != 12345
        admin.patch(
            f"{URL}{product.id}/",
            {"popularity": 5, "is_demo": True, "created_at": "2001-01-01T00:00:00Z"},
            format="json",
        )
        product.refresh_from_db()
        assert product.popularity == 0 and product.is_demo is False and product.created_at.year != 2001

    def test_price_changes_are_audited_with_before_and_after(self, admin, product):
        res = admin.patch(f"{URL}{product.id}/", {"price": "2.35", "name": "Gala apples 1kg"}, format="json")
        assert res.status_code == 200 and res.json()["price"] == "2.35"
        change = audits("product.price_changed").get()
        assert change.before == {"price": "2.00"} and change.after == {"price": "2.35"}
        assert change.target_id == str(product.id) and change.actor.role == "ADMIN"
        updated = audits("product.updated").get()
        assert (
            updated.before["price"] == "2.00"
            and updated.after["price"] == "2.35"
            and updated.after["name"] == "Gala apples 1kg"
        )

    def test_no_price_audit_when_the_price_did_not_change(self, admin, product):
        admin.patch(f"{URL}{product.id}/", {"price": "2.00", "short_description": "Crisp"}, format="json")
        assert not audits("product.price_changed").exists() and audits("product.updated").count() == 1

    def test_storefront_sees_the_new_price_immediately(self, admin, product, stock_up, api):
        stock_up(product, 10)
        before = api.get("/api/v1/products/").json()["results"][0]["price"]
        admin.patch(f"{URL}{product.id}/", {"price": "3.10"}, format="json")
        assert before == "2.00" and api.get(f"/api/v1/products/{product.slug}/").json()["price"] == "3.10"

    def test_cannot_change_the_counting_unit_once_stock_exists(self, admin, product, stock_up, units):
        assert (
            admin.patch(f"{URL}{product.id}/", {"sale_unit": units["kg"].id}, format="json").status_code == 200
        )  # same unit
        stock_up(product, 5)
        res = admin.patch(
            f"{URL}{product.id}/", {"sale_unit": units["each"].id, "qty_min": "1", "qty_step": "1"}, format="json"
        )
        assert res.status_code == 400 and "sale_unit" in details(res)
        res = admin.patch(f"{URL}{product.id}/", {"tracks_batches": True}, format="json")
        assert res.status_code == 400 and "tracks_batches" in details(res)

    def test_unit_can_change_while_the_product_has_no_history(self, admin, product, units):
        res = admin.patch(
            f"{URL}{product.id}/", {"sale_unit": units["each"].id, "qty_min": "1", "qty_step": "1"}, format="json"
        )
        assert res.status_code == 200 and res.json()["sale_unit_code"] == "each"

    def test_no_audit_or_row_when_validation_fails_midway(self, admin, product):
        res = admin.patch(
            f"{URL}{product.id}/", {"price": "9.99", "qty_max": "0.1"}, format="json"
        )  # max below the 0.5 minimum
        assert res.status_code == 400
        product.refresh_from_db()
        assert product.price == D("2.00") and not audits("product.updated").exists()


class TestListing:
    @pytest.fixture
    def shelf(self, product_factory, category, brand, units):
        from apps.catalog.models import Category

        dairy = Category.objects.create(name="Dairy", slug="dairy")
        milk = product_factory(
            sku="MLK",
            name="Whole milk",
            price="1.20",
            category=dairy,
            brand=brand,
            is_perishable=True,
            barcode="4006381333931",
        )
        apple = product_factory(sku="APL", name="Gala apple", price="0.40", category=category)
        pear = product_factory(sku="PER", name="Conference pear", price="0.55", category=category, status="INACTIVE")
        return milk, apple, pear

    def test_search_filters_ordering_and_pagination_shape(self, admin, shelf, category):
        milk, apple, pear = shelf
        assert [p["sku"] for p in results(admin.get(URL, {"search": "milk"}))] == ["MLK"]
        assert [p["sku"] for p in results(admin.get(URL, {"search": "4006381333931"}))] == ["MLK"]  # by barcode
        assert {p["sku"] for p in results(admin.get(URL, {"status": "INACTIVE"}))} == {"PER"}
        assert {p["sku"] for p in results(admin.get(URL, {"status": "ACTIVE,INACTIVE"}))} == {"MLK", "APL", "PER"}
        assert [p["sku"] for p in results(admin.get(URL, {"perishable": "true"}))] == ["MLK"]
        assert {p["sku"] for p in results(admin.get(URL, {"brand": milk.brand_id}))} == {"MLK"}
        assert [p["sku"] for p in results(admin.get(URL, {"ordering": "-price"}))] == ["MLK", "PER", "APL"]
        parent = category.parent_id  # a department lists the products of its categories
        assert {p["sku"] for p in results(admin.get(URL, {"category": parent}))} == {"APL", "PER"}
        page = admin.get(URL, {"page_size": 2}).json()
        assert page["count"] == 3 and page["total_pages"] == 2 and len(page["results"]) == 2 and page["page_size"] == 2

    def test_category_and_brand_filters_accept_slugs_as_well_as_ids(self, admin, shelf, category, brand):
        assert {p["sku"] for p in results(admin.get(URL, {"category": category.slug}))} == {"APL", "PER"}
        assert {p["sku"] for p in results(admin.get(URL, {"category": category.parent.slug}))} == {"APL", "PER"}
        assert {p["sku"] for p in results(admin.get(URL, {"category": "dairy"}))} == {"MLK"}
        assert {p["sku"] for p in results(admin.get(URL, {"brand": brand.slug}))} == {"MLK"}
        assert results(admin.get(URL, {"category": "no-such-category"})) == []

    def test_unknown_filter_values_are_rejected_not_ignored(self, admin, shelf):
        res = admin.get(URL, {"status": "NOPE"})
        assert res.status_code == 400 and "status" in details(res)
        assert admin.get(URL, {"missing": "colour"}).status_code == 400

    def test_completeness_flags_and_filters(self, admin, shelf, units):
        milk, apple, pear = shelf
        apple.description = "Crisp"
        apple.origin_country, apple.storage_instructions, apple.allergen_info_complete = "UK", "Cool", True
        apple.save()
        ProductImage.objects.create(product=apple, image="products/x.webp", alt_text="apple")
        NutritionFact.objects.create(product=apple, source="label")
        by_sku = {p["sku"]: p for p in results(admin.get(URL))}
        assert by_sku["APL"]["missing"] == ["ingredients"]  # packaged goods need ingredients
        assert set(by_sku["MLK"]["missing"]) == {
            "image",
            "description",
            "origin",
            "nutrition",
            "ingredients",
            "allergens",
            "storage",
        }
        assert {p["sku"] for p in results(admin.get(URL, {"incomplete": "true"}))} == {"MLK", "PER", "APL"}
        assert {p["sku"] for p in results(admin.get(URL, {"missing": "image"}))} == {"MLK", "PER"}
        assert {p["sku"] for p in results(admin.get(URL, {"missing": "image,nutrition"}))} == {"MLK", "PER"}
        apple.ingredients = "Apple"
        apple.save()
        assert {p["sku"] for p in results(admin.get(URL, {"incomplete": "false"}))} == {"APL"}

    def test_detail_embeds_the_nested_data(self, admin, product):
        data = admin.get(f"{URL}{product.id}/").json()
        assert data["images"] == [] and data["claims"] == [] and data["allergens"] == [] and data["nutrition"] is None


class TestArchiveAndDelete:
    def test_a_product_with_orders_is_archived_never_deleted(self, admin, product, order_factory):
        order_factory([(product, 2)])
        res = admin.delete(f"{URL}{product.id}/")
        assert res.status_code == 200 and res.json() == {"id": product.id, "result": "archived", "status": "ARCHIVED"}
        product.refresh_from_db()
        assert product.status == "ARCHIVED"
        assert product.order_items.count() == 1  # history intact
        entry = audits("product.archived").get()
        assert entry.before["status"] == "ACTIVE" and entry.after["status"] == "ARCHIVED"
        assert not audits("product.deleted").exists()

    def test_archived_products_disappear_from_the_storefront(self, admin, product, stock_up, api):
        stock_up(product, 5)
        assert api.get(f"/api/v1/products/{product.slug}/").status_code == 200
        order_factory_free = admin.delete(f"{URL}{product.id}/?archive=true")
        assert order_factory_free.json()["result"] == "archived"
        assert api.get(f"/api/v1/products/{product.slug}/").status_code == 404

    def test_a_product_that_was_ever_stocked_is_archived_even_without_orders(self, admin, product, stock_up):
        stock_up(product, 3)
        res = admin.delete(f"{URL}{product.id}/")
        assert res.json()["result"] == "archived" and Product.objects.filter(pk=product.pk, status="ARCHIVED").exists()

    def test_a_product_nothing_ever_referenced_is_hard_deleted_with_its_images(self, admin, product, media):
        up = admin.post(f"{URL}{product.id}/images/", {"image": upload("JPEG"), "alt_text": "Gala"}, format="multipart")
        assert up.status_code == 201 and stored_files(media)
        res = admin.delete(f"{URL}{product.id}/")
        assert res.json() == {"id": product.id, "result": "deleted", "status": None}
        assert not Product.objects.filter(pk=product.pk).exists()
        assert stored_files(media) == set()  # original + every variant removed from storage
        entry = audits("product.deleted").get()
        assert entry.target_id == str(product.id) and entry.before["sku"] == "APL-1" and entry.after is None

    def test_archive_flag_forces_archiving_and_is_idempotent(self, admin, product):
        assert admin.delete(f"{URL}{product.id}/?archive=true").json()["result"] == "archived"
        assert admin.delete(f"{URL}{product.id}/?archive=true").json()["result"] == "archived"
        assert audits("product.archived").count() == 1

    def test_unknown_product_is_404(self, admin):
        assert admin.delete(f"{URL}999999/").status_code == 404


class TestAvailabilityAndMerchandising:
    def test_availability_switch_hides_the_product_and_is_audited(self, staff, product, stock_up, api):
        stock_up(product, 5)
        c = staff("INVENTORY_MANAGER")
        res = c.patch(f"{URL}{product.id}/availability/", {"is_available": False}, format="json")
        assert res.status_code == 200 and res.json()["is_available"] is False
        assert api.get(f"/api/v1/products/{product.slug}/").status_code == 404
        entry = audits("product.availability_changed").get()
        assert entry.before == {"is_available": True, "status": "ACTIVE"} and entry.after == {
            "is_available": False,
            "status": "ACTIVE",
        }
        assert entry.actor.role == "INVENTORY_MANAGER"

    def test_status_accepts_only_active_or_inactive_and_never_touches_other_fields(self, staff, product):
        c = staff("STORE_MANAGER")
        assert c.patch(f"{URL}{product.id}/availability/", {"status": "ARCHIVED"}, format="json").status_code == 400
        assert c.patch(f"{URL}{product.id}/availability/", {}, format="json").status_code == 400
        res = c.patch(
            f"{URL}{product.id}/availability/", {"status": "INACTIVE", "price": "99", "name": "Hacked"}, format="json"
        )
        product.refresh_from_db()
        assert (
            res.status_code == 200
            and product.status == "INACTIVE"
            and product.price == D("2.00")
            and product.name == "Gala apples"
        )

    def test_archived_products_cannot_be_reactivated_with_the_narrow_switch(self, admin, staff, product):
        admin.delete(f"{URL}{product.id}/?archive=true")
        res = staff("STORE_MANAGER").patch(f"{URL}{product.id}/availability/", {"status": "ACTIVE"}, format="json")
        assert res.status_code == 409 and res.json()["error"]["code"] == "INVALID_STATE"
        assert (
            admin.patch(f"{URL}{product.id}/", {"status": "ACTIVE"}, format="json").status_code == 200
        )  # catalog.write can

    def test_featured_flag_only_changes_is_featured(self, staff, product):
        res = staff("MARKETING_MANAGER").patch(
            f"{URL}{product.id}/merchandising/", {"is_featured": True, "price": "0.01"}, format="json"
        )
        product.refresh_from_db()
        assert res.status_code == 200 and product.is_featured is True and product.price == D("2.00")
        assert (
            staff("MARKETING_MANAGER").patch(f"{URL}{product.id}/merchandising/", {}, format="json").status_code == 400
        )
        entry = audits("product.merchandising_changed").get()
        assert entry.before == {"is_featured": False} and entry.after == {"is_featured": True}


class TestClaims:
    def test_verifying_a_claim_needs_evidence_and_records_who_and_when(self, admin, product):
        bad = admin.put(
            f"{URL}{product.id}/claims/", [{"kind": "ORGANIC", "verified": True, "evidence": "  "}], format="json"
        )
        assert bad.status_code == 400 and bad.json()["error"]["code"] == "VALIDATION_ERROR"
        assert "evidence" in str(bad.json()["error"]["details"]) and not ProductClaim.objects.exists()
        ok = admin.put(
            f"{URL}{product.id}/claims/",
            [
                {"kind": "ORGANIC", "verified": True, "evidence": "Soil Assoc. cert 123"},
                {"kind": "VEGAN", "verified": False},
            ],
            format="json",
        )
        assert ok.status_code == 200
        organic = ProductClaim.objects.get(kind="ORGANIC")
        assert organic.verified and organic.verified_by == admin.user and organic.verified_at is not None
        vegan = ProductClaim.objects.get(kind="VEGAN")
        assert not vegan.verified and vegan.verified_by is None
        assert audits("product.claims_updated").get().after[0]["verified_by"] == admin.user.email

    def test_resubmitting_unchanged_evidence_keeps_the_original_verifier(self, admin, staff, product):
        body = [{"kind": "HALAL", "verified": True, "evidence": "Certificate H-77"}]
        admin.put(f"{URL}{product.id}/claims/", body, format="json")
        first = ProductClaim.objects.get(kind="HALAL")
        other = staff("SUPER_ADMIN")
        other.put(f"{URL}{product.id}/claims/", body, format="json")
        again = ProductClaim.objects.get(kind="HALAL")
        assert again.verified_by == admin.user and again.verified_at == first.verified_at
        other.put(
            f"{URL}{product.id}/claims/",
            [{"kind": "HALAL", "verified": True, "evidence": "Certificate H-78"}],
            format="json",
        )
        assert (
            ProductClaim.objects.get(kind="HALAL").verified_by == other.user
        )  # new evidence = re-verified by the new person

    def test_put_replaces_the_list_and_unverifying_clears_the_signature(self, admin, product):
        admin.put(
            f"{URL}{product.id}/claims/",
            [{"kind": "VEGAN", "verified": True, "evidence": "Label"}, {"kind": "KOSHER", "verified": False}],
            format="json",
        )
        res = admin.put(
            f"{URL}{product.id}/claims/",
            {"claims": [{"kind": "VEGAN", "verified": False, "evidence": "Label"}]},
            format="json",
        )
        assert res.status_code == 200 and [c["kind"] for c in res.json()] == ["VEGAN"]
        vegan = ProductClaim.objects.get()
        assert vegan.verified is False and vegan.verified_by is None and vegan.verified_at is None

    def test_duplicate_kind_and_unknown_kind_are_rejected(self, admin, product):
        dup = admin.put(f"{URL}{product.id}/claims/", [{"kind": "VEGAN"}, {"kind": "VEGAN"}], format="json")
        assert dup.status_code == 400
        assert admin.put(f"{URL}{product.id}/claims/", [{"kind": "MAGIC"}], format="json").status_code == 400

    def test_only_verified_claims_reach_the_storefront(self, admin, product, stock_up, api):
        stock_up(product, 5)
        admin.put(
            f"{URL}{product.id}/claims/",
            [
                {"kind": "ORGANIC", "verified": True, "evidence": "Cert 1"},
                {"kind": "VEGAN", "verified": False, "evidence": "pending"},
            ],
            format="json",
        )
        public = api.get(f"/api/v1/products/{product.slug}/").json()
        assert [c["kind"] for c in public["claims"]] == ["ORGANIC"]


class TestAllergensAndNutrition:
    def test_allergens_are_replaced_and_the_completeness_flag_is_set(self, admin, product, stock_up, api):
        stock_up(product, 5)
        res = admin.put(
            f"{URL}{product.id}/allergens/",
            {
                "allergens": [
                    {"allergen": "milk", "level": "CONTAINS"},
                    {"allergen": "sesame", "level": "MAY_CONTAIN"},
                ],
                "allergen_info_complete": True,
            },
            format="json",
        )
        assert res.status_code == 200 and res.json()["allergen_info_complete"] is True
        assert {(a["allergen"], a["level"]) for a in res.json()["allergens"]} == {
            ("milk", "CONTAINS"),
            ("sesame", "MAY_CONTAIN"),
        }
        public = api.get(f"/api/v1/products/{product.slug}/").json()["allergens"]
        assert public == {"contains": ["Milk"], "may_contain": ["Sesame"], "confirmed": True}
        res = admin.put(
            f"{URL}{product.id}/allergens/", {"allergens": []}, format="json"
        )  # flag untouched when omitted
        product.refresh_from_db()
        assert res.json()["allergens"] == [] and product.allergen_info_complete is True
        entry = audits("product.allergens_updated").first()  # newest first
        assert (
            entry.before["allergen_info_complete"] is True
            and len(entry.before["allergens"]) == 2
            and entry.after["allergens"] == []
        )

    def test_allergens_may_be_given_by_code_key_too(self, admin, product):
        res = admin.put(f"{URL}{product.id}/allergens/", {"allergens": [{"code": "eggs"}]}, format="json")
        assert (
            res.status_code == 200
            and res.json()["allergens"][0]["allergen"] == "eggs"
            and res.json()["allergens"][0]["level"] == "CONTAINS"
        )

    def test_unknown_or_duplicate_allergens_are_rejected(self, admin, product):
        assert Allergen.objects.filter(code="milk").exists()
        assert (
            admin.put(
                f"{URL}{product.id}/allergens/", {"allergens": [{"allergen": "unicorn"}]}, format="json"
            ).status_code
            == 400
        )
        dup = admin.put(
            f"{URL}{product.id}/allergens/",
            {"allergens": [{"allergen": "milk"}, {"allergen": "milk", "level": "MAY_CONTAIN"}]},
            format="json",
        )
        assert dup.status_code == 400
        assert (
            admin.put(
                f"{URL}{product.id}/allergens/", {"allergens": [{"allergen": "milk", "level": "ALWAYS"}]}, format="json"
            ).status_code
            == 400
        )

    def test_nutrition_accepts_nulls_but_needs_a_source(self, admin, product):
        res = admin.put(
            f"{URL}{product.id}/nutrition/", {"energy_kcal": "52.0", "fat": "0.2", "salt": None}, format="json"
        )
        assert res.status_code == 400 and "source" in details(res)
        res = admin.put(
            f"{URL}{product.id}/nutrition/",
            {"energy_kcal": "52.0", "fat": "0.20", "protein": None, "source": "Supplier datasheet 2026"},
            format="json",
        )
        assert res.status_code == 200, res.content
        data = res.json()
        assert (
            data["energy_kcal"] == "52"
            and data["fat"] == "0.2"
            and data["protein"] is None
            and data["basis"] == "per 100 g"
        )
        assert NutritionFact.objects.get(product=product).source == "Supplier datasheet 2026"

    def test_put_replaces_everything_and_staff_entered_data_is_not_demo(self, admin, product):
        NutritionFact.objects.create(
            product=product, source="sample", energy_kcal=D("10"), protein=D("1"), is_demo=True
        )
        res = admin.put(f"{URL}{product.id}/nutrition/", {"fibre": "2.4", "source": "Lab report"}, format="json")
        assert res.status_code == 200
        fact = NutritionFact.objects.get(product=product)
        assert fact.energy_kcal is None and fact.protein is None and fact.fibre == D("2.4") and fact.is_demo is False
        entry = audits("product.nutrition_updated").get()
        assert entry.before["energy_kcal"] == "10" and entry.after["energy_kcal"] is None

    def test_impossible_values_are_rejected(self, admin, product):
        assert (
            admin.put(f"{URL}{product.id}/nutrition/", {"fat": "-1", "source": "x"}, format="json").status_code == 400
        )
        res = admin.put(f"{URL}{product.id}/nutrition/", {"fat": "1", "saturates": "2", "source": "x"}, format="json")
        assert res.status_code == 400 and "saturates" in details(res)
        res = admin.put(
            f"{URL}{product.id}/nutrition/", {"carbohydrate": "5", "sugars": "9", "source": "x"}, format="json"
        )
        assert res.status_code == 400 and "sugars" in details(res)

    def test_nutrition_can_be_removed(self, admin, product):
        admin.put(f"{URL}{product.id}/nutrition/", {"source": "label", "protein": "1"}, format="json")
        assert admin.delete(f"{URL}{product.id}/nutrition/").status_code == 204
        assert (
            not NutritionFact.objects.filter(product=product).exists()
            and audits("product.nutrition_removed").count() == 1
        )


class TestImages:
    def add(self, client, product, fmt="JPEG", alt="A product photo", **kw):
        return client.post(
            f"{URL}{product.id}/images/", {"image": upload(fmt, **kw), "alt_text": alt}, format="multipart"
        )

    @pytest.mark.parametrize("fmt", ["JPEG", "PNG", "WEBP"])
    def test_accepts_jpeg_png_and_webp_and_writes_responsive_variants(self, fmt, admin, product, media):
        res = self.add(admin, product, fmt)
        assert res.status_code == 201, res.content
        image = ProductImage.objects.get(pk=res.json()["id"])
        assert image.image_widths == [320, 640, 1024] and image.alt_text == "A product photo" and image.sort_order == 0
        names = stored_files(media, prefix=f"products/{product.id}")
        assert len(names) == 4 and image.image.name.endswith(".webp")  # normalised original + 3 variants, always WebP
        assert set(res.json()["urls"]) == {"original", "320", "640", "1024"}
        assert audits("product.image_added").get().after["image_id"] == image.pk

    def test_small_images_only_get_the_variants_they_can_fill(self, admin, product, media):
        res = self.add(admin, product, size=(500, 400))
        assert ProductImage.objects.get(pk=res.json()["id"]).image_widths == [320]

    @pytest.mark.parametrize("kind", sorted(BAD_UPLOADS))
    def test_rejects_svg_html_corrupt_and_unsupported_files(self, kind, admin, product, media):
        res = admin.post(
            f"{URL}{product.id}/images/", {"image": BAD_UPLOADS[kind](), "alt_text": "x"}, format="multipart"
        )
        assert (
            res.status_code == 400 and res.json()["error"]["code"] == "VALIDATION_ERROR" and "image" in details(res)
        ), res.content
        assert not ProductImage.objects.exists() and stored_files(media) == set()

    def test_rejects_oversize_files(self, admin, product, media, settings):
        settings.IMAGE_UPLOAD_MAX_BYTES = 2000
        res = self.add(admin, product)
        assert res.status_code == 400 and "too large" in str(details(res)["image"])
        assert not ProductImage.objects.exists() and stored_files(media) == set()

    def test_alt_text_and_file_are_required(self, admin, product, media):
        assert admin.post(f"{URL}{product.id}/images/", {"image": upload()}, format="multipart").status_code == 400
        blank = self.add(admin, product, alt="   ")
        assert blank.status_code == 400 and "alt_text" in details(blank)
        no_file = admin.post(f"{URL}{product.id}/images/", {"alt_text": "x"}, format="multipart")
        assert no_file.status_code == 400 and "image" in details(no_file)

    def test_at_most_eight_images_per_product(self, admin, product, media):
        for n in range(8):
            assert self.add(admin, product, size=(400, 300), alt=f"photo {n}").status_code == 201
        res = self.add(admin, product, size=(400, 300))
        assert res.status_code == 400 and "at most 8" in str(details(res)["image"])
        assert product.images.count() == 8 and len(stored_files(media)) == 16  # nothing leaked for the refused upload

    def test_reorder_needs_the_exact_set_of_ids(self, admin, product, media):
        ids = [self.add(admin, product, size=(400, 300), alt=f"p{n}").json()["id"] for n in range(3)]
        res = admin.patch(f"{URL}{product.id}/images/order/", {"ids": list(reversed(ids))}, format="json")
        assert res.status_code == 200 and [i["id"] for i in res.json()] == list(reversed(ids))
        assert [i.id for i in product.images.all()] == list(reversed(ids))
        assert admin.patch(f"{URL}{product.id}/images/order/", {"ids": ids[:2]}, format="json").status_code == 400
        assert (
            admin.patch(f"{URL}{product.id}/images/order/", {"ids": [*ids, ids[0]]}, format="json").status_code == 400
        )
        assert (
            admin.patch(f"{URL}{product.id}/images/order/", {"ids": [*ids[:2], 999999]}, format="json").status_code
            == 400
        )
        assert audits("product.images_reordered").count() == 1

    def test_deleting_an_image_removes_the_row_and_all_its_files(self, admin, product, media):
        keep = self.add(admin, product, alt="keep").json()["id"]
        gone = self.add(admin, product, alt="gone").json()["id"]
        assert len(stored_files(media)) == 8
        res = admin.delete(f"{URL}{product.id}/images/{gone}/")
        assert res.status_code == 204
        assert list(product.images.values_list("id", flat=True)) == [keep] and len(stored_files(media)) == 4
        assert audits("product.image_removed").get().before["alt_text"] == "gone"

    def test_images_of_other_products_are_off_limits(self, admin, product, product_factory, media):
        other = product_factory(sku="OTH", name="Other")
        theirs = self.add(admin, other).json()["id"]
        assert admin.delete(f"{URL}{product.id}/images/{theirs}/").status_code == 404
        assert (
            admin.patch(f"{URL}{product.id}/images/{theirs}/", {"alt_text": "stolen"}, format="json").status_code == 404
        )
        assert other.images.count() == 1

    def test_alt_text_can_be_edited(self, admin, product, media):
        image_id = self.add(admin, product).json()["id"]
        res = admin.patch(f"{URL}{product.id}/images/{image_id}/", {"alt_text": "Three red apples"}, format="json")
        assert res.status_code == 200 and ProductImage.objects.get(pk=image_id).alt_text == "Three red apples"
        assert admin.patch(f"{URL}{product.id}/images/{image_id}/", {"alt_text": ""}, format="json").status_code == 400

    def test_uploaded_images_appear_on_the_storefront(self, admin, product, stock_up, api, media):
        stock_up(product, 5)
        self.add(admin, product, alt="Gala apples in a bowl")
        card = api.get("/api/v1/products/").json()["results"][0]
        assert card["image"]["alt"] == "Gala apples in a bowl" and "320" in card["image"]["urls"]
