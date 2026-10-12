"""Orchestrates the demo seed: reset (optional), then every loader in dependency order, then the summary table."""

from __future__ import annotations

from django.db import transaction
from django.db.models import Q

from apps.accounts.models import Address, User
from apps.catalog.models import (
    Brand,
    Category,
    Collection,
    NutritionFact,
    Product,
    ProductAllergen,
    ProductClaim,
    ProductImage,
    ProductStatus,
    Review,
)
from apps.content.models import FAQ, Article, Banner, Page
from apps.inventory.models import Batch, StockLevel, StockMovement
from apps.promotions.models import Coupon, Promotion
from apps.purchasing.models import PurchaseOrder, Supplier, SupplierProduct
from apps.stores.models import Branch, BranchClosure, BranchHours, DeliverySlot, DeliveryZone, SlotTemplate

from . import load_accounts, load_catalog, load_content, load_ops, load_promos, load_stores
from .accounts_data import DEMO_DOMAIN
from .catalog_base import CATEGORIES, DEPARTMENTS
from .common import DEMO_REF, Tally
from .content_data import ARTICLES, BANNERS, FAQS, PAGES
from .ops_data import COLLECTIONS
from .reset import reset_demo_data

DEPARTMENT_SLUGS = [d[0] for d in DEPARTMENTS]
CATEGORY_SLUGS = [slug for rows in CATEGORIES.values() for slug, *_ in rows]


def run(
    stdout,
    *,
    password: str,
    skip_images: bool = False,
    refresh_images: bool = False,
    reset: bool = False,
    no_seed: bool = False,
) -> Tally:
    tally = Tally(stdout)
    with transaction.atomic():
        if reset:
            deleted, kept = reset_demo_data()
            stdout.write("Reset: " + (", ".join(f"{k} {v}" for k, v in sorted(deleted.items())) or "nothing to delete"))
            for label, n in sorted(kept.items()):
                tally.warn(f"{label}: {n} demo row(s) kept because real data still references them")
        if no_seed:
            return tally
        with_images = not skip_images
        units = load_catalog.load_units()

        load_stores.seed_store_settings(tally)
        branches = load_stores.seed_branches(tally)
        load_stores.seed_slots(branches, tally)
        users = load_accounts.seed_accounts(password, branches, tally)  # noqa: F841 - created for their side effects
        cats = load_catalog.seed_categories(tally, with_images, refresh_images)
        brands = load_catalog.seed_brands(tally)
        products = load_catalog.seed_products(cats, brands, units, tally, with_images, refresh_images)
        load_catalog.seed_collections(products, tally)
        load_catalog.seed_reviews(products, tally)
        suppliers, by_category, costs = load_ops.seed_suppliers(products, tally)
        load_ops.seed_purchase_orders(suppliers, branches, products, costs, tally)
        load_ops.seed_inventory(products, branches, costs, by_category, tally)
        load_promos.seed_promotions(products, cats, tally)
        load_promos.seed_coupons(cats, tally)
        load_content.seed_pages(tally)
        load_content.seed_faqs(tally)
        load_content.seed_articles(products, tally, with_images, refresh_images)
        load_content.seed_banners(tally, with_images, refresh_images)
    return tally


def summary_rows(tally: Tally) -> list[tuple[str, int, int]]:
    """(label, demo rows now in the database, rows created by this run)."""
    demo_products = Product.objects.filter(is_demo=True)
    hidden = demo_products.filter(~Q(status=ProductStatus.ACTIVE) | Q(is_available=False)).count()
    created = tally.created
    claims = ProductClaim.objects.filter(product__is_demo=True)
    rows = [
        ("Branches", Branch.objects.filter(is_demo=True).count(), created["Branch"]),
        ("Opening-hours rows", BranchHours.objects.filter(branch__is_demo=True).count(), created["BranchHours"]),
        ("Branch closures", BranchClosure.objects.filter(branch__is_demo=True).count(), created["BranchClosure"]),
        ("Delivery zones", DeliveryZone.objects.filter(branch__is_demo=True).count(), created["DeliveryZone"]),
        ("Slot templates", SlotTemplate.objects.filter(branch__is_demo=True).count(), created["SlotTemplate"]),
        ("Delivery/pickup slots", DeliverySlot.objects.filter(branch__is_demo=True).count(), created["DeliverySlot"]),
        (
            "Staff accounts",
            User.objects.filter(email__iendswith=f"@{DEMO_DOMAIN}").exclude(role="CUSTOMER").count(),
            created["User (staff)"],
        ),
        (
            "Customer accounts",
            User.objects.filter(email__iendswith=f"@{DEMO_DOMAIN}", role="CUSTOMER").count(),
            created["User (customer)"],
        ),
        ("Addresses", Address.objects.filter(user__email__iendswith=f"@{DEMO_DOMAIN}").count(), created["Address"]),
        ("Departments", Category.objects.filter(slug__in=DEPARTMENT_SLUGS).count(), created["Department"]),
        ("Categories", Category.objects.filter(slug__in=CATEGORY_SLUGS).count(), created["Category"]),
        (
            "Category/department illustrations",
            Category.objects.filter(slug__in=[*CATEGORY_SLUGS, *DEPARTMENT_SLUGS]).exclude(image="").count(),
            created["Category image"],
        ),
        ("Brands", Brand.objects.filter(is_demo=True).count(), created["Brand"]),
        ("Products", demo_products.count(), created["Product"]),
        ("  of which hidden (inactive/archived/unavailable)", hidden, 0),
        ("Product images", ProductImage.objects.filter(product__is_demo=True).count(), created["ProductImage"]),
        ("Product claims (verified)", claims.filter(verified=True).count(), created["ProductClaim (verified)"]),
        ("Product claims (unverified)", claims.filter(verified=False).count(), created["ProductClaim (unverified)"]),
        ("Allergen rows", ProductAllergen.objects.filter(product__is_demo=True).count(), 0),
        ("Nutrition records", NutritionFact.objects.filter(is_demo=True).count(), created["NutritionFact"]),
        (
            "Collections",
            Collection.objects.filter(slug__in=[c["slug"] for c in COLLECTIONS]).count(),
            created["Collection"],
        ),
        ("Reviews", Review.objects.filter(is_demo=True).count(), created["Review"]),
        ("Suppliers", Supplier.objects.filter(is_demo=True).count(), created["Supplier"]),
        (
            "Supplier-product links",
            SupplierProduct.objects.filter(supplier__is_demo=True).count(),
            created["SupplierProduct"],
        ),
        ("Purchase orders", PurchaseOrder.objects.filter(is_demo=True).count(), created["PurchaseOrder"]),
        ("Stock levels", StockLevel.objects.filter(product__is_demo=True).count(), created["StockLevel"]),
        ("Batches", Batch.objects.filter(is_demo=True).count(), created["Batch"]),
        ("Stock movements", StockMovement.objects.filter(ref_type=DEMO_REF).count(), created["StockMovement"]),
        ("Promotions", Promotion.objects.filter(is_demo=True).count(), created["Promotion"]),
        ("Coupons", Coupon.objects.filter(is_demo=True).count(), created["Coupon"]),
        (
            "Pages (template text)",
            Page.objects.filter(is_template=True, slug__in=[p["slug"] for p in PAGES]).count(),
            created["Page"],
        ),
        ("FAQs", FAQ.objects.filter(question__in=[f[2] for f in FAQS]).count(), created["FAQ"]),
        ("Articles", Article.objects.filter(slug__in=[a["slug"] for a in ARTICLES]).count(), created["Article"]),
        ("Banners", Banner.objects.filter(title__in=[b[1] for b in BANNERS]).count(), created["Banner"]),
    ]
    return rows
