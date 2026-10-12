"""Staff API: categories (two-level tree), brands, collections, unit / allergen lookups and review moderation."""

from __future__ import annotations

from django.db import transaction
from django.db.models import Count, Q
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from apps.core import audit
from apps.core.admin_utils import (
    AdminReadOnlyViewSet,
    AuditedViewSet,
    ImageFileSerializer,
    SingleImageMixin,
    delete_image_files,
    unique_slug,
)
from apps.core.exceptions import DomainError, ErrorCode
from apps.core.pagination import StandardPagination

from .models import (
    Allergen,
    Brand,
    Category,
    Collection,
    CollectionItem,
    Product,
    ProductStatus,
    Review,
    ReviewStatus,
    SaleUnit,
)
from .signals import bump_catalog_caches


# =============================================================================================== categories
class CategorySerializer(serializers.ModelSerializer):
    image = serializers.SerializerMethodField()
    product_count = serializers.IntegerField(read_only=True, default=0)
    active_product_count = serializers.IntegerField(read_only=True, default=0)
    children_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = Category
        fields = [
            "id", "parent", "name", "slug", "description", "image", "sort_order", "is_active", "show_on_home",
            "product_count", "active_product_count", "children_count", "created_at", "updated_at",
        ]  # fmt: skip
        read_only_fields = ["id", "created_at", "updated_at"]
        extra_kwargs = {"slug": {"required": False}}

    def get_image(self, obj) -> dict:
        return obj.image_urls()

    def validate_parent(self, parent):
        inst = self.instance
        if parent is None:
            return parent
        if inst is not None and parent.pk == inst.pk:
            raise serializers.ValidationError("A category can't be its own parent.")
        if parent.parent_id:
            raise serializers.ValidationError(
                "Categories have two levels (department → category). Choose a department as the parent."
            )
        if inst is not None and inst.children.exists():
            raise serializers.ValidationError(
                "This category has sub-categories, so it can't be moved under another one (only two levels are supported)."
            )
        return parent

    def validate(self, attrs):
        if self.instance is None and not attrs.get("slug"):
            attrs["slug"] = unique_slug(Category, attrs.get("name", "category"))
        return attrs


class CategoryViewSet(SingleImageMixin, AuditedViewSet):
    queryset = Category.objects.select_related("parent").order_by("parent_id", "sort_order", "name")
    serializer_class = CategorySerializer
    read_capability = "catalog.read"
    capability = "catalog.write"
    search_fields = ["name", "slug"]
    ordering_fields = ["name", "sort_order", "created_at"]
    audit_label = "category"

    def get_queryset(self):
        qs = (
            super()
            .get_queryset()
            .annotate(
                product_count=Count("products", distinct=True),
                active_product_count=Count("products", filter=Q(products__status=ProductStatus.ACTIVE), distinct=True),
                children_count=Count("children", distinct=True),
            )
        )
        p = self.request.query_params
        if p.get("parent") == "null":
            qs = qs.filter(parent__isnull=True)
        elif p.get("parent", "").isdigit():
            qs = qs.filter(parent_id=p["parent"])
        if p.get("is_active") in ("true", "false", "1", "0"):
            qs = qs.filter(is_active=p["is_active"] in ("true", "1"))
        return qs

    def _blockers(self, category: Category) -> dict:
        return {
            "active_products": category.products.filter(status=ProductStatus.ACTIVE).count(),
            "products": category.products.count(),
            "active_children": category.children.filter(is_active=True).count(),
            "children": category.children.count(),
        }

    def perform_update(self, serializer):
        category = serializer.instance
        if category.is_active and serializer.validated_data.get("is_active") is False:
            blockers = self._blockers(category)
            if blockers["active_products"] or blockers["active_children"]:
                parts = []
                if blockers["active_products"]:
                    parts.append(f"{blockers['active_products']} active product(s)")
                if blockers["active_children"]:
                    parts.append(
                        f"{blockers['active_children']} active sub-categor{'y' if blockers['active_children'] == 1 else 'ies'}"
                    )
                raise DomainError(
                    ErrorCode.INVALID_STATE,
                    f"This category still has {' and '.join(parts)}, so it can't be deactivated: shoppers would lose them. "
                    "Move or deactivate those first.",
                    status_code=409, details=blockers,
                )  # fmt: skip
        super().perform_update(serializer)

    def perform_destroy(self, instance):
        blockers = self._blockers(instance)
        if blockers["products"] or blockers["children"]:
            parts = []
            if blockers["products"]:
                parts.append(f"{blockers['products']} product(s) ({blockers['active_products']} active)")
            if blockers["children"]:
                parts.append(f"{blockers['children']} sub-categor{'y' if blockers['children'] == 1 else 'ies'}")
            raise DomainError(
                ErrorCode.INVALID_STATE,
                f"This category still contains {' and '.join(parts)}, so it can't be deleted. Move them elsewhere first"
                + (" (or deactivate it once its products are inactive)." if not blockers["active_products"] else "."),
                status_code=409, details=blockers,
            )  # fmt: skip
        name, widths = instance.image.name if instance.image else None, instance.image_widths
        super().perform_destroy(instance)
        delete_image_files(name, widths)

    @extend_schema(request=ImageFileSerializer, responses={200: CategorySerializer, 204: None})
    @action(detail=True, methods=["post", "delete"], url_path="image", parser_classes=[MultiPartParser, FormParser])
    def image(self, request, pk=None):
        return self.handle_image(request)


# =============================================================================================== brands
class BrandSerializer(serializers.ModelSerializer):
    product_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = Brand
        fields = [
            "id",
            "name",
            "slug",
            "description",
            "is_active",
            "is_demo",
            "product_count",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "is_demo", "created_at", "updated_at"]
        extra_kwargs = {"slug": {"required": False}, "name": {"validators": []}}

    def validate_name(self, value):
        value = value.strip()
        clash = Brand.objects.filter(name__iexact=value)
        if self.instance is not None:
            clash = clash.exclude(pk=self.instance.pk)
        if clash.exists():
            raise serializers.ValidationError("A brand with this name already exists.")
        return value

    def validate(self, attrs):
        if self.instance is None and not attrs.get("slug"):
            attrs["slug"] = unique_slug(Brand, attrs.get("name", "brand"))
        return attrs


class BrandViewSet(AuditedViewSet):
    queryset = Brand.objects.order_by("name")
    serializer_class = BrandSerializer
    read_capability = "catalog.read"
    capability = "catalog.write"
    search_fields = ["name", "slug"]
    ordering_fields = ["name", "created_at"]
    audit_label = "brand"

    def get_queryset(self):
        qs = super().get_queryset().annotate(product_count=Count("products", distinct=True))
        flag = self.request.query_params.get("is_active")
        if flag in ("true", "false", "1", "0"):
            qs = qs.filter(is_active=flag in ("true", "1"))
        return qs

    def perform_destroy(self, instance):
        count = instance.products.count()
        if count:
            raise DomainError(
                ErrorCode.INVALID_STATE,
                f"{count} product(s) still use this brand, so it can't be deleted. Deactivate it, or move the products to another brand first.",
                status_code=409, details={"products": count},
            )  # fmt: skip
        super().perform_destroy(instance)


# =============================================================================================== collections
class CollectionSerializer(serializers.ModelSerializer):
    product_count = serializers.IntegerField(read_only=True, default=0)
    is_current = serializers.SerializerMethodField()

    class Meta:
        model = Collection
        fields = [
            "id", "name", "slug", "description", "is_active", "show_on_home", "sort_order", "starts_on", "ends_on",
            "is_current", "product_count", "created_at", "updated_at",
        ]  # fmt: skip
        read_only_fields = ["id", "created_at", "updated_at"]
        extra_kwargs = {"slug": {"required": False}}

    def get_is_current(self, obj) -> bool:
        return obj.is_current()

    def validate(self, attrs):
        starts = attrs.get("starts_on", getattr(self.instance, "starts_on", None))
        ends = attrs.get("ends_on", getattr(self.instance, "ends_on", None))
        if starts and ends and ends < starts:
            raise serializers.ValidationError({"ends_on": "The end date can't be before the start date."})
        if self.instance is None and not attrs.get("slug"):
            attrs["slug"] = unique_slug(Collection, attrs.get("name", "collection"))
        return attrs


class CollectionProductsSerializer(serializers.Serializer):
    product_ids = serializers.ListField(child=serializers.IntegerField(min_value=1), allow_empty=True, max_length=500)

    def to_internal_value(self, data):
        if (
            isinstance(data, dict) and "product_ids" not in data and "products" in data
        ):  # accept {"products": [...]} too
            data = {**data, "product_ids": data["products"]}
        return super().to_internal_value(data)

    def validate_product_ids(self, value):
        if len(value) != len(set(value)):
            raise serializers.ValidationError("Each product can only appear once.")
        found = set(Product.objects.filter(pk__in=value).values_list("pk", flat=True))
        missing = [pk for pk in value if pk not in found]
        if missing:
            raise serializers.ValidationError(f"Unknown product id(s): {', '.join(map(str, missing))}.")
        return value


class CollectionViewSet(AuditedViewSet):
    """Curated product groups. Marketing may curate them (`catalog.merchandise`); reading needs `catalog.read`."""

    queryset = Collection.objects.order_by("sort_order", "name")
    serializer_class = CollectionSerializer
    read_capability = "catalog.read"
    capability = "catalog.merchandise"
    search_fields = ["name", "slug"]
    ordering_fields = ["name", "sort_order", "created_at"]
    audit_label = "collection"

    def get_queryset(self):
        return super().get_queryset().annotate(product_count=Count("collectionitem", distinct=True))

    @staticmethod
    def _members(collection: Collection) -> list[dict]:
        rows = (
            CollectionItem.objects.filter(collection=collection).select_related("product").order_by("sort_order", "id")
        )
        return [
            {
                "id": r.product_id,
                "sku": r.product.sku,
                "name": r.product.name,
                "slug": r.product.slug,
                "status": r.product.status,
                "sort_order": r.sort_order,
            }
            for r in rows
        ]

    @extend_schema(request=CollectionProductsSerializer, responses={200: dict})
    @action(detail=True, methods=["get", "put"], url_path="products")
    def products(self, request, pk=None):
        collection = self.get_object()
        if request.method == "GET":
            return Response(self._members(collection))
        ser = CollectionProductsSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        ids = ser.validated_data["product_ids"]
        with transaction.atomic():
            Collection.objects.select_for_update(of=("self",)).get(pk=collection.pk)
            before = [m["id"] for m in self._members(collection)]
            CollectionItem.objects.filter(collection=collection).delete()
            CollectionItem.objects.bulk_create(
                [CollectionItem(collection=collection, product_id=pid, sort_order=pos) for pos, pid in enumerate(ids)]
            )
            audit.record(
                request.user,
                "collection.products_updated",
                collection,
                before={"product_ids": before},
                after={"product_ids": ids},
                request=request,
            )
        bump_catalog_caches()  # bulk_create bypasses the post_save signals that normally invalidate the storefront caches
        return Response(self._members(collection))


# =============================================================================================== lookups
class UnitSerializer(serializers.ModelSerializer):
    class Meta:
        model = SaleUnit
        fields = ["id", "code", "name", "symbol", "kind", "allows_fraction"]
        read_only_fields = fields


class AllergenSerializer(serializers.ModelSerializer):
    class Meta:
        model = Allergen
        fields = ["id", "code", "name"]
        read_only_fields = fields


class UnitViewSet(AdminReadOnlyViewSet):
    queryset = SaleUnit.objects.order_by("kind", "to_base")
    serializer_class = UnitSerializer
    read_capability = capability = "catalog.read"


class AllergenViewSet(AdminReadOnlyViewSet):
    queryset = Allergen.objects.order_by("name")
    serializer_class = AllergenSerializer
    read_capability = capability = "catalog.read"


# =============================================================================================== reviews
class ReviewModerationSerializer(serializers.ModelSerializer):
    product = serializers.SerializerMethodField()
    author = serializers.CharField(source="user.full_name", read_only=True)

    class Meta:
        model = Review
        fields = [
            "id",
            "product",
            "author",
            "rating",
            "title",
            "body",
            "status",
            "verified_purchase",
            "is_demo",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields

    def get_product(self, obj) -> dict:
        return {"id": obj.product_id, "sku": obj.product.sku, "name": obj.product.name}


class ReviewDecisionSerializer(serializers.Serializer):
    note = serializers.CharField(max_length=300, required=False, allow_blank=True)


class ReviewModerationViewSet(AdminReadOnlyViewSet):
    """Read + approve/reject. Customers' reviews are never edited by staff — only their visibility is decided."""

    queryset = Review.objects.select_related("product", "user").order_by("-created_at", "-id")
    serializer_class = ReviewModerationSerializer
    pagination_class = StandardPagination
    read_capability = capability = "content.manage"

    def get_queryset(self):
        qs = super().get_queryset()
        p = self.request.query_params
        if p.get("status"):
            wanted = [s for s in p["status"].upper().split(",") if s]
            bad = [s for s in wanted if s not in ReviewStatus.values]
            if bad:
                raise serializers.ValidationError({"status": [f"Unknown status: {', '.join(bad)}."]})
            qs = qs.filter(status__in=wanted)
        if p.get("product", "").isdigit():
            qs = qs.filter(product_id=p["product"])
        if p.get("rating", "").isdigit():
            qs = qs.filter(rating=p["rating"])
        if p.get("q"):
            qs = qs.filter(
                Q(title__icontains=p["q"])
                | Q(body__icontains=p["q"])
                | Q(product__name__icontains=p["q"])
                | Q(product__sku__icontains=p["q"])
            )
        return qs

    def _decide(self, request, target: str, label: str):
        ser = ReviewDecisionSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        with transaction.atomic():
            review = Review.objects.select_for_update(of=("self",)).get(pk=self.get_object().pk)
            if review.status != target:  # repeating a decision is a harmless no-op
                before = {"status": review.status}
                review.status = target
                review.save(update_fields=["status", "updated_at"])  # post_save recomputes the product's rating
                audit.record(
                    request.user, f"review.{label}", review, summary=ser.validated_data.get("note", ""),
                    before=before, after={"status": review.status}, request=request,
                )  # fmt: skip
        review = self.get_queryset().get(pk=review.pk)
        return Response(self.get_serializer(review).data)

    @extend_schema(request=ReviewDecisionSerializer, responses={200: ReviewModerationSerializer})
    @action(detail=True, methods=["post"], url_path="approve")
    def approve(self, request, pk=None):
        return self._decide(request, ReviewStatus.APPROVED, "approved")

    @extend_schema(request=ReviewDecisionSerializer, responses={200: ReviewModerationSerializer})
    @action(detail=True, methods=["post"], url_path="reject")
    def reject(self, request, pk=None):
        return self._decide(request, ReviewStatus.REJECTED, "rejected")
