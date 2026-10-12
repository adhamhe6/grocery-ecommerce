"""Automatic-promotion pricing. Pure functions + a small cached index; used by catalog, cart and checkout.

Rules (documented in docs/commerce-workflows.md):
* Promotions never stack on one product: the one giving the lowest line total for the quantity wins
  (ties → lowest `priority`, then id).
* Unit prices are rounded to cents; a line total is `money(effective_unit_price × quantity)` for
  percent/amount promotions and `groups × multibuy_price + remainder × base` for multibuy.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import ROUND_FLOOR, Decimal

from django.db.models import Q
from django.utils import timezone

from apps.core import cache as core_cache
from apps.core.money import ZERO, money


@dataclass(frozen=True)
class PromoDef:
    id: int
    label: str
    kind: str
    percent: Decimal | None
    amount_off: Decimal | None
    multibuy_qty: int | None
    multibuy_price: Decimal | None
    product_ids: frozenset[int] = field(default_factory=frozenset)
    category_ids: frozenset[int] = field(default_factory=frozenset)
    brand_ids: frozenset[int] = field(default_factory=frozenset)
    ends_at: object | None = None


@dataclass(frozen=True)
class PromoApplication:
    promo_id: int
    label: str
    kind: str
    unit_price: Decimal  # effective price per unit (display)
    line_total: Decimal
    savings: Decimal  # vs. base price × qty
    params: dict


class PromotionIndex:
    def __init__(self, promos: list[PromoDef]):
        self.promos = promos
        self.by_product: dict[int, list[PromoDef]] = {}
        self.by_category: dict[int, list[PromoDef]] = {}
        self.by_brand: dict[int, list[PromoDef]] = {}
        for p in promos:
            for pid in p.product_ids:
                self.by_product.setdefault(pid, []).append(p)
            for cid in p.category_ids:
                self.by_category.setdefault(cid, []).append(p)
            for bid in p.brand_ids:
                self.by_brand.setdefault(bid, []).append(p)

    def candidates(
        self, product_id: int, category_id: int | None, parent_category_id: int | None, brand_id: int | None
    ) -> list[PromoDef]:
        found = {p.id: p for p in self.by_product.get(product_id, [])}
        for cid in (category_id, parent_category_id):
            if cid:
                found.update({p.id: p for p in self.by_category.get(cid, [])})
        if brand_id:
            found.update({p.id: p for p in self.by_brand.get(brand_id, [])})
        return list(found.values())


def _load_defs(now) -> list[PromoDef]:
    from apps.promotions.models import Promotion

    qs = (
        Promotion.objects.filter(is_active=True, starts_at__lte=now)
        .filter(Q(ends_at__isnull=True) | Q(ends_at__gt=now))
        .prefetch_related("products", "categories", "brands")
    )
    return [
        PromoDef(
            id=p.id,
            label=p.label,
            kind=p.kind,
            percent=p.percent,
            amount_off=p.amount_off,
            multibuy_qty=p.multibuy_qty,
            multibuy_price=p.multibuy_price,
            product_ids=frozenset(x.id for x in p.products.all()) if p.scope == "PRODUCTS" else frozenset(),
            category_ids=frozenset(x.id for x in p.categories.all()) if p.scope == "CATEGORIES" else frozenset(),
            brand_ids=frozenset(x.id for x in p.brands.all()) if p.scope == "BRANDS" else frozenset(),
            ends_at=p.ends_at,
        )
        for p in qs
    ]


def load_index(now=None, use_cache: bool = True) -> PromotionIndex:
    """Cached for 30 s for catalog browsing. Checkout calls `load_index(use_cache=False)` — it must see live data."""
    now = now or timezone.now()
    if not use_cache:
        return PromotionIndex(_load_defs(now))
    defs = core_cache.get_or_set("promos", ("active",), 30, lambda: _load_defs(now))
    # a cached definition may have expired within the TTL window
    return PromotionIndex([d for d in defs if d.ends_at is None or d.ends_at > now])


def apply_promo(promo: PromoDef, base_price: Decimal, qty: Decimal) -> PromoApplication | None:
    base_total = money(base_price * qty)
    if promo.kind == "PERCENT_OFF" and promo.percent:
        unit = money(base_price * (Decimal("100") - promo.percent) / Decimal("100"))
        total = money(unit * qty)
        params = {"percent": str(promo.percent)}
    elif promo.kind == "AMOUNT_OFF" and promo.amount_off:
        unit = max(money(base_price - promo.amount_off), ZERO)
        total = money(unit * qty)
        params = {"amount_off": str(promo.amount_off)}
    elif promo.kind == "MULTIBUY" and promo.multibuy_qty and promo.multibuy_price is not None:
        groups = (qty / promo.multibuy_qty).to_integral_value(rounding=ROUND_FLOOR)
        remainder = qty - groups * promo.multibuy_qty
        total = money(groups * promo.multibuy_price + remainder * base_price)
        unit = money(total / qty) if qty else base_price
        params = {"multibuy_qty": promo.multibuy_qty, "multibuy_price": str(promo.multibuy_price)}
    else:
        return None
    if total >= base_total:
        return None
    return PromoApplication(promo.id, promo.label, promo.kind, unit, total, base_total - total, params)


def best_application(candidates: list[PromoDef], base_price: Decimal, qty: Decimal) -> PromoApplication | None:
    best: PromoApplication | None = None
    for promo in sorted(candidates, key=lambda p: p.id):
        app = apply_promo(promo, base_price, qty)
        if app and (best is None or app.line_total < best.line_total):
            best = app
    return best


def display_promo(index: PromotionIndex, product) -> PromoApplication | None:
    """Promotion shown on cards/PDP for quantity = the product's minimum order quantity (or the multibuy threshold)."""
    cat = product.category
    cands = index.candidates(product.id, product.category_id, cat.parent_id if cat else None, product.brand_id)
    if not cands:
        return None
    qty = product.qty_min
    # For multibuy show the offer at the quantity that triggers it so the label is truthful.
    app = best_application(cands, product.price, qty)
    if app:
        return app
    for promo in cands:
        if promo.kind == "MULTIBUY" and promo.multibuy_qty:
            return apply_promo(promo, product.price, Decimal(promo.multibuy_qty))
    return None
