from __future__ import annotations

import hashlib
import json
from decimal import Decimal

from django.core.validators import MaxValueValidator, MinValueValidator, RegexValidator
from django.db import IntegrityError, models, transaction

from . import cache as core_cache

HEX = RegexValidator(r"^#[0-9a-fA-F]{6}$", "Use a 6-digit hex colour such as #1F3D2B.")


class TimeStampedModel(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class StoreSettings(models.Model):
    """Singleton holding everything a business edits without a developer."""

    name = models.CharField(max_length=80, default="Orchard Row")
    legal_name = models.CharField(max_length=160, blank=True)
    tagline = models.CharField(max_length=140, default="Fresh, honestly labelled.")
    logo = models.ImageField(upload_to="brand/", blank=True, null=True)
    brand_primary = models.CharField(max_length=7, default="#1F3D2B", validators=[HEX])
    brand_accent = models.CharField(max_length=7, default="#B8532F", validators=[HEX])

    support_email = models.EmailField(default="hello@example.invalid")
    support_phone = models.CharField(max_length=40, blank=True)
    support_hours = models.CharField(max_length=160, blank=True)
    address = models.TextField(blank=True)

    currency = models.CharField(max_length=3, default="USD")
    locale = models.CharField(max_length=16, default="en-US")
    timezone = models.CharField(max_length=64, default="UTC")
    prices_include_tax = models.BooleanField(default=True)
    tax_label = models.CharField(max_length=30, default="VAT")

    weight_tolerance_percent = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=Decimal("10.00"),
        validators=[MinValueValidator(Decimal("0")), MaxValueValidator(Decimal("50"))],
        help_text="Max variation between ordered and picked weight a picker may record; also the card-authorisation buffer.",
    )
    substitution_price_cap = models.BooleanField(
        default=True, help_text="Customers never pay more for a substitute than for the item it replaces."
    )
    complaint_window_hours = models.PositiveIntegerField(default=24)
    min_order_value = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0.00"))
    allow_guest_checkout = models.BooleanField(default=True)
    card_payments_enabled = models.BooleanField(default=True)
    cash_on_delivery_enabled = models.BooleanField(default=True)

    demo_mode = models.BooleanField(
        default=False, help_text="Shows a 'demonstration store' notice: catalog, imagery and reviews are sample data."
    )

    instagram_url = models.URLField(blank=True)
    facebook_url = models.URLField(blank=True)
    x_url = models.URLField(blank=True)
    youtube_url = models.URLField(blank=True)
    tiktok_url = models.URLField(blank=True)
    socials_are_placeholders = models.BooleanField(
        default=True, help_text="True while social URLs are placeholders that must be replaced before launch."
    )

    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "store settings"
        verbose_name_plural = "store settings"

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        self.pk = 1
        super().save(*args, **kwargs)
        core_cache.bump("settings")

    def delete(self, *args, **kwargs):  # singleton
        raise IntegrityError("StoreSettings cannot be deleted")

    @classmethod
    def load(cls) -> StoreSettings:
        obj = core_cache.get_or_set("settings", ("obj",), 300, lambda: cls.objects.get_or_create(pk=1)[0])
        return obj


class AuditLog(models.Model):
    """Append-only record of consequential staff/system actions."""

    actor = models.ForeignKey("accounts.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    actor_label = models.CharField(max_length=254, blank=True)
    action = models.CharField(max_length=80, db_index=True)
    target_type = models.CharField(max_length=60, blank=True)
    target_id = models.CharField(max_length=64, blank=True)
    summary = models.CharField(max_length=300, blank=True)
    before = models.JSONField(null=True, blank=True)
    after = models.JSONField(null=True, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    request_id = models.CharField(max_length=64, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [models.Index(fields=["target_type", "target_id"])]

    def save(self, *args, **kwargs):
        if self.pk:
            raise IntegrityError("audit log entries are immutable")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise IntegrityError("audit log entries are immutable")


class IdempotencyRecord(models.Model):
    """Stores the outcome of an idempotent operation so retries return the same result."""

    scope = models.CharField(max_length=40)
    actor_key = models.CharField(max_length=80)
    key = models.CharField(max_length=120)
    request_hash = models.CharField(max_length=64)
    resource_type = models.CharField(max_length=40, blank=True)
    resource_id = models.CharField(max_length=64, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["scope", "actor_key", "key"], name="uniq_idempotency_key")]

    @staticmethod
    def hash_payload(payload) -> str:
        return hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()

    @classmethod
    def claim(cls, scope: str, actor_key: str, key: str, payload) -> tuple[IdempotencyRecord, bool]:
        """Insert-or-fetch. Must be called inside `transaction.atomic()`.

        A concurrent duplicate blocks on the unique index until the first transaction commits, then
        receives the committed row (created=False).
        """
        digest = cls.hash_payload(payload)
        with transaction.atomic():
            record, created = cls.objects.get_or_create(
                scope=scope, actor_key=actor_key, key=key, defaults={"request_hash": digest}
            )
        return record, created
