"""Staff catalog API: categories (two-level tree), brands, collections, unit / allergen lookups and review moderation."""

from decimal import Decimal

import pytest
from django.core.cache import cache

from apps.catalog.models import Brand, Category, Collection, CollectionItem, Product, Review
from apps.core import rbac
from apps.core.models import AuditLog
from tests.admin.conftest import results
from tests.admin.helpers import BAD_UPLOADS, STAFF_ROLES, details, stored_files, upload
from tests.conftest import make_user

pytestmark = pytest.mark.django_db


@pytest.fixture
def media(settings, tmp_path):
    """Point uploads at a throw-away folder so the test can assert exactly which files exist."""
    settings.MEDIA_ROOT = str(tmp_path)
    return tmp_path


D = Decimal
BASE = "/api/v1/admin/"
CATEGORY_WRITERS = {"SUPER_ADMIN", "ADMIN"}
COLLECTION_WRITERS = {"SUPER_ADMIN", "ADMIN", "MARKETING_MANAGER"}
REVIEW_STAFF = {"SUPER_ADMIN", "ADMIN", "MARKETING_MANAGER"}


def audits(action):
    return AuditLog.objects.filter(action=action)


# =============================================================================================== categories
@pytest.fixture
def dept(db):
    return Category.objects.create(name="Dairy & eggs", slug="dairy-eggs")


class TestCategories:
    URL = BASE + "categories/"

    def test_matrix_documented_against_rbac(self):
        assert {r for r in rbac.STAFF_ROLES if rbac.role_has(r, "catalog.write")} == CATEGORY_WRITERS
        assert {r for r in rbac.STAFF_ROLES if rbac.role_has(r, "catalog.merchandise")} == COLLECTION_WRITERS

    @pytest.mark.parametrize("role", STAFF_ROLES)
    def test_role_matrix(self, role, staff, dept):
        c = staff(role)
        assert c.get(self.URL).status_code == 200
        res = c.post(self.URL, {"name": f"Cat {role}", "parent": dept.id}, format="json")
        assert res.status_code == (201 if role in CATEGORY_WRITERS else 403), (role, res.content)
        res = c.patch(f"{self.URL}{dept.id}/", {"description": "x"}, format="json")
        assert res.status_code == (200 if role in CATEGORY_WRITERS else 403)

    def test_creates_a_two_level_tree_with_generated_slugs_and_audit(self, admin, dept):
        res = admin.post(self.URL, {"name": "Free-range eggs", "parent": dept.id, "sort_order": 5}, format="json")
        assert res.status_code == 201 and res.json()["slug"] == "free-range-eggs" and res.json()["parent"] == dept.id
        assert res.json()["product_count"] == 0 and res.json()["children_count"] == 0
        assert audits("category.created").get().after["name"] == "Free-range eggs"
        listed = results(admin.get(self.URL, {"parent": dept.id}))
        assert [c["name"] for c in listed] == ["Free-range eggs"]
        assert results(admin.get(self.URL, {"parent": "null"}))[0]["children_count"] == 1

    def test_third_level_self_parent_and_reparenting_a_parent_are_refused(self, admin, dept):
        child = Category.objects.create(name="Eggs", slug="eggs", parent=dept)
        other = Category.objects.create(name="Bakery", slug="bakery")
        grandchild = admin.post(self.URL, {"name": "Duck eggs", "parent": child.id}, format="json")
        assert grandchild.status_code == 400 and "parent" in details(grandchild)
        self_parent = admin.patch(f"{self.URL}{other.id}/", {"parent": other.id}, format="json")
        assert self_parent.status_code == 400 and "parent" in details(self_parent)
        moved = admin.patch(
            f"{self.URL}{dept.id}/", {"parent": other.id}, format="json"
        )  # dept has children -> would be level 3
        assert moved.status_code == 400 and "sub-categories" in str(details(moved)["parent"])
        assert (
            admin.patch(f"{self.URL}{child.id}/", {"parent": other.id}, format="json").status_code == 200
        )  # a leaf can move

    def test_slug_must_be_unique_and_valid(self, admin, dept):
        assert admin.post(self.URL, {"name": "Other", "slug": "dairy-eggs"}, format="json").status_code == 400
        assert admin.post(self.URL, {"name": "Other", "slug": "Bad Slug!"}, format="json").status_code == 400

    def test_cannot_deactivate_while_active_products_remain_and_the_error_explains_why(
        self, admin, dept, product_factory
    ):
        child = Category.objects.create(name="Eggs", slug="eggs", parent=dept)
        product_factory(sku="EGG", name="Eggs x6", category=child)
        res = admin.patch(f"{self.URL}{child.id}/", {"is_active": False}, format="json")
        assert res.status_code == 409 and res.json()["error"]["code"] == "INVALID_STATE"
        assert (
            "1 active product" in res.json()["error"]["message"]
            and res.json()["error"]["details"]["active_products"] == 1
        )
        child.refresh_from_db()
        assert child.is_active is True and not audits("category.updated").exists()
        Product.objects.filter(category=child).update(status="INACTIVE")
        assert admin.patch(f"{self.URL}{child.id}/", {"is_active": False}, format="json").status_code == 200

    def test_cannot_deactivate_a_department_with_active_subcategories(self, admin, dept):
        Category.objects.create(name="Eggs", slug="eggs", parent=dept)
        res = admin.patch(f"{self.URL}{dept.id}/", {"is_active": False}, format="json")
        assert res.status_code == 409 and "active sub-categor" in res.json()["error"]["message"]

    def test_delete_guards_and_audit(self, admin, dept, product_factory):
        child = Category.objects.create(name="Eggs", slug="eggs", parent=dept)
        has_children = admin.delete(f"{self.URL}{dept.id}/")
        assert has_children.status_code == 409 and "1 sub-categor" in has_children.json()["error"]["message"]
        product_factory(sku="EGG", name="Eggs x6", category=child, status="ARCHIVED")
        has_products = admin.delete(f"{self.URL}{child.id}/")  # archived products still block (the FK is protected)
        assert has_products.status_code == 409 and "1 product" in has_products.json()["error"]["message"]
        Product.objects.all().delete()
        assert admin.delete(f"{self.URL}{child.id}/").status_code == 204
        assert admin.delete(f"{self.URL}{dept.id}/").status_code == 204
        assert (
            audits("category.deleted").count() == 2 and not Category.objects.filter(pk__in=[child.pk, dept.pk]).exists()
        )

    def test_storefront_category_tree_follows_edits_immediately(self, admin, category, product_factory, stock_up, api):
        product_factory(sku="P1", name="Pear", category=category)
        assert [c["name"] for c in api.get("/api/v1/categories/").json()[0]["children"]] == ["Fruit"]
        admin.patch(
            f"{self.URL}{category.id}/", {"name": "Fresh fruit"}, format="json"
        )  # cached for 10 minutes otherwise
        assert [c["name"] for c in api.get("/api/v1/categories/").json()[0]["children"]] == ["Fresh fruit"]

    def test_image_upload_replace_and_remove_clean_up_files(self, admin, dept, media):
        res = admin.post(f"{self.URL}{dept.id}/image/", {"image": upload("PNG")}, format="multipart")
        assert res.status_code == 200 and set(res.json()["image"]) == {"original", "320", "640", "1024"}
        dept.refresh_from_db()
        assert dept.image_widths == [320, 640, 1024] and len(stored_files(media)) == 4
        first_files = stored_files(media)
        admin.post(f"{self.URL}{dept.id}/image/", {"image": upload("JPEG")}, format="multipart")
        assert len(stored_files(media)) == 4 and stored_files(media).isdisjoint(
            first_files
        )  # the old picture was removed
        assert admin.delete(f"{self.URL}{dept.id}/image/").status_code == 204
        dept.refresh_from_db()
        assert not dept.image and dept.image_widths == [] and stored_files(media) == set()

    def test_a_new_upload_never_reuses_an_earlier_image_url(self, admin, dept, media):
        """Media is served `immutable` for a year, so a name that was ever used must never come back with new content."""
        seen = set()
        for _ in range(3):
            admin.post(f"{self.URL}{dept.id}/image/", {"image": upload("PNG")}, format="multipart")
            dept.refresh_from_db()
            assert dept.image.name not in seen
            seen.add(dept.image.name)
            admin.delete(f"{self.URL}{dept.id}/image/")  # frees the name under the old scheme

    @pytest.mark.parametrize("kind", sorted(BAD_UPLOADS))
    def test_unsafe_category_images_are_rejected(self, kind, admin, dept, media):
        res = admin.post(f"{self.URL}{dept.id}/image/", {"image": BAD_UPLOADS[kind]()}, format="multipart")
        assert res.status_code == 400 and "image" in details(res) and stored_files(media) == set()

    def test_deleting_a_category_removes_its_image(self, admin, dept, media):
        admin.post(f"{self.URL}{dept.id}/image/", {"image": upload("WEBP")}, format="multipart")
        assert stored_files(media)
        assert admin.delete(f"{self.URL}{dept.id}/").status_code == 204 and stored_files(media) == set()


# =============================================================================================== brands
class TestBrands:
    URL = BASE + "brands/"

    @pytest.mark.parametrize("role", STAFF_ROLES)
    def test_role_matrix(self, role, staff, brand):
        c = staff(role)
        assert c.get(self.URL).status_code == 200
        res = c.post(self.URL, {"name": f"Brand {role}"}, format="json")
        assert res.status_code == (201 if role in CATEGORY_WRITERS else 403)

    def test_names_are_unique_ignoring_case_and_slugs_are_generated(self, admin, brand):
        res = admin.post(self.URL, {"name": "Green Valley"}, format="json")
        assert res.status_code == 201 and res.json()["slug"] == "green-valley"
        dup = admin.post(self.URL, {"name": "TEST FARM"}, format="json")
        assert dup.status_code == 400 and "name" in details(dup)
        clash = admin.patch(f"{self.URL}{res.json()['id']}/", {"name": " test farm "}, format="json")
        assert clash.status_code == 400
        assert (
            admin.patch(f"{self.URL}{brand.id}/", {"name": "TEST FARM"}, format="json").status_code == 200
        )  # own name, new case

    def test_update_is_audited_and_is_demo_is_not_assignable(self, admin, brand):
        res = admin.patch(
            f"{self.URL}{brand.id}/", {"description": "Family farm", "is_demo": True, "is_active": False}, format="json"
        )
        assert res.status_code == 200
        brand.refresh_from_db()
        assert brand.is_demo is False and brand.is_active is False
        entry = audits("brand.updated").get()
        assert entry.before["description"] == "" and entry.after["description"] == "Family farm"

    def test_brand_with_products_cannot_be_deleted(self, admin, brand, product_factory):
        product_factory(sku="B1", name="Jam", brand=brand)
        res = admin.delete(f"{self.URL}{brand.id}/")
        assert res.status_code == 409 and res.json()["error"]["details"] == {"products": 1}
        listed = results(admin.get(self.URL))
        assert listed[0]["product_count"] == 1
        Product.objects.all().delete()
        assert admin.delete(f"{self.URL}{brand.id}/").status_code == 204
        assert audits("brand.deleted").get().before["name"] == "Test Farm"

    def test_search_and_active_filter(self, admin, brand):
        Brand.objects.create(name="Old Mill", slug="old-mill", is_active=False)
        assert [b["name"] for b in results(admin.get(self.URL, {"search": "mill"}))] == ["Old Mill"]
        assert [b["name"] for b in results(admin.get(self.URL, {"is_active": "false"}))] == ["Old Mill"]


# =============================================================================================== collections
@pytest.fixture
def basket(product_factory):
    return [product_factory(sku=f"C{n}", name=f"Item {n}") for n in range(3)]


class TestCollections:
    URL = BASE + "collections/"

    @pytest.mark.parametrize("role", STAFF_ROLES)
    def test_role_matrix_marketing_curates_collections(self, role, staff):
        c = staff(role)
        assert c.get(self.URL).status_code == 200
        res = c.post(self.URL, {"name": f"Picks by {role}"}, format="json")
        assert res.status_code == (201 if role in COLLECTION_WRITERS else 403), (role, res.content)

    def test_crud_audit_and_date_window_validation(self, admin):
        res = admin.post(
            self.URL,
            {"name": "Summer BBQ", "starts_on": "2026-06-01", "ends_on": "2026-08-31", "show_on_home": True},
            format="json",
        )
        assert res.status_code == 201 and res.json()["slug"] == "summer-bbq"
        bad = admin.post(
            self.URL, {"name": "Backwards", "starts_on": "2026-06-01", "ends_on": "2026-05-01"}, format="json"
        )
        assert bad.status_code == 400 and "ends_on" in details(bad)
        pk = res.json()["id"]
        admin.patch(f"{self.URL}{pk}/", {"name": "Summer grilling"}, format="json")
        assert audits("collection.updated").get().before["name"] == "Summer BBQ"
        assert admin.delete(f"{self.URL}{pk}/").status_code == 204 and audits("collection.deleted").count() == 1

    def test_membership_is_ordered_replaced_and_audited(self, admin, basket):
        pk = admin.post(self.URL, {"name": "Weekly picks"}, format="json").json()["id"]
        a, b, c = [p.id for p in basket]
        res = admin.put(f"{self.URL}{pk}/products/", {"product_ids": [c, a, b]}, format="json")
        assert (
            res.status_code == 200
            and [m["id"] for m in res.json()] == [c, a, b]
            and [m["sort_order"] for m in res.json()] == [0, 1, 2]
        )
        assert [m["id"] for m in admin.get(f"{self.URL}{pk}/products/").json()] == [c, a, b]
        res = admin.put(f"{self.URL}{pk}/products/", {"product_ids": [b]}, format="json")
        assert [m["id"] for m in res.json()] == [b] and CollectionItem.objects.filter(collection_id=pk).count() == 1
        entry = audits("collection.products_updated").first()
        assert entry.before == {"product_ids": [c, a, b]} and entry.after == {"product_ids": [b]}
        assert results(admin.get(self.URL))[0]["product_count"] == 1

    def test_membership_accepts_a_products_key_as_an_alias(self, admin, basket):
        pk = admin.post(self.URL, {"name": "Weekly picks"}, format="json").json()["id"]
        res = admin.put(f"{self.URL}{pk}/products/", {"products": [basket[1].id, basket[0].id]}, format="json")
        assert res.status_code == 200 and [m["id"] for m in res.json()] == [basket[1].id, basket[0].id]

    def test_membership_validation(self, admin, basket):
        pk = admin.post(self.URL, {"name": "Weekly picks"}, format="json").json()["id"]
        dup = admin.put(f"{self.URL}{pk}/products/", {"product_ids": [basket[0].id, basket[0].id]}, format="json")
        assert dup.status_code == 400 and "product_ids" in details(dup)
        unknown = admin.put(f"{self.URL}{pk}/products/", {"product_ids": [basket[0].id, 987654]}, format="json")
        assert unknown.status_code == 400 and "987654" in str(details(unknown))
        assert admin.put(f"{self.URL}{pk}/products/", {}, format="json").status_code == 400
        assert not CollectionItem.objects.exists()

    def test_storefront_caches_are_invalidated(self, admin, basket, api):
        pk = admin.post(self.URL, {"name": "Weekly picks"}, format="json").json()["id"]
        version = cache.get("ver:catalog")
        admin.put(f"{self.URL}{pk}/products/", {"product_ids": [basket[0].id]}, format="json")
        assert (
            cache.get("ver:catalog") != version
        )  # bulk membership writes bypass signals, so the view bumps explicitly
        assert [c["name"] for c in api.get("/api/v1/collections/").json()] == ["Weekly picks"]

    def test_members_are_scoped_to_their_collection(self, admin, basket):
        one = admin.post(self.URL, {"name": "One"}, format="json").json()["id"]
        two = admin.post(self.URL, {"name": "Two"}, format="json").json()["id"]
        admin.put(f"{self.URL}{one}/products/", {"product_ids": [basket[0].id]}, format="json")
        assert admin.get(f"{self.URL}{two}/products/").json() == []
        assert Collection.objects.count() == 2


# =============================================================================================== lookups
class TestLookups:
    @pytest.mark.parametrize("role", STAFF_ROLES)
    @pytest.mark.parametrize("name", ["units", "allergens"])
    def test_every_staff_role_can_read_lookups(self, role, name, staff, units):
        res = staff(role).get(f"{BASE}{name}/")
        assert res.status_code == 200 and len(res.json()) >= 10

    def test_units_and_allergens_have_the_reference_data(self, admin, units):
        codes = {u["code"] for u in admin.get(f"{BASE}units/").json()}
        assert {"each", "kg", "g", "l", "pack"} <= codes
        assert any(a["code"] == "milk" for a in admin.get(f"{BASE}allergens/").json())

    @pytest.mark.parametrize("name", ["units", "allergens"])
    def test_lookups_are_strictly_read_only(self, name, admin, units):
        assert admin.post(f"{BASE}{name}/", {"code": "x", "name": "X"}, format="json").status_code == 405
        pk = admin.get(f"{BASE}{name}/").json()[0]["id"]
        assert admin.patch(f"{BASE}{name}/{pk}/", {"name": "Changed"}, format="json").status_code == 405
        assert admin.delete(f"{BASE}{name}/{pk}/").status_code == 405


# =============================================================================================== reviews
@pytest.fixture
def reviews(product_factory):
    p = product_factory(sku="REV", name="Reviewed jam")
    people = [make_user(email=f"r{n}@example.com", full_name=f"Reviewer {n}") for n in range(3)]
    return [
        Review.objects.create(product=p, user=people[0], rating=5, title="Great", body="Lovely", status="PENDING"),
        Review.objects.create(product=p, user=people[1], rating=1, title="Bad", body="Spam", status="PENDING"),
        Review.objects.create(product=p, user=people[2], rating=3, title="Fine", status="APPROVED"),
    ]


class TestReviewModeration:
    URL = BASE + "reviews/"

    @pytest.mark.parametrize("role", STAFF_ROLES)
    def test_role_matrix(self, role, staff, reviews):
        c = staff(role)
        allowed = role in REVIEW_STAFF
        assert c.get(self.URL).status_code == (200 if allowed else 403)
        assert c.post(f"{self.URL}{reviews[0].id}/approve/", {}, format="json").status_code == (200 if allowed else 403)
        assert c.post(f"{self.URL}{reviews[1].id}/reject/", {}, format="json").status_code == (200 if allowed else 403)

    def test_list_by_status_without_exposing_email(self, admin, reviews):
        pending = results(admin.get(self.URL, {"status": "PENDING"}))
        assert {r["title"] for r in pending} == {"Great", "Bad"}
        assert {r["title"] for r in results(admin.get(self.URL, {"status": "approved"}))} == {"Fine"}
        assert "r0@example.com" not in str(pending) and pending[0]["author"].startswith("Reviewer")
        assert pending[0]["product"]["sku"] == "REV"
        assert admin.get(self.URL, {"status": "MAYBE"}).status_code == 400

    def test_approve_and_reject_update_the_product_rating_and_are_audited(self, admin, reviews):
        product = reviews[0].product
        product.refresh_from_db()
        assert (product.rating_count, product.rating_avg) == (1, D("3.00"))
        res = admin.post(f"{self.URL}{reviews[0].id}/approve/", {"note": "genuine"}, format="json")
        assert res.status_code == 200 and res.json()["status"] == "APPROVED"
        product.refresh_from_db()
        assert (product.rating_count, product.rating_avg) == (2, D("4.00"))
        res = admin.post(f"{self.URL}{reviews[1].id}/reject/", {"note": "spam"}, format="json")
        assert res.json()["status"] == "REJECTED"
        product.refresh_from_db()
        assert product.rating_count == 2  # a rejected review never counts
        approved = audits("review.approved").get()
        assert (
            approved.before == {"status": "PENDING"}
            and approved.after == {"status": "APPROVED"}
            and approved.summary == "genuine"
        )
        assert audits("review.rejected").get().summary == "spam"

    def test_repeating_a_decision_is_a_harmless_no_op_and_decisions_can_be_reversed(self, admin, reviews):
        admin.post(f"{self.URL}{reviews[2].id}/approve/", {}, format="json")
        assert not audits("review.approved").exists()  # already approved
        assert admin.post(f"{self.URL}{reviews[2].id}/reject/", {}, format="json").json()["status"] == "REJECTED"
        assert admin.post(f"{self.URL}{reviews[2].id}/approve/", {}, format="json").json()["status"] == "APPROVED"

    def test_reviews_cannot_be_edited_or_deleted_by_staff(self, admin, reviews):
        assert admin.patch(f"{self.URL}{reviews[0].id}/", {"body": "edited"}, format="json").status_code == 405
        assert admin.delete(f"{self.URL}{reviews[0].id}/").status_code == 405
        assert admin.post(self.URL, {"rating": 5}, format="json").status_code == 405

    def test_unknown_review_is_404(self, admin):
        assert admin.post(f"{self.URL}999999/approve/", {}, format="json").status_code == 404
