from __future__ import annotations

from django.db import IntegrityError
from django.db.models import Prefetch, Q
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.core import cache as core_cache
from apps.core.exceptions import DomainError, ErrorCode
from apps.core.pagination import StandardPagination
from apps.inventory.availability import annotate_availability
from apps.promotions.engine import load_index
from apps.stores.services import default_branch

from . import search
from .models import Brand, Category, Collection, Product, ProductImage, ProductStatus, Review, ReviewStatus
from .queries import ProductQuery, ProductQuerySerializer, category_tree
from .serializers import ProductCardSerializer, ProductDetailSerializer, ReviewCreateSerializer, ReviewSerializer


def default_branch_id() -> int | None:
    return (
        core_cache.get_or_set("catalog", ("default-branch",), 300, lambda: (b.id if (b := default_branch()) else 0))
        or None
    )


def resolve_branch_id(request) -> int | None:
    raw = request.query_params.get("branch")
    if raw and raw.isdigit():
        return int(raw)
    return default_branch_id()


def card_context(branch_id):
    return {"promo_index": load_index(), "branch_id": branch_id}


class PublicView(APIView):
    permission_classes = [AllowAny]
    authentication_classes: list = []  # public catalog data never depends on the session


class ProductListView(PublicView):
    @extend_schema(parameters=[ProductQuerySerializer], responses=ProductCardSerializer(many=True))
    def get(self, request):
        ser = ProductQuerySerializer(data=request.query_params)
        ser.is_valid(raise_exception=True)
        params = ser.validated_data
        branch_id = params.get("branch") or default_branch_id()
        pq = ProductQuery(params, load_index(), branch_id)
        paginator = StandardPagination()
        page = paginator.paginate_queryset(pq.listing(), request)
        response = paginator.get_paginated_response(
            ProductCardSerializer(page, many=True, context=card_context(branch_id)).data
        )
        if params.get("facets"):
            response.data["facets"] = pq.facets()
        return response


class ProductDetailView(PublicView):
    @extend_schema(responses=ProductDetailSerializer)
    def get(self, request, slug):
        branch_id = resolve_branch_id(request)
        qs = ProductQuery({}, load_index(), branch_id).base()
        qs = annotate_availability(qs, branch_id).select_related(
            "brand", "category__parent", "sale_unit", "net_content_unit", "nutrition"
        )
        qs = qs.prefetch_related(
            Prefetch("images", queryset=ProductImage.objects.order_by("sort_order", "id")),
            "allergens__allergen",
            "claims",
        )
        product = qs.filter(slug=slug).first()
        if product is None:
            raise DomainError(ErrorCode.NOT_FOUND, "We couldn't find that product.", status_code=404)
        ctx = card_context(branch_id)
        product._reviews_demo = (
            product.rating_count
            and not Review.objects.filter(product=product, status=ReviewStatus.APPROVED, is_demo=False).exists()
        )
        data = ProductDetailSerializer(product, context=ctx).data
        related = (
            annotate_availability(
                ProductQuery({}, ctx["promo_index"], branch_id)
                .base()
                .filter(category=product.category)
                .exclude(pk=product.pk),
                branch_id,
            )
            .select_related("brand", "category__parent", "sale_unit", "net_content_unit")
            .prefetch_related(Prefetch("images", queryset=ProductImage.objects.order_by("sort_order", "id")))
            .order_by("-popularity", "name")[:6]
        )
        data["related"] = ProductCardSerializer(related, many=True, context=ctx).data
        return Response(data)


class ProductReviewsView(APIView):
    def get_permissions(self):
        return [IsAuthenticated()] if self.request.method == "POST" else [AllowAny()]

    @extend_schema(responses=ReviewSerializer(many=True))
    def get(self, request, slug):
        product = Product.objects.filter(slug=slug, status=ProductStatus.ACTIVE).first()
        if product is None:
            raise DomainError(ErrorCode.NOT_FOUND, "We couldn't find that product.", status_code=404)
        qs = Review.objects.filter(product=product, status=ReviewStatus.APPROVED).select_related("user")
        paginator = StandardPagination()
        page = paginator.paginate_queryset(qs, request)
        return paginator.get_paginated_response(ReviewSerializer(page, many=True).data)

    @extend_schema(request=ReviewCreateSerializer, responses=ReviewSerializer)
    def post(self, request, slug):
        from apps.orders.models import OrderItem, OrderStatus

        product = Product.objects.filter(slug=slug, status=ProductStatus.ACTIVE).first()
        if product is None:
            raise DomainError(ErrorCode.NOT_FOUND, "We couldn't find that product.", status_code=404)
        ser = ReviewCreateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        bought = OrderItem.objects.filter(
            order__customer=request.user, order__status=OrderStatus.COMPLETED, product=product
        ).exists()
        if not bought:
            raise DomainError(
                "REVIEW_NOT_ALLOWED", "You can review products from orders you've received.", status_code=403
            )
        try:
            review = Review.objects.create(
                product=product,
                user=request.user,
                verified_purchase=True,
                status=ReviewStatus.PENDING,
                **ser.validated_data,
            )
        except IntegrityError:
            raise DomainError("REVIEW_EXISTS", "You've already reviewed this product.", status_code=409) from None
        return Response(ReviewSerializer(review).data, status=status.HTTP_201_CREATED)


class CategoryListView(PublicView):
    @extend_schema(responses={200: dict})
    def get(self, request):
        return Response(category_tree())


class BrandListView(PublicView):
    @extend_schema(responses={200: dict})
    def get(self, request):
        data = core_cache.get_or_set(
            "catalog",
            ("brands",),
            600,
            lambda: [
                {"id": b.id, "name": b.name, "slug": b.slug, "description": b.description}
                for b in Brand.objects.filter(is_active=True, products__status=ProductStatus.ACTIVE)
                .distinct()
                .order_by("name")
            ],
        )
        return Response(data)


class SuggestView(PublicView):
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "anon"

    @extend_schema(parameters=[OpenApiParameter("q", str)], responses={200: dict})
    def get(self, request):
        q = search.normalize_query(request.query_params.get("q", ""))
        if len(q) < 2:
            return Response({"products": [], "categories": [], "brands": []})
        branch_id = resolve_branch_id(request)

        def build():
            base = ProductQuery({}, load_index(), branch_id).base()
            qs, _ = search.apply_search(base, q)
            qs = (
                qs.select_related("category", "sale_unit")
                .prefetch_related(Prefetch("images", queryset=ProductImage.objects.order_by("sort_order", "id")))
                .order_by("-rank", "-popularity")[:6]
            )
            return {
                "query": q,
                "products": [
                    {
                        "slug": p.slug,
                        "name": p.name,
                        "category": p.category.name,
                        "image": (p.images.all()[0].urls() if p.images.all() else {}),
                    }
                    for p in qs
                ],
                "categories": [
                    {"slug": c.slug, "name": c.name}
                    for c in Category.objects.filter(is_active=True, name__icontains=q)[:3]
                ],
                "brands": [
                    {"slug": b.slug, "name": b.name}
                    for b in Brand.objects.filter(is_active=True, name__icontains=q)[:3]
                ],
            }

        return Response(core_cache.get_or_set("catalog", ("suggest", branch_id, q.lower()), 30, build))


class CollectionListView(PublicView):
    @extend_schema(responses={200: dict})
    def get(self, request):
        today = timezone.localdate()
        rows = [
            {"slug": c.slug, "name": c.name, "description": c.description}
            for c in Collection.objects.filter(is_active=True)
            .filter(Q(starts_on__isnull=True) | Q(starts_on__lte=today))
            .filter(Q(ends_on__isnull=True) | Q(ends_on__gte=today))
        ]
        return Response(rows)


class HomeView(PublicView):
    """Everything the home page needs in one cacheable request (60 s). Prices/stock are re-validated at cart/checkout."""

    @extend_schema(responses={200: dict})
    def get(self, request):
        from apps.content.models import Article, Banner

        branch_id = resolve_branch_id(request)

        def build():
            ctx = card_context(branch_id)
            now = timezone.now()
            today = timezone.localdate()

            def cards(qs, n=8):
                qs = (
                    annotate_availability(qs, branch_id)
                    .select_related("brand", "category__parent", "sale_unit", "net_content_unit")
                    .prefetch_related(Prefetch("images", queryset=ProductImage.objects.order_by("sort_order", "id")))
                )
                return ProductCardSerializer(qs[:n], many=True, context=ctx).data

            pq = ProductQuery({}, ctx["promo_index"], branch_id)
            base = pq.base()
            banners = Banner.objects.filter(is_active=True, starts_at__lte=now).filter(
                Q(ends_at__isnull=True) | Q(ends_at__gt=now)
            )
            collections = []
            for c in (
                Collection.objects.filter(is_active=True, show_on_home=True)
                .filter(Q(starts_on__isnull=True) | Q(starts_on__lte=today))
                .filter(Q(ends_on__isnull=True) | Q(ends_on__gte=today))[:4]
            ):
                collections.append(
                    {
                        "slug": c.slug,
                        "name": c.name,
                        "description": c.description,
                        "products": cards(base.filter(collections=c).order_by("collectionitem__sort_order"), 8),
                    }
                )
            return {
                "banners": [
                    {
                        "id": b.id,
                        "placement": b.placement,
                        "title": b.title,
                        "subtitle": b.subtitle,
                        "cta_label": b.cta_label,
                        "cta_link": b.cta_link,
                        "image": b.image.url if b.image else None,
                    }
                    for b in banners
                ],
                "departments": category_tree()[:8],
                "collections": collections,
                "offers": cards(base.filter(pq.offer_q()).order_by("-popularity"), 8),
                "bestsellers": cards(base.order_by("-popularity", "name"), 8),
                "new_arrivals": cards(base.order_by("-created_at", "name"), 8),
                "guides": [
                    {
                        "slug": a.slug,
                        "kind": a.kind,
                        "title": a.title,
                        "summary": a.summary,
                        "image": a.image.url if a.image else None,
                    }
                    for a in Article.objects.filter(is_published=True, published_at__lte=now)[:3]
                ],
            }

        return Response(core_cache.get_or_set("home", (branch_id,), 60, build))
