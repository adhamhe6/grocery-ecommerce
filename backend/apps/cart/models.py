from __future__ import annotations

import uuid
from decimal import Decimal

from django.db import models
from django.db.models import Q

from apps.core.models import TimeStampedModel


class SubstitutionPolicy(models.TextChoices):
    ALLOW = "ALLOW", "Substitute with a suitable alternative"
    CONTACT = "CONTACT", "Contact me before substituting"
    NONE = "NONE", "Don't substitute — refund unavailable items"


class ItemSubstitutionPref(models.TextChoices):
    INHERIT = "INHERIT", "Use order preference"
    ALLOW = "ALLOW", "Allow substitute"
    NONE = "NONE", "Never substitute this item"


class CartStatus(models.TextChoices):
    ACTIVE = "ACTIVE", "Active"
    CONVERTED = "CONVERTED", "Converted to order"
    MERGED = "MERGED", "Merged into another cart"


class Cart(TimeStampedModel):
    user = models.ForeignKey("accounts.User", null=True, blank=True, on_delete=models.CASCADE, related_name="carts")
    token = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    branch = models.ForeignKey("stores.Branch", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    coupon_code = models.CharField(max_length=40, blank=True)
    substitution_policy = models.CharField(
        max_length=10, choices=SubstitutionPolicy.choices, default=SubstitutionPolicy.ALLOW
    )
    status = models.CharField(max_length=10, choices=CartStatus.choices, default=CartStatus.ACTIVE)
    notices = models.JSONField(
        default=list, blank=True, help_text="Pending price/availability change notices for the customer"
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["user"], condition=Q(status="ACTIVE", user__isnull=False), name="uniq_active_cart_per_user"
            )
        ]
        indexes = [models.Index(fields=["status", "updated_at"])]


class CartItem(TimeStampedModel):
    cart = models.ForeignKey(Cart, on_delete=models.CASCADE, related_name="items")
    product = models.ForeignKey("catalog.Product", on_delete=models.CASCADE, related_name="+")
    quantity = models.DecimalField(max_digits=10, decimal_places=3)
    substitution_pref = models.CharField(
        max_length=10, choices=ItemSubstitutionPref.choices, default=ItemSubstitutionPref.INHERIT
    )
    unit_price_seen = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Price when last shown to the customer (used to explain changes)",
    )

    class Meta:
        ordering = ["created_at", "id"]
        constraints = [
            models.UniqueConstraint(fields=["cart", "product"], name="uniq_cart_product"),
            models.CheckConstraint(condition=Q(quantity__gt=0), name="cart_item_qty_pos"),
        ]


class Favorite(models.Model):
    user = models.ForeignKey("accounts.User", on_delete=models.CASCADE, related_name="favorites")
    product = models.ForeignKey("catalog.Product", on_delete=models.CASCADE, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [models.UniqueConstraint(fields=["user", "product"], name="uniq_favorite")]


class ComparisonItem(models.Model):
    user = models.ForeignKey("accounts.User", on_delete=models.CASCADE, related_name="comparison_items")
    product = models.ForeignKey("catalog.Product", on_delete=models.CASCADE, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
        constraints = [models.UniqueConstraint(fields=["user", "product"], name="uniq_comparison_item")]


class ShoppingList(TimeStampedModel):
    user = models.ForeignKey("accounts.User", on_delete=models.CASCADE, related_name="shopping_lists")
    name = models.CharField(max_length=80)

    class Meta:
        ordering = ["name"]
        constraints = [models.UniqueConstraint(fields=["user", "name"], name="uniq_list_name_per_user")]


class ShoppingListItem(models.Model):
    shopping_list = models.ForeignKey(ShoppingList, on_delete=models.CASCADE, related_name="items")
    product = models.ForeignKey("catalog.Product", on_delete=models.CASCADE, related_name="+")
    quantity = models.DecimalField(max_digits=10, decimal_places=3, default=Decimal("1"))

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["shopping_list", "product"], name="uniq_list_product"),
            models.CheckConstraint(condition=Q(quantity__gt=0), name="list_item_qty_pos"),
        ]
