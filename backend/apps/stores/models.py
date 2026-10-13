from __future__ import annotations

import datetime as dt
from decimal import Decimal

from django.contrib.postgres.fields import ArrayField
from django.db import models
from django.db.models import F, Q

from apps.core.models import TimeStampedModel

WEEKDAYS = [
    (0, "Monday"),
    (1, "Tuesday"),
    (2, "Wednesday"),
    (3, "Thursday"),
    (4, "Friday"),
    (5, "Saturday"),
    (6, "Sunday"),
]


class Branch(TimeStampedModel):
    code = models.SlugField(max_length=20, unique=True)
    name = models.CharField(max_length=120)
    slug = models.SlugField(max_length=80, unique=True)
    address_line1 = models.CharField(max_length=160)
    address_line2 = models.CharField(max_length=160, blank=True)
    city = models.CharField(max_length=80)
    area = models.CharField(max_length=80, blank=True)
    postal_code = models.CharField(max_length=16, blank=True)
    phone = models.CharField(max_length=40, blank=True)
    email = models.EmailField(blank=True)
    timezone = models.CharField(max_length=64, blank=True, help_text="Blank = store timezone")
    is_active = models.BooleanField(default=True)
    is_default = models.BooleanField(default=False)
    offers_delivery = models.BooleanField(default=True)
    offers_pickup = models.BooleanField(default=True)
    prep_minutes = models.PositiveIntegerField(
        default=120, help_text="Minimum time between placing an order and the start of its slot."
    )
    pickup_instructions = models.CharField(max_length=300, blank=True)
    is_demo = models.BooleanField(default=False)

    class Meta:
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(fields=["is_default"], condition=Q(is_default=True), name="uniq_default_branch")
        ]

    def __str__(self):
        return self.name

    @property
    def address_display(self) -> str:
        return ", ".join(
            p for p in [self.address_line1, self.address_line2, self.area, self.city, self.postal_code] if p
        )


class BranchHours(models.Model):
    branch = models.ForeignKey(Branch, on_delete=models.CASCADE, related_name="hours")
    weekday = models.PositiveSmallIntegerField(choices=WEEKDAYS)
    opens = models.TimeField(null=True, blank=True)
    closes = models.TimeField(null=True, blank=True)
    is_closed = models.BooleanField(default=False)

    class Meta:
        ordering = ["weekday"]
        constraints = [
            models.UniqueConstraint(fields=["branch", "weekday"], name="uniq_branch_weekday"),
            models.CheckConstraint(
                condition=Q(is_closed=True)
                | (Q(opens__isnull=False) & Q(closes__isnull=False) & Q(opens__lt=F("closes"))),
                name="hours_open_before_close",
            ),
        ]


class BranchClosure(models.Model):
    branch = models.ForeignKey(Branch, on_delete=models.CASCADE, related_name="closures")
    date = models.DateField()
    reason = models.CharField(max_length=160, blank=True)

    class Meta:
        ordering = ["date"]
        constraints = [models.UniqueConstraint(fields=["branch", "date"], name="uniq_branch_closure_date")]


class DeliveryZone(TimeStampedModel):
    branch = models.ForeignKey(Branch, on_delete=models.CASCADE, related_name="zones")
    name = models.CharField(max_length=80)
    postcode_prefixes = ArrayField(
        models.CharField(max_length=16),
        default=list,
        blank=True,
        help_text="Upper-case, no spaces. An address matches if its postcode starts with any prefix.",
    )
    areas = ArrayField(
        models.CharField(max_length=80),
        default=list,
        blank=True,
        help_text="Lower-case district names matched exactly (case-insensitive).",
    )
    delivery_fee = models.DecimalField(max_digits=8, decimal_places=2, default=Decimal("0.00"))
    free_delivery_threshold = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    min_order_value = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0.00"))
    priority = models.PositiveSmallIntegerField(default=100, help_text="Lower wins when several zones match")
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["priority", "name"]
        constraints = [
            models.CheckConstraint(condition=Q(delivery_fee__gte=0), name="zone_fee_nonneg"),
            models.CheckConstraint(condition=Q(min_order_value__gte=0), name="zone_min_nonneg"),
        ]

    def __str__(self):
        return f"{self.branch.code}/{self.name}"


class SlotKind(models.TextChoices):
    DELIVERY = "DELIVERY", "Delivery"
    PICKUP = "PICKUP", "Pickup"


class SlotTemplate(TimeStampedModel):
    """Weekly pattern from which concrete `DeliverySlot` rows are generated."""

    branch = models.ForeignKey(Branch, on_delete=models.CASCADE, related_name="slot_templates")
    zone = models.ForeignKey(
        DeliveryZone, null=True, blank=True, on_delete=models.CASCADE, related_name="slot_templates"
    )
    kind = models.CharField(max_length=10, choices=SlotKind.choices)
    weekday = models.PositiveSmallIntegerField(choices=WEEKDAYS)
    start_time = models.TimeField()
    end_time = models.TimeField()
    capacity = models.PositiveIntegerField()
    fee = models.DecimalField(
        max_digits=8, decimal_places=2, null=True, blank=True, help_text="Overrides the zone delivery fee when set"
    )
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["branch", "kind", "weekday", "start_time"]
        constraints = [
            models.CheckConstraint(condition=Q(start_time__lt=F("end_time")), name="template_start_before_end"),
            models.CheckConstraint(condition=Q(capacity__gt=0), name="template_capacity_pos"),
        ]


class DeliverySlot(TimeStampedModel):
    branch = models.ForeignKey(Branch, on_delete=models.CASCADE, related_name="slots")
    zone = models.ForeignKey(DeliveryZone, null=True, blank=True, on_delete=models.CASCADE, related_name="slots")
    kind = models.CharField(max_length=10, choices=SlotKind.choices)
    date = models.DateField()
    start_time = models.TimeField()
    end_time = models.TimeField()
    capacity = models.PositiveIntegerField()
    booked = models.PositiveIntegerField(default=0)
    fee = models.DecimalField(max_digits=8, decimal_places=2, default=Decimal("0.00"))
    is_open = models.BooleanField(default=True)
    template = models.ForeignKey(SlotTemplate, null=True, blank=True, on_delete=models.SET_NULL, related_name="slots")

    class Meta:
        ordering = ["date", "start_time"]
        indexes = [models.Index(fields=["branch", "kind", "date"])]
        constraints = [
            models.UniqueConstraint(
                fields=["branch", "zone", "kind", "date", "start_time"], name="uniq_slot", nulls_distinct=False
            ),
            models.CheckConstraint(condition=Q(booked__lte=F("capacity")), name="slot_not_overbooked"),
            models.CheckConstraint(condition=Q(start_time__lt=F("end_time")), name="slot_start_before_end"),
        ]

    @property
    def remaining(self) -> int:
        return max(self.capacity - self.booked, 0)

    @property
    def starts_at_naive(self) -> dt.datetime:
        return dt.datetime.combine(self.date, self.start_time)
