"""Catalogue: departments, categories, brands, products (with trust data), collections and demo reviews."""

from __future__ import annotations

import datetime as dt
from decimal import Decimal

from django.utils import timezone

from apps.accounts.models import User
from apps.catalog.models import (
    Allergen,
    AllergenLevel,
    Brand,
    Category,
    ClaimKind,
    Collection,
    CollectionItem,
    NutritionFact,
    Product,
    ProductAllergen,
    ProductClaim,
    ProductStatus,
    Review,
    ReviewStatus,
    SaleUnit,
    StockMode,
)

from . import imaging
from .accounts_data import DEMO_DOMAIN, REVIEWS
from .catalog_base import BRANDS, CATEGORIES, DEPARTMENTS
from .catalog_data import (
    CLAIM_PENDING_EVIDENCE,
    CLAIM_PENDING_VEGAN_EVIDENCE,
    CLAIM_PLAIN_EVIDENCE,
    NUTRITION,
    NUTRITION_SOURCE,
    ORIGIN_NOTE,
    PRODUCTS,
)
from .common import Tally
from .ops_data import COLLECTIONS

DEC = Decimal


class SeedError(RuntimeError):
    pass


def load_units() -> dict[str, SaleUnit]:
    units = {u.code: u for u in SaleUnit.objects.all()}
    needed = {p["unit"] for p in PRODUCTS} | {p["nc"][1] for p in PRODUCTS if p["nc"]}
    missing = sorted(needed - set(units))
    if missing:
        raise SeedError(
            f"Sale units {missing} are missing - run `manage.py migrate` first (they come from a data migration)."
        )
    return units


# --------------------------------------------------------------------------- categories
def seed_categories(tally: Tally, with_images: bool, refresh_images: bool) -> dict[str, Category]:
    cats: dict[str, Category] = {}

    def upsert(slug, parent, name, description, sort_order, show_on_home):
        obj = Category.objects.filter(slug=slug).first()
        created = obj is None
        if created:
            obj = Category(slug=slug, is_active=True)
        obj.parent, obj.name, obj.description = parent, name, description
        obj.sort_order, obj.show_on_home = sort_order, show_on_home
        obj.save()
        tally.add("Department" if parent is None else "Category", created)
        if with_images:
            tally.add("Category image", imaging.attach_category_image(obj, refresh_images) == "created")
        cats[slug] = obj

    for slug, name, description, sort_order, home in DEPARTMENTS:
        upsert(slug, None, name, description, sort_order, home)
    for dept_slug, rows in CATEGORIES.items():
        for position, (slug, name, description, _prefix) in enumerate(rows, start=1):
            upsert(slug, cats[dept_slug], name, description, position * 10, False)
    return cats


# --------------------------------------------------------------------------- brands
def seed_brands(tally: Tally) -> dict[str, Brand]:
    brands: dict[str, Brand] = {}
    for name, slug, _mark, _color, description in BRANDS:
        obj = Brand.objects.filter(slug=slug).first() or Brand.objects.filter(name=name).first()
        if obj is not None and not obj.is_demo:
            tally.skip("Brand", f"{name!r} exists and is not demo data; its products are seeded without a brand")
            continue
        created = obj is None
        if created:
            obj = Brand(is_active=True)
        obj.name, obj.slug, obj.description, obj.is_demo = name, slug, description, True
        obj.save()
        tally.add("Brand", created)
        brands[name] = obj
    return brands


# --------------------------------------------------------------------------- products
def _claim(product: Product, kind: str, verified: bool, evidence: str, tally: Tally) -> None:
    kwargs = {"verified_at": timezone.now()} if verified else {}
    _, created = ProductClaim.objects.get_or_create(
        product=product, kind=kind, defaults={"verified": verified, "evidence": evidence, **kwargs}
    )
    if created:
        tally.add("ProductClaim (verified)" if verified else "ProductClaim (unverified)", True)


def _trust_data(product: Product, rec: dict, tally: Tally) -> None:
    diet = rec["diet"]
    if diet == "plain":
        _claim(product, ClaimKind.VEGAN, True, CLAIM_PLAIN_EVIDENCE, tally)
        _claim(product, ClaimKind.VEGETARIAN, True, CLAIM_PLAIN_EVIDENCE, tally)
    elif diet == "veg":
        _claim(product, ClaimKind.VEGETARIAN, True, CLAIM_PLAIN_EVIDENCE, tally)
    elif diet == "pending-vegan":
        _claim(product, ClaimKind.VEGAN, False, CLAIM_PENDING_VEGAN_EVIDENCE, tally)
    for kind in rec["claims"]:
        _claim(product, getattr(ClaimKind, kind), False, CLAIM_PENDING_EVIDENCE, tally)

    if rec["alg"] is not None:  # allergens are only recorded when derived from an authored ingredient list
        wanted = dict.fromkeys(rec["alg"], AllergenLevel.CONTAINS)
        wanted.update(dict.fromkeys((c for c in rec["may"] if c not in wanted), AllergenLevel.MAY_CONTAIN))
        allergens = {a.code: a for a in Allergen.objects.filter(code__in=wanted)}
        if set(allergens) != set(wanted):
            raise SeedError(f"Unknown allergen codes for {rec['name']}: {sorted(set(wanted) - set(allergens))}")
        ProductAllergen.objects.filter(product=product).exclude(allergen__code__in=wanted).delete()
        for code, level in wanted.items():
            ProductAllergen.objects.update_or_create(
                product=product, allergen=allergens[code], defaults={"level": level}
            )

    values = NUTRITION.get(rec["name"])
    if values:
        _, created = NutritionFact.objects.update_or_create(
            product=product,
            defaults={
                "basis": "per 100 g",
                "energy_kcal": DEC(values["kcal"]),
                "energy_kj": DEC(values["kj"]),
                "fat": DEC(values["fat"]),
                "saturates": DEC(values["sat"]),
                "carbohydrate": DEC(values["carb"]),
                "sugars": DEC(values["sugars"]),
                "fibre": DEC(values["fibre"]),
                "protein": DEC(values["protein"]),
                "salt": DEC(values["salt"]),
                "source": NUTRITION_SOURCE,
                "is_demo": True,
            },
        )
        tally.add("NutritionFact", created)


def seed_products(
    cats: dict[str, Category],
    brands: dict[str, Brand],
    units: dict[str, SaleUnit],
    tally: Tally,
    with_images: bool,
    refresh_images: bool,
) -> dict[str, Product]:
    products: dict[str, Product] = {}
    now = timezone.now()
    for rec in PRODUCTS:
        existing = Product.objects.filter(sku=rec["sku"]).first() or Product.objects.filter(slug=rec["slug"]).first()
        if existing is not None and not existing.is_demo:
            tally.skip("Product", f"{rec['sku']} / {rec['slug']} exists and is not demo data; left unchanged")
            continue
        created = existing is None
        product = existing or Product(sku=rec["sku"], slug=rec["slug"])
        product.name = rec["name"]
        product.short_description = rec["short"]
        product.description = rec["desc"]
        product.category = cats[rec["cat"]]
        product.brand = brands.get(rec["brand"]) if rec["brand"] else None
        product.barcode = rec["barcode"]
        product.product_type, product.storage_type = rec["ptype"], rec["stor"]
        product.sale_unit = units[rec["unit"]]
        product.price, product.tax_rate = rec["price"], DEC("0")
        qmin, qstep, qmax = (DEC(v) for v in rec["qty"])
        product.qty_min, product.qty_step, product.qty_max = qmin, qstep, qmax
        if rec["nc"]:
            product.net_content, product.net_content_unit = DEC(str(rec["nc"][0])), units[rec["nc"][1]]
        else:
            product.net_content, product.net_content_unit = None, None
        product.is_variable_weight = bool(rec["vw"])
        product.stock_mode = StockMode.MADE_TO_ORDER if rec["mto"] else StockMode.TRACKED
        product.tracks_batches = bool(rec["batches"]) and not rec["mto"]
        product.is_perishable = bool(rec["perish"])
        product.sell_buffer_days = rec["buffer"]
        if rec["origin"]:
            product.origin_country, product.origin_note = rec["origin"], ORIGIN_NOTE
        else:
            product.origin_country, product.origin_note = "", ""
        product.storage_instructions, product.packaging = rec["storage"], rec["pack"]
        product.ingredients = rec["ingr"] or ""
        product.manufacturer = rec["brand"] or ""
        product.allergen_info_complete = rec["alg"] is not None
        product.is_demo = True
        if created:  # operational flags are set once; later runs never flip them back
            product.status = {"inactive": ProductStatus.INACTIVE, "archived": ProductStatus.ARCHIVED}.get(
                rec["state"], ProductStatus.ACTIVE
            )
            product.is_available = rec["state"] != "unavailable"
            product.is_featured = bool(rec["feat"])
            product.popularity = rec["popularity"]
        product.save()
        # keep "new arrivals" meaningful: created_at is re-based on every run
        Product.objects.filter(pk=product.pk).update(created_at=now - dt.timedelta(days=rec["created_days_ago"]))
        tally.add("Product", created)
        _trust_data(product, rec, tally)
        if with_images:
            outcome = imaging.attach_product_image(product, rec["alt"], rec["sku"], refresh_images)
            if outcome == "missing":
                tally.warn(f"no illustration found for {rec['sku']} (run scripts/generate_demo_images.py)")
            else:
                tally.add("ProductImage", outcome == "created")
        products[rec["name"]] = product
    return products


# --------------------------------------------------------------------------- collections
def seed_collections(products: dict[str, Product], tally: Tally) -> None:
    for spec in COLLECTIONS:
        obj = Collection.objects.filter(slug=spec["slug"]).first()
        created = obj is None
        if created:
            obj = Collection(slug=spec["slug"], is_active=True)
        obj.name, obj.description = spec["name"], spec["description"]
        obj.show_on_home, obj.sort_order = spec["show_on_home"], spec["sort_order"]
        obj.save()
        tally.add("Collection", created)
        wanted = [products[n] for n in spec["products"] if n in products]
        CollectionItem.objects.filter(collection=obj).exclude(product__in=wanted).delete()
        for position, product in enumerate(wanted):
            CollectionItem.objects.update_or_create(collection=obj, product=product, defaults={"sort_order": position})


# --------------------------------------------------------------------------- reviews
def seed_reviews(products: dict[str, Product], tally: Tally) -> None:
    now = timezone.now()
    for index, (name, local, rating, title, body) in enumerate(REVIEWS):
        product = products.get(name)
        user = User.objects.filter(email__iexact=f"{local}@{DEMO_DOMAIN}").first()
        if product is None or user is None:
            continue
        existing = Review.objects.filter(product=product, user=user).first()
        if existing is not None and not existing.is_demo:
            tally.skip("Review", f"{user.email} already reviewed {name!r} (not demo data)")
            continue
        review, created = Review.objects.update_or_create(
            product=product,
            user=user,
            defaults={
                "rating": rating,
                "title": title,
                "body": body,
                "status": ReviewStatus.APPROVED,
                "verified_purchase": False,
                "is_demo": True,
            },
        )
        Review.objects.filter(pk=review.pk).update(created_at=now - dt.timedelta(days=3 + (index * 7) % 61))
        tally.add("Review", created)
