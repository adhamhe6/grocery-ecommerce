"""The pricing engine: one place that turns (products, quantities, coupon, fulfilment) into authoritative money.

The browser may *display* estimates, but cart view, checkout quote and order creation all call this module.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal

from django.utils import timezone

from apps.core.exceptions import DomainError, ErrorCode
from apps.core.models import StoreSettings
from apps.core.money import ZERO, is_multiple_of_step, money, qty
from apps.inventory.availability import Availability
from apps.promotions.coupons import CouponResult, evaluate_coupon
from apps.promotions.engine import PromoApplication, PromotionIndex, best_application

HUNDRED = Decimal("100")


@dataclass
class PricedLine:
    product: object
    quantity: Decimal
    base_unit_price: Decimal
    unit_price: Decimal
    line_total: Decimal
    promo: PromoApplication | None
    coupon_share: Decimal = ZERO
    availability: Availability | None = None
    issues: list[dict] = field(default_factory=list)
    substitution_pref: str = "INHERIT"

    @property
    def total_after_coupon(self) -> Decimal:
        return self.line_total - self.coupon_share

    @property
    def blocking(self) -> bool:
        return any(i.get("blocking") for i in self.issues)


@dataclass
class Totals:
    subtotal: Decimal = ZERO  # lines after promotions, before coupon
    promo_savings: Decimal = ZERO
    coupon_discount: Decimal = ZERO
    delivery_fee: Decimal = ZERO
    delivery_fee_before_free: Decimal = ZERO
    tax_total: Decimal = ZERO
    total: Decimal = ZERO
    authorized_amount: Decimal = ZERO
    variable_weight_buffer: Decimal = ZERO
    free_delivery: bool = False


def describe_rules(product) -> str:
    unit = product.sale_unit.symbol
    parts = [f"minimum {product.qty_min.normalize():f} {unit}", f"in steps of {product.qty_step.normalize():f} {unit}"]
    if product.qty_max is not None:
        parts.append(f"up to {product.qty_max.normalize():f} {unit}")
    return ", ".join(parts)


def validate_quantity(product, quantity) -> Decimal:
    """Return the normalised quantity or raise INVALID_QUANTITY (negative, zero, wrong step, fractional counts…)."""
    rules = {
        "min": str(product.qty_min),
        "step": str(product.qty_step),
        "max": str(product.qty_max) if product.qty_max else None,
    }
    try:
        raw = Decimal(str(quantity))
        if not raw.is_finite():
            raise ValueError
    except (ArithmeticError, ValueError, TypeError):
        raise DomainError(ErrorCode.INVALID_QUANTITY, "Enter a valid quantity.", details=rules) from None
    if raw <= 0:
        raise DomainError(ErrorCode.INVALID_QUANTITY, "Quantity must be greater than zero.", details=rules)
    value = qty(raw)
    if value != raw:
        raise DomainError(ErrorCode.INVALID_QUANTITY, "Quantity has too many decimal places.", details=rules)
    if not product.sale_unit.allows_fraction and value != value.to_integral_value():
        raise DomainError(ErrorCode.INVALID_QUANTITY, f"{product.name} is sold in whole units.", details=rules)
    if value < product.qty_min or not is_multiple_of_step(value, product.qty_min, product.qty_step):
        raise DomainError(
            ErrorCode.INVALID_QUANTITY, f"{product.name} is sold {describe_rules(product)}.", details=rules
        )
    if product.qty_max is not None and value > product.qty_max:
        raise DomainError(
            ErrorCode.INVALID_QUANTITY,
            f"The most you can order of {product.name} is {product.qty_max.normalize():f} {product.sale_unit.symbol}.",
            details=rules,
        )
    return value


def price_items(items, index: PromotionIndex) -> list[PricedLine]:
    """items: iterable of (product, quantity[, substitution_pref]). Product must have category loaded."""
    lines: list[PricedLine] = []
    for entry in items:
        product, quantity = entry[0], entry[1]
        pref = entry[2] if len(entry) > 2 else "INHERIT"
        cat = product.category
        candidates = index.candidates(product.id, product.category_id, cat.parent_id if cat else None, product.brand_id)
        promo = best_application(candidates, product.price, quantity) if candidates else None
        if promo:
            line_total, unit_price = promo.line_total, promo.unit_price
        else:
            line_total, unit_price = money(product.price * quantity), product.price
        lines.append(
            PricedLine(product, quantity, product.price, unit_price, line_total, promo, substitution_pref=pref)
        )
    return lines


def compute_totals(
    lines: list[PricedLine],
    coupon: CouponResult | None,
    *,
    delivery_fee: Decimal | None = None,
    free_delivery_threshold: Decimal | None = None,
    settings: StoreSettings | None = None,
) -> Totals:
    settings = settings or StoreSettings.load()
    t = Totals()
    for ln in lines:
        ln.coupon_share = coupon.shares.get(ln.product.id, ZERO) if coupon else ZERO
    t.subtotal = money(sum((ln.line_total for ln in lines), ZERO))
    t.promo_savings = money(sum((ln.promo.savings for ln in lines if ln.promo), ZERO))
    t.coupon_discount = money(coupon.discount if coupon else ZERO)
    after_coupon = t.subtotal - t.coupon_discount

    fee = money(delivery_fee) if delivery_fee is not None else ZERO
    t.delivery_fee_before_free = fee
    if fee > 0 and (
        (coupon and coupon.free_delivery)
        or (free_delivery_threshold is not None and after_coupon >= free_delivery_threshold)
    ):
        fee, t.free_delivery = ZERO, True
    t.delivery_fee = money(fee)
    t.delivery_fee_before_free = money(t.delivery_fee_before_free)

    for ln in lines:
        rate = ln.product.tax_rate
        if rate:
            base = ln.total_after_coupon
            t.tax_total += (
                money(base * rate / (HUNDRED + rate)) if settings.prices_include_tax else money(base * rate / HUNDRED)
            )
    t.tax_total = money(t.tax_total)
    t.total = money(after_coupon + fee + (ZERO if settings.prices_include_tax else t.tax_total))
    if t.total < 0:
        t.total = ZERO

    # Card authorisation = estimated total + tolerance buffer on weighed lines, so the final (weighed) price can never exceed what was authorised.
    variable_total = sum((ln.line_total for ln in lines if ln.product.is_variable_weight), ZERO)
    t.variable_weight_buffer = money(variable_total * settings.weight_tolerance_percent / HUNDRED)
    t.authorized_amount = money(t.total + t.variable_weight_buffer)
    return t


def apply_coupon_to_lines(
    code: str, lines: list[PricedLine], *, user=None, email: str = "", fulfilment_type: str | None = None
) -> CouponResult | None:
    if not code:
        return None
    return evaluate_coupon(code, lines, user=user, email=email, fulfilment_type=fulfilment_type, now=timezone.now())
