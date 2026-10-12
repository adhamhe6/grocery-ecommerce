from __future__ import annotations

from decimal import Decimal

from django.db import models
from django.db.models import F, Q

from apps.core.models import TimeStampedModel


class Provider(models.TextChoices):
    DEMO = "demo", "Demo sandbox"
    STRIPE = "stripe", "Stripe"
    COD = "cod", "Pay on delivery/pickup"


class PaymentState(models.TextChoices):
    REQUIRES_ACTION = "REQUIRES_ACTION", "Waiting for customer"
    AUTHORIZED = "AUTHORIZED", "Authorised"
    CAPTURED = "CAPTURED", "Captured"
    PENDING_COLLECTION = "PENDING_COLLECTION", "Pending collection"
    FAILED = "FAILED", "Failed"
    CANCELLED = "CANCELLED", "Cancelled by customer"
    VOIDED = "VOIDED", "Authorisation released"
    PARTIALLY_REFUNDED = "PARTIALLY_REFUNDED", "Partially refunded"
    REFUNDED = "REFUNDED", "Refunded"


OPEN_STATES = (PaymentState.REQUIRES_ACTION, PaymentState.AUTHORIZED, PaymentState.PENDING_COLLECTION)


class Payment(TimeStampedModel):
    order = models.ForeignKey("orders.Order", on_delete=models.PROTECT, related_name="payments")
    provider = models.CharField(max_length=10, choices=Provider.choices)
    method = models.CharField(max_length=6)
    state = models.CharField(
        max_length=20, choices=PaymentState.choices, default=PaymentState.REQUIRES_ACTION, db_index=True
    )
    amount = models.DecimalField(
        max_digits=12, decimal_places=2, help_text="Authorised / requested amount (max chargeable)"
    )
    captured_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0"))
    refunded_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0"))
    currency = models.CharField(max_length=3)
    provider_reference = models.CharField(max_length=120, blank=True)
    checkout_url = models.CharField(max_length=500, blank=True)
    attempt = models.PositiveSmallIntegerField(default=1)
    idempotency_key = models.CharField(max_length=120, blank=True)
    failure_code = models.CharField(max_length=60, blank=True)
    failure_message = models.CharField(max_length=300, blank=True)
    captured_at = models.DateTimeField(null=True, blank=True)
    is_demo = models.BooleanField(default=False)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["provider", "provider_reference"],
                condition=~Q(provider_reference=""),
                name="uniq_provider_reference",
            ),
            models.UniqueConstraint(
                fields=["order"],
                condition=Q(state__in=["REQUIRES_ACTION", "AUTHORIZED", "PENDING_COLLECTION"]),
                name="uniq_open_payment_per_order",
            ),
            models.CheckConstraint(condition=Q(amount__gte=0), name="payment_amount_nonneg"),
            models.CheckConstraint(condition=Q(captured_amount__lte=F("amount")), name="payment_captured_le_amount"),
            models.CheckConstraint(
                condition=Q(refunded_amount__lte=F("captured_amount")), name="payment_refunded_le_captured"
            ),
        ]
        indexes = [models.Index(fields=["order", "-created_at"])]


class EventOutcome(models.TextChoices):
    APPLIED = "APPLIED", "Applied"
    DUPLICATE = "DUPLICATE", "Duplicate (ignored)"
    IGNORED = "IGNORED", "Ignored"
    ERROR = "ERROR", "Error"


class PaymentEvent(models.Model):
    """Every verified provider notification, de-duplicated by (provider, event id)."""

    payment = models.ForeignKey(Payment, null=True, blank=True, on_delete=models.SET_NULL, related_name="events")
    provider = models.CharField(max_length=10)
    event_id = models.CharField(max_length=120)
    event_type = models.CharField(max_length=60)
    payload = models.JSONField(default=dict)
    outcome = models.CharField(max_length=10, choices=EventOutcome.choices, default=EventOutcome.APPLIED)
    error = models.CharField(max_length=300, blank=True)
    received_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-received_at"]
        constraints = [models.UniqueConstraint(fields=["provider", "event_id"], name="uniq_payment_event")]


class RefundStatus(models.TextChoices):
    PENDING = "PENDING", "Pending"
    SUCCEEDED = "SUCCEEDED", "Succeeded"
    FAILED = "FAILED", "Failed"


class RefundMethod(models.TextChoices):
    PROVIDER = "PROVIDER", "Via payment provider"
    MANUAL = "MANUAL", "Manual (cash / store credit handed over)"


class Refund(TimeStampedModel):
    payment = models.ForeignKey(Payment, on_delete=models.PROTECT, related_name="refunds")
    order = models.ForeignKey("orders.Order", on_delete=models.PROTECT, related_name="refunds")
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    reason = models.CharField(max_length=300)
    status = models.CharField(max_length=10, choices=RefundStatus.choices, default=RefundStatus.PENDING, db_index=True)
    method = models.CharField(max_length=10, choices=RefundMethod.choices, default=RefundMethod.PROVIDER)
    provider_refund_id = models.CharField(max_length=120, blank=True)
    idempotency_key = models.CharField(max_length=120)
    requested_by = models.ForeignKey(
        "accounts.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    support_case = models.ForeignKey(
        "orders.SupportCase", null=True, blank=True, on_delete=models.SET_NULL, related_name="refunds"
    )
    failure_message = models.CharField(max_length=300, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    reference = models.CharField(max_length=120, blank=True, help_text="Manual refund reference (receipt no., etc.)")

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(condition=Q(amount__gt=0), name="refund_amount_pos"),
            models.UniqueConstraint(fields=["payment", "idempotency_key"], name="uniq_refund_key"),
        ]
