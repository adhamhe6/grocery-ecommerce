from __future__ import annotations

from decimal import Decimal

from django.db import IntegrityError, models
from django.db.models import F, Q

from apps.core.models import TimeStampedModel


class StockLevel(TimeStampedModel):
    """Counted stock of a product at a branch. The CHECK constraints make overselling impossible at DB level."""

    product = models.ForeignKey("catalog.Product", on_delete=models.CASCADE, related_name="stock_levels")
    branch = models.ForeignKey("stores.Branch", on_delete=models.CASCADE, related_name="stock_levels")
    on_hand = models.DecimalField(max_digits=12, decimal_places=3, default=Decimal("0"))
    reserved = models.DecimalField(max_digits=12, decimal_places=3, default=Decimal("0"))
    low_stock_threshold = models.DecimalField(max_digits=12, decimal_places=3, default=Decimal("0"))
    reorder_quantity = models.DecimalField(max_digits=12, decimal_places=3, default=Decimal("0"))

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["product", "branch"], name="uniq_stock_product_branch"),
            models.CheckConstraint(condition=Q(on_hand__gte=0), name="stock_on_hand_nonneg"),
            models.CheckConstraint(condition=Q(reserved__gte=0), name="stock_reserved_nonneg"),
            models.CheckConstraint(condition=Q(reserved__lte=F("on_hand")), name="stock_reserved_le_on_hand"),
        ]
        indexes = [models.Index(fields=["branch", "product"])]

    @property
    def available(self) -> Decimal:
        return self.on_hand - self.reserved

    def __str__(self):
        return f"{self.product_id}@{self.branch_id}: {self.on_hand}/{self.reserved}"


class BatchStatus(models.TextChoices):
    ACTIVE = "ACTIVE", "Active"
    QUARANTINED = "QUARANTINED", "Quarantined (blocked)"
    EXPIRED = "EXPIRED", "Expired"
    DEPLETED = "DEPLETED", "Depleted"


class ExpiryKind(models.TextChoices):
    BEST_BEFORE = "BEST_BEFORE", "Best before"
    USE_BY = "USE_BY", "Use by"


class QualityStatus(models.TextChoices):
    PENDING = "PENDING", "Inspection pending"
    PASSED = "PASSED", "Passed"
    FAILED = "FAILED", "Failed"


class Batch(TimeStampedModel):
    product = models.ForeignKey("catalog.Product", on_delete=models.PROTECT, related_name="batches")
    branch = models.ForeignKey("stores.Branch", on_delete=models.PROTECT, related_name="batches")
    supplier = models.ForeignKey(
        "purchasing.Supplier", null=True, blank=True, on_delete=models.SET_NULL, related_name="batches"
    )
    lot_code = models.CharField(max_length=60)
    received_on = models.DateField()
    expiry_date = models.DateField(null=True, blank=True)
    expiry_kind = models.CharField(max_length=12, choices=ExpiryKind.choices, default=ExpiryKind.BEST_BEFORE)
    sellable_until = models.DateField(
        null=True, blank=True, help_text="Last day this batch may be sold (expiry − product buffer)"
    )
    qty_received = models.DecimalField(max_digits=12, decimal_places=3)
    qty_remaining = models.DecimalField(max_digits=12, decimal_places=3)
    qty_reserved = models.DecimalField(max_digits=12, decimal_places=3, default=Decimal("0"))
    unit_cost = models.DecimalField(max_digits=10, decimal_places=4, null=True, blank=True)
    status = models.CharField(max_length=12, choices=BatchStatus.choices, default=BatchStatus.ACTIVE)
    quality_status = models.CharField(max_length=10, choices=QualityStatus.choices, default=QualityStatus.PASSED)
    notes = models.CharField(max_length=300, blank=True)
    is_demo = models.BooleanField(default=False)

    class Meta:
        ordering = ["expiry_date", "received_on", "id"]
        constraints = [
            models.UniqueConstraint(fields=["product", "branch", "lot_code"], name="uniq_batch_lot"),
            models.CheckConstraint(condition=Q(qty_received__gt=0), name="batch_received_pos"),
            models.CheckConstraint(condition=Q(qty_remaining__gte=0), name="batch_remaining_nonneg"),
            models.CheckConstraint(condition=Q(qty_reserved__gte=0), name="batch_reserved_nonneg"),
            models.CheckConstraint(
                condition=Q(qty_reserved__lte=F("qty_remaining")), name="batch_reserved_le_remaining"
            ),
        ]
        indexes = [
            models.Index(fields=["product", "branch", "status", "sellable_until"], name="batch_fefo_idx"),
            models.Index(fields=["branch", "status", "expiry_date"], name="batch_expiry_idx"),
        ]

    def __str__(self):
        return f"{self.product_id}/{self.lot_code}"

    @property
    def available(self) -> Decimal:
        return self.qty_remaining - self.qty_reserved


class MovementKind(models.TextChoices):
    RECEIPT = "RECEIPT", "Goods received"
    SALE = "SALE", "Sold (picked)"
    ADJUSTMENT = "ADJUSTMENT", "Adjustment"
    WASTE = "WASTE", "Waste / spoilage"
    TRANSFER_OUT = "TRANSFER_OUT", "Transfer out"
    TRANSFER_IN = "TRANSFER_IN", "Transfer in"
    RETURN = "RETURN", "Returned to stock"


class WasteReason(models.TextChoices):
    EXPIRED = "EXPIRED", "Expired"
    DAMAGED = "DAMAGED", "Damaged"
    SPOILED = "SPOILED", "Spoiled"
    QUALITY = "QUALITY", "Failed quality check"
    OTHER = "OTHER", "Other"


class StockMovement(models.Model):
    """Immutable ledger of every change to on-hand stock."""

    product = models.ForeignKey("catalog.Product", on_delete=models.PROTECT, related_name="movements")
    branch = models.ForeignKey("stores.Branch", on_delete=models.PROTECT, related_name="movements")
    batch = models.ForeignKey(Batch, null=True, blank=True, on_delete=models.PROTECT, related_name="movements")
    kind = models.CharField(max_length=14, choices=MovementKind.choices, db_index=True)
    qty_delta = models.DecimalField(max_digits=12, decimal_places=3)
    on_hand_after = models.DecimalField(max_digits=12, decimal_places=3)
    unit_cost = models.DecimalField(max_digits=10, decimal_places=4, null=True, blank=True)
    reason_code = models.CharField(max_length=20, blank=True)
    note = models.CharField(max_length=300, blank=True)
    actor = models.ForeignKey("accounts.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    ref_type = models.CharField(max_length=30, blank=True)
    ref_id = models.CharField(max_length=64, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["product", "branch", "-created_at"]),
            models.Index(fields=["ref_type", "ref_id"]),
        ]
        constraints = [models.CheckConstraint(condition=~Q(qty_delta=0), name="movement_nonzero")]

    def save(self, *args, **kwargs):
        if self.pk:
            raise IntegrityError("stock movements are immutable")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise IntegrityError("stock movements are immutable")


class AllocationState(models.TextChoices):
    RESERVED = "RESERVED", "Reserved"
    COMMITTED = "COMMITTED", "Committed (picked)"
    RELEASED = "RELEASED", "Released"


class Allocation(TimeStampedModel):
    """Stock set aside for an order line (optionally from a specific batch)."""

    order_item = models.ForeignKey("orders.OrderItem", on_delete=models.CASCADE, related_name="allocations")
    product = models.ForeignKey("catalog.Product", on_delete=models.PROTECT, related_name="+")
    branch = models.ForeignKey("stores.Branch", on_delete=models.PROTECT, related_name="+")
    batch = models.ForeignKey(Batch, null=True, blank=True, on_delete=models.PROTECT, related_name="allocations")
    qty = models.DecimalField(max_digits=12, decimal_places=3)
    state = models.CharField(
        max_length=10, choices=AllocationState.choices, default=AllocationState.RESERVED, db_index=True
    )

    class Meta:
        constraints = [models.CheckConstraint(condition=Q(qty__gt=0), name="allocation_qty_pos")]
        indexes = [models.Index(fields=["order_item", "state"])]
