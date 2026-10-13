"""Unit-price calculation (price per kg / per L) used for display and comparison."""

from __future__ import annotations

from decimal import Decimal

from apps.core.money import money

BASE_SYMBOL = {"WEIGHT": "kg", "VOLUME": "L"}


def unit_price_for(product, price: Decimal | None = None) -> dict | None:
    """Price per kg / L. `price` lets callers pass the effective (promotional) price."""
    price = product.price if price is None else price
    unit = product.sale_unit
    if unit.kind in BASE_SYMBOL:
        # Sold directly by weight/volume: price is per `to_base` of the base unit.
        per_base = price / unit.to_base
        return {"amount": money(per_base), "per": BASE_SYMBOL[unit.kind], "kind": unit.kind}
    if product.net_content and product.net_content_unit_id:
        content_base = product.net_content * product.net_content_unit.to_base
        if content_base > 0:
            return {
                "amount": money(price / content_base),
                "per": BASE_SYMBOL[product.net_content_unit.kind],
                "kind": product.net_content_unit.kind,
            }
    return None


def pack_label(product) -> str:
    """Human description of how the product is sold, e.g. 'per kg', 'each · 500 g'."""
    unit = product.sale_unit
    if unit.kind != "COUNT":
        return f"per {unit.symbol}" if unit.to_base == Decimal("1") else f"per {unit.symbol}"
    label = unit.name.lower() if unit.code != "each" else "each"
    if product.net_content and product.net_content_unit_id:
        content = product.net_content.normalize()
        content = f"{content:f}"
        return f"{label} · {content} {product.net_content_unit.symbol}"
    return label
