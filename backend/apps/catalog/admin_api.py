"""Staff API: products (with nested claims / allergens / nutrition / images editing).

Categories, brands, collections, lookups and review moderation live in `admin_taxonomy.py`.
Routes are registered in `config/admin_urls_crud.py`.
"""

from __future__ import annotations

import copy

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.db.models import Exists, OuterRef, ProtectedError, Q
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from apps.core import audit
from apps.core.admin_api import snapshot
from apps.core.admin_utils import (
    AuditedViewSet,
    QuantityField,
    bool_param,
    delete_image_files,
    store_image,
    unique_slug,
)
from apps.core.exceptions import DomainError, ErrorCode
from apps.core.pagination import StandardPagination

from .models import (
    Allergen,
    AllergenLevel,
    NutritionFact,
    Product,
    ProductAllergen,
    ProductClaim,
    ProductImage,
    ProductStatus,
    ProductType,
    StorageType,
)
from .signals import bump_catalog_caches

MAX_IMAGES = 8
NUTRIENTS = ["energy_kcal", "energy_kj", "fat", "saturates", "carbohydrate", "sugars", "fibre", "protein", "salt"]
LOOSE_OR_HOUSEHOLD = ["LOOSE_PRODUCE", "HOUSEHOLD"]

# "Is this part of the product page filled in?" — one Q per gap, mirrored by `ProductSerializer.get_missing`.
MISSING_Q = {
    "image": Q(has_image=False),
    "description": Q(description=""),
    "origin": Q(origin_country="", origin_note=""),
    "nutrition": Q(has_nutrition=False),
    "ingredients": Q(ingredients="") & ~Q(product_type__in=LOOSE_OR_HOUSEHOLD),
    "allergens": Q(allergen_info_complete=False),
    "storage": Q(storage_instructions=""),
}


# =============================================================================================== serializers
class ImageSerializer(serializers.ModelSerializer):
    urls = serializers.SerializerMethodField()

    class Meta:
        model = ProductImage
        fields = ["id", "alt_text", "sort_order", "urls", "created_at"]
        read_only_fields = fields

    def get_urls(self, obj):
        return obj.urls()


class ClaimSerializer(serializers.ModelSerializer):
    verified_by = serializers.SerializerMethodField()

    class Meta:
        model = ProductClaim
        fields = ["kind", "verified", "evidence", "verified_by", "verified_at"]
        read_only_fields = ["verified_by", "verified_at"]
        extra_kwargs = {"verified": {"required": False}, "evidence": {"required": False, "allow_blank": True}}
        validators: list = []  # the (product, kind) uniqueness is checked on the whole list in the view

    def get_verified_by(self, obj):
        return obj.verified_by.email if obj.verified_by_id else None

    def validate(self, attrs):
        attrs["evidence"] = (attrs.get("evidence") or "").strip()
        if attrs.get("verified") and not attrs["evidence"]:
            raise serializers.ValidationError(
                {
                    "evidence": "Evidence (certificate number, label review, supplier statement…) is required to mark a claim as verified."
                }
            )
        return attrs


class AllergenInputSerializer(serializers.Serializer):
    allergen = serializers.SlugRelatedField(slug_field="code", queryset=Allergen.objects.all())
    level = serializers.ChoiceField(choices=AllergenLevel.choices, default=AllergenLevel.CONTAINS)


class AllergensPutSerializer(serializers.Serializer):
    allergens = AllergenInputSerializer(many=True)
    allergen_info_complete = serializers.BooleanField(required=False)

    def validate_allergens(self, value):
        codes = [row["allergen"].code for row in value]
        if len(codes) != len(set(codes)):
            raise serializers.ValidationError("Each allergen can only be listed once.")
        return value


class NutritionSerializer(serializers.ModelSerializer):
    energy_kcal = QuantityField(max_digits=7, decimal_places=1, min_value=0, allow_null=True, required=False)
    energy_kj = QuantityField(max_digits=7, decimal_places=1, min_value=0, allow_null=True, required=False)
    fat = QuantityField(max_digits=6, decimal_places=2, min_value=0, allow_null=True, required=False)
    saturates = QuantityField(max_digits=6, decimal_places=2, min_value=0, allow_null=True, required=False)
    carbohydrate = QuantityField(max_digits=6, decimal_places=2, min_value=0, allow_null=True, required=False)
    sugars = QuantityField(max_digits=6, decimal_places=2, min_value=0, allow_null=True, required=False)
    fibre = QuantityField(max_digits=6, decimal_places=2, min_value=0, allow_null=True, required=False)
    protein = QuantityField(max_digits=6, decimal_places=2, min_value=0, allow_null=True, required=False)
    salt = QuantityField(max_digits=6, decimal_places=3, min_value=0, allow_null=True, required=False)
    source = serializers.CharField(max_length=200)
    basis = serializers.CharField(max_length=30, required=False)

    class Meta:
        model = NutritionFact
        fields = ["basis", *NUTRIENTS, "source", "is_demo"]
        read_only_fields = ["is_demo"]

    def validate_source(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError(
                "Say where these values come from (label, supplier datasheet, lab report…)."
            )
        return value

    def validate(self, attrs):
        def num(name):
            return attrs.get(name)

        if num("saturates") is not None and num("fat") is not None and num("saturates") > num("fat"):
            raise serializers.ValidationError({"saturates": "Saturates can't exceed total fat."})
        if num("sugars") is not None and num("carbohydrate") is not None and num("sugars") > num("carbohydrate"):
            raise serializers.ValidationError({"sugars": "Sugars can't exceed total carbohydrate."})
        return attrs


class ProductSerializer(serializers.ModelSerializer):
    """List + write shape. Money is a 2-dp string, quantities are canonical strings."""

    price = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=0)
    qty_min = QuantityField(max_digits=10, decimal_places=3, min_value=0, required=False)
    qty_step = QuantityField(max_digits=10, decimal_places=3, min_value=0, required=False)
    qty_max = QuantityField(max_digits=10, decimal_places=3, min_value=0, allow_null=True, required=False)
    net_content = QuantityField(max_digits=10, decimal_places=3, min_value=0, allow_null=True, required=False)
    barcode = serializers.CharField(max_length=14, allow_null=True, allow_blank=True, required=False)

    category_name = serializers.CharField(source="category.name", read_only=True)
    brand_name = serializers.SerializerMethodField()
    sale_unit_code = serializers.CharField(source="sale_unit.code", read_only=True)
    unit_price = serializers.SerializerMethodField()
    missing = serializers.SerializerMethodField()

    class Meta:
        model = Product
        fields = [
            "id", "sku", "slug", "name", "short_description", "description",
            "category", "category_name", "brand", "brand_name", "barcode",
            "product_type", "storage_type", "sale_unit", "sale_unit_code", "price", "unit_price", "tax_rate",
            "qty_min", "qty_step", "qty_max", "net_content", "net_content_unit", "is_variable_weight",
            "stock_mode", "tracks_batches", "is_perishable", "sell_buffer_days",
            "status", "is_available", "is_featured",
            "origin_country", "origin_note", "storage_instructions", "ingredients", "packaging", "manufacturer",
            "allergen_info_complete", "popularity", "rating_avg", "rating_count", "is_demo", "missing",
            "created_at", "updated_at",
        ]  # fmt: skip
        read_only_fields = [
            "id", "popularity", "rating_avg", "rating_count", "is_demo", "created_at", "updated_at",
        ]  # fmt: skip
        extra_kwargs = {"slug": {"required": False}, "sku": {"max_length": 32}}

    # -- derived (read-only) ----------------------------------------------------------------
    def get_brand_name(self, obj):
        return obj.brand.name if obj.brand_id else None

    def get_unit_price(self, obj):
        up = obj.unit_price
        return {"amount": str(up["amount"]), "per": up["per"]} if up else None

    def get_missing(self, obj) -> list[str]:
        has_image = getattr(obj, "has_image", None)
        has_nutrition = getattr(obj, "has_nutrition", None)
        if has_image is None:
            has_image = obj.images.exists()
        if has_nutrition is None:
            has_nutrition = NutritionFact.objects.filter(product=obj).exists()
        missing = []
        if not has_image:
            missing.append("image")
        if not obj.description:
            missing.append("description")
        if not (obj.origin_country or obj.origin_note):
            missing.append("origin")
        if not has_nutrition:
            missing.append("nutrition")
        if not obj.ingredients and obj.product_type not in LOOSE_OR_HOUSEHOLD:
            missing.append("ingredients")
        if not obj.allergen_info_complete:
            missing.append("allergens")
        if not obj.storage_instructions:
            missing.append("storage")
        return missing

    # -- field level -------------------------------------------------------------------------
    def validate_sku(self, value):
        return value.strip()

    def validate_barcode(self, value):
        value = (value or "").strip()
        if not value:
            return None  # the unique index only covers non-null barcodes: blank must be NULL, never ""
        if not value.isdigit() or not 8 <= len(value) <= 14:
            raise serializers.ValidationError("A barcode is 8 to 14 digits (EAN/UPC/GTIN).")
        clash = Product.objects.filter(barcode=value)
        if self.instance is not None:
            clash = clash.exclude(pk=self.instance.pk)
        if clash.exists():
            raise serializers.ValidationError("Another product already uses this barcode.")
        return value

    # -- object level ------------------------------------------------------------------------
    def validate(self, attrs):
        inst = self.instance
        candidate = copy.copy(inst) if inst is not None else Product()
        for key, value in attrs.items():
            setattr(candidate, key, value)
        errors: dict[str, list[str]] = {}

        try:  # the model's own rules (variable weight needs a weight unit, batches need tracked stock, net content pair…)
            candidate.clean()
        except DjangoValidationError as exc:
            errors.update({k: list(v) for k, v in exc.message_dict.items()})

        if candidate.qty_max is not None and candidate.qty_max < candidate.qty_min:
            errors.setdefault("qty_max", []).append("The maximum can't be below the minimum quantity.")
        if candidate.qty_min is not None and candidate.qty_min <= 0:
            errors.setdefault("qty_min", []).append("The minimum quantity must be greater than zero.")
        if candidate.qty_step is not None and candidate.qty_step <= 0:
            errors.setdefault("qty_step", []).append("The quantity step must be greater than zero.")
        if candidate.net_content is not None and candidate.net_content <= 0:
            errors.setdefault("net_content", []).append("Net content must be greater than zero.")
        if candidate.sale_unit_id and not candidate.sale_unit.allows_fraction:
            for name in ("qty_min", "qty_step", "qty_max"):
                value = getattr(candidate, name)
                if value is not None and value != value.to_integral_value():
                    errors.setdefault(name, []).append(
                        f"{candidate.sale_unit.name} can only be sold in whole numbers, so this can't be a fraction."
                    )

        if inst is not None:
            self._guard_stock_sensitive_changes(inst, attrs, errors)
        if errors:
            raise serializers.ValidationError(errors)

        if inst is None and not attrs.get("slug"):
            attrs["slug"] = unique_slug(Product, attrs.get("name", "product"))
        return attrs

    @staticmethod
    def _guard_stock_sensitive_changes(inst: Product, attrs: dict, errors: dict) -> None:
        """Changing how a product is counted after stock/orders exist would silently corrupt those numbers."""
        changed_unit = "sale_unit" in attrs and attrs["sale_unit"].pk != inst.sale_unit_id
        changed_tracking = ("tracks_batches" in attrs and attrs["tracks_batches"] != inst.tracks_batches) or (
            "stock_mode" in attrs and attrs["stock_mode"] != inst.stock_mode
        )
        if not (changed_unit or changed_tracking):
            return
        if not has_stock_or_orders(inst, include_empty_levels=False):
            return
        if changed_unit:
            errors.setdefault("sale_unit", []).append(
                "This product already has stock or orders counted in its current unit. Archive it and create a new product instead."
            )
        if changed_tracking:
            field = "tracks_batches" if "tracks_batches" in attrs else "stock_mode"
            errors.setdefault(field, []).append(
                "This product already has stock or orders, so how its stock is tracked can't change. Archive it and create a new product instead."
            )


class ProductDetailSerializer(ProductSerializer):
    images = ImageSerializer(many=True, read_only=True)
    claims = ClaimSerializer(many=True, read_only=True)
    allergens = serializers.SerializerMethodField()
    nutrition = serializers.SerializerMethodField()

    class Meta(ProductSerializer.Meta):
        fields = [*ProductSerializer.Meta.fields, "images", "claims", "allergens", "nutrition"]
        read_only_fields = [*ProductSerializer.Meta.read_only_fields, "images", "claims", "allergens", "nutrition"]

    def get_allergens(self, obj):
        return [
            {"allergen": row.allergen.code, "name": row.allergen.name, "level": row.level}
            for row in obj.allergens.select_related("allergen").order_by("allergen__name")
        ]

    def get_nutrition(self, obj):
        row = NutritionFact.objects.filter(product=obj).first()
        return NutritionSerializer(row).data if row else None


class AvailabilitySerializer(serializers.Serializer):
    is_available = serializers.BooleanField(required=False)
    status = serializers.ChoiceField(choices=[ProductStatus.ACTIVE, ProductStatus.INACTIVE], required=False)

    def validate(self, attrs):
        if not attrs:
            raise serializers.ValidationError("Send is_available and/or status (ACTIVE or INACTIVE).")
        return attrs


class MerchandisingSerializer(serializers.Serializer):
    is_featured = serializers.BooleanField()


class ImageUploadSerializer(serializers.Serializer):
    image = serializers.FileField(allow_empty_file=False)
    alt_text = serializers.CharField(max_length=200)

    def validate_alt_text(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Describe the image for people using screen readers.")
        return value


class ImageAltSerializer(serializers.Serializer):
    alt_text = serializers.CharField(max_length=200)

    validate_alt_text = ImageUploadSerializer.validate_alt_text


class ImageOrderSerializer(serializers.Serializer):
    ids = serializers.ListField(child=serializers.IntegerField(min_value=1), allow_empty=False)


# =============================================================================================== helpers
def has_stock_or_orders(product: Product, *, include_empty_levels: bool = True) -> bool:
    """True when ledger, order or purchasing rows point at this product (so it must never be hard-deleted)."""
    from apps.purchasing.models import PurchaseOrderLine

    levels = product.stock_levels.all()
    if not include_empty_levels:
        levels = levels.filter(Q(on_hand__gt=0) | Q(reserved__gt=0))
    return (
        product.order_items.exists()
        or product.movements.exists()
        or product.batches.exists()
        or levels.exists()
        or PurchaseOrderLine.objects.filter(product=product).exists()
    )


def touch(product: Product) -> None:
    """Bump `updated_at` (sitemap freshness) and the search/catalog caches after a nested edit."""
    product.save(update_fields=["updated_at"])


def _csv_choices(request, name: str, allowed) -> list[str]:
    raw = request.query_params.get(name, "")
    values = [v.strip() for v in raw.split(",") if v.strip()]
    bad = [v for v in values if v not in set(allowed)]
    if bad:
        raise serializers.ValidationError({name: [f"Unknown value(s): {', '.join(bad)}."]})
    return values


# =============================================================================================== viewset
class ProductViewSet(AuditedViewSet):
    """Catalog management. Reads need `catalog.read`; edits `catalog.write`; stock-room and marketing roles get
    narrow switches (`availability` → `catalog.availability`, `merchandising` → `catalog.merchandise`)."""

    queryset = Product.objects.select_related("category__parent", "brand", "sale_unit", "net_content_unit").order_by(
        "name", "id"
    )
    pagination_class = StandardPagination
    read_capability = "catalog.read"
    capability = "catalog.write"
    capability_map = {"availability": "catalog.availability", "merchandising": "catalog.merchandise"}
    search_fields = ["name", "sku", "barcode"]
    ordering_fields = ["name", "sku", "price", "created_at", "updated_at", "popularity", "status"]
    audit_label = "product"
    audit_exclude = {"search_text", "search_vector"}

    def get_serializer_class(self):
        return ProductSerializer if self.action == "list" else ProductDetailSerializer

    def get_queryset(self):
        qs = (
            super()
            .get_queryset()
            .annotate(
                has_image=Exists(ProductImage.objects.filter(product=OuterRef("pk"))),
                has_nutrition=Exists(NutritionFact.objects.filter(product=OuterRef("pk"))),
            )
        )
        if self.action != "list":
            return qs
        p = self.request.query_params
        statuses = _csv_choices(self.request, "status", ProductStatus.values)
        if statuses:
            qs = qs.filter(status__in=statuses)
        if p.get("category", "").isdigit():  # a department also shows the products of its categories
            qs = qs.filter(Q(category_id=p["category"]) | Q(category__parent_id=p["category"]))
        if p.get("brand", "").isdigit():
            qs = qs.filter(brand_id=p["brand"])
        for param, field in (
            ("perishable", "is_perishable"),
            ("featured", "is_featured"),
            ("available", "is_available"),
        ):
            flag = bool_param(self.request, param)
            if flag is not None:
                qs = qs.filter(**{field: flag})
        types = _csv_choices(self.request, "product_type", ProductType.values)
        if types:
            qs = qs.filter(product_type__in=types)
        storage = _csv_choices(self.request, "storage_type", StorageType.values)
        if storage:
            qs = qs.filter(storage_type__in=storage)
        missing = _csv_choices(self.request, "missing", MISSING_Q)
        for gap in missing:
            qs = qs.filter(MISSING_Q[gap])
        if bool_param(self.request, "incomplete"):
            any_gap = Q(pk__in=[])
            for gap_q in MISSING_Q.values():
                any_gap |= gap_q
            qs = qs.filter(any_gap)
        elif bool_param(self.request, "incomplete") is False:
            for gap_q in MISSING_Q.values():
                qs = qs.exclude(gap_q)
        return qs

    # -- price changes get their own audit line -----------------------------------------------------
    def perform_update(self, serializer):
        old_price = serializer.instance.price
        with transaction.atomic():
            super().perform_update(serializer)
            new_price = serializer.instance.price
            if new_price != old_price:
                audit.record(
                    self.request.user, "product.price_changed", serializer.instance,
                    summary=f"{serializer.instance.sku}: {old_price} -> {new_price}",
                    before={"price": str(old_price)}, after={"price": str(new_price)}, request=self.request,
                )  # fmt: skip

    # -- DELETE = archive (hard delete only for products nothing ever referenced) ----------------------
    @extend_schema(responses={200: dict})
    def destroy(self, request, *args, **kwargs):
        pk = self.get_object().pk
        outcome, files = "archived", []
        with transaction.atomic():
            product = Product.objects.select_for_update(of=("self",)).get(pk=pk)
            before = self.audit_state(product)
            if bool_param(request, "archive") is not True and not has_stock_or_orders(product):
                files = [(img.image.name, img.image_widths) for img in product.images.all()]
                try:
                    with transaction.atomic():
                        product.delete()
                    outcome = "deleted"
                except ProtectedError:  # something we didn't anticipate points at it: archive instead
                    files = []
            if outcome == "deleted":
                audit.record(
                    request.user, "product.deleted", None, before=before, request=request,
                    target_type="Product", target_id=str(pk),
                )  # fmt: skip
            elif product.status != ProductStatus.ARCHIVED:
                product.status = ProductStatus.ARCHIVED
                product.save(update_fields=["status", "updated_at"])
                audit.record(
                    request.user,
                    "product.archived",
                    product,
                    before=before,
                    after=self.audit_state(product),
                    request=request,
                )
        for name, widths in files:
            delete_image_files(name, widths)
        body = {"id": pk, "result": outcome, "status": ProductStatus.ARCHIVED if outcome == "archived" else None}
        return Response(body, status=status.HTTP_200_OK)

    # -- narrow switches --------------------------------------------------------------------------------
    @extend_schema(request=AvailabilitySerializer, responses={200: ProductDetailSerializer})
    @action(detail=True, methods=["patch"], url_path="availability")
    def availability(self, request, pk=None):
        ser = AvailabilitySerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        with transaction.atomic():
            product = Product.objects.select_for_update(of=("self",)).get(pk=self.get_object().pk)
            if "status" in ser.validated_data and product.status == ProductStatus.ARCHIVED:
                raise DomainError(
                    ErrorCode.INVALID_STATE,
                    "Archived products can only be restored by someone who can edit the catalog.",
                    status_code=409,
                )
            before = {"is_available": product.is_available, "status": product.status}
            for key, value in ser.validated_data.items():
                setattr(product, key, value)
            product.save(update_fields=[*ser.validated_data, "updated_at"])
            audit.record(
                request.user, "product.availability_changed", product, before=before,
                after={"is_available": product.is_available, "status": product.status}, request=request,
            )  # fmt: skip
        return Response(ProductDetailSerializer(self.get_object()).data)

    @extend_schema(request=MerchandisingSerializer, responses={200: ProductDetailSerializer})
    @action(detail=True, methods=["patch"], url_path="merchandising")
    def merchandising(self, request, pk=None):
        ser = MerchandisingSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        with transaction.atomic():
            product = Product.objects.select_for_update(of=("self",)).get(pk=self.get_object().pk)
            before = {"is_featured": product.is_featured}
            product.is_featured = ser.validated_data["is_featured"]
            product.save(update_fields=["is_featured", "updated_at"])
            audit.record(
                request.user, "product.merchandising_changed", product,
                before=before, after={"is_featured": product.is_featured}, request=request,
            )  # fmt: skip
        return Response(ProductDetailSerializer(self.get_object()).data)

    # -- claims ----------------------------------------------------------------------------------------------
    @extend_schema(request=ClaimSerializer(many=True), responses={200: ClaimSerializer(many=True)})
    @action(detail=True, methods=["put"], url_path="claims")
    def claims(self, request, pk=None):
        payload = request.data.get("claims") if isinstance(request.data, dict) else request.data
        if payload is None:
            raise serializers.ValidationError({"claims": ["Send the full list of claims."]})
        ser = ClaimSerializer(data=payload, many=True)
        ser.is_valid(raise_exception=True)
        kinds = [row["kind"] for row in ser.validated_data]
        if len(kinds) != len(set(kinds)):
            raise serializers.ValidationError({"claims": ["Each claim can only be listed once."]})
        with transaction.atomic():
            product = Product.objects.select_for_update(of=("self",)).get(pk=self.get_object().pk)
            existing = {c.kind: c for c in product.claims.select_related("verified_by")}
            before = ClaimSerializer(existing.values(), many=True).data
            now = timezone.now()
            for row in ser.validated_data:
                claim = existing.pop(row["kind"], None) or ProductClaim(product=product, kind=row["kind"])
                verified, evidence = bool(row.get("verified")), row["evidence"]
                newly_verified = verified and not (claim.pk and claim.verified and claim.evidence == evidence)
                claim.verified, claim.evidence = verified, evidence
                if newly_verified:  # who signed it off, and when, is part of the record
                    claim.verified_by, claim.verified_at = request.user, now
                elif not verified:
                    claim.verified_by, claim.verified_at = None, None
                claim.save()
            ProductClaim.objects.filter(pk__in=[c.pk for c in existing.values()]).delete()
            touch(product)
            result = ClaimSerializer(product.claims.select_related("verified_by").order_by("kind"), many=True).data
            audit.record(
                request.user, "product.claims_updated", product,
                before=[dict(r) for r in before], after=[dict(r) for r in result], request=request,
            )  # fmt: skip
        return Response(result)

    # -- allergens --------------------------------------------------------------------------------------------
    @extend_schema(request=AllergensPutSerializer, responses={200: dict})
    @action(detail=True, methods=["put"], url_path="allergens")
    def allergens(self, request, pk=None):
        ser = AllergensPutSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        with transaction.atomic():
            product = Product.objects.select_for_update(of=("self",)).get(pk=self.get_object().pk)

            def state():
                rows = product.allergens.select_related("allergen").order_by("allergen__name")
                return {
                    "allergens": [
                        {"allergen": r.allergen.code, "name": r.allergen.name, "level": r.level} for r in rows
                    ],
                    "allergen_info_complete": product.allergen_info_complete,
                }

            before = state()
            product.allergens.all().delete()
            ProductAllergen.objects.bulk_create(
                [
                    ProductAllergen(product=product, allergen=r["allergen"], level=r["level"])
                    for r in ser.validated_data["allergens"]
                ]
            )
            if "allergen_info_complete" in ser.validated_data:
                product.allergen_info_complete = ser.validated_data["allergen_info_complete"]
                product.save(update_fields=["allergen_info_complete", "updated_at"])
            else:
                touch(product)
            after = state()
            audit.record(
                request.user, "product.allergens_updated", product, before=before, after=after, request=request
            )
        return Response(after)

    # -- nutrition --------------------------------------------------------------------------------------------
    @extend_schema(request=NutritionSerializer, responses={200: NutritionSerializer})
    @action(detail=True, methods=["put", "delete"], url_path="nutrition")
    def nutrition(self, request, pk=None):
        with transaction.atomic():
            product = Product.objects.select_for_update(of=("self",)).get(pk=self.get_object().pk)
            existing = NutritionFact.objects.filter(product=product).first()
            before = NutritionSerializer(existing).data if existing else None
            if request.method == "DELETE":
                if existing:
                    existing.delete()
                    touch(product)
                    audit.record(request.user, "product.nutrition_removed", product, before=before, request=request)
                return Response(status=status.HTTP_204_NO_CONTENT)
            ser = NutritionSerializer(data=request.data)
            ser.is_valid(raise_exception=True)
            values = {
                name: ser.validated_data.get(name) for name in NUTRIENTS
            }  # PUT replaces: omitted nutrients become unknown
            values["source"] = ser.validated_data["source"]
            values["basis"] = ser.validated_data.get("basis") or "per 100 g"
            values["is_demo"] = False  # staff-entered values replace any sample data
            fact, _ = NutritionFact.objects.update_or_create(product=product, defaults=values)
            touch(product)
            after = NutritionSerializer(fact).data
            audit.record(
                request.user, "product.nutrition_updated", product, before=before, after=after, request=request
            )
        return Response(after)

    # -- images -------------------------------------------------------------------------------------------------
    @extend_schema(request=ImageUploadSerializer, responses={200: ImageSerializer(many=True), 201: ImageSerializer})
    @action(
        detail=True,
        methods=["get", "post"],
        url_path="images",
        url_name="images",
        parser_classes=[MultiPartParser, FormParser],
    )
    def product_images(self, request, pk=None):
        product = self.get_object()
        if request.method == "GET":
            return Response(ImageSerializer(product.images.all(), many=True).data)
        ser = ImageUploadSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        stored = None
        try:
            with transaction.atomic():
                locked = Product.objects.select_for_update(of=("self",)).get(
                    pk=product.pk
                )  # serialise concurrent uploads
                existing = list(locked.images.values_list("sort_order", flat=True))
                if len(existing) >= MAX_IMAGES:
                    raise serializers.ValidationError(
                        {
                            "image": [
                                f"A product can have at most {MAX_IMAGES} images. Remove one before adding another."
                            ]
                        }
                    )
                image = ProductImage(
                    product=locked,
                    alt_text=ser.validated_data["alt_text"],
                    sort_order=(max(existing) + 1) if existing else 0,
                )
                widths = store_image(image.image, ser.validated_data["image"])
                stored = (image.image.name, widths)
                image.image_widths = widths
                image.save()
                touch(locked)
                audit.record(
                    request.user, "product.image_added", locked,
                    after={"image_id": image.pk, "alt_text": image.alt_text, "file": image.image.name}, request=request,
                )  # fmt: skip
        except Exception:
            if stored:  # the row never committed: don't leave its files behind
                delete_image_files(*stored)
            raise
        bump_catalog_caches()
        return Response(ImageSerializer(image).data, status=status.HTTP_201_CREATED)

    @extend_schema(request=ImageOrderSerializer, responses={200: ImageSerializer(many=True)})
    @action(detail=True, methods=["patch"], url_path="images/order")
    def image_order(self, request, pk=None):
        ser = ImageOrderSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        ids = ser.validated_data["ids"]
        with transaction.atomic():
            product = Product.objects.select_for_update(of=("self",)).get(pk=self.get_object().pk)
            current = list(product.images.order_by("sort_order", "id").values_list("id", flat=True))
            if len(ids) != len(set(ids)) or set(ids) != set(current):
                raise serializers.ValidationError({"ids": ["List every image of this product exactly once."]})
            by_id = {i.pk: i for i in product.images.all()}
            for position, image_id in enumerate(ids):
                by_id[image_id].sort_order = position
            ProductImage.objects.bulk_update(by_id.values(), ["sort_order"])
            touch(product)
            audit.record(
                request.user,
                "product.images_reordered",
                product,
                before={"ids": current},
                after={"ids": ids},
                request=request,
            )
        bump_catalog_caches()
        return Response(ImageSerializer(product.images.all(), many=True).data)

    @extend_schema(request=ImageAltSerializer, responses={200: ImageSerializer, 204: None})
    @action(detail=True, methods=["patch", "delete"], url_path=r"images/(?P<image_id>[0-9]+)")
    def image_detail(self, request, pk=None, image_id=None):
        product = self.get_object()
        image = product.images.filter(pk=image_id).first()
        if image is None:
            raise DomainError(ErrorCode.NOT_FOUND, "That image doesn't belong to this product.", status_code=404)
        if request.method == "PATCH":
            ser = ImageAltSerializer(data=request.data)
            ser.is_valid(raise_exception=True)
            with transaction.atomic():
                before = snapshot(image)
                image.alt_text = ser.validated_data["alt_text"]
                image.save(update_fields=["alt_text", "updated_at"])
                audit.record(
                    request.user,
                    "product.image_updated",
                    product,
                    before=before,
                    after=snapshot(image),
                    request=request,
                )
            bump_catalog_caches()
            return Response(ImageSerializer(image).data)
        name, widths = image.image.name, image.image_widths
        with transaction.atomic():
            before = snapshot(image)
            image.delete()
            touch(product)
            audit.record(request.user, "product.image_removed", product, before=before, request=request)
        delete_image_files(name, widths)  # after the row is gone: original + every responsive variant
        bump_catalog_caches()
        return Response(status=status.HTTP_204_NO_CONTENT)
