from __future__ import annotations

from decimal import Decimal

from django.db import models
from django.db.models import Q
from django.db.models.functions import Lower
from django.utils import timezone

from apps.core.models import TimeStampedModel


class PromotionKind(models.TextChoices):
    PERCENT_OFF = "PERCENT_OFF", "Percent off"
    AMOUNT_OFF = "AMOUNT_OFF", "Amount off per unit"
    MULTIBUY = "MULTIBUY", "Multibuy (N for a fixed price)"


class PromotionScope(models.TextChoices):
    PRODUCTS = "PRODUCTS", "Selected products"
    CATEGORIES = "CATEGORIES", "Categories"
    BRANDS = "BRANDS", "Brands"


class Promotion(TimeStampedModel):
    """Automatic price promotion. Promotions never stack on one product: the best price wins."""

    name = models.CharField(max_length=120)
    label = models.CharField(max_length=40, help_text="Badge text, e.g. '20% off'")
    kind = models.CharField(max_length=12, choices=PromotionKind.choices)
    scope = models.CharField(max_length=12, choices=PromotionScope.choices, default=PromotionScope.PRODUCTS)
    products = models.ManyToManyField("catalog.Product", blank=True, related_name="promotions")
    categories = models.ManyToManyField("catalog.Category", blank=True, related_name="promotions")
    brands = models.ManyToManyField("catalog.Brand", blank=True, related_name="promotions")
    percent = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    amount_off = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    multibuy_qty = models.PositiveSmallIntegerField(null=True, blank=True)
    multibuy_price = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    starts_at = models.DateTimeField(default=timezone.now)
    ends_at = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    is_demo = models.BooleanField(default=False)

    class Meta:
        ordering = ["-starts_at"]
        constraints = [
            models.CheckConstraint(
                condition=Q(percent__isnull=True) | (Q(percent__gt=0) & Q(percent__lte=100)), name="promo_percent_range"
            ),
            models.CheckConstraint(condition=Q(amount_off__isnull=True) | Q(amount_off__gt=0), name="promo_amount_pos"),
            models.CheckConstraint(
                condition=Q(multibuy_qty__isnull=True) | Q(multibuy_qty__gte=2), name="promo_multibuy_qty"
            ),
            models.CheckConstraint(
                condition=Q(multibuy_price__isnull=True) | Q(multibuy_price__gte=0), name="promo_multibuy_price"
            ),
            models.CheckConstraint(
                condition=Q(ends_at__isnull=True) | Q(ends_at__gt=models.F("starts_at")), name="promo_dates_ordered"
            ),
        ]
        indexes = [models.Index(fields=["is_active", "starts_at", "ends_at"])]

    def __str__(self):
        return self.name

    def is_running(self, now=None) -> bool:
        now = now or timezone.now()
        return self.is_active and self.starts_at <= now and (self.ends_at is None or now < self.ends_at)


class CouponKind(models.TextChoices):
    PERCENT = "PERCENT", "Percent off"
    FIXED = "FIXED", "Fixed amount off"
    FREE_DELIVERY = "FREE_DELIVERY", "Free delivery"


class CouponScope(models.TextChoices):
    ALL = "ALL", "Whole basket"
    CATEGORIES = "CATEGORIES", "Selected categories"
    PRODUCTS = "PRODUCTS", "Selected products"


class Coupon(TimeStampedModel):
    code = models.CharField(max_length=40)
    description = models.CharField(max_length=200, blank=True)
    kind = models.CharField(max_length=14, choices=CouponKind.choices)
    value = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0"))
    max_discount = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    min_order_value = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0"))
    starts_at = models.DateTimeField(default=timezone.now)
    ends_at = models.DateTimeField(null=True, blank=True)
    usage_limit = models.PositiveIntegerField(null=True, blank=True, help_text="Total redemptions allowed")
    per_customer_limit = models.PositiveIntegerField(null=True, blank=True, default=1)
    first_order_only = models.BooleanField(default=False)
    scope = models.CharField(max_length=12, choices=CouponScope.choices, default=CouponScope.ALL)
    categories = models.ManyToManyField("catalog.Category", blank=True, related_name="coupons")
    products = models.ManyToManyField("catalog.Product", blank=True, related_name="coupons")
    excluded_products = models.ManyToManyField("catalog.Product", blank=True, related_name="+")
    exclude_discounted_items = models.BooleanField(
        default=True, help_text="Coupon ignores lines that already have a promotion"
    )
    used_count = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True)
    is_demo = models.BooleanField(default=False)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(Lower("code"), name="uniq_coupon_code_ci"),
            models.CheckConstraint(condition=Q(value__gte=0), name="coupon_value_nonneg"),
            models.CheckConstraint(condition=Q(kind="FREE_DELIVERY") | Q(value__gt=0), name="coupon_value_required"),
            models.CheckConstraint(condition=~Q(kind="PERCENT") | Q(value__lte=100), name="coupon_percent_le_100"),
            models.CheckConstraint(condition=Q(min_order_value__gte=0), name="coupon_min_nonneg"),
        ]

    def __str__(self):
        return self.code

    def save(self, *args, **kwargs):
        self.code = self.code.strip().upper()
        super().save(*args, **kwargs)


class RedemptionStatus(models.TextChoices):
    ACTIVE = "ACTIVE", "Active"
    VOID = "VOID", "Voided"


class CouponRedemption(models.Model):
    coupon = models.ForeignKey(Coupon, on_delete=models.PROTECT, related_name="redemptions")
    order = models.OneToOneField("orders.Order", on_delete=models.CASCADE, related_name="coupon_redemption")
    user = models.ForeignKey("accounts.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    email = models.EmailField(blank=True)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    status = models.CharField(max_length=8, choices=RedemptionStatus.choices, default=RedemptionStatus.ACTIVE)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=["coupon", "user", "status"]),
            models.Index(fields=["coupon", "email", "status"]),
        ]
