"""Staff API: automatic promotions and coupons (capability `promotions.manage`).

Saving a promotion bumps the `promos` and `home` caches through the signals wired in `PromotionsConfig.ready()`
(M2M target changes included), so storefront prices follow within one request.
"""

from __future__ import annotations

import re
from decimal import Decimal

from django.db.models import Count, Q, Sum
from django.db.models.functions import Coalesce
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.catalog.models import Brand, Category, Product, ProductStatus
from apps.core.admin_utils import AuditedViewSet, bool_param, mask_email
from apps.core.exceptions import DomainError, ErrorCode
from apps.core.money import money
from apps.core.pagination import StandardPagination

from .engine import PromoDef, apply_promo
from .models import (
    Coupon,
    CouponKind,
    CouponRedemption,
    CouponScope,
    Promotion,
    PromotionKind,
    PromotionScope,
    RedemptionStatus,
)

CODE_RE = re.compile(r"^[A-Z0-9][A-Z0-9_-]{2,39}$")
WARNING_PRODUCT_SCAN_LIMIT = 2000


# =============================================================================================== promotions
KIND_FIELDS = {
    PromotionKind.PERCENT_OFF: {"percent"},
    PromotionKind.AMOUNT_OFF: {"amount_off"},
    PromotionKind.MULTIBUY: {"multibuy_qty", "multibuy_price"},
}
ALL_KIND_FIELDS = set().union(*KIND_FIELDS.values())
SCOPE_FIELDS = {
    PromotionScope.PRODUCTS: "products",
    PromotionScope.CATEGORIES: "categories",
    PromotionScope.BRANDS: "brands",
}
SCOPE_NOUN = {"products": "product", "categories": "category", "brands": "brand"}


def promotion_warnings(promo: Promotion) -> list[str]:
    """Human warnings about offers the pricing engine will silently ignore (it never applies an offer that doesn't save money)."""
    warnings: list[str] = []
    now = timezone.now()
    if promo.ends_at is not None and promo.ends_at <= now:
        warnings.append("This promotion has already ended, so shoppers won't see it.")
    elif promo.starts_at > now and promo.is_active:
        warnings.append("This promotion starts in the future; it will go live automatically at its start time.")

    scope_field = SCOPE_FIELDS[promo.scope]
    if scope_field == "products":
        targets = Product.objects.filter(promotions=promo)
    elif scope_field == "categories":
        ids = list(promo.categories.values_list("pk", flat=True))
        targets = Product.objects.filter(Q(category_id__in=ids) | Q(category__parent_id__in=ids))
    else:
        targets = Product.objects.filter(brand__in=promo.brands.all())
    targets = targets.filter(status=ProductStatus.ACTIVE).select_related("category").distinct().order_by("id")[:WARNING_PRODUCT_SCAN_LIMIT]
    products = list(targets)
    if not products:
        warnings.append("No active products are covered by this promotion right now.")
        return warnings

    definition = PromoDef(
        id=promo.pk or 0, label=promo.label, kind=promo.kind, percent=promo.percent, amount_off=promo.amount_off,
        multibuy_qty=promo.multibuy_qty, multibuy_price=promo.multibuy_price,
    )  # fmt: skip
    useless = []
    for product in products:
        qty = Decimal(promo.multibuy_qty) if promo.kind == PromotionKind.MULTIBUY and promo.multibuy_qty else product.qty_min
        if apply_promo(definition, product.price, qty) is None:
            useless.append(product)
    if useless:
        names = ", ".join(f"{p.name} ({money(p.price)})" for p in useless[:5]) + (f" and {len(useless) - 5} more" if len(useless) > 5 else "")
        if promo.kind == PromotionKind.MULTIBUY:
            detail = f"{promo.multibuy_qty} for {money(promo.multibuy_price)} is not cheaper than buying them at the shelf price"
        elif promo.kind == PromotionKind.AMOUNT_OFF:
            detail = f"{money(promo.amount_off)} off does not lower the price"
        else:
            detail = f"{promo.percent}% off does not lower the price"
        warnings.append(
            f"{detail} for {len(useless)} of {len(products)} product(s): {names}. "
            "The pricing engine ignores an offer that doesn't save money, so shoppers won't get it on those products."
        )
    return warnings


class PromotionSerializer(serializers.ModelSerializer):
    products = serializers.PrimaryKeyRelatedField(queryset=Product.objects.all(), many=True, required=False)
    categories = serializers.PrimaryKeyRelatedField(queryset=Category.objects.all(), many=True, required=False)
    brands = serializers.PrimaryKeyRelatedField(queryset=Brand.objects.all(), many=True, required=False)
    percent = serializers.DecimalField(max_digits=5, decimal_places=2, required=False, allow_null=True)
    amount_off = serializers.DecimalField(max_digits=10, decimal_places=2, required=False, allow_null=True)
    multibuy_price = serializers.DecimalField(max_digits=10, decimal_places=2, required=False, allow_null=True)
    is_running = serializers.SerializerMethodField()
    warnings = serializers.SerializerMethodField()

    class Meta:
        model = Promotion
        fields = [
            "id", "name", "label", "kind", "scope", "products", "categories", "brands",
            "percent", "amount_off", "multibuy_qty", "multibuy_price", "starts_at", "ends_at",
            "is_active", "is_running", "is_demo", "warnings", "created_at", "updated_at",
        ]  # fmt: skip
        read_only_fields = ["id", "is_demo", "created_at", "updated_at"]

    def get_is_running(self, obj) -> bool:
        return obj.is_running()

    def get_warnings(self, obj) -> list[str]:
        return promotion_warnings(obj) if self.context.get("with_warnings") and obj.pk else []

    def validate(self, attrs):
        inst = self.instance

        def current(name):
            if name in attrs:
                return attrs[name]
            return getattr(inst, name, None) if inst is not None else None

        kind, scope = current("kind"), current("scope") or PromotionScope.PRODUCTS
        errors: dict[str, str] = {}

        # a field that belongs to another kind must not be sent with a value (stale ones are cleared on save)
        for other_kind, names in KIND_FIELDS.items():
            if other_kind != kind:
                for name in names & set(attrs):
                    if attrs[name] is not None:
                        errors[name] = f"Not used by {kind} promotions."
        if kind == PromotionKind.PERCENT_OFF:
            percent = current("percent")
            if percent is None:
                errors["percent"] = "Enter the percentage off (greater than 0, up to 100)."
            elif not (Decimal("0") < percent <= Decimal("100")):
                errors["percent"] = "The percentage must be greater than 0 and at most 100."
        elif kind == PromotionKind.AMOUNT_OFF:
            amount = current("amount_off")
            if amount is None or amount <= 0:
                errors["amount_off"] = "Enter the amount taken off each unit (greater than 0)."
        elif kind == PromotionKind.MULTIBUY:
            qty, price = current("multibuy_qty"), current("multibuy_price")
            if qty is None or qty < 2:
                errors["multibuy_qty"] = "A multibuy needs a quantity of at least 2."
            if price is None or price < 0:
                errors["multibuy_price"] = "Enter the price for the group (0 or more)."

        # the scope must point at something
        for scope_value, field in SCOPE_FIELDS.items():
            if scope_value != scope and attrs.get(field):
                errors[field] = f"Targets are only used when the scope is {scope_value}."
        field = SCOPE_FIELDS[scope]
        targets = attrs[field] if field in attrs else (list(getattr(inst, field).all()) if inst is not None else [])
        if not targets:
            errors[field] = f"Choose at least one {SCOPE_NOUN[field]} for this {scope} promotion."

        starts, ends = current("starts_at"), current("ends_at")
        if starts and ends and ends <= starts:
            errors["ends_at"] = "The end must be after the start."
        if errors:
            raise serializers.ValidationError(errors)
        return attrs

    def _apply_relations(self, instance: Promotion, relations: dict) -> None:
        wanted = SCOPE_FIELDS[instance.scope]
        for scope_field in SCOPE_FIELDS.values():
            if scope_field == wanted and scope_field in relations:
                getattr(instance, scope_field).set(relations[scope_field])
            elif scope_field != wanted:
                getattr(instance, scope_field).clear()  # targets of a different scope would be dead weight

    def _clear_stale_kind_fields(self, validated: dict) -> None:
        kind = validated.get("kind") or getattr(self.instance, "kind", None)
        for other_kind, names in KIND_FIELDS.items():
            if other_kind != kind:
                for name in names:
                    validated[name] = None

    def create(self, validated):
        relations = {f: validated.pop(f) for f in SCOPE_FIELDS.values() if f in validated}
        self._clear_stale_kind_fields(validated)
        instance = Promotion.objects.create(**validated)
        self._apply_relations(instance, relations)
        return instance

    def update(self, instance, validated):
        relations = {f: validated.pop(f) for f in SCOPE_FIELDS.values() if f in validated}
        self._clear_stale_kind_fields(validated)
        for key, value in validated.items():
            setattr(instance, key, value)
        instance.save()
        self._apply_relations(instance, relations)
        return instance


class PromotionViewSet(AuditedViewSet):
    queryset = Promotion.objects.prefetch_related("products", "categories", "brands").order_by("-starts_at", "-id")
    serializer_class = PromotionSerializer
    pagination_class = StandardPagination
    capability = read_capability = "promotions.manage"
    search_fields = ["name", "label"]
    ordering_fields = ["starts_at", "ends_at", "name", "created_at"]
    audit_label = "promotion"
    audit_m2m = ("products", "categories", "brands")

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx["with_warnings"] = self.action != "list"
        return ctx

    def get_queryset(self):
        qs = super().get_queryset()
        p = self.request.query_params
        for name in ("kind", "scope"):
            if p.get(name):
                qs = qs.filter(**{name: p[name].upper()})
        flag = bool_param(self.request, "is_active")
        if flag is not None:
            qs = qs.filter(is_active=flag)
        if bool_param(self.request, "running"):
            now = timezone.now()
            qs = qs.filter(is_active=True, starts_at__lte=now).filter(Q(ends_at__isnull=True) | Q(ends_at__gt=now))
        return qs


# =============================================================================================== coupons
class CouponSerializer(serializers.ModelSerializer):
    code = serializers.CharField(max_length=40)
    value = serializers.DecimalField(max_digits=10, decimal_places=2, required=False, min_value=Decimal("0"))
    max_discount = serializers.DecimalField(max_digits=10, decimal_places=2, required=False, allow_null=True, min_value=Decimal("0"))
    min_order_value = serializers.DecimalField(max_digits=10, decimal_places=2, required=False, min_value=Decimal("0"))
    categories = serializers.PrimaryKeyRelatedField(queryset=Category.objects.all(), many=True, required=False)
    products = serializers.PrimaryKeyRelatedField(queryset=Product.objects.all(), many=True, required=False)
    excluded_products = serializers.PrimaryKeyRelatedField(queryset=Product.objects.all(), many=True, required=False)
    is_redeemed = serializers.SerializerMethodField()

    class Meta:
        model = Coupon
        fields = [
            "id", "code", "description", "kind", "value", "max_discount", "min_order_value", "starts_at", "ends_at",
            "usage_limit", "per_customer_limit", "first_order_only", "scope", "categories", "products", "excluded_products",
            "exclude_discounted_items", "used_count", "is_redeemed", "is_active", "is_demo", "created_at", "updated_at",
        ]  # fmt: skip
        read_only_fields = ["id", "used_count", "is_demo", "created_at", "updated_at"]
        # The case-insensitive uniqueness rule is checked in validate_code (DRF can't express Lower(code) constraints).
        extra_kwargs = {"usage_limit": {"min_value": 1}, "per_customer_limit": {"min_value": 1}}
        validators: list = []

    def get_is_redeemed(self, obj) -> bool:
        return obj.used_count > 0 or obj.redemptions.exists()

    def validate_code(self, value):
        code = value.strip().upper()
        if not CODE_RE.match(code):
            raise serializers.ValidationError("Use 3–40 letters, digits, '-' or '_' (no spaces).")
        clash = Coupon.objects.filter(code__iexact=code)
        if self.instance is not None:
            clash = clash.exclude(pk=self.instance.pk)
            if code != self.instance.code and self.get_is_redeemed(self.instance):
                raise serializers.ValidationError(
                    "This code has already been redeemed, so it can't be renamed (order history refers to it). Create a new coupon instead."
                )
        if clash.exists():
            raise serializers.ValidationError("A coupon with this code already exists (codes are not case-sensitive).")
        return code

    def validate(self, attrs):
        inst = self.instance

        def current(name, default=None):
            if name in attrs:
                return attrs[name]
            return getattr(inst, name, default) if inst is not None else default

        errors: dict[str, str] = {}
        kind, scope = current("kind"), current("scope", CouponScope.ALL)
        value = current("value", Decimal("0"))
        if kind == CouponKind.PERCENT and not (Decimal("0") < value <= Decimal("100")):
            errors["value"] = "A percentage coupon needs a value above 0 and at most 100."
        elif kind == CouponKind.FIXED and value <= 0:
            errors["value"] = "A fixed-amount coupon needs a value above 0."
        elif kind == CouponKind.FREE_DELIVERY:
            attrs["value"] = Decimal("0")
            if scope != CouponScope.ALL:
                errors["scope"] = "Free-delivery coupons apply to the whole order (scope ALL)."
        if kind != CouponKind.PERCENT and attrs.get("max_discount") is not None:
            errors["max_discount"] = "A maximum discount only makes sense for percentage coupons."

        field_for_scope = {CouponScope.PRODUCTS: "products", CouponScope.CATEGORIES: "categories"}
        for scope_value, field in field_for_scope.items():
            if scope_value != scope and attrs.get(field):
                errors[field] = f"Targets are only used when the scope is {scope_value}."
        if scope in field_for_scope:
            field = field_for_scope[scope]
            targets = attrs[field] if field in attrs else (list(getattr(inst, field).all()) if inst is not None else [])
            if not targets:
                errors[field] = f"Choose at least one {SCOPE_NOUN[field]} for a {scope} coupon."

        products = attrs["products"] if "products" in attrs else (list(inst.products.all()) if inst is not None else [])
        excluded = attrs["excluded_products"] if "excluded_products" in attrs else (list(inst.excluded_products.all()) if inst is not None else [])
        overlap = {p.pk for p in products} & {p.pk for p in excluded}
        if scope == CouponScope.PRODUCTS and overlap:
            errors["excluded_products"] = "A product can't be both included and excluded."

        limit = current("usage_limit")
        if limit is not None and inst is not None and limit < inst.used_count:
            errors["usage_limit"] = f"This coupon has already been used {inst.used_count} time(s); the limit can't be set below that."
        starts, ends = current("starts_at"), current("ends_at")
        if starts and ends and ends <= starts:
            errors["ends_at"] = "The end must be after the start."
        if errors:
            raise serializers.ValidationError(errors)
        return attrs

    def create(self, validated):
        relations = {f: validated.pop(f) for f in ("categories", "products", "excluded_products") if f in validated}
        coupon = Coupon.objects.create(**validated)
        self._set_relations(coupon, relations)
        return coupon

    def update(self, instance, validated):
        relations = {f: validated.pop(f) for f in ("categories", "products", "excluded_products") if f in validated}
        for key, value in validated.items():
            setattr(instance, key, value)
        instance.save()
        self._set_relations(instance, relations)
        return instance

    @staticmethod
    def _set_relations(coupon: Coupon, relations: dict) -> None:
        for name, items in relations.items():
            getattr(coupon, name).set(items)
        if coupon.scope != CouponScope.PRODUCTS:
            coupon.products.clear()
        if coupon.scope != CouponScope.CATEGORIES:
            coupon.categories.clear()


class CouponViewSet(AuditedViewSet):
    queryset = Coupon.objects.prefetch_related("categories", "products", "excluded_products").order_by("-created_at", "-id")
    serializer_class = CouponSerializer
    pagination_class = StandardPagination
    capability = read_capability = "promotions.manage"
    search_fields = ["code", "description"]
    ordering_fields = ["code", "created_at", "starts_at", "ends_at", "used_count"]
    audit_label = "coupon"
    audit_m2m = ("categories", "products", "excluded_products")

    def get_queryset(self):
        qs = super().get_queryset()
        p = self.request.query_params
        for name in ("kind", "scope"):
            if p.get(name):
                qs = qs.filter(**{name: p[name].upper()})
        flag = bool_param(self.request, "is_active")
        if flag is not None:
            qs = qs.filter(is_active=flag)
        return qs

    def perform_destroy(self, instance):
        if instance.used_count or instance.redemptions.exists():
            raise DomainError(
                ErrorCode.INVALID_STATE,
                "This coupon has been redeemed, so it can't be deleted (orders refer to it). Deactivate it instead.",
                status_code=409,
            )
        super().perform_destroy(instance)

    @extend_schema(responses={200: dict})
    @action(detail=True, methods=["get"], url_path="stats")
    def stats(self, request, pk=None):
        coupon = self.get_object()
        rows = CouponRedemption.objects.filter(coupon=coupon)
        per_status = {r["status"]: r for r in rows.values("status").annotate(n=Count("id"), total=Coalesce(Sum("amount"), Decimal("0")))}

        def bucket(name):
            row = per_status.get(name)
            return (row["n"], row["total"]) if row else (0, Decimal("0"))

        active_n, active_total = bucket(RedemptionStatus.ACTIVE)
        void_n, void_total = bucket(RedemptionStatus.VOID)
        last = rows.select_related("order", "user").order_by("-created_at", "-id")[:20]
        return Response(
            {
                "code": coupon.code,
                "used_count": coupon.used_count,
                "usage_limit": coupon.usage_limit,
                "redemptions": {"active": active_n, "void": void_n},
                "total_discount": str(money(active_total)),  # voided redemptions gave the discount back
                "voided_discount": str(money(void_total)),
                "last_redemptions": [
                    {
                        "order_number": r.order.number,
                        "email": mask_email(r.email or (r.user.email if r.user_id else "") or r.order.contact_email),
                        "amount": str(money(r.amount)),
                        "status": r.status,
                        "created_at": r.created_at,
                    }
                    for r in last
                ],
            }
        )
