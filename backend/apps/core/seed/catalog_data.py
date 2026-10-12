"""Assembled demo catalogue: finished product records with SKUs, slugs, barcodes and popularity.

Plain data, deterministic (no randomness; pseudo-variation comes from a CRC of the SKU). Importable without Django.
"""

from __future__ import annotations

import re
import zlib

from .catalog_base import BRAND_BY_NAME, BRANDS, CAT, CATEGORIES, DEPARTMENTS, UNIT_QTY
from .products_chilled_bakery import CHILLED_BAKERY
from .products_other import MEAT_FISH_FROZEN, SPECIALTY
from .products_pantry import DRINKS_SNACKS, PANTRY
from .products_produce import PRODUCE

ORIGIN_NOTE = (
    "Demo data: example origin shown to demonstrate this field. Confirm with the supplier before relying on it."
)
NUTRITION_SOURCE = "Generic reference values (demo) — replace with supplier label data"
CLAIM_PENDING_EVIDENCE = "Awaiting supplier certificate (demo)"
CLAIM_PENDING_VEGAN_EVIDENCE = "Awaiting supplier statement (demo)"
CLAIM_PLAIN_EVIDENCE = "Plain single-ingredient product (demo record)"

# most popular first: gives a clear 30-day bestseller ordering for the "popular" sort
BESTSELLERS = [
    "Bananas",
    "Whole Milk",
    "Large White Eggs",
    "Gala Apples",
    "Vine Tomatoes",
    "Avocados",
    "Sourdough Loaf",
    "Carrots",
    "Yellow Onions",
    "Russet Potatoes",
    "Baby Spinach",
    "Cheddar",
    "Unsalted Butter",
    "Strawberries",
    "Chicken Breast Fillets",
    "Spaghetti",
    "Olive Oil",
    "Greek-Style Yogurt",
    "Orange Juice",
    "Basmati Rice",
    "Salmon Fillets",
    "Blueberries",
    "Lemons",
    "Cucumbers",
    "Butter Croissant",
    "Tortilla Chips",
    "Medium-Roast Ground Coffee",
    "Crunchy Granola",
    "Red Bell Peppers",
    "Broccoli",
    "Sea Salt Potato Chips",
    "Garlic",
    "Penne Rigate",
    "Still Water",
    "Tomato Pasta Sauce",
    "Large Brown Eggs",
    "Oat Drink",
    "Whole Wheat Sandwich Loaf",
    "Ground Beef",
    "Margherita Pizza",
]

NUTRITION = {
    # per 100 g, generic reference values for plain whole foods (not supplier label data)
    "Bananas": dict(
        kcal="89",
        kj="372",
        fat="0.33",
        sat="0.11",
        carb="22.8",
        sugars="12.2",
        fibre="2.6",
        protein="1.09",
        salt="0.003",
    ),
    "Gala Apples": dict(
        kcal="52",
        kj="218",
        fat="0.17",
        sat="0.03",
        carb="13.8",
        sugars="10.4",
        fibre="2.4",
        protein="0.26",
        salt="0.003",
    ),
    "Carrots": dict(
        kcal="41", kj="172", fat="0.24", sat="0.04", carb="9.6", sugars="4.7", fibre="2.8", protein="0.93", salt="0.173"
    ),
    "Russet Potatoes": dict(
        kcal="77",
        kj="322",
        fat="0.09",
        sat="0.03",
        carb="17.5",
        sugars="0.8",
        fibre="2.1",
        protein="2.05",
        salt="0.015",
    ),
    "Vine Tomatoes": dict(
        kcal="18", kj="75", fat="0.2", sat="0.03", carb="3.9", sugars="2.6", fibre="1.2", protein="0.88", salt="0.013"
    ),
    "Broccoli": dict(
        kcal="34", kj="142", fat="0.37", sat="0.04", carb="6.6", sugars="1.7", fibre="2.6", protein="2.82", salt="0.083"
    ),
    "Baby Spinach": dict(
        kcal="23", kj="96", fat="0.39", sat="0.06", carb="3.6", sugars="0.4", fibre="2.2", protein="2.86", salt="0.198"
    ),
    "Blueberries": dict(
        kcal="57",
        kj="238",
        fat="0.33",
        sat="0.03",
        carb="14.5",
        sugars="10.0",
        fibre="2.4",
        protein="0.74",
        salt="0.003",
    ),
    "Large White Eggs": dict(
        kcal="143",
        kj="598",
        fat="9.51",
        sat="3.13",
        carb="0.72",
        sugars="0.37",
        fibre="0",
        protein="12.56",
        salt="0.355",
    ),
    "Rolled Oats": dict(
        kcal="389",
        kj="1628",
        fat="6.9",
        sat="1.22",
        carb="66.3",
        sugars="1.0",
        fibre="10.6",
        protein="16.9",
        salt="0.005",
    ),
    "Long-Grain White Rice": dict(
        kcal="365",
        kj="1527",
        fat="0.66",
        sat="0.18",
        carb="80.0",
        sugars="0.12",
        fibre="1.3",
        protein="7.13",
        salt="0.013",
    ),
    "Red Lentils": dict(
        kcal="352",
        kj="1473",
        fat="1.06",
        sat="0.15",
        carb="63.4",
        sugars="2.0",
        fibre="10.7",
        protein="24.6",
        salt="0.015",
    ),
}

ALL_PRODUCTS = PRODUCE + PANTRY + CHILLED_BAKERY + MEAT_FISH_FROZEN + DRINKS_SNACKS + SPECIALTY

CATEGORY_PREFIX = {slug: prefix for cats in CATEGORIES.values() for slug, _n, _d, prefix in cats}
CATEGORY_PARENT = {slug: dept for dept, cats in CATEGORIES.items() for slug, *_ in cats}


def slugify(value: str) -> str:
    value = value.lower().replace("&", " and ")
    return re.sub(r"[^a-z0-9]+", "-", value).strip("-")


def ean13(body12: str) -> str:
    total = sum(int(d) * (3 if i % 2 else 1) for i, d in enumerate(body12))
    return body12 + str((10 - total % 10) % 10)


def _finish(records: list[dict]) -> list[dict]:
    out, counters, slugs = [], {}, set()
    rank = {name: i for i, name in enumerate(BESTSELLERS)}
    for idx, rec in enumerate(records, start=1):
        rec = dict(rec)
        prefix = CATEGORY_PREFIX[rec["cat"]]
        counters[prefix] = counters.get(prefix, 0) + 1
        rec["sku"] = f"OR-{prefix}-{counters[prefix]:04d}"
        rec["index"] = idx
        slug = slugify(rec["name"])
        if slug in slugs:
            raise ValueError(f"duplicate product slug {slug!r}")
        slugs.add(slug)
        rec["slug"] = slug
        crc = zlib.crc32(rec["sku"].encode())
        # barcodes use GS1 prefix 20 ("restricted circulation / in-store use"), so they cannot collide with real products
        rec["barcode"] = ean13(f"20{1000000000 + idx * 37:010d}") if rec["ean"] else None
        rec["popularity"] = 980 - rank[rec["name"]] * 17 if rec["name"] in rank else 12 + crc % 120
        rec["created_days_ago"] = rec["new"] if rec["new"] is not None else 45 + crc % 300
        rec["cost_factor"] = (55 + crc % 16) / 100
        unit = rec["unit"]
        rec["qty"] = rec["qty"] or UNIT_QTY[unit]
        rec["vw"] = rec["vw"] if rec["vw"] is not None else unit in ("kg", "100g")
        out.append(rec)
    return out


PRODUCTS = _finish(ALL_PRODUCTS)
PRODUCT_BY_NAME = {p["name"]: p for p in PRODUCTS}
PRODUCT_BY_SKU = {p["sku"]: p for p in PRODUCTS}


def art_params(rec: dict) -> tuple[str, dict]:
    """Archetype name and parameters for a product, with the brand wordmark/colour and pack name filled in."""
    archetype, params = rec["art"]
    params = dict(params)
    brand = BRAND_BY_NAME.get(rec["brand"]) if rec["brand"] else None
    if brand:
        params.setdefault("brand", brand["mark"])
        params.setdefault("accent", brand["color"])
    params.setdefault("name", rec["name"])
    return archetype, params


def check() -> None:
    """Cheap structural validation (also exercised by the test-suite)."""
    names = [p["name"] for p in PRODUCTS]
    assert len(names) == len(set(names)), "duplicate product names"
    for p in PRODUCTS:
        assert p["cat"] in CAT, p["name"]
        assert p["brand"] is None or p["brand"] in BRAND_BY_NAME, (p["name"], p["brand"])
        assert len(p["short"]) <= 200, p["name"]
    for name in BESTSELLERS:
        assert name in PRODUCT_BY_NAME, name
    for name in NUTRITION:
        assert name in PRODUCT_BY_NAME, name


__all__ = [
    "ALL_PRODUCTS",
    "BESTSELLERS",
    "BRANDS",
    "BRAND_BY_NAME",
    "CATEGORIES",
    "CATEGORY_PARENT",
    "DEPARTMENTS",
    "NUTRITION",
    "ORIGIN_NOTE",
    "PRODUCTS",
    "PRODUCT_BY_NAME",
    "PRODUCT_BY_SKU",
    "art_params",
    "check",
]
