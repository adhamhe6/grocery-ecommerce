"""Guards that keep the synthetic-data generator away from real and demo databases."""

from __future__ import annotations

from django.db import connection

# Patterns that mark every row the generator creates. `reset` deletes by these and by nothing else.
SKU_PREFIX = "PERF-"
RACE_SKU = "PERF-RACE-0001"
EMAIL_DOMAIN = "perf.invalid"
BRAND_SLUG_PREFIX = "perf-"
PROMO_NAME_PREFIX = "PERF "
MOVEMENT_REF = "PERF_SEED"
DB_NAME_MARKER = "perf"


class UnsafeTarget(Exception):  # noqa: N818 - a refusal, not an error condition worth an "Error" suffix
    """Raised when the generator is pointed at something it must not touch."""


def database_name() -> str:
    """Name of the database the default connection points at (a function so tests can replace it)."""
    return str(connection.settings_dict.get("NAME") or "")


def name_is_perf(name: str) -> bool:
    return DB_NAME_MARKER in name.lower()


def assert_safe_target(confirm_synthetic: bool) -> str:
    """Return the database name, or raise `UnsafeTarget` explaining why generating data here is refused."""
    name = database_name()
    if not confirm_synthetic:
        raise UnsafeTarget(
            "seed_perf creates tens of thousands of synthetic rows. Re-run with --confirm-synthetic to acknowledge "
            "that this database contains only throw-away data."
        )
    if not name_is_perf(name):
        raise UnsafeTarget(
            f"Refusing to run against database {name!r}: its name must contain {DB_NAME_MARKER!r} "
            "(for example `grocery_perf`). This guard exists so the generator can never pollute a real or demo "
            "database. Create a scratch database, migrate it, run `seed_demo --skip-images`, then point DATABASE_URL at it."
        )
    return name
