"""Delete ONLY demo rows, respecting PROTECT relations (rows that real data still depends on are kept and reported).

Identification rules: models with `is_demo` use it; rows without it (categories, collections, pages, FAQs, articles,
banners, accounts) are matched by the natural keys from the seed lists only. Anything outside those keys is never touched.
"""

from __future__ import annotations

from collections import defaultdict

from django.db import transaction
from django.db.models import ProtectedError, RestrictedError

from apps.accounts.models import User
from apps.catalog.models import Brand, Category, Collection, Product, Review
from apps.content.models import FAQ, Article, Banner, Page
from apps.inventory.models import Batch, StockMovement
from apps.promotions.models import Coupon, Promotion
from apps.purchasing.models import PurchaseOrder, Supplier
from apps.stores.models import Branch

from . import imaging
from .accounts_data import DEMO_DOMAIN
from .catalog_base import CATEGORIES, DEPARTMENTS
from .content_data import ARTICLES, BANNERS, FAQS, PAGES
from .ops_data import COLLECTIONS

BLOCKED = (ProtectedError, RestrictedError)


def _delete_each(queryset, label: str, deleted: dict, kept: dict) -> None:
    """Delete rows one by one in savepoints so a PROTECTed row is kept without aborting the rest."""
    for obj in queryset:
        try:
            with transaction.atomic():
                obj.delete()
            deleted[label] += 1
        except BLOCKED:
            kept[label] += 1


def reset_demo_data() -> tuple[dict[str, int], dict[str, int]]:
    deleted: dict[str, int] = defaultdict(int)
    kept: dict[str, int] = defaultdict(int)

    _delete_each(Review.objects.filter(is_demo=True), "Review", deleted, kept)
    for spec in COLLECTIONS:
        _delete_each(Collection.objects.filter(slug=spec["slug"]), "Collection", deleted, kept)

    # content (natural keys from the seed lists; pages only while they are still template text)
    for article in Article.objects.filter(slug__in=[a["slug"] for a in ARTICLES]):
        name, widths = (article.image.name if article.image else None), article.image_widths
        try:
            with transaction.atomic():
                article.delete()
            imaging.delete_stored(name, widths)
            deleted["Article"] += 1
        except BLOCKED:
            kept["Article"] += 1
    _delete_each(FAQ.objects.filter(question__in=[f[2] for f in FAQS]), "FAQ", deleted, kept)
    _delete_each(Page.objects.filter(slug__in=[p["slug"] for p in PAGES], is_template=True), "Page", deleted, kept)
    for banner in Banner.objects.filter(title__in=[b[1] for b in BANNERS]):
        name, widths = (banner.image.name if banner.image else None), banner.image_widths
        try:
            with transaction.atomic():
                banner.delete()
            imaging.delete_stored(name, widths)
            deleted["Banner"] += 1
        except BLOCKED:
            kept["Banner"] += 1

    _delete_each(Promotion.objects.filter(is_demo=True), "Promotion", deleted, kept)
    _delete_each(Coupon.objects.filter(is_demo=True), "Coupon", deleted, kept)
    _delete_each(PurchaseOrder.objects.filter(is_demo=True), "PurchaseOrder", deleted, kept)

    # products: ledger rows and lots go with them; a product that real orders reference stays (with its stock)
    for product in Product.objects.filter(is_demo=True).order_by("id"):
        files = [(i.image.name, i.image_widths) for i in product.images.all()]
        try:
            with transaction.atomic():
                StockMovement.objects.filter(
                    product=product
                ).delete()  # queryset delete: ledger rows are append-only otherwise
                Batch.objects.filter(product=product).delete()
                product.delete()
        except BLOCKED:
            kept["Product"] += 1
            continue
        for name, widths in files:
            imaging.delete_stored(name, widths)
        deleted["Product"] += 1

    _delete_each(Supplier.objects.filter(is_demo=True), "Supplier", deleted, kept)
    _delete_each(Brand.objects.filter(is_demo=True), "Brand", deleted, kept)

    # categories: only seed slugs, only when empty (children first, then departments)
    child_slugs = [slug for rows in CATEGORIES.values() for slug, *_ in rows]
    for group in (child_slugs, [d[0] for d in DEPARTMENTS]):
        for cat in Category.objects.filter(slug__in=group):
            if cat.products.exists() or cat.children.exists():
                kept["Category"] += 1
                continue
            name, widths = (cat.image.name if cat.image else None), cat.image_widths
            try:
                with transaction.atomic():
                    cat.delete()
            except BLOCKED:
                kept["Category"] += 1
                continue
            imaging.delete_stored(name, widths)
            deleted["Category"] += 1

    _delete_each(Branch.objects.filter(is_demo=True), "Branch", deleted, kept)
    _delete_each(User.objects.filter(email__iendswith=f"@{DEMO_DOMAIN}"), "User", deleted, kept)
    return dict(deleted), dict(kept)
