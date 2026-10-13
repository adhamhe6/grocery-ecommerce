from __future__ import annotations

import logging
from decimal import Decimal

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.db.models import Prefetch, Q

from apps.catalog.models import Product, ProductImage, ProductStatus
from apps.catalog.serializers import ProductCardSerializer
from apps.core.exceptions import DomainError, ErrorCode
from apps.core.money import ZERO, money, qty_str
from apps.inventory.availability import annotate_availability, compute_availability
from apps.promotions.engine import load_index

from .models import Cart, CartItem, CartStatus
from .pricing import PricedLine, apply_coupon_to_lines, compute_totals, price_items, validate_quantity

logger = logging.getLogger(__name__)

CART_COOKIE = "gc_cart"
CART_COOKIE_MAX_AGE = 60 * 60 * 24 * 30
MAX_LINES = 100


# ----------------------------------------------------------------------------------------- cart lookup
def get_cart(request, create: bool = False) -> Cart | None:
    user = request.user if request.user and request.user.is_authenticated else None
    if user is not None:
        cart = Cart.objects.filter(user=user, status=CartStatus.ACTIVE).first()
        if cart is None and create:
            cart, _ = Cart.objects.get_or_create(user=user, status=CartStatus.ACTIVE)
        return cart
    token = request.COOKIES.get(CART_COOKIE)
    cart = None
    if token:
        try:
            cart = Cart.objects.filter(token=token, user__isnull=True, status=CartStatus.ACTIVE).first()
        except (ValueError, TypeError, DjangoValidationError):  # malformed token
            cart = None
    if cart is None and create:
        cart = Cart.objects.create()
    return cart


def attach_cookie(response, request, cart: Cart | None) -> None:
    """Guests identify their cart by an HttpOnly cookie; signed-in users don't need one."""
    if cart is not None and cart.user_id is None:
        response.set_cookie(
            CART_COOKIE,
            str(cart.token),
            max_age=CART_COOKIE_MAX_AGE,
            httponly=True,
            samesite="Lax",
            secure=request.is_secure(),
        )


# ----------------------------------------------------------------------------------------- mutations
def _purchasable_product(product_id) -> Product:
    product = (
        Product.objects.select_related("category__parent", "brand", "sale_unit", "net_content_unit")
        .filter(pk=product_id, status=ProductStatus.ACTIVE, is_available=True, category__is_active=True)
        .filter(Q(category__parent__isnull=True) | Q(category__parent__is_active=True))
        .first()
    )
    if product is None:
        raise DomainError(ErrorCode.PRODUCT_UNAVAILABLE, "This product is no longer available.", status_code=404)
    return product


def _availability(product: Product, branch_id: int | None):
    annotated = annotate_availability(Product.objects.filter(pk=product.pk), branch_id).get()
    return compute_availability(product, annotated.avail_qty, annotated.low_threshold)


def _current_unit_price(product: Product, quantity: Decimal) -> Decimal:
    line = price_items([(product, quantity)], load_index(use_cache=False))[0]
    return line.unit_price


def _check_can_hold(product: Product, total_qty: Decimal, branch_id: int | None) -> None:
    avail = _availability(product, branch_id)
    if not avail.can_order:
        raise DomainError(
            ErrorCode.PRODUCT_UNAVAILABLE, f"{product.name} is out of stock at the moment.", status_code=409
        )
    if avail.max_orderable is not None and total_qty > avail.max_orderable:
        raise DomainError(
            ErrorCode.INSUFFICIENT_STOCK,
            f"Only {avail.max_orderable.normalize():f} {product.sale_unit.symbol} of {product.name} available.",
            status_code=409,
            details={"max_orderable": qty_str(avail.max_orderable)},
        )


@transaction.atomic
def add_item(cart: Cart, product_id, quantity, branch_id: int | None) -> CartItem:
    cart = Cart.objects.select_for_update().get(pk=cart.pk)
    product = _purchasable_product(product_id)
    existing = CartItem.objects.filter(cart=cart, product=product).first()
    if existing is None and cart.items.count() >= MAX_LINES:
        raise DomainError(ErrorCode.VALIDATION_ERROR, f"A basket can hold up to {MAX_LINES} different products.")
    add_qty = validate_quantity_loose(product, quantity)
    total = (existing.quantity if existing else ZERO) + add_qty
    total = validate_quantity(product, total)
    _check_can_hold(product, total, branch_id)
    price = _current_unit_price(product, total)
    if existing:
        existing.quantity, existing.unit_price_seen = total, price
        existing.save(update_fields=["quantity", "unit_price_seen", "updated_at"])
        return existing
    return CartItem.objects.create(cart=cart, product=product, quantity=total, unit_price_seen=price)


def validate_quantity_loose(product: Product, quantity) -> Decimal:
    """The amount being *added* only has to be positive, step-aligned and well formed (the total gets the full check)."""
    from apps.core.money import is_multiple_of_step, qty

    try:
        raw = Decimal(str(quantity))
        if not raw.is_finite() or raw <= 0 or raw != qty(raw):
            raise ValueError
    except (ArithmeticError, ValueError, TypeError):
        raise DomainError(ErrorCode.INVALID_QUANTITY, "Enter a valid quantity greater than zero.") from None
    if not is_multiple_of_step(raw, Decimal("0"), product.qty_step):
        return validate_quantity(product, raw)  # raises the descriptive step error
    return raw


@transaction.atomic
def set_quantity(
    cart: Cart, product_id, quantity, branch_id: int | None, substitution_pref: str | None = None
) -> CartItem | None:
    cart = Cart.objects.select_for_update().get(pk=cart.pk)
    item = (
        CartItem.objects.select_for_update(of=("self",))
        .filter(cart=cart, product_id=product_id)
        .select_related("product__sale_unit", "product__category__parent")
        .first()
    )
    if item is None:
        raise DomainError(ErrorCode.NOT_FOUND, "That product isn't in your basket.", status_code=404)
    if quantity is not None:
        if Decimal(str(quantity)) == 0:
            item.delete()
            return None
        value = validate_quantity(item.product, quantity)
        if value > item.quantity:  # only growing the basket needs a stock check
            _check_can_hold(item.product, value, branch_id)
        item.quantity = value
        item.unit_price_seen = _current_unit_price(item.product, value)
    if substitution_pref is not None:
        item.substitution_pref = substitution_pref
    item.save()
    return item


@transaction.atomic
def remove_item(cart: Cart, product_id) -> None:
    CartItem.objects.filter(cart=cart, product_id=product_id).delete()


@transaction.atomic
def clear(cart: Cart) -> None:
    cart.items.all().delete()
    cart.coupon_code = ""
    cart.notices = []
    cart.save(update_fields=["coupon_code", "notices", "updated_at"])


@transaction.atomic
def merge_into_user_cart(guest: Cart, user) -> Cart:
    """Move a guest basket into the user's basket on login. Quantities add up but never exceed the product's limits."""
    target, _ = Cart.objects.select_for_update().get_or_create(user=user, status=CartStatus.ACTIVE)
    for item in guest.items.select_related("product__sale_unit", "product__category__parent"):
        product = item.product
        if not product.is_purchasable:
            continue
        existing = CartItem.objects.filter(cart=target, product=product).first()
        total = item.quantity + (existing.quantity if existing else ZERO)
        if product.qty_max is not None:
            total = min(total, product.qty_max)
        try:
            total = validate_quantity(product, total)
        except DomainError:
            total = item.quantity if existing is None else existing.quantity
        if existing:
            existing.quantity = total
            existing.save(update_fields=["quantity", "updated_at"])
        else:
            CartItem.objects.create(cart=target, product=product, quantity=total, unit_price_seen=item.unit_price_seen)
    if guest.coupon_code and not target.coupon_code:
        target.coupon_code = guest.coupon_code
        target.save(update_fields=["coupon_code", "updated_at"])
    guest.status = CartStatus.MERGED
    guest.save(update_fields=["status", "updated_at"])
    return target


# ----------------------------------------------------------------------------------------- read model
def resolve_branch_id(cart: Cart | None, requested: int | None = None) -> int | None:
    from apps.catalog.views import default_branch_id

    return requested or (cart.branch_id if cart and cart.branch_id else None) or default_branch_id()


def load_lines(cart: Cart, branch_id: int | None, index=None):
    """Returns (items, products_by_id, priced lines). Products come annotated with live availability."""
    items = list(cart.items.all())
    ids = [i.product_id for i in items]
    products = {
        p.id: p
        for p in annotate_availability(Product.objects.filter(pk__in=ids), branch_id)
        .select_related("brand", "category__parent", "sale_unit", "net_content_unit")
        .prefetch_related(Prefetch("images", queryset=ProductImage.objects.order_by("sort_order", "id")))
    }
    index = index or load_index(use_cache=False)
    priced = []
    for item in items:
        product = products.get(item.product_id)
        if product is None:
            continue
        line = price_items([(product, item.quantity, item.substitution_pref)], index)[0]
        line.availability = compute_availability(
            product, getattr(product, "avail_qty", None), getattr(product, "low_threshold", ZERO)
        )
        line.issues = detect_issues(item, product, line)
        priced.append((item, line))
    return priced, index


def detect_issues(item: CartItem, product: Product, line: PricedLine) -> list[dict]:
    issues = []
    avail = line.availability
    if not product.is_purchasable or not product.category_is_live:
        issues.append({"code": "UNAVAILABLE", "blocking": True, "message": "No longer available."})
    elif avail.status == "OUT_OF_STOCK":
        issues.append({"code": "OUT_OF_STOCK", "blocking": True, "message": "Out of stock at your store."})
    elif avail.max_orderable is not None and item.quantity > avail.max_orderable:
        issues.append(
            {
                "code": "REDUCED_AVAILABILITY",
                "blocking": True,
                "max_orderable": qty_str(avail.max_orderable),
                "message": f"Only {avail.max_orderable.normalize():f} {product.sale_unit.symbol} available.",
            }
        )
    else:
        try:
            validate_quantity(product, item.quantity)
        except DomainError as exc:
            issues.append({"code": "INVALID_QUANTITY", "blocking": True, "message": exc.message})
    if item.unit_price_seen is not None and money(item.unit_price_seen) != money(line.unit_price):
        issues.append(
            {
                "code": "PRICE_CHANGED",
                "blocking": False,
                "from": str(money(item.unit_price_seen)),
                "to": str(money(line.unit_price)),
                "message": f"Price changed from {money(item.unit_price_seen)} to {money(line.unit_price)}.",
            }
        )
    return issues


def build_cart_payload(cart: Cart | None, request, branch_id: int | None = None) -> dict:
    if cart is None:
        return empty_payload()
    branch_id = resolve_branch_id(cart, branch_id)
    priced, index = load_lines(cart, branch_id)
    lines = [ln for _, ln in priced]
    user = request.user if request.user.is_authenticated else None
    coupon_info, result = None, None
    if cart.coupon_code:
        try:
            result = apply_coupon_to_lines(cart.coupon_code, lines, user=user, email=getattr(user, "email", ""))
            coupon_info = {
                "code": result.coupon.code,
                "valid": True,
                "description": result.description,
                "discount": str(result.discount),
                "free_delivery": result.free_delivery,
            }
        except DomainError as exc:
            coupon_info = {"code": cart.coupon_code, "valid": False, "message": exc.message}
    totals = compute_totals(lines, result)
    ctx = {"promo_index": index, "branch_id": branch_id}
    card = ProductCardSerializer
    return {
        "item_count": len(lines),
        "substitution_policy": cart.substitution_policy,
        "branch_id": branch_id,
        "lines": [
            {
                "product": card(ln.product, context=ctx).data,
                "quantity": str(
                    ln.quantity.normalize()
                    if ln.quantity != ln.quantity.to_integral_value()
                    else ln.quantity.to_integral_value()
                ),
                "unit_price": str(ln.unit_price),
                "base_unit_price": str(ln.base_unit_price),
                "line_total": str(ln.line_total),
                "promotion": {"label": ln.promo.label, "kind": ln.promo.kind, "savings": str(ln.promo.savings)}
                if ln.promo
                else None,
                "substitution_pref": item.substitution_pref,
                "is_estimate": ln.product.is_variable_weight,
                "issues": ln.issues,
            }
            for item, ln in priced
        ],
        "coupon": coupon_info,
        "totals": {
            "subtotal": str(totals.subtotal),
            "promo_savings": str(totals.promo_savings),
            "coupon_discount": str(totals.coupon_discount),
            "estimated_total": str(money(totals.subtotal - totals.coupon_discount)),
            "has_estimated_lines": any(ln.product.is_variable_weight for ln in lines),
        },
        "notices": cart.notices or [],
        "can_checkout": bool(lines) and not any(ln.blocking for ln in lines),
    }


def empty_payload() -> dict:
    return {
        "item_count": 0,
        "substitution_policy": "ALLOW",
        "branch_id": None,
        "lines": [],
        "coupon": None,
        "totals": {
            "subtotal": "0.00",
            "promo_savings": "0.00",
            "coupon_discount": "0.00",
            "estimated_total": "0.00",
            "has_estimated_lines": False,
        },
        "notices": [],
        "can_checkout": False,
    }


@transaction.atomic
def acknowledge_prices(cart: Cart, branch_id: int | None) -> None:
    priced, _ = load_lines(cart, resolve_branch_id(cart, branch_id))
    for item, line in priced:
        if item.unit_price_seen is None or money(item.unit_price_seen) != money(line.unit_price):
            CartItem.objects.filter(pk=item.pk).update(unit_price_seen=line.unit_price)
    Cart.objects.filter(pk=cart.pk).update(notices=[])


@transaction.atomic
def fix_blocking_issues(cart: Cart, branch_id: int | None) -> list[str]:
    """Customer-initiated: drop unavailable lines and trim quantities to what we can supply. Returns what changed."""
    branch_id = resolve_branch_id(cart, branch_id)
    priced, _ = load_lines(cart, branch_id)
    changes: list[str] = []
    for item, line in priced:
        blocking = next((i for i in line.issues if i.get("blocking")), None)
        if blocking is None:
            continue
        name = line.product.name
        if blocking["code"] in ("UNAVAILABLE", "OUT_OF_STOCK"):
            item.delete()
            changes.append(f"Removed {name}: {blocking['message'].rstrip('.').lower()}.")
        elif blocking["code"] == "REDUCED_AVAILABILITY":
            new_qty = Decimal(blocking["max_orderable"])
            if new_qty >= line.product.qty_min:
                old = item.quantity
                item.quantity = new_qty
                item.save(update_fields=["quantity", "updated_at"])
                changes.append(
                    f"Reduced {name} from {old.normalize():f} to {new_qty.normalize():f} {line.product.sale_unit.symbol} (all we have available)."
                )
            else:
                item.delete()
                changes.append(f"Removed {name}: not enough in stock.")
        else:
            item.delete()
            changes.append(f"Removed {name}: its ordering rules changed, please add it again.")
    cart.notices = changes
    cart.save(update_fields=["notices", "updated_at"])
    return changes


@transaction.atomic
def reorder(cart: Cart, order, branch_id: int | None) -> dict:
    """Add a past order's items at today's prices/availability. Reports what was added, adjusted or skipped — never assumes."""
    added, adjusted, skipped = [], [], []  # a line is in exactly one list: added as ordered, added reduced, or skipped
    for old in order.items.filter(substitute_for__isnull=True).select_related("product"):
        product = old.product
        wanted = old.ordered_qty
        try:
            product = _purchasable_product(product.pk)
            wanted = min(wanted, product.qty_max) if product.qty_max else wanted
            avail = _availability(product, branch_id)
            if not avail.can_order:
                skipped.append({"name": old.name, "reason": "Out of stock right now"})
                continue
            reduced = avail.max_orderable is not None and wanted > avail.max_orderable
            if reduced:
                adjusted.append(
                    {
                        "name": old.name,
                        "requested": str(old.ordered_qty),
                        "added": str(avail.max_orderable),
                        "reason": "Limited stock",
                    }
                )
                wanted = avail.max_orderable
            existing = CartItem.objects.filter(cart=cart, product=product).first()
            total = validate_quantity(product, (existing.quantity if existing else ZERO) + wanted)
            if existing:
                existing.quantity = total
                existing.save(update_fields=["quantity", "updated_at"])
            else:
                CartItem.objects.create(
                    cart=cart, product=product, quantity=total, unit_price_seen=_current_unit_price(product, total)
                )
            if not reduced:
                added.append({"name": old.name, "quantity": str(wanted)})
        except DomainError as exc:
            skipped.append({"name": old.name, "reason": exc.message})
    return {"added": added, "adjusted": adjusted, "skipped": skipped}
