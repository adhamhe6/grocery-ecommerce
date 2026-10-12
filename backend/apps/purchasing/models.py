from __future__ import annotations

from decimal import Decimal

from django.db import models
from django.db.models import Q

from apps.core.models import TimeStampedModel


class SupplierStatus(models.TextChoices):
    ACTIVE = "ACTIVE", "Active"
    ON_HOLD = "ON_HOLD", "On hold"
    INACTIVE = "INACTIVE", "Inactive"


class Supplier(TimeStampedModel):
    code = models.SlugField(max_length=20, unique=True)
    name = models.CharField(max_length=140)
    contact_name = models.CharField(max_length=120, blank=True)
    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=40, blank=True)
    address = models.TextField(blank=True)
    status = models.CharField(max_length=10, choices=SupplierStatus.choices, default=SupplierStatus.ACTIVE)
    lead_time_days = models.PositiveSmallIntegerField(default=2)
    notes = models.TextField(blank=True)
    is_demo = models.BooleanField(default=False)
    products = models.ManyToManyField("catalog.Product", through="SupplierProduct", related_name="suppliers")

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class SupplierProduct(models.Model):
    supplier = models.ForeignKey(Supplier, on_delete=models.CASCADE)
    product = models.ForeignKey("catalog.Product", on_delete=models.CASCADE)
    supplier_sku = models.CharField(max_length=60, blank=True)
    unit_cost = models.DecimalField(max_digits=10, decimal_places=4, null=True, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["supplier", "product"], name="uniq_supplier_product")]


class POStatus(models.TextChoices):
    DRAFT = "DRAFT", "Draft"
    SUBMITTED = "SUBMITTED", "Submitted"
    CONFIRMED = "CONFIRMED", "Confirmed by supplier"
    PARTIALLY_RECEIVED = "PARTIALLY_RECEIVED", "Partially received"
    RECEIVED = "RECEIVED", "Received"
    CANCELLED = "CANCELLED", "Cancelled"


class PurchaseOrder(TimeStampedModel):
    number = models.CharField(max_length=24, unique=True)
    supplier = models.ForeignKey(Supplier, on_delete=models.PROTECT, related_name="purchase_orders")
    branch = models.ForeignKey("stores.Branch", on_delete=models.PROTECT, related_name="purchase_orders")
    status = models.CharField(max_length=20, choices=POStatus.choices, default=POStatus.DRAFT, db_index=True)
    expected_date = models.DateField(null=True, blank=True)
    notes = models.TextField(blank=True)
    created_by = models.ForeignKey("accounts.User", null=True, on_delete=models.SET_NULL, related_name="+")
    submitted_at = models.DateTimeField(null=True, blank=True)
    is_demo = models.BooleanField(default=False)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.number

    @property
    def total_cost(self) -> Decimal:
        return sum((line.qty_ordered * line.unit_cost for line in self.lines.all()), Decimal("0"))


class PurchaseOrderLine(models.Model):
    purchase_order = models.ForeignKey(PurchaseOrder, on_delete=models.CASCADE, related_name="lines")
    product = models.ForeignKey("catalog.Product", on_delete=models.PROTECT, related_name="+")
    qty_ordered = models.DecimalField(max_digits=12, decimal_places=3)
    unit_cost = models.DecimalField(max_digits=10, decimal_places=4)
    qty_received = models.DecimalField(max_digits=12, decimal_places=3, default=Decimal("0"))
    qty_rejected = models.DecimalField(max_digits=12, decimal_places=3, default=Decimal("0"))

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["purchase_order", "product"], name="uniq_po_line_product"),
            models.CheckConstraint(condition=Q(qty_ordered__gt=0), name="po_line_ordered_pos"),
            models.CheckConstraint(condition=Q(unit_cost__gte=0), name="po_line_cost_nonneg"),
            models.CheckConstraint(
                condition=Q(qty_received__gte=0) & Q(qty_rejected__gte=0), name="po_line_received_nonneg"
            ),
        ]


class GoodsReceipt(TimeStampedModel):
    """One delivery against a PO. `idempotency_key` makes double-submission a no-op."""

    purchase_order = models.ForeignKey(PurchaseOrder, on_delete=models.PROTECT, related_name="receipts")
    number = models.CharField(max_length=30, unique=True)
    idempotency_key = models.CharField(max_length=80)
    received_by = models.ForeignKey("accounts.User", null=True, on_delete=models.SET_NULL, related_name="+")
    delivery_note = models.CharField(max_length=120, blank=True)
    notes = models.CharField(max_length=300, blank=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [models.UniqueConstraint(fields=["purchase_order", "idempotency_key"], name="uniq_receipt_key")]


class GoodsReceiptLine(models.Model):
    receipt = models.ForeignKey(GoodsReceipt, on_delete=models.CASCADE, related_name="lines")
    po_line = models.ForeignKey(PurchaseOrderLine, on_delete=models.PROTECT, related_name="receipt_lines")
    qty_accepted = models.DecimalField(max_digits=12, decimal_places=3, default=Decimal("0"))
    qty_rejected = models.DecimalField(max_digits=12, decimal_places=3, default=Decimal("0"))
    reject_reason = models.CharField(max_length=200, blank=True)
    lot_code = models.CharField(max_length=60, blank=True)
    expiry_date = models.DateField(null=True, blank=True)
    expiry_kind = models.CharField(max_length=12, default="BEST_BEFORE")
    batch = models.ForeignKey(
        "inventory.Batch", null=True, blank=True, on_delete=models.SET_NULL, related_name="receipt_lines"
    )

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(qty_accepted__gte=0) & Q(qty_rejected__gte=0), name="receipt_line_nonneg"
            ),
        ]
