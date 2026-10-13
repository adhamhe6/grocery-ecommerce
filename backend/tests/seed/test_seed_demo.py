"""Tests for the `seed_demo` management command and the data it creates (uses the real PostgreSQL test database)."""

from __future__ import annotations

import datetime as dt
import io
import re
from collections import Counter
from decimal import Decimal
from pathlib import Path

import pytest
from django.core.files.storage import default_storage
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db.models import Count, F, Q, Sum
from django.utils import timezone
from PIL import Image

from apps.accounts.models import Address, User
from apps.catalog import images as catalog_images
from apps.catalog.models import (
    Brand,
    Category,
    ClaimKind,
    Collection,
    NutritionFact,
    Product,
    ProductAllergen,
    ProductClaim,
    ProductImage,
    ProductStatus,
    Review,
    SaleUnit,
    StockMode,
)
from apps.content.models import FAQ, Article, Banner, Page
from apps.core import rbac
from apps.core.models import StoreSettings
from apps.core.seed import catalog_data, content_data, imaging, ops_data
from apps.core.seed.accounts_data import DEFAULT_PASSWORD, DEMO_DOMAIN, REVIEWS
from apps.core.seed.common import DEMO_REF, today
from apps.inventory.availability import availability_map, sellable_batch_q
from apps.inventory.models import Batch, BatchStatus, MovementKind, QualityStatus, StockLevel, StockMovement
from apps.promotions.engine import apply_promo, load_index
from apps.promotions.models import Coupon, Promotion
from apps.purchasing.models import PurchaseOrder, Supplier, SupplierProduct
from apps.stores.models import Branch, BranchClosure, BranchHours, DeliverySlot, DeliveryZone, SlotKind
from apps.stores.services import find_zone

pytestmark = pytest.mark.django_db

BANNED = ("organic", "farm fresh", "locally sourced", "healthy", "natural", "chemical-free")


# --------------------------------------------------------------------------- fixtures
@pytest.fixture(scope="module")
def seeded(django_db_setup, django_db_blocker):
    """Run the seed once for the module (committed), and remove only demo rows afterwards."""
    with django_db_blocker.unblock():
        had_settings = StoreSettings.objects.filter(pk=1).exists()
        out = io.StringIO()
        call_command("seed_demo", "--skip-images", "--force", stdout=out)
    yield out.getvalue()
    with django_db_blocker.unblock():
        call_command("seed_demo", "--reset-demo", "--no-seed", "--force", stdout=io.StringIO())
        if not had_settings:
            StoreSettings.objects.filter(pk=1).delete()


def demo_products():
    return Product.objects.filter(is_demo=True)


def visible_products():
    return demo_products().filter(status=ProductStatus.ACTIVE, is_available=True)


def snapshot() -> dict[str, int]:
    return {
        "branches": Branch.objects.count(),
        "hours": BranchHours.objects.count(),
        "zones": DeliveryZone.objects.count(),
        "slots": DeliverySlot.objects.count(),
        "users": User.objects.count(),
        "addresses": Address.objects.count(),
        "categories": Category.objects.count(),
        "brands": Brand.objects.count(),
        "products": Product.objects.count(),
        "claims": ProductClaim.objects.count(),
        "allergens": ProductAllergen.objects.count(),
        "nutrition": NutritionFact.objects.count(),
        "collections": Collection.objects.count(),
        "reviews": Review.objects.count(),
        "suppliers": Supplier.objects.count(),
        "supplier_products": SupplierProduct.objects.count(),
        "pos": PurchaseOrder.objects.count(),
        "stock_levels": StockLevel.objects.count(),
        "batches": Batch.objects.count(),
        "movements": StockMovement.objects.count(),
        "promotions": Promotion.objects.count(),
        "coupons": Coupon.objects.count(),
        "pages": Page.objects.count(),
        "faqs": FAQ.objects.count(),
        "articles": Article.objects.count(),
        "banners": Banner.objects.count(),
    }


# --------------------------------------------------------------------------- command behaviour
def test_refuses_to_run_with_debug_off_without_force(settings):
    settings.DEBUG = False
    with pytest.raises(CommandError, match="DEBUG is off"):
        call_command("seed_demo", "--skip-images", stdout=io.StringIO())


def test_no_seed_requires_reset(settings):
    settings.DEBUG = True
    with pytest.raises(CommandError, match="--reset-demo"):
        call_command("seed_demo", "--no-seed", stdout=io.StringIO())


def test_summary_table_is_printed(seeded):
    assert "Products" in seeded and "Batches" in seeded and "Demo data is ready." in seeded


def test_second_run_creates_nothing_and_keeps_counts(seeded):
    before = snapshot()
    out = io.StringIO()
    call_command("seed_demo", "--skip-images", "--force", stdout=out)
    assert snapshot() == before
    created_now = [line.split()[-1] for line in out.getvalue().splitlines() if re.search(r"\s\d+\s+\d+$", line)]
    assert set(created_now) == {"0"}, out.getvalue()


def test_password_comes_from_option_env_or_default(seeded, monkeypatch):
    user = User.objects.get(email=f"admin@{DEMO_DOMAIN}")
    assert user.check_password(DEFAULT_PASSWORD)
    call_command("seed_demo", "--skip-images", "--force", "--password", "Another-Demo-Pass-1", stdout=io.StringIO())
    user.refresh_from_db()
    assert user.check_password("Another-Demo-Pass-1")
    monkeypatch.setenv("DEMO_PASSWORD", "Env-Demo-Pass-2")
    call_command("seed_demo", "--skip-images", "--force", stdout=io.StringIO())
    user.refresh_from_db()
    assert user.check_password("Env-Demo-Pass-2")


# --------------------------------------------------------------------------- store, branches, slots
def test_store_settings_are_demo_labelled(seeded):
    s = StoreSettings.objects.get(pk=1)
    assert (s.name, s.tagline) == ("Orchard Row", "Fresh, honestly labelled.")
    assert s.demo_mode and s.socials_are_placeholders
    assert s.currency == "USD" and s.locale == "en-US" and s.timezone == "America/New_York"
    assert s.support_email.endswith(".example") and s.support_phone.startswith("+1 555 01")
    for url in (s.instagram_url, s.facebook_url, s.x_url, s.youtube_url, s.tiktok_url):
        assert url.startswith("https://") and "demo" in url


def test_branches_hours_zones_and_closure(seeded):
    central, north = Branch.objects.get(code="central"), Branch.objects.get(code="north")
    assert central.is_default and not north.is_default and central.is_demo and north.is_demo
    for branch in (central, north):
        assert BranchHours.objects.filter(branch=branch).count() == 7
    assert BranchHours.objects.get(branch=north, weekday=6).is_closed
    zones = {z.name: z for z in DeliveryZone.objects.all()}
    assert {"RW1", "RW2"} <= {p for z in DeliveryZone.objects.filter(branch=central) for p in z.postcode_prefixes}
    assert {"RW3", "RW4"} <= {p for z in DeliveryZone.objects.filter(branch=north) for p in z.postcode_prefixes}
    assert len({(z.delivery_fee, z.free_delivery_threshold, z.min_order_value) for z in zones.values()}) == 4
    closure = BranchClosure.objects.get()
    assert closure.date >= today() + dt.timedelta(days=6)


def test_slots_exist_and_respect_hours_and_closures(seeded):
    slots = DeliverySlot.objects.select_related("branch", "zone")
    assert slots.filter(kind=SlotKind.DELIVERY).exists() and slots.filter(kind=SlotKind.PICKUP).exists()
    closure = BranchClosure.objects.get()
    assert not DeliverySlot.objects.filter(branch=closure.branch, date=closure.date).exists()
    hours = {(h.branch_id, h.weekday): h for h in BranchHours.objects.all()}
    for slot in slots:
        h = hours[(slot.branch_id, slot.date.weekday())]
        assert not h.is_closed and h.opens <= slot.start_time and slot.end_time <= h.closes
        assert 6 <= slot.capacity <= 12
        if slot.kind == SlotKind.DELIVERY:
            assert slot.zone is not None and slot.fee == slot.zone.delivery_fee
    assert slots.filter(date__gte=today(), date__lte=today() + dt.timedelta(days=10)).count() == slots.count()


# --------------------------------------------------------------------------- catalogue targets
def test_catalogue_counts_and_structure(seeded):
    assert 120 <= demo_products().count() <= 140
    depts = Category.objects.filter(parent__isnull=True, slug__in=[d[0] for d in catalog_data.DEPARTMENTS])
    assert depts.count() == 7
    for dept in depts:
        assert not dept.parent_id
        assert dept.children.exists() and dept.description and dept.sort_order
    assert Category.objects.filter(parent__isnull=False).count() == 42
    sizes = Counter()
    for cat in Category.objects.filter(parent__isnull=False):
        n = visible_products().filter(category=cat).count()
        assert n >= 3, f"{cat.slug} has only {n} visible products"
        sizes[cat.parent.slug] += n
    assert sizes.most_common(1)[0][0] == "fresh-produce"
    assert Category.objects.filter(parent__isnull=True, show_on_home=True).count() >= 4
    assert 12 <= Brand.objects.filter(is_demo=True).count() <= 18


def test_every_product_is_curated_and_unique(seeded):
    products = list(demo_products().select_related("sale_unit", "brand", "category"))
    assert len({p.name for p in products}) == len(products)
    assert len({p.sku for p in products}) == len(products)
    assert len({p.barcode for p in products if p.barcode}) == len([p for p in products if p.barcode])
    assert 0 < len([p for p in products if p.barcode]) < len(products)
    for p in products:
        assert re.fullmatch(r"OR-[A-Z]{3}-\d{4}", p.sku), p.sku
        assert not re.match(r"(?i)product\s*\d", p.name)
        assert p.short_description and len(p.short_description) <= 200
        sentences = [s for s in re.split(r"(?<=[.!?])\s+", p.description.strip()) if s]
        assert 2 <= len(sentences) <= 4, (p.name, len(sentences))
        assert p.tax_rate == 0 and p.is_demo
        assert p.qty_min > 0 and p.qty_step > 0 and (p.qty_max is None or p.qty_max >= p.qty_min)
        assert p.packaging and p.storage_instructions
        assert p.manufacturer == (p.brand.name if p.brand else "")
        if p.is_variable_weight:
            assert p.sale_unit.is_weight
        if p.sale_unit.code == "kg":
            assert p.qty_step == Decimal("0.25") and Decimal("0.25") <= p.qty_min <= Decimal("1.25")
        if p.sale_unit.kind != "COUNT" and not p.is_variable_weight:
            raise AssertionError(f"weight-priced product not flagged variable weight: {p.name}")
        if p.tracks_batches:
            assert p.stock_mode == StockMode.TRACKED
        p.full_clean(exclude=["slug", "search_vector", "search_text"])
    # the requested range of selling units is represented
    codes = Counter(p.sale_unit.code for p in products)
    assert {"kg", "each", "pack", "dozen", "bundle", "100g", "box"} <= set(codes)
    assert demo_products().filter(net_content_unit__code__in=["ml", "l"]).exists()
    assert (
        demo_products().filter(storage_type="FROZEN").exists()
        and demo_products().filter(product_type="HOUSEHOLD").exists()
    )
    assert demo_products().filter(stock_mode=StockMode.MADE_TO_ORDER, tracks_batches=False).count() >= 2
    assert demo_products().filter(is_featured=True).count() >= 10
    popularity = list(visible_products().order_by("-popularity").values_list("popularity", flat=True))
    assert popularity[0] > popularity[10] > popularity[30] and len(set(popularity[:30])) == 30


def test_admin_state_products_exist(seeded):
    assert demo_products().filter(status=ProductStatus.INACTIVE).count() == 1
    assert demo_products().filter(status=ProductStatus.ARCHIVED).count() == 1
    assert demo_products().filter(status=ProductStatus.ACTIVE, is_available=False).count() == 1


def test_no_banned_marketing_language_anywhere(seeded):
    texts = []
    for p in demo_products():
        texts += [p.name, p.short_description, p.description, p.packaging, p.storage_instructions, p.ingredients]
    texts += [b.description for b in Brand.objects.filter(is_demo=True)]
    texts += [c.description for c in Category.objects.all()] + [c.description for c in Collection.objects.all()]
    texts += [x for page in Page.objects.all() for x in (page.title, page.summary, page.body)]
    texts += [x for f in FAQ.objects.all() for x in (f.question, f.answer)]
    texts += [x for a in Article.objects.all() for x in (a.title, a.summary, a.body)]
    texts += [x for b in Banner.objects.all() for x in (b.title, b.subtitle)]
    texts += [x for r in Review.objects.all() for x in (r.title, r.body)]
    texts += [x for pr in Promotion.objects.all() for x in (pr.name, pr.label)]
    texts += [c.description for c in Coupon.objects.all()]
    for text in texts:
        lowered = text.lower()
        for word in BANNED:
            assert word not in lowered, f"banned word {word!r} in: {text[:80]}"
    # claim evidence only ever says "awaiting ..." for certificate-type claims
    for claim in ProductClaim.objects.filter(verified=False):
        assert claim.evidence.startswith("Awaiting")


# --------------------------------------------------------------------------- honest trust data
def test_origin_is_limited_and_labelled_demo(seeded):
    with_origin = demo_products().exclude(origin_country="")
    assert 0 < with_origin.count() <= 12
    for p in with_origin:
        assert p.origin_note.startswith("Demo data:")
    assert not demo_products().filter(origin_country="").exclude(origin_note="").exists()


def test_claims_unverified_by_default_and_verified_only_when_inherent(seeded):
    unverified = ProductClaim.objects.filter(verified=False)
    assert unverified.exists()
    certificate_kinds = {
        ClaimKind.ORGANIC,
        ClaimKind.FAIRTRADE,
        ClaimKind.HALAL,
        ClaimKind.KOSHER,
        ClaimKind.GLUTEN_FREE,
    }
    assert {c.kind for c in unverified} & certificate_kinds
    for claim in ProductClaim.objects.filter(kind__in=[*certificate_kinds, ClaimKind.LOCALLY_GROWN]):
        assert not claim.verified and claim.evidence == "Awaiting supplier certificate (demo)"
    verified = ProductClaim.objects.filter(verified=True)
    assert verified.exists()
    assert {c.kind for c in verified} <= {ClaimKind.VEGAN, ClaimKind.VEGETARIAN}
    assert {c.evidence for c in verified} == {"Plain single-ingredient product (demo record)"}
    for claim in verified.select_related("product"):
        assert claim.product.is_demo and claim.verified_at is not None
        assert not claim.product.ingredients or "," not in claim.product.ingredients.split("(")[0]


def test_nutrition_is_limited_generic_and_labelled(seeded):
    rows = NutritionFact.objects.all()
    assert 0 < rows.count() <= 12
    for row in rows:
        assert row.is_demo and row.basis == "per 100 g"
        assert row.source == "Generic reference values (demo) — replace with supplier label data"
        assert row.product.is_demo and row.product.name in catalog_data.NUTRITION


ALLERGEN_RULES = {
    "gluten": ("wheat", "barley", "oats", "semolina"),
    "milk": ("milk", "cream", "cheese", "mozzarella", "bechamel", "yogurt"),
    "eggs": ("egg",),
    "peanuts": ("peanut",),
    "tree-nuts": ("almond", "cashew", "hazelnut", "walnut", "pecan", "pistachio"),
    "soybeans": ("soy",),
    "sesame": ("sesame", "tahini"),
    "fish": ("fish", "cod", "tuna", "salmon"),
    "crustaceans": ("shrimp",),
    "mustard": ("mustard",),
    "sulphites": ("sulphur dioxide",),
}


def derived_allergens(ingredients: str) -> set[str]:
    text = ingredients.lower().replace("cocoa butter", "").replace("coconut milk", "")
    found = {code for code, words in ALLERGEN_RULES.items() if any(w in text for w in words)}
    if re.search(r"\bbutter\b", text):
        found.add("milk")
    return found


def test_allergens_only_where_ingredients_support_them(seeded):
    complete = demo_products().filter(allergen_info_complete=True)
    unconfirmed = demo_products().filter(allergen_info_complete=False)
    assert complete.count() >= 40 and unconfirmed.count() >= 20
    assert not unconfirmed.filter(allergens__isnull=False).exists()
    for p in complete:
        declared = set(p.allergens.filter(level="CONTAINS").values_list("allergen__code", flat=True))
        assert declared == derived_allergens(p.ingredients), p.name
    assert ProductAllergen.objects.filter(level="MAY_CONTAIN").exists()
    # loose produce never claims a confirmed allergen list
    assert not demo_products().filter(product_type="LOOSE_PRODUCE", allergen_info_complete=True).exists()


# --------------------------------------------------------------------------- public API
def public_listing(api):
    names, page = [], 1
    while True:
        res = api.get("/api/v1/products/", {"page_size": 100, "page": page})
        assert res.status_code == 200
        body = res.json()
        names += [r["slug"] for r in body["results"]]
        if not body["next"]:
            return names
        page += 1


def test_public_api_hides_inactive_archived_and_unavailable(seeded, api):
    listed = set(public_listing(api))
    hidden = demo_products().exclude(status=ProductStatus.ACTIVE) | demo_products().filter(is_available=False)
    assert hidden.count() == 3
    for p in hidden:
        assert p.slug not in listed
        assert api.get(f"/api/v1/products/{p.slug}/").status_code == 404
    assert listed == set(visible_products().values_list("slug", flat=True))
    detail = api.get("/api/v1/products/bananas/").json()
    assert detail["unit_price"]["per"] == "kg" and detail["rating"]["is_demo"] is True


def test_public_api_only_shows_verified_claims_and_confirmed_allergens(seeded, api):
    body = api.get("/api/v1/products/vine-tomatoes/").json()
    assert {c["kind"] for c in body["claims"]} == {"VEGAN", "VEGETARIAN"}  # ORGANIC is seeded unverified
    assert api.get("/api/v1/products/", {"claim": "ORGANIC"}).json()["count"] == 0
    assert body["allergens"]["confirmed"] is False
    bread = api.get("/api/v1/products/sourdough-loaf/").json()
    assert bread["allergens"]["confirmed"] and "Cereals containing gluten" in bread["allergens"]["contains"]


# --------------------------------------------------------------------------- suppliers and purchasing
def test_suppliers_links_and_purchase_orders(seeded):
    assert Supplier.objects.filter(is_demo=True).count() == 6
    for s in Supplier.objects.filter(is_demo=True):
        assert s.email.endswith(".example") and s.phone.startswith("+1 555 01") and s.lead_time_days >= 1
    for link in SupplierProduct.objects.select_related("product"):
        ratio = link.unit_cost / link.product.price
        assert Decimal("0.54") <= ratio <= Decimal("0.71"), link.product.name
    assert SupplierProduct.objects.count() == demo_products().count()
    pos = PurchaseOrder.objects.filter(is_demo=True)
    assert 2 <= pos.count() <= 3 and {p.status for p in pos} <= {"DRAFT", "SUBMITTED", "CONFIRMED"}
    assert all(re.fullmatch(r"PO-DEMO-\d{4}", p.number) and p.lines.exists() for p in pos)
    assert not any(line.qty_received for p in pos for line in p.lines.all())


# --------------------------------------------------------------------------- inventory
def test_ledger_invariants_hold_for_every_stock_row(seeded):
    assert StockLevel.objects.count() > 100
    for level in StockLevel.objects.select_related("product"):
        ledger = StockMovement.objects.filter(product=level.product, branch=level.branch).aggregate(s=Sum("qty_delta"))[
            "s"
        ]
        assert (ledger or Decimal("0")) == level.on_hand, (level.product.name, level.branch.code)
        assert level.reserved == 0 and 0 <= level.reserved <= level.on_hand
        if level.product.tracks_batches:
            agg = Batch.objects.filter(product=level.product, branch=level.branch).aggregate(
                remaining=Sum("qty_remaining"), reserved=Sum("qty_reserved")
            )
            assert (agg["remaining"] or Decimal("0")) == level.on_hand, (level.product.name, level.branch.code)
            assert (agg["reserved"] or Decimal("0")) == 0
    for batch in Batch.objects.all():
        assert batch.qty_received > 0 and 0 <= batch.qty_remaining <= batch.qty_received and batch.qty_reserved == 0
        assert re.fullmatch(r"LOT-(CEN|NOR)-\d{4}-[A-Z]", batch.lot_code) and batch.is_demo and batch.unit_cost
        if batch.expiry_date:
            assert batch.sellable_until == batch.expiry_date - dt.timedelta(days=batch.product.sell_buffer_days)
    # every lot has a receipt; every movement running total is consistent
    assert Batch.objects.count() == StockMovement.objects.filter(kind=MovementKind.RECEIPT, batch__isnull=False).count()
    for movement in StockMovement.objects.filter(ref_type=DEMO_REF):
        assert movement.on_hand_after >= 0 and movement.ref_id


def test_stock_scenarios_are_present(seeded):
    central = Branch.objects.get(code="central")
    levels = StockLevel.objects.filter(product__is_demo=True)
    low = levels.filter(low_stock_threshold__gt=0, on_hand__gt=0, on_hand__lte=F("low_stock_threshold"))
    assert low.values("product").distinct().count() >= 10
    zero = levels.filter(branch=central, on_hand=0)
    assert zero.count() >= 6
    t = today()
    near = Batch.objects.filter(
        status=BatchStatus.ACTIVE, expiry_date__gte=t + dt.timedelta(days=1), expiry_date__lte=t + dt.timedelta(days=3)
    )
    assert near.count() >= 8
    expired = Batch.objects.filter(status=BatchStatus.EXPIRED)
    assert expired.count() >= 2 and all(b.expiry_date < t for b in expired)
    assert expired.filter(qty_remaining__gt=0).exists()
    assert StockMovement.objects.filter(kind=MovementKind.WASTE, reason_code="EXPIRED").exists()
    assert Batch.objects.filter(status=BatchStatus.QUARANTINED).count() == 1
    assert Batch.objects.filter(quality_status=QualityStatus.FAILED).count() == 1
    stocked_north = set(StockLevel.objects.filter(branch__code="north").values_list("product_id", flat=True))
    stocked_central = set(StockLevel.objects.filter(branch__code="central").values_list("product_id", flat=True))
    assert len(stocked_central - stocked_north) >= 3


def test_blocked_and_expired_batches_are_not_available(seeded):
    sellable = set(Batch.objects.filter(sellable_batch_q()).values_list("id", flat=True))
    for batch in Batch.objects.filter(
        Q(status__in=[BatchStatus.EXPIRED, BatchStatus.QUARANTINED]) | Q(quality_status=QualityStatus.FAILED)
    ):
        assert batch.id not in sellable
    # a product whose only lot was written off after expiry is out of stock at that branch
    central = Branch.objects.get(code="central")
    raspberries = Product.objects.get(name="Raspberries")
    avail = availability_map([raspberries], central.id)[raspberries.id]
    assert avail.status == "OUT_OF_STOCK"
    # a product with a blocked lot alongside a good lot is only available for the good lot's quantity
    cucumbers = Product.objects.get(name="Cucumbers")
    good = Batch.objects.get(product=cucumbers, branch=central, lot_code__endswith="-A")
    amap = availability_map([cucumbers], central.id)[cucumbers.id]
    assert amap.available_qty == good.qty_remaining
    failed = Batch.objects.get(product=cucumbers, branch=central, quality_status=QualityStatus.FAILED)
    assert (
        StockLevel.objects.get(product=cucumbers, branch=central).on_hand == good.qty_remaining + failed.qty_remaining
    )
    # sold-out / low-stock states reach the public API
    items = {r["name"]: r for r in _api_names(["Sourdough Loaf", "Whole Milk", "Bananas"])}
    assert items["Sourdough Loaf"]["availability"]["status"] == "OUT_OF_STOCK"
    assert items["Whole Milk"]["availability"]["status"] == "LOW_STOCK"
    assert items["Bananas"]["availability"]["status"] == "IN_STOCK"


def _api_names(names):
    from rest_framework.test import APIClient

    api = APIClient()
    out = []
    for name in names:
        slug = Product.objects.get(name=name).slug
        res = api.get("/api/v1/products/", {"q": name, "page_size": 20}).json()["results"]
        out += [r for r in res if r["slug"] == slug]
    return out


# --------------------------------------------------------------------------- promotions, coupons, collections
def test_promotions_cover_the_requested_scenarios(seeded):
    now = timezone.now()
    promos = {p.name: p for p in Promotion.objects.filter(is_demo=True)}
    assert len(promos) == 7
    running = [p for p in promos.values() if p.is_running(now)]
    assert any(p.kind == "PERCENT_OFF" and p.scope == "CATEGORIES" for p in running)
    assert any(p.kind == "AMOUNT_OFF" for p in running)
    ending_soon = [p for p in running if p.ends_at - now < dt.timedelta(days=3)]
    assert len(ending_soon) == 1 and ending_soon[0].ends_at - now > dt.timedelta(days=1)
    assert any(p.ends_at and p.ends_at < now for p in promos.values())  # expired
    assert any(not p.is_active for p in promos.values())  # inactive
    # the multibuy is a genuine saving, so the engine really applies it
    multibuy = next(p for p in promos.values() if p.kind == "MULTIBUY")
    for product in multibuy.products.all():
        assert multibuy.multibuy_price < multibuy.multibuy_qty * product.price
    index = load_index(use_cache=False)
    spaghetti = Product.objects.get(name="Spaghetti")
    cands = index.candidates(spaghetti.id, spaghetti.category_id, spaghetti.category.parent_id, None)
    assert any(c.kind == "MULTIBUY" for c in cands)
    best = [apply_promo(c, spaghetti.price, Decimal("3")) for c in cands if c.kind == "MULTIBUY"][0]
    assert best is not None and best.line_total == Decimal("5.00")


def test_coupons_cover_the_requested_scenarios(seeded):
    now = timezone.now()
    coupons = {c.code: c for c in Coupon.objects.filter(is_demo=True)}
    assert {"WELCOME10", "FRESH5", "FREESHIP", "SPRING20"} <= set(coupons)
    assert (
        coupons["WELCOME10"].kind == "PERCENT"
        and coupons["WELCOME10"].first_order_only
        and coupons["WELCOME10"].min_order_value > 0
    )
    assert coupons["FRESH5"].kind == "FIXED" and coupons["FRESH5"].min_order_value > 0
    assert coupons["FREESHIP"].kind == "FREE_DELIVERY"
    assert any(c.scope == "CATEGORIES" and c.categories.exists() for c in coupons.values())
    assert coupons["SPRING20"].ends_at < now
    exhausted = [c for c in coupons.values() if c.usage_limit == 1 and c.used_count == 1]
    assert len(exhausted) == 1


def test_collections_are_populated(seeded):
    slugs = {c.slug: c for c in Collection.objects.all()}
    assert set(slugs) == {
        "seasonal-produce",
        "pantry-staples",
        "weeknight-dinners",
        "plant-based-kitchen",
        "breakfast-table",
    }
    assert 3 <= Collection.objects.filter(show_on_home=True).count() <= 4
    for c in slugs.values():
        assert c.products.count() >= 8 and c.is_active and c.description


# --------------------------------------------------------------------------- content
def test_pages_are_clearly_template_text(seeded):
    expected = {
        "about",
        "sourcing-and-freshness",
        "delivery-policy",
        "refund-and-cancellation",
        "substitutions",
        "privacy",
        "terms",
    }
    pages = {p.slug: p for p in Page.objects.all()}
    assert expected <= set(pages)
    for slug in expected:
        page = pages[slug]
        assert page.is_template and page.is_published
        assert "Template text" in page.body and "legal adviser" in page.body
        assert "legal compliance" in page.body  # only appears inside the disclaimer
        assert not re.search(
            r"(?i)\b(complies with|compliant with|certified|guarantee[sd]?)\b",
            page.body.replace("certification or guarantee", ""),
        )


def test_faqs_articles_and_banners(seeded):
    assert FAQ.objects.count() >= 14
    questions = " ".join(f.question.lower() for f in FAQ.objects.all())
    for keyword in ("delivery window", "substitut", "weighed", "damaged", "payment", "coupon"):
        assert keyword in questions
    articles = Article.objects.all()
    assert articles.filter(kind="RECIPE").count() == 6 and articles.filter(kind="GUIDE").count() == 4
    for recipe in articles.filter(kind="RECIPE"):
        assert recipe.servings and recipe.total_minutes and recipe.products.count() >= 5
        assert re.search(r"(?m)^1\. ", recipe.body) and "## Method" in recipe.body
    assert articles.filter(kind="GUIDE").exclude(products=None).count() == 4
    banners = Banner.objects.all()
    assert Counter(b.placement for b in banners) == {"HERO": 3, "STRIP": 1, "PROMO": 2}


def test_banner_links_point_at_existing_frontend_routes(seeded):
    patterns = [re.compile(p) for p in content_data.ALLOWED_BANNER_LINKS]
    for banner in Banner.objects.all():
        assert any(p.match(banner.cta_link) for p in patterns), banner.cta_link
        banner.full_clean()
        if m := re.fullmatch(r"/shop\?category=([a-z0-9-]+)", banner.cta_link):
            assert Category.objects.filter(slug=m.group(1)).exists()
        if m := re.fullmatch(r"/collections/([a-z0-9-]+)", banner.cta_link):
            assert Collection.objects.filter(slug=m.group(1)).exists()
        if m := re.fullmatch(r"/p/([a-z0-9-]+)", banner.cta_link):
            assert Page.objects.filter(slug=m.group(1)).exists()
        if m := re.fullmatch(r"/guides/([a-z0-9-]+)", banner.cta_link):
            assert Article.objects.filter(slug=m.group(1), kind="GUIDE").exists()
    # promo copy matches promotions that actually exist
    titles = {b.title for b in Banner.objects.all()}
    assert (
        "Berries 15% off" in titles and Promotion.objects.filter(label="15% off", categories__slug="berries").exists()
    )
    assert "Pasta: 3 for $5" in titles and Promotion.objects.filter(label="3 for $5").exists()


# --------------------------------------------------------------------------- accounts and reviews
def test_demo_accounts_roles_branches_and_addresses(seeded):
    expected = {
        "superadmin": (rbac.SUPER_ADMIN, set()),
        "admin": (rbac.ADMIN, set()),
        "manager.central": (rbac.STORE_MANAGER, {"central"}),
        "manager.north": (rbac.STORE_MANAGER, {"north"}),
        "inventory": (rbac.INVENTORY_MANAGER, {"central"}),
        "purchasing": (rbac.PURCHASING_MANAGER, {"central", "north"}),
        "picker": (rbac.FULFILMENT_STAFF, {"central"}),
        "support": (rbac.CUSTOMER_SUPPORT, set()),
        "marketing": (rbac.MARKETING_MANAGER, set()),
    }
    for local, (role, branches) in expected.items():
        user = User.objects.get(email=f"{local}@{DEMO_DOMAIN}")
        assert user.role == role and user.is_active
        assert {b.code for b in user.branches.all()} == branches
        assert user.check_password(DEFAULT_PASSWORD)
        assert user.has_usable_password() and DEFAULT_PASSWORD not in user.password
    assert User.objects.get(email=f"superadmin@{DEMO_DOMAIN}").is_superuser
    customers = User.objects.filter(email__endswith=f"@{DEMO_DOMAIN}", role=rbac.CUSTOMER)
    assert customers.count() == 8 and {"alex", "sam", "priya"} <= {c.email.split("@")[0] for c in customers}
    for customer in customers:
        addresses = list(customer.addresses.all())
        assert 1 <= len(addresses) <= 2 and sum(a.is_default for a in addresses) == 1
        for address in addresses:
            assert find_zone(postal_code=address.postal_code, area=address.area) is not None, address
    assert (
        not User.objects.filter(email__endswith=f"@{DEMO_DOMAIN}")
        .exclude(email__regex=r"^[a-z.]+@demo\.orchardrow\.test$")
        .exists()
    )


def test_demo_reviews_and_rating_aggregates(seeded):
    reviews = Review.objects.all()
    assert 45 <= reviews.count() <= 55
    assert all(r.is_demo and not r.verified_purchase and r.status == "APPROVED" for r in reviews)
    ratings = Counter(r.rating for r in reviews)
    assert ratings[4] + ratings[5] > 0.6 * reviews.count() and ratings[3] >= 3 and ratings[2] >= 2
    assert reviews.values("product", "user").distinct().count() == reviews.count()
    assert all(r.user.email.endswith(f"@{DEMO_DOMAIN}") for r in reviews.select_related("user"))
    per_product = reviews.values("product").annotate(n=Count("id"))
    assert 15 <= per_product.count() <= 25
    for product in Product.objects.filter(rating_count__gt=0):
        mine = list(reviews.filter(product=product).values_list("rating", flat=True))
        assert product.rating_count == len(mine)
        assert abs(product.rating_avg - Decimal(sum(mine)) / len(mine)) < Decimal("0.01")


# --------------------------------------------------------------------------- reset
def test_reset_demo_removes_only_demo_rows(seeded):
    genuine_dept = Category.objects.create(name="Real Department", slug="real-department")
    genuine_cat = Category.objects.create(name="Real Category", slug="real-category", parent=genuine_dept)
    unit = SaleUnit.objects.get(code="each")
    genuine = Product.objects.create(
        sku="REAL-0001", slug="real-0001", name="Real Item", category=genuine_cat, sale_unit=unit, price=Decimal("1.00")
    )
    in_seed_category = Product.objects.create(
        sku="REAL-0002",
        slug="real-0002",
        name="Real Fruit",
        category=Category.objects.get(slug="fruit"),
        sale_unit=unit,
        price=Decimal("2.00"),
    )
    genuine_brand = Brand.objects.create(name="Real Brand", slug="real-brand")
    genuine_user = User.objects.create_user(email="owner@example.com", password="Owner-Pass-12345", full_name="Owner")

    call_command("seed_demo", "--reset-demo", "--no-seed", "--force", stdout=io.StringIO())

    assert not Product.objects.filter(is_demo=True).exists()
    assert not Branch.objects.filter(is_demo=True).exists() and not Supplier.objects.filter(is_demo=True).exists()
    assert not Review.objects.exists() and not Promotion.objects.exists() and not Coupon.objects.exists()
    assert not User.objects.filter(email__endswith=f"@{DEMO_DOMAIN}").exists()
    assert not Batch.objects.exists() and not StockMovement.objects.exists() and not DeliverySlot.objects.exists()
    assert not Page.objects.filter(slug__in=[p["slug"] for p in content_data.PAGES]).exists()
    assert not FAQ.objects.filter(question__in=[f[2] for f in content_data.FAQS]).exists()
    assert not Article.objects.filter(slug__in=[a["slug"] for a in content_data.ARTICLES]).exists()
    assert not Banner.objects.filter(title__in=[b[1] for b in content_data.BANNERS]).exists()
    survivors = set(Product.objects.values_list("sku", flat=True))
    assert survivors == {genuine.sku, in_seed_category.sku}
    assert Category.objects.filter(slug__in=["real-department", "real-category"]).count() == 2
    assert (
        Category.objects.filter(slug="fruit").exists() and Category.objects.filter(slug="fresh-produce").exists()
    )  # still hold a real product
    assert not Category.objects.filter(slug="vegetables").exists()  # empty seed category removed
    assert Brand.objects.filter(pk=genuine_brand.pk).exists() and User.objects.filter(pk=genuine_user.pk).exists()

    # re-seeding afterwards works and never touches the real rows
    call_command("seed_demo", "--skip-images", "--force", stdout=io.StringIO())
    assert Product.objects.filter(is_demo=True).count() == len(catalog_data.PRODUCTS)
    assert Product.objects.get(sku="REAL-0002").category.slug == "fruit"


def test_real_rows_with_seed_keys_are_never_overwritten(seeded):
    """A genuine (non-demo) product/brand/coupon that collides with a seed natural key is left alone."""
    call_command("seed_demo", "--reset-demo", "--no-seed", "--force", stdout=io.StringIO())
    cat = Category.objects.create(name="Mine", slug="mine")
    unit = SaleUnit.objects.get(code="each")
    mine = Product.objects.create(
        sku="OR-VEG-0001",
        slug="vine-tomatoes",
        name="My own tomatoes",
        category=cat,
        sale_unit=unit,
        price=Decimal("9.99"),
    )
    Brand.objects.create(name="Millbrook Dairy", slug="millbrook-dairy")
    Coupon.objects.create(code="welcome10", kind="PERCENT", value=Decimal("5"))
    out = io.StringIO()
    call_command("seed_demo", "--skip-images", "--force", stdout=out)
    mine.refresh_from_db()
    assert (mine.name, mine.price, mine.is_demo) == ("My own tomatoes", Decimal("9.99"), False)
    assert Brand.objects.get(name="Millbrook Dairy").is_demo is False
    assert Coupon.objects.get(code="WELCOME10").is_demo is False and Coupon.objects.get(code="WELCOME10").value == 5
    assert "not demo data" in out.getvalue()


# --------------------------------------------------------------------------- imagery
def test_every_product_has_an_illustration_file_and_alt_text():
    root = Path(imaging.IMAGE_ROOT)
    alts = set()
    total = 0
    for rec in catalog_data.PRODUCTS:
        path = root / "products" / f"{rec['sku'].lower()}.webp"
        assert path.exists(), f"missing illustration for {rec['sku']} {rec['name']}"
        assert path.stat().st_size < 45 * 1024
        with Image.open(path) as img:
            assert img.format == "WEBP" and img.size == (900, 900)
        assert rec["alt"].startswith("Illustration of") and len(rec["alt"]) <= 200
        alts.add(rec["alt"])
        total += path.stat().st_size
    assert len(alts) == len(catalog_data.PRODUCTS), "alt texts must be unique per product"
    for slug in [d[0] for d in catalog_data.DEPARTMENTS] + [
        c[0] for rows in catalog_data.CATEGORIES.values() for c in rows
    ]:
        assert (root / "categories" / f"{slug}.webp").exists(), slug
    for key in ops_banner_keys():
        with Image.open(root / "banners" / f"{key}.webp") as img:
            assert img.size == (1600, 900)
    assert total < 8 * 1024 * 1024


def ops_banner_keys():
    return [b[5] for b in content_data.BANNERS if b[5]]


def test_images_are_attached_through_the_upload_pipeline(seeded, settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path  # FileSystemStorage follows MEDIA_ROOT changes
    for name in ("Bananas", "Sourdough Loaf", "Toothpaste"):
        product = Product.objects.get(name=name)
        rec = catalog_data.PRODUCT_BY_NAME[name]
        assert imaging.attach_product_image(product, rec["alt"], rec["sku"]) == "created"
        image = ProductImage.objects.get(product=product)
        assert image.alt_text == rec["alt"] and image.image_widths == [320, 640]
        assert default_storage.exists(image.image.name)
        assert default_storage.exists(catalog_images.variant_name(image.image.name, 320))
        # idempotent: an existing image is kept unless a refresh is requested
        assert imaging.attach_product_image(product, rec["alt"], rec["sku"]) == "kept"
        assert imaging.attach_product_image(product, rec["alt"], rec["sku"], refresh=True) == "created"
        assert product.images.count() == 1
    category = Category.objects.get(slug="fruit")
    assert imaging.attach_category_image(category) == "created" and category.image_widths == [320, 640]
    banner = Banner.objects.filter(title="Weeknight dinners, sorted").get()
    assert imaging.attach_banner_image(banner, "hero-weeknight-dinners") == "created"
    assert banner.image_widths == [320, 640, 1024]


# --------------------------------------------------------------------------- pure data checks (no database needed)
def test_catalogue_data_is_internally_consistent():
    catalog_data.check()
    for rec in catalog_data.PRODUCTS:
        if rec["barcode"]:
            digits = rec["barcode"]
            assert len(digits) == 13 and digits.isdigit() and digits.startswith("20")
            total = sum(int(d) * (3 if i % 2 else 1) for i, d in enumerate(digits[:12]))
            assert (10 - total % 10) % 10 == int(digits[12])
    for collection in ops_data.COLLECTIONS:
        for name in collection["products"]:
            assert name in catalog_data.PRODUCT_BY_NAME, name
    for promo in ops_data.PROMOTIONS:
        for name in promo.get("products", []):
            assert name in catalog_data.PRODUCT_BY_NAME, name
    for article in content_data.ARTICLES:
        for name in article["products"]:
            assert name in catalog_data.PRODUCT_BY_NAME, name
    for name in ops_data.STOCK_SCENARIOS:
        assert name in catalog_data.PRODUCT_BY_NAME, name
    for review in REVIEWS:
        assert review[0] in catalog_data.PRODUCT_BY_NAME
    assert len({(r[0], r[1]) for r in REVIEWS}) == len(REVIEWS)
