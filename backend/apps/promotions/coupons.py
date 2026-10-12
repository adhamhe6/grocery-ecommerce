"""Coupon eligibility, discount calculation and (race-safe) redemption.

All rules are enforced here on the server — the browser only ever submits a code.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import ROUND_DOWN, Decimal

from django.db import connection, transaction
from django.db.models import Q
from django.utils import timezone

from apps.core.exceptions import DomainError, ErrorCode
from apps.core.money import CENT, ZERO, money

from .models import Coupon, CouponKind, CouponRedemption, CouponScope, RedemptionStatus


@dataclass
class CouponResult:
    coupon: Coupon
    discount: Decimal = ZERO
    free_delivery: bool = False
    shares: dict[int, Decimal] = field(default_factory=dict)  # product_id -> discount allocated to that line
    description: str = ""


def _invalid(message: str, **details) -> DomainError:
    return DomainError(ErrorCode.INVALID_COUPON, message, details=details)


def find_coupon(code: str) -> Coupon | None:
    code = (code or "").strip()
    return Coupon.objects.filter(code__iexact=code).first() if code else None


def _prior_use_count(coupon: Coupon, user, email: str) -> int:
    q = Q()
    if user is not None and getattr(user, "is_authenticated", False):
        q |= Q(user=user)
    if email:
        q |= Q(email__iexact=email)
    if not q:
        return 0
    return CouponRedemption.objects.filter(coupon=coupon, status=RedemptionStatus.ACTIVE).filter(q).count()


def _has_prior_orders(user, email: str) -> bool:
    from apps.orders.models import Order, OrderStatus

    q = Q()
    if user is not None and getattr(user, "is_authenticated", False):
        q |= Q(customer=user)
    if email:
        q |= Q(contact_email__iexact=email)
    if not q:
        return False
    return Order.objects.filter(q).exclude(status__in=[OrderStatus.CANCELLED, OrderStatus.PAYMENT_FAILED]).exists()


def _eligible_lines(coupon: Coupon, lines):
    if coupon.scope == CouponScope.ALL:
        pool = list(lines)
    elif coupon.scope == CouponScope.PRODUCTS:
        ids = set(coupon.products.values_list("id", flat=True))
        pool = [ln for ln in lines if ln.product.id in ids]
    else:
        cat_ids = set(coupon.categories.values_list("id", flat=True))
        pool = [ln for ln in lines if ln.product.category_id in cat_ids or (ln.product.category.parent_id in cat_ids)]
    excluded = set(coupon.excluded_products.values_list("id", flat=True))
    pool = [ln for ln in pool if ln.product.id not in excluded]
    if coupon.exclude_discounted_items:
        pool = [ln for ln in pool if ln.promo is None]
    return pool


def _allocate(total: Decimal, weights: list[tuple[int, Decimal]]) -> dict[int, Decimal]:
    """Split `total` across lines pro-rata to cents so the shares sum to exactly `total` (largest remainder)."""
    weight_sum = sum((w for _, w in weights), ZERO)
    if total <= 0 or weight_sum <= 0:
        return {}
    raw = [(key, total * w / weight_sum) for key, w in weights]
    floors = [(key, r.quantize(CENT, rounding=ROUND_DOWN)) for key, r in raw]
    leftover = int(((total - sum((f for _, f in floors), ZERO)) / CENT).to_integral_value())
    order = sorted(range(len(raw)), key=lambda i: (raw[i][1] - floors[i][1]), reverse=True)
    shares = dict(floors)
    for i in order[:leftover]:
        shares[raw[i][0]] += CENT
    return {k: v for k, v in shares.items() if v > 0}


def evaluate_coupon(
    code: str, lines, *, user=None, email: str = "", fulfilment_type: str | None = None, now=None
) -> CouponResult:
    """Validate `code` against the priced basket and compute the discount. Raises DomainError(INVALID_COUPON)."""
    now = now or timezone.now()
    coupon = find_coupon(code)
    if coupon is None:
        raise _invalid("That code isn't valid. Check the spelling and try again.")
    if not coupon.is_active:
        raise _invalid("This code isn't active.")
    if coupon.starts_at > now:
        raise _invalid("This code isn't active yet.")
    if coupon.ends_at is not None and coupon.ends_at <= now:
        raise _invalid("This code has expired.")
    if coupon.usage_limit is not None and coupon.used_count >= coupon.usage_limit:
        raise _invalid("This code has been fully redeemed.")
    if coupon.per_customer_limit is not None and _prior_use_count(coupon, user, email) >= coupon.per_customer_limit:
        raise _invalid("You've already used this code.")
    if coupon.first_order_only and _has_prior_orders(user, email):
        raise _invalid("This code is for first orders only.")

    lines = list(lines)
    basket = sum((ln.line_total for ln in lines), ZERO)
    if basket < coupon.min_order_value:
        raise _invalid(
            f"Spend {money(coupon.min_order_value)} or more to use this code — you're {money(coupon.min_order_value - basket)} away.",
            shortfall=str(money(coupon.min_order_value - basket)),
        )

    if coupon.kind == CouponKind.FREE_DELIVERY:
        if fulfilment_type == "PICKUP":
            raise _invalid("Free delivery codes can't be used with store pickup.")
        return CouponResult(coupon, free_delivery=True, description="Free delivery")

    eligible = _eligible_lines(coupon, lines)
    base = sum((ln.line_total for ln in eligible), ZERO)
    if not eligible or base <= 0:
        raise _invalid("This code doesn't apply to the items in your basket.")
    if coupon.kind == CouponKind.PERCENT:
        discount = money(base * coupon.value / Decimal("100"))
        desc = f"{coupon.value.normalize():f}% off"
    else:
        discount = money(coupon.value)
        desc = f"{money(coupon.value)} off"
    if coupon.max_discount is not None:
        discount = min(discount, money(coupon.max_discount))
    discount = min(discount, base)  # a discount can never exceed what it applies to → totals can't go negative
    shares = _allocate(discount, [(ln.product.id, ln.line_total) for ln in eligible])
    return CouponResult(coupon, discount=discount, shares=shares, description=desc)


# ----------------------------------------------------------------------------------------- redemption
def redeem(result: CouponResult, order, user=None, email: str = "") -> CouponRedemption:
    """Count a redemption under a row lock so concurrent checkouts cannot exceed the usage limits."""
    if not connection.in_atomic_block:
        raise RuntimeError("redeem() must run inside transaction.atomic()")
    coupon = Coupon.objects.select_for_update().get(pk=result.coupon.pk)
    now = timezone.now()
    if not coupon.is_active or coupon.starts_at > now or (coupon.ends_at and coupon.ends_at <= now):
        raise _invalid("This code is no longer valid.")
    if coupon.usage_limit is not None and coupon.used_count >= coupon.usage_limit:
        raise _invalid("This code has just been fully redeemed.")
    if coupon.per_customer_limit is not None and _prior_use_count(coupon, user, email) >= coupon.per_customer_limit:
        raise _invalid("You've already used this code.")
    Coupon.objects.filter(pk=coupon.pk).update(used_count=coupon.used_count + 1)
    return CouponRedemption.objects.create(
        coupon=coupon,
        order=order,
        user=user if getattr(user, "is_authenticated", False) else None,
        email=email,
        amount=result.discount,
    )


def void_redemption(order) -> bool:
    """Give the use back when an order is cancelled / payment expires. Idempotent."""
    redemption = (
        CouponRedemption.objects.select_for_update().filter(order=order, status=RedemptionStatus.ACTIVE).first()
    )
    if redemption is None:
        return False
    with transaction.atomic():
        Coupon.objects.select_for_update().get(pk=redemption.coupon_id)
        redemption.status = RedemptionStatus.VOID
        redemption.save(update_fields=["status"])
        Coupon.objects.filter(pk=redemption.coupon_id, used_count__gt=0).update(used_count=models_f_minus_one())
    return True


def models_f_minus_one():
    from django.db.models import F

    return F("used_count") - 1
