"""Delivery coverage, opening hours and capacity-safe slot booking."""

from __future__ import annotations

import datetime as dt
import logging
import zoneinfo
from decimal import Decimal

from django.db import transaction
from django.db.models import F
from django.utils import timezone

from apps.core.exceptions import DomainError, ErrorCode
from apps.core.models import StoreSettings

from .models import Branch, BranchClosure, BranchHours, DeliverySlot, DeliveryZone, SlotKind, SlotTemplate

logger = logging.getLogger(__name__)


def normalize_postcode(value: str) -> str:
    return "".join((value or "").split()).upper()


def branch_tz(branch: Branch) -> zoneinfo.ZoneInfo:
    return zoneinfo.ZoneInfo(branch.timezone or StoreSettings.load().timezone or "UTC")


def default_branch() -> Branch | None:
    return Branch.objects.filter(is_active=True).order_by("-is_default", "id").first()


def find_zone(*, postal_code: str = "", area: str = "", branch: Branch | None = None) -> DeliveryZone | None:
    """Return the highest-priority active zone covering the address, or None."""
    code = normalize_postcode(postal_code)
    area_l = (area or "").strip().lower()
    zones = DeliveryZone.objects.filter(is_active=True, branch__is_active=True, branch__offers_delivery=True)
    if branch is not None:
        zones = zones.filter(branch=branch)
    for zone in zones.select_related("branch"):
        if code and any(code.startswith(normalize_postcode(p)) for p in zone.postcode_prefixes if p):
            return zone
        if area_l and area_l in {a.strip().lower() for a in zone.areas}:
            return zone
    return None


def require_zone(*, postal_code: str = "", area: str = "", branch: Branch | None = None) -> DeliveryZone:
    zone = find_zone(postal_code=postal_code, area=area, branch=branch)
    if zone is None:
        raise DomainError(
            ErrorCode.ADDRESS_NOT_SERVICEABLE,
            "We don't deliver to this address yet. Try store pickup or a different address.",
            details={"postal_code": postal_code, "area": area},
        )
    return zone


def is_open_on(branch: Branch, date: dt.date, start: dt.time, end: dt.time) -> bool:
    if BranchClosure.objects.filter(branch=branch, date=date).exists():
        return False
    hours = BranchHours.objects.filter(branch=branch, weekday=date.weekday()).first()
    if hours is None or hours.is_closed:
        return False
    return hours.opens <= start and end <= hours.closes


def generate_slots(branch: Branch, days_ahead: int = 7, today: dt.date | None = None) -> int:
    """Create concrete slots from active templates. Idempotent; respects closures and opening hours."""
    today = today or timezone.now().astimezone(branch_tz(branch)).date()
    created = 0
    templates = list(SlotTemplate.objects.filter(branch=branch, is_active=True).select_related("zone"))
    for offset in range(days_ahead + 1):
        day = today + dt.timedelta(days=offset)
        for t in (x for x in templates if x.weekday == day.weekday()):
            if not is_open_on(branch, day, t.start_time, t.end_time):
                continue
            if t.kind == SlotKind.DELIVERY:
                fee = t.fee if t.fee is not None else (t.zone.delivery_fee if t.zone else Decimal("0.00"))
            else:
                fee = t.fee if t.fee is not None else Decimal("0.00")
            _, was_created = DeliverySlot.objects.get_or_create(
                branch=branch,
                zone=t.zone,
                kind=t.kind,
                date=day,
                start_time=t.start_time,
                defaults={"end_time": t.end_time, "capacity": t.capacity, "fee": fee, "template": t},
            )
            created += int(was_created)
    return created


def earliest_bookable(branch: Branch, now: dt.datetime | None = None) -> dt.datetime:
    now = now or timezone.now()
    return (now + dt.timedelta(minutes=branch.prep_minutes)).astimezone(branch_tz(branch))


def slot_start(slot: DeliverySlot) -> dt.datetime:
    return dt.datetime.combine(slot.date, slot.start_time, tzinfo=branch_tz(slot.branch))


def available_slots(
    branch: Branch, kind: str, zone: DeliveryZone | None = None, days: int = 7, now: dt.datetime | None = None
):
    now = now or timezone.now()
    horizon = earliest_bookable(branch, now)
    qs = DeliverySlot.objects.filter(
        branch=branch,
        kind=kind,
        is_open=True,
        booked__lt=F("capacity"),
        date__gte=horizon.date(),
        date__lte=horizon.date() + dt.timedelta(days=days),
    ).select_related("branch")
    if kind == SlotKind.DELIVERY:
        qs = qs.filter(zone=zone)
    return [s for s in qs.order_by("date", "start_time") if slot_start(s) >= horizon]


@transaction.atomic
def book_slot(
    slot_id: int, *, kind: str, branch_id: int, zone_id: int | None, now: dt.datetime | None = None
) -> DeliverySlot:
    """Atomically take one place in a slot. The conditional UPDATE is the capacity guard:
    two concurrent bookings of the last place cannot both succeed (and a CHECK constraint backs it up)."""
    slot = DeliverySlot.objects.select_related("branch").filter(pk=slot_id).first()
    if (
        slot is None
        or slot.kind != kind
        or slot.branch_id != branch_id
        or (kind == SlotKind.DELIVERY and slot.zone_id != zone_id)
    ):
        raise DomainError(
            ErrorCode.DELIVERY_SLOT_UNAVAILABLE, "That time slot is no longer available. Please choose another."
        )
    now = now or timezone.now()
    if not slot.is_open or slot_start(slot) < earliest_bookable(slot.branch, now):
        raise DomainError(
            ErrorCode.DELIVERY_SLOT_UNAVAILABLE, "That time slot is no longer bookable. Please choose a later one."
        )
    updated = DeliverySlot.objects.filter(pk=slot_id, is_open=True, booked__lt=F("capacity")).update(
        booked=F("booked") + 1
    )
    if not updated:
        raise DomainError(ErrorCode.DELIVERY_SLOT_UNAVAILABLE, "That time slot just filled up. Please choose another.")
    slot.refresh_from_db()
    return slot


def release_slot(slot_id: int | None) -> None:
    if slot_id:
        DeliverySlot.objects.filter(pk=slot_id, booked__gt=0).update(booked=F("booked") - 1)
