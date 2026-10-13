"""Store settings, branches, opening hours, closures, delivery zones and slot templates."""

from __future__ import annotations

import datetime as dt
from decimal import Decimal

from apps.core.models import StoreSettings
from apps.stores.models import (
    Branch,
    BranchClosure,
    BranchHours,
    DeliverySlot,
    DeliveryZone,
    SlotKind,
    SlotTemplate,
)
from apps.stores.services import generate_slots

from .common import Tally, day_offset
from .ops_data import (
    BRANCHES,
    DEFAULT_SUPPORT_EMAIL,
    DELIVERY_WINDOWS,
    PICKUP_CAPACITY,
    STORE,
    ZONES,
)


def seed_store_settings(tally: Tally) -> None:
    obj, created = StoreSettings.objects.get_or_create(pk=1)
    if not (created or obj.demo_mode or obj.support_email == DEFAULT_SUPPORT_EMAIL):
        tally.skip("StoreSettings", "already customised and not in demo mode; left unchanged")
        return
    for key, value in STORE.items():
        setattr(obj, key, value)
    obj.save()
    tally.add("StoreSettings", created)


def _fits(hours: tuple | None, start: dt.time, end: dt.time) -> bool:
    return bool(hours) and hours[0] <= start and end <= hours[1]


def seed_branches(tally: Tally) -> dict[str, Branch]:
    branches: dict[str, Branch] = {}
    for spec in BRANCHES:
        existing = Branch.objects.filter(code=spec["code"]).first() or Branch.objects.filter(slug=spec["slug"]).first()
        if existing and not existing.is_demo:
            tally.skip("Branch", f"{spec['code']!r} exists and is not demo data; left unchanged")
            continue
        other_default = Branch.objects.filter(is_default=True).exclude(code=spec["code"]).exists()
        fields = {
            k: spec[k]
            for k in (
                "name",
                "slug",
                "address_line1",
                "address_line2",
                "city",
                "area",
                "postal_code",
                "phone",
                "email",
                "prep_minutes",
                "pickup_instructions",
            )
        }
        fields["is_default"] = bool(spec["is_default"]) and not other_default
        fields["is_demo"] = True
        branch, created = Branch.objects.update_or_create(code=spec["code"], defaults=fields)
        tally.add("Branch", created)
        branches[spec["code"]] = branch
        _seed_hours(branch, spec, tally)
        _seed_closure(branch, spec, tally)
        _seed_zones_and_templates(branch, spec, tally)
    return branches


def _seed_hours(branch: Branch, spec: dict, tally: Tally) -> None:
    for weekday in range(7):
        window = spec["hours"].get(weekday)
        defaults = (
            {"opens": window[0], "closes": window[1], "is_closed": False}
            if window
            else {"opens": None, "closes": None, "is_closed": True}
        )
        _, created = BranchHours.objects.update_or_create(branch=branch, weekday=weekday, defaults=defaults)
        tally.add("BranchHours", created)


def _seed_closure(branch: Branch, spec: dict, tally: Tally) -> None:
    reason = spec.get("closure")
    if not reason:
        return
    day = day_offset(6)
    for _ in range(14):  # first day on or after +6 days on which the branch is normally open
        hours = BranchHours.objects.filter(branch=branch, weekday=day.weekday()).first()
        if hours and not hours.is_closed:
            break
        day += dt.timedelta(days=1)
    closure = BranchClosure.objects.filter(branch=branch, reason=reason).first()
    created = closure is None
    if created:
        closure = BranchClosure(branch=branch, reason=reason)
    closure.date = day
    closure.save()
    # slots generated before the closure was (re)dated must not stay bookable on the closed day
    DeliverySlot.objects.filter(branch=branch, date=day, booked=0).delete()
    tally.add("BranchClosure", created)


def _seed_zones_and_templates(branch: Branch, spec: dict, tally: Tally) -> None:
    hours = spec["hours"]
    for zone_spec in ZONES[branch.code]:
        zone, created = DeliveryZone.objects.update_or_create(
            branch=branch,
            name=zone_spec["name"],
            defaults={
                "postcode_prefixes": zone_spec["postcode_prefixes"],
                "areas": zone_spec["areas"],
                "delivery_fee": Decimal(zone_spec["delivery_fee"]),
                "free_delivery_threshold": Decimal(zone_spec["free_delivery_threshold"]),
                "min_order_value": Decimal(zone_spec["min_order_value"]),
                "priority": zone_spec["priority"],
            },
        )
        tally.add("DeliveryZone", created)
        for weekday in range(7):
            for (start_h, end_h), capacity in zip(DELIVERY_WINDOWS, zone_spec["capacity"], strict=True):
                start, end = dt.time(start_h), dt.time(end_h)
                if _fits(hours.get(weekday), start, end):
                    _template(branch, zone, SlotKind.DELIVERY, weekday, start, end, capacity, tally)
    # hourly pickup slots (not tied to a zone)
    for weekday in range(7):
        window = spec["sunday_pickup_hours"] if weekday == 6 else spec["pickup_hours"]
        if not window:
            continue
        for hour in range(window[0], window[1]):
            start, end = dt.time(hour), dt.time(hour + 1)
            if _fits(hours.get(weekday), start, end):
                _template(branch, None, SlotKind.PICKUP, weekday, start, end, PICKUP_CAPACITY[branch.code], tally)


def _template(branch, zone, kind, weekday, start, end, capacity, tally) -> None:
    _, created = SlotTemplate.objects.update_or_create(
        branch=branch,
        zone=zone,
        kind=kind,
        weekday=weekday,
        start_time=start,
        defaults={"end_time": end, "capacity": capacity, "is_active": True},
    )
    tally.add("SlotTemplate", created)


def seed_slots(branches: dict[str, Branch], tally: Tally) -> None:
    for branch in branches.values():
        made = generate_slots(branch, days_ahead=10)
        tally.created["DeliverySlot"] += made
