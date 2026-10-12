from __future__ import annotations

import secrets
import string
from decimal import Decimal

from django.db import models
from django.db.models import Q
from django.utils import timezone

from apps.cart.models import ItemSubstitutionPref, SubstitutionPolicy
from apps.core.models import TimeStampedModel


class FulfilmentType(models.TextChoices):
    DELIVERY = "DELIVERY", "Home delivery"
    PICKUP = "PICKUP", "Store pickup"


class OrderStatus(models.TextChoices):
    PENDING_PAYMENT = "PENDING_PAYMENT", "Awaiting payment"
    CONFIRMED = "CONFIRMED", "Confirmed"
    PICKING = "PICKING", "Being picked"
    PACKING = "PACKING", "Being packed"
    READY_FOR_PICKUP = "READY_FOR_PICKUP", "Ready for pickup"
    READY_FOR_DISPATCH = "READY_FOR_DISPATCH", "Ready for dispatch"
    OUT_FOR_DELIVERY = "OUT_FOR_DELIVERY", "Out for delivery"
    COMPLETED = "COMPLETED", "Completed"
    CANCELLED = "CANCELLED", "Cancelled"
    PAYMENT_FAILED = "PAYMENT_FAILED", "Payment failed"


class OrderPaymentStatus(models.TextChoices):
    UNPAID = "UNPAID", "Unpaid"
    AUTHORIZED = "AUTHORIZED", "Authorised"
    PENDING_COLLECTION = "PENDING_COLLECTION", "To pay on delivery/pickup"
    PAID = "PAID", "Paid"
    PARTIALLY_REFUNDED = "PARTIALLY_REFUNDED", "Partially refunded"
    REFUNDED = "REFUNDED", "Refunded"
    FAILED = "FAILED", "Failed"
    VOIDED = "VOIDED", "Authorisation released"


class PaymentMethod(models.TextChoices):
    CARD = "CARD", "Card"
    COD = "COD", "Pay on delivery / pickup"


_ALPHABET = string.ascii_uppercase.replace("O", "").replace("I", "") + "23456789"


def new_order_number() -> str:
    return "OR-" + timezone.now().strftime("%y%m%d") + "-" + "".join(secrets.choice(_ALPHABET) for _ in range(5))


def new_tracking_token() -> str:
    return secrets.token_urlsafe(24)


class Order(TimeStampedModel):
    number = models.CharField(max_length=20, unique=True, default=new_order_number)
    customer = models.ForeignKey(
        "accounts.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="orders"
    )
    contact_name = models.CharField(max_length=120)
    contact_email = models.EmailField()
    contact_phone = models.CharField(max_length=32)
    tracking_token = models.CharField(max_length=48, default=new_tracking_token, unique=True, editable=False)

    branch = models.ForeignKey("stores.Branch", on_delete=models.PROTECT, related_name="orders")
    fulfilment_type = models.CharField(max_length=10, choices=FulfilmentType.choices)
    slot = models.ForeignKey(
        "stores.DeliverySlot", null=True, blank=True, on_delete=models.PROTECT, related_name="orders"
    )
    zone = models.ForeignKey("stores.DeliveryZone", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    slot_starts_at = models.DateTimeField(null=True, blank=True, db_index=True)
    slot_ends_at = models.DateTimeField(null=True, blank=True)

    ship_recipient = models.CharField(max_length=120, blank=True)
    ship_phone = models.CharField(max_length=32, blank=True)
    ship_line1 = models.CharField(max_length=160, blank=True)
    ship_line2 = models.CharField(max_length=160, blank=True)
    ship_city = models.CharField(max_length=80, blank=True)
    ship_area = models.CharField(max_length=80, blank=True)
    ship_postal_code = models.CharField(max_length=16, blank=True)
    ship_instructions = models.CharField(max_length=300, blank=True)

    substitution_policy = models.CharField(
        max_length=10, choices=SubstitutionPolicy.choices, default=SubstitutionPolicy.ALLOW
    )
    customer_note = models.CharField(max_length=500, blank=True)
    currency = models.CharField(max_length=3, default="USD")

    subtotal = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0"))
    promo_savings = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0"))
    coupon_code = models.CharField(max_length=40, blank=True)
    coupon_discount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0"))
    delivery_fee = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0"))
    tax_total = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0"))
    total = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0"), help_text="Estimated total")
    authorized_amount = models.DecimalField(
        max_digits=12, decimal_places=2, default=Decimal("0"), help_text="Maximum chargeable amount"
    )
    final_total = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    weights_finalized_at = models.DateTimeField(null=True, blank=True)

    status = models.CharField(
        max_length=20, choices=OrderStatus.choices, default=OrderStatus.PENDING_PAYMENT, db_index=True
    )
    payment_status = models.CharField(
        max_length=20, choices=OrderPaymentStatus.choices, default=OrderPaymentStatus.UNPAID, db_index=True
    )
    payment_method = models.CharField(max_length=6, choices=PaymentMethod.choices, default=PaymentMethod.CARD)

    checkout_key = models.CharField(max_length=120, null=True, blank=True)
    reservation_expires_at = models.DateTimeField(null=True, blank=True, db_index=True)
    placed_at = models.DateTimeField(default=timezone.now, db_index=True)
    confirmed_at = models.DateTimeField(null=True, blank=True)
    picking_started_at = models.DateTimeField(null=True, blank=True)
    packed_at = models.DateTimeField(null=True, blank=True)
    ready_at = models.DateTimeField(null=True, blank=True)
    dispatched_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancel_reason = models.CharField(max_length=300, blank=True)
    cancelled_by = models.ForeignKey(
        "accounts.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    assigned_to = models.ForeignKey(
        "accounts.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="assigned_orders"
    )
    is_demo = models.BooleanField(default=False)

    class Meta:
        ordering = ["-placed_at", "-id"]
        indexes = [
            models.Index(fields=["branch", "status", "slot_starts_at"], name="order_queue_idx"),
            models.Index(fields=["customer", "-placed_at"], name="order_customer_idx"),
            models.Index(fields=["contact_email"], name="order_email_idx"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["checkout_key"], condition=Q(checkout_key__isnull=False), name="uniq_order_checkout_key"
            ),
            models.CheckConstraint(
                condition=Q(total__gte=0) & Q(subtotal__gte=0) & Q(delivery_fee__gte=0), name="order_amounts_nonneg"
            ),
            models.CheckConstraint(condition=Q(coupon_discount__gte=0), name="order_discount_nonneg"),
            models.CheckConstraint(
                condition=Q(fulfilment_type="PICKUP") | Q(ship_line1__gt=""), name="order_delivery_has_address"
            ),
        ]

    def __str__(self):
        return self.number

    @property
    def amount_due(self) -> Decimal:
        return self.final_total if self.final_total is not None else self.total


class OrderItemStatus(models.TextChoices):
    PENDING = "PENDING", "To pick"
    PICKED = "PICKED", "Picked"
    SHORT = "SHORT", "Short-picked"
    UNAVAILABLE = "UNAVAILABLE", "Unavailable"
    SUBSTITUTED = "SUBSTITUTED", "Substituted"
    REMOVED = "REMOVED", "Removed (refunded)"


class OrderItem(TimeStampedModel):
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="items")
    product = models.ForeignKey("catalog.Product", on_delete=models.PROTECT, related_name="order_items")
    substitute_for = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.CASCADE, related_name="substitutes"
    )

    # Snapshots — historical orders must not change when the catalog does.
    name = models.CharField(max_length=140)
    sku = models.CharField(max_length=32)
    image_path = models.CharField(max_length=200, blank=True)
    unit_symbol = models.CharField(max_length=12)
    unit_name = models.CharField(max_length=40)
    is_variable_weight = models.BooleanField(default=False)
    tax_rate = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("0"))

    base_unit_price = models.DecimalField(max_digits=10, decimal_places=2)
    unit_price = models.DecimalField(
        max_digits=10, decimal_places=2, help_text="Effective price per unit after promotions"
    )
    promo_label = models.CharField(max_length=40, blank=True)
    promo_kind = models.CharField(max_length=12, blank=True)
    promo_params = models.JSONField(null=True, blank=True)

    ordered_qty = models.DecimalField(max_digits=10, decimal_places=3)
    picked_qty = models.DecimalField(max_digits=10, decimal_places=3, null=True, blank=True)
    line_total_estimated = models.DecimalField(max_digits=12, decimal_places=2)
    coupon_share = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0"))
    line_total_final = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)

    substitution_pref = models.CharField(
        max_length=10, choices=ItemSubstitutionPref.choices, default=ItemSubstitutionPref.INHERIT
    )
    status = models.CharField(max_length=12, choices=OrderItemStatus.choices, default=OrderItemStatus.PENDING)
    picker_note = models.CharField(max_length=300, blank=True)
    picked_by = models.ForeignKey("accounts.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    picked_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["id"]
        indexes = [models.Index(fields=["product", "order"], name="orderitem_product_idx")]
        constraints = [
            models.CheckConstraint(condition=Q(ordered_qty__gt=0), name="orderitem_qty_pos"),
            models.CheckConstraint(
                condition=Q(unit_price__gte=0) & Q(line_total_estimated__gte=0), name="orderitem_price_nonneg"
            ),
            models.CheckConstraint(
                condition=Q(picked_qty__isnull=True) | Q(picked_qty__gte=0), name="orderitem_picked_nonneg"
            ),
        ]

    @property
    def is_substitute(self) -> bool:
        return self.substitute_for_id is not None

    @property
    def effective_total(self) -> Decimal:
        return self.line_total_final if self.line_total_final is not None else self.line_total_estimated


class OrderStatusHistory(models.Model):
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="history")
    from_status = models.CharField(max_length=20, blank=True)
    to_status = models.CharField(max_length=20)
    actor = models.ForeignKey("accounts.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    actor_label = models.CharField(max_length=254, blank=True)
    note = models.CharField(max_length=400, blank=True, help_text="Internal note (staff only)")
    public_note = models.CharField(max_length=300, blank=True, help_text="Shown to the customer in the order timeline")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]


class SubstitutionStatus(models.TextChoices):
    AWAITING_CUSTOMER = "AWAITING_CUSTOMER", "Awaiting customer"
    APPROVED = "APPROVED", "Approved"
    REJECTED = "REJECTED", "Rejected"
    AUTO_APPROVED = "AUTO_APPROVED", "Applied (customer allows substitutes)"


class Substitution(TimeStampedModel):
    order_item = models.ForeignKey(OrderItem, on_delete=models.CASCADE, related_name="substitutions")
    substitute_product = models.ForeignKey("catalog.Product", on_delete=models.PROTECT, related_name="+")
    substitute_item = models.OneToOneField(
        OrderItem, null=True, blank=True, on_delete=models.SET_NULL, related_name="substitution_record"
    )
    qty = models.DecimalField(max_digits=10, decimal_places=3)
    list_unit_price = models.DecimalField(max_digits=10, decimal_places=2, help_text="Substitute's real price per unit")
    charged_unit_price = models.DecimalField(
        max_digits=10, decimal_places=2, help_text="Price per unit the customer pays"
    )
    price_difference = models.DecimalField(
        max_digits=12, decimal_places=2, default=Decimal("0"), help_text="Substitute minus original, line total"
    )
    status = models.CharField(max_length=20, choices=SubstitutionStatus.choices)
    policy_snapshot = models.CharField(max_length=10, choices=SubstitutionPolicy.choices)
    reason = models.CharField(max_length=300, blank=True)
    proposed_by = models.ForeignKey("accounts.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    decided_by = models.ForeignKey("accounts.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    decided_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["status"])]


class CaseKind(models.TextChoices):
    MISSING = "MISSING", "Missing item"
    DAMAGED = "DAMAGED", "Damaged / poor quality"
    INCORRECT = "INCORRECT", "Incorrect item"
    WEIGHT = "WEIGHT", "Weight / price query"
    LATE = "LATE", "Late delivery"
    OTHER = "OTHER", "Other"


class CaseStatus(models.TextChoices):
    OPEN = "OPEN", "Open"
    IN_REVIEW = "IN_REVIEW", "In review"
    RESOLVED = "RESOLVED", "Resolved"
    REJECTED = "REJECTED", "Rejected"


class CaseResolution(models.TextChoices):
    NONE = "NONE", "No action"
    REFUND = "REFUND", "Refund"
    REPLACEMENT = "REPLACEMENT", "Replacement"
    GOODWILL = "GOODWILL", "Goodwill refund"


class SupportCase(TimeStampedModel):
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="cases")
    customer = models.ForeignKey(
        "accounts.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="cases"
    )
    order_item = models.ForeignKey(OrderItem, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    kind = models.CharField(max_length=12, choices=CaseKind.choices)
    description = models.TextField(max_length=2000)
    status = models.CharField(max_length=10, choices=CaseStatus.choices, default=CaseStatus.OPEN, db_index=True)
    resolution = models.CharField(max_length=12, choices=CaseResolution.choices, default=CaseResolution.NONE)
    refund_amount = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0"))
    staff_notes = models.TextField(blank=True)
    handled_by = models.ForeignKey("accounts.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    resolved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [models.CheckConstraint(condition=Q(refund_amount__gte=0), name="case_refund_nonneg")]
