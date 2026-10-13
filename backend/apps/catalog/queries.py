"""Server-side product discovery: validated filters, sorts, facets and pagination-ready querysets."""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field
from decimal import Decimal

from django.db.models import Case, Count, Exists, IntegerField, Max, Min, OuterRef, Prefetch, Q, Value, When
from django.utils import timezone
from rest_framework import serializers

from apps.core import cache as core_cache
from apps.inventory.availability import annotate_availability
from apps.promotions.engine import PromotionIndex

from . import search
from .models import Category, ClaimKind, Product, ProductClaim, ProductImage, ProductStatus

SORT_CHOICES = ["relevance", "price_asc", "price_desc", "newest", "popular", "name", "offers"]
NEW_WINDOW_DAYS = 30


class ProductQuerySerializer(serializers.Serializer):
    """Validates and documents the product listing query string."""

    q = serializers.CharField(required=False, allow_blank=True, max_length=500)
    category = serializers.SlugField(required=False)
    brand = serializers.ListField(child=serializers.SlugField(), required=False)
    price_min = serializers.DecimalField(max_digits=10, decimal_places=2, required=False, min_value=Decimal("0"))
    price_max = serializers.DecimalField(max_digits=10, decimal_places=2, required=False, min_value=Decimal("0"))
    in_stock = serializers.BooleanField(required=False)
    on_offer = serializers.BooleanField(required=False)
    is_new = serializers.BooleanField(required=False)
    featured = serializers.BooleanField(required=False)
    unit = serializers.SlugField(required=False)
    product_type = serializers.CharField(required=False, max_length=20)
    claim = serializers.ListField(child=serializers.ChoiceField(choices=ClaimKind.values), required=False)
    collection = serializers.SlugField(required=False)
    sort = serializers.ChoiceField(choices=SORT_CHOICES, required=False, default="relevance")
    branch = serializers.IntegerField(required=False, min_value=1)
    facets = serializers.BooleanField(required=False, default=False)

    def to_internal_value(self, data):
        # QueryDict → plain dict with repeatable keys as lists
        flat = {}
        for key in data:
            values = data.getlist(key) if hasattr(data, "getlist") else [data[key]]
            if key in ("brand", "claim"):
                flat[key] = [v for raw in values for v in raw.split(",") if v]
            else:
                flat[key] = values[-1]
        return super().to_internal_value(flat)


@dataclass
class ProductQuery:
    params: dict
    index: PromotionIndex
    branch_id: int | None
    today: dt.date = field(default_factory=timezone.localdate)

    # ---------------------------------------------------------------- base
    def base(self):
        return Product.objects.filter(status=ProductStatus.ACTIVE, is_available=True, category__is_active=True).filter(
            Q(category__parent__isnull=True) | Q(category__parent__is_active=True)
        )

    def offer_q(self) -> Q:
        prod_ids = set(self.index.by_product)
        cat_ids = set(self.index.by_category)
        if cat_ids:  # a promotion on a department also covers its categories
            cat_ids |= set(Category.objects.filter(parent_id__in=cat_ids).values_list("id", flat=True))
        brand_ids = set(self.index.by_brand)
        q = Q(pk__in=prod_ids) | Q(category_id__in=cat_ids) | Q(brand_id__in=brand_ids)
        return q if (prod_ids or cat_ids or brand_ids) else Q(pk__in=[])

    def filtered(self, skip: tuple[str, ...] = ()):
        p, qs = self.params, self.base()
        if "category" not in skip and p.get("category"):
            qs = qs.filter(Q(category__slug=p["category"]) | Q(category__parent__slug=p["category"]))
        if "brand" not in skip and p.get("brand"):
            qs = qs.filter(brand__slug__in=p["brand"])
        if p.get("price_min") is not None:
            qs = qs.filter(price__gte=p["price_min"])
        if p.get("price_max") is not None:
            qs = qs.filter(price__lte=p["price_max"])
        if p.get("unit"):
            qs = qs.filter(sale_unit__code=p["unit"])
        if p.get("product_type"):
            qs = qs.filter(product_type=p["product_type"])
        if p.get("featured"):
            qs = qs.filter(is_featured=True)
        if p.get("is_new"):
            qs = qs.filter(created_at__gte=timezone.now() - dt.timedelta(days=NEW_WINDOW_DAYS))
        if p.get("on_offer"):
            qs = qs.filter(self.offer_q())
        if p.get("collection"):
            qs = qs.filter(collections__slug=p["collection"], collections__is_active=True)
        for kind in p.get("claim") or []:  # only verified claims can filter
            qs = qs.filter(Exists(ProductClaim.objects.filter(product=OuterRef("pk"), kind=kind, verified=True)))
        if p.get("in_stock"):
            qs = annotate_availability(qs, self.branch_id, self.today).filter(
                Q(stock_mode="MADE_TO_ORDER") | Q(avail_qty__gte=Q_qty_min())
            )
        return qs

    # ---------------------------------------------------------------- listing
    def listing(self):
        qs, searched = search.apply_search(self.filtered(), self.params.get("q", ""))
        if "avail_qty" not in qs.query.annotations:
            qs = annotate_availability(qs, self.branch_id, self.today)
        qs = qs.select_related("brand", "category__parent", "sale_unit", "net_content_unit").prefetch_related(
            Prefetch("images", queryset=ProductImage.objects.order_by("sort_order", "id"))
        )
        sort = self.params.get("sort", "relevance")
        if sort == "relevance":
            order = ("-rank", "-popularity", "name") if searched else ("-popularity", "name")
        elif sort == "price_asc":
            order = ("price", "name")
        elif sort == "price_desc":
            order = ("-price", "name")
        elif sort == "newest":
            order = ("-created_at", "name")
        elif sort == "popular":
            order = ("-popularity", "name")
        elif sort == "offers":
            qs = qs.annotate(
                _offer=Case(When(self.offer_q(), then=Value(0)), default=Value(1), output_field=IntegerField())
            )
            order = ("_offer", "name")
        else:
            order = ("name",)
        return qs.order_by(*order, "id")

    # ---------------------------------------------------------------- facets
    def facets(self) -> dict:
        brands = (
            self.filtered(skip=("brand",))
            .filter(brand__isnull=False)
            .values("brand__slug", "brand__name")
            .annotate(n=Count("id"))
            .order_by("-n", "brand__name")[:40]
        )
        cats = (
            self.filtered(skip=("category",))
            .values("category__slug", "category__name", "category__parent__slug")
            .annotate(n=Count("id"))
            .order_by("-n")[:60]
        )
        price = self.filtered().aggregate(lo=Min("price"), hi=Max("price"))
        return {
            "brands": [{"slug": b["brand__slug"], "name": b["brand__name"], "count": b["n"]} for b in brands],
            "categories": [
                {
                    "slug": c["category__slug"],
                    "name": c["category__name"],
                    "parent": c["category__parent__slug"],
                    "count": c["n"],
                }
                for c in cats
            ],
            "price": {"min": str(price["lo"] or "0.00"), "max": str(price["hi"] or "0.00")},
        }


def Q_qty_min():
    from django.db.models import F

    return F("qty_min")


def category_tree() -> list[dict]:
    """Departments → categories that currently hold at least one purchasable product (cached, bumped on change)."""

    def build():
        counts = dict(
            Product.objects.filter(status=ProductStatus.ACTIVE, is_available=True)
            .values_list("category_id")
            .annotate(n=Count("id"))
        )
        cats = list(Category.objects.filter(is_active=True).order_by("sort_order", "name"))
        children: dict[int, list] = {}
        for c in cats:
            if c.parent_id:
                children.setdefault(c.parent_id, []).append(c)
        tree = []
        for dept in (c for c in cats if not c.parent_id):
            kids = [
                {
                    "id": k.id,
                    "name": k.name,
                    "slug": k.slug,
                    "description": k.description,
                    "image": k.image_urls(),
                    "count": counts.get(k.id, 0),
                }
                for k in children.get(dept.id, [])
                if counts.get(k.id, 0) > 0
            ]
            total = counts.get(dept.id, 0) + sum(k["count"] for k in kids)
            if total == 0:
                continue
            tree.append(
                {
                    "id": dept.id,
                    "name": dept.name,
                    "slug": dept.slug,
                    "description": dept.description,
                    "image": dept.image_urls(),
                    "show_on_home": dept.show_on_home,
                    "count": total,
                    "children": kids,
                }
            )
        return tree

    return core_cache.get_or_set("catalog", ("category-tree",), 600, build)
