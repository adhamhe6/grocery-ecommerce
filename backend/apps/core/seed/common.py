"""Shared helpers for the demo seed: time handling, a tally of what was done, and tiny upsert utilities."""

from __future__ import annotations

import datetime as dt
from collections import defaultdict
from zoneinfo import ZoneInfo

from django.utils import timezone

from .ops_data import STORE

TZ = ZoneInfo(STORE["timezone"])
DEMO_REF = "DEMO_SEED"  # StockMovement.ref_type used to identify seeded ledger rows


def today() -> dt.date:
    return timezone.now().astimezone(TZ).date()


def local_dt(day: dt.date, hour: int = 0, minute: int = 0) -> dt.datetime:
    return dt.datetime.combine(day, dt.time(hour, minute), tzinfo=TZ)


def day_offset(days: int) -> dt.date:
    return today() + dt.timedelta(days=days)


def midnight(days: int) -> dt.datetime:
    """Local midnight at the start of the day `days` from today (stable within a day, so reruns are idempotent)."""
    return local_dt(day_offset(days))


class Tally:
    """Counts of rows created / updated / left alone per entity, plus warnings, for the summary at the end."""

    def __init__(self, stdout=None):
        self.created: dict[str, int] = defaultdict(int)
        self.updated: dict[str, int] = defaultdict(int)
        self.skipped: dict[str, int] = defaultdict(int)
        self.warnings: list[str] = []
        self._stdout = stdout

    def add(self, label: str, created: bool) -> None:
        (self.created if created else self.updated)[label] += 1

    def skip(self, label: str, why: str) -> None:
        self.skipped[label] += 1
        self.warn(f"{label}: {why}")

    def warn(self, message: str) -> None:
        self.warnings.append(message)
        if self._stdout is not None:
            self._stdout.write(f"  warning: {message}")
