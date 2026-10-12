"""Checkout: quote and place an order.

`prepare()` is shared by `quote()` (read-only) and `place_order()` (side effects) so what the customer is shown is
computed by exactly the code that later charges them. Nothing the browser sends is trusted for prices or totals —
`expected_total` is only compared against the server's number to detect a stale basket (409 CART_CHANGED).
"""

from __future__ import annotations

import datetime as dt
import logging
from dataclasses import dataclass, field
from decimal import Decimal

from django.conf import settings as dj_settings
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.accounts.models import Address
from apps.cart import pricing
from apps.cart.models import Cart, CartItem, CartStatus
from apps.catalog.models import Product, ProductImage
from apps.core.exceptions import DomainError, ErrorCode
from apps.core.models import IdempotencyRecord, StoreSettings
from apps.core.money import ZERO, money
from apps.inventory import services as inventory
from apps.inventory.availability import annotate_availability, compute_availability
from apps.payments import services as payments
from apps.promotions import coupons
from apps.promotions.coupons import CouponResult
from apps.promotions.engine import load_index
from apps.stores.models import Branch, DeliverySlot, DeliveryZone, SlotKind
from apps.stores.services import book_slot, earliest_bookable, require_zone, slot_start

from .models import FulfilmentType, Order, OrderItem, OrderStatus, OrderStatusHistory, PaymentMethod

logger = logging.getLogger(__name__)

IDEMPOTENCY_SCOPE = "checkout"


@dataclass
class CheckoutInput:
    fulfilment_type: str
    slot_id: int
    payment_method: str
    branch_id: int | None = None
    address_id: int | None = None
    address: dict | None = None
    contact: dict = field(default_factory=dict)
    substitution_policy: str | None = None
    customer_note: str = ""
    expected_total: Decimal | None = None
    save_address: bool = False

    def fingerprint(self) -> dict:
        return {
            "f": self.fulfilment_type,
            "slot": self.slot_id,
            "pm": self.payment_method,
            "b": self.branch_id,
            "a": self.address_id,
            "addr": self.address,
            "contact": self.contact,
            "sub": self.substitution_policy,
            "note": self.customer_note,
            "exp": str(self.expected_total) if self.expected_total is not None else None,
        }


@dataclass
class Prepared:
    cart: Cart
    items: list[CartItem]
    branch: Branch
    zone: DeliveryZone | None
    slot: DeliverySlot
    lines: list
    coupon: CouponResult | None
    totals: pricing.Totals
    contact: dict
    ship: dict
    settings: StoreSettings
    min_order: Decimal


# ----------------------------------------------------------------------------------------- preparation
def _resolve_contact(user, data: CheckoutInput, store: StoreSettings, fallback_phone: str = "") -> dict:
    contact = dict(data.contact or {})
    if user is not None:
        contact.setdefault("name", user.full_name)
        contact.setdefault("email", user.email)
        contact.setdefault("phone", user.phone or fallback_phone)
    elif not store.allow_guest_checkout:
        raise DomainError(
            "GUEST_CHECKOUT_DISABLED", "Please sign in or create an account to place an order.", status_code=403
        )
    missing = [k for k in ("name", "email", "phone") if not str(contact.get(k, "")).strip()]
    if missing:
        raise DomainError(
            ErrorCode.VALIDATION_ERROR,
            "We need your name, email and phone number to confirm the order.",
            details={f"contact.{k}": ["This field is required."] for k in missing},
        )
    contact["email"] = contact["email"].strip().lower()
    return contact


def _resolve_destination(user, data: CheckoutInput):
    """Returns (branch, zone, ship_snapshot). Validates serviceability for delivery."""
    if data.fulfilment_type == FulfilmentType.PICKUP:
        branch = Branch.objects.filter(pk=data.branch_id, is_active=True, offers_pickup=True).first()
        if branch is None:
            raise DomainError(
                ErrorCode.VALIDATION_ERROR,
                "Choose a store to collect from.",
                details={"branch_id": ["Choose a pickup store."]},
            )
        return branch, None, {}
    addr: dict
    if data.address_id:
        if user is None:
            raise DomainError(ErrorCode.VALIDATION_ERROR, "Sign in to use a saved address.")
        saved = Address.objects.filter(pk=data.address_id, user=user).first()  # ownership enforced by the query
        if saved is None:
            raise DomainError(ErrorCode.NOT_FOUND, "We couldn't find that address.", status_code=404)
        addr = {
            k: getattr(saved, k)
            for k in ("recipient_name", "phone", "line1", "line2", "city", "area", "postal_code", "instructions")
        }
    elif data.address:
        addr = data.address
    else:
        raise DomainError(
            ErrorCode.VALIDATION_ERROR, "Choose a delivery address.", details={"address": ["Required for delivery."]}
        )
    zone = require_zone(postal_code=addr.get("postal_code", ""), area=addr.get("area", ""))
    ship = {
        "ship_recipient": addr["recipient_name"],
        "ship_phone": addr["phone"],
        "ship_line1": addr["line1"],
        "ship_line2": addr.get("line2", ""),
        "ship_city": addr["city"],
        "ship_area": addr.get("area", ""),
        "ship_postal_code": addr.get("postal_code", ""),
        "ship_instructions": addr.get("instructions", ""),
    }
    return zone.branch, zone, ship


def _check_slot(
    slot_id: int, data: CheckoutInput, branch: Branch, zone: DeliveryZone | None, now: dt.datetime
) -> DeliverySlot:
    kind = SlotKind.DELIVERY if data.fulfilment_type == FulfilmentType.DELIVERY else SlotKind.PICKUP
    slot = DeliverySlot.objects.select_related("branch", "zone").filter(pk=slot_id).first()
    if (
        slot is None
        or slot.kind != kind
        or slot.branch_id != branch.id
        or (kind == SlotKind.DELIVERY and slot.zone_id != zone.id)
    ):
        raise DomainError(
            ErrorCode.DELIVERY_SLOT_UNAVAILABLE,
            "Please choose a time slot that matches your delivery or pickup choice.",
            status_code=409,
        )
    if not slot.is_open or slot.remaining <= 0:
        raise DomainError(
            ErrorCode.DELIVERY_SLOT_UNAVAILABLE, "That time slot is full. Please choose another.", status_code=409
        )
    if slot_start(slot) < earliest_bookable(branch, now):
        raise DomainError(
            ErrorCode.DELIVERY_SLOT_UNAVAILABLE,
            "That time slot is too soon for us to prepare your order. Please choose a later one.",
            status_code=409,
        )
    return slot


def prepare(cart: Cart, user, data: CheckoutInput, *, lock: bool = False) -> Prepared:
    store = StoreSettings.load()
    now = timezone.now()
    items = list(
        cart.items.select_related(
            "product__sale_unit", "product__category__parent", "product__brand", "product__net_content_unit"
        )
    )
    if not items:
        raise DomainError(ErrorCode.CART_EMPTY, "Your basket is empty.", status_code=409)
    branch, zone, ship = _resolve_destination(user, data)
    contact = _resolve_contact(user, data, store, ship.get("ship_phone", ""))
    slot = _check_slot(data.slot_id, data, branch, zone, now)

    if data.payment_method == PaymentMethod.CARD:
        if not (store.card_payments_enabled and payments.card_provider_name()):
            raise DomainError(
                ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE,
                "Card payments aren't available right now. Please choose another payment method.",
                status_code=503,
            )
    elif data.payment_method == PaymentMethod.COD:
        if not store.cash_on_delivery_enabled:
            raise DomainError(
                ErrorCode.VALIDATION_ERROR, "Pay-on-delivery isn't available. Please choose card payment."
            )
    else:
        raise DomainError(ErrorCode.VALIDATION_ERROR, "Choose a payment method.")

    # Re-validate every line against live product, quantity-rule and availability data.
    live = {
        p.id: p
        for p in annotate_availability(
            Product.objects.filter(pk__in=[i.product_id for i in items]), branch.id
        ).select_related("sale_unit", "category__parent", "brand", "net_content_unit")
    }
    problems = []
    entries = []
    for item in items:
        product = live.get(item.product_id)
        if product is None or not product.is_purchasable or not product.category.is_active:
            problems.append(
                {
                    "product_id": item.product_id,
                    "code": ErrorCode.PRODUCT_UNAVAILABLE,
                    "name": getattr(product, "name", "An item"),
                    "message": "No longer available",
                }
            )
            continue
        try:
            quantity = pricing.validate_quantity(product, item.quantity)
        except DomainError as exc:
            problems.append({"product_id": product.id, "code": exc.code, "name": product.name, "message": exc.message})
            continue
        avail = compute_availability(product, product.avail_qty, product.low_threshold)
        if not avail.can_order or (avail.max_orderable is not None and quantity > avail.max_orderable):
            problems.append(
                {
                    "product_id": product.id,
                    "code": ErrorCode.INSUFFICIENT_STOCK,
                    "name": product.name,
                    "message": "Not enough stock at this store",
                    "available": str(avail.available_qty),
                }
            )
            continue
        entries.append((product, quantity, item.substitution_pref))
    if problems:
        raise DomainError(
            ErrorCode.CART_CHANGED,
            "Some items in your basket have changed. Please review your basket.",
            status_code=409,
            details={"items": problems},
        )

    lines = pricing.price_items(entries, load_index(use_cache=False))
    user_obj = user if user is not None else None
    coupon_result = None
    if cart.coupon_code:
        coupon_result = pricing.apply_coupon_to_lines(
            cart.coupon_code, lines, user=user_obj, email=contact["email"], fulfilment_type=data.fulfilment_type
        )
    delivery_fee = slot.fee
    totals = pricing.compute_totals(
        lines,
        coupon_result,
        delivery_fee=delivery_fee,
        free_delivery_threshold=zone.free_delivery_threshold if zone else None,
        settings=store,
    )
    min_order = max(store.min_order_value, zone.min_order_value if zone else ZERO)
    if totals.subtotal < min_order:
        raise DomainError(
            ErrorCode.MIN_ORDER_NOT_MET,
            f"The minimum order for this delivery area is {money(min_order)}. Add {money(min_order - totals.subtotal)} more to continue.",
            status_code=409,
            details={"minimum": str(money(min_order)), "shortfall": str(money(min_order - totals.subtotal))},
        )
    if data.expected_total is not None and money(data.expected_total) != totals.total:
        raise DomainError(
            ErrorCode.CART_CHANGED,
            "The total for your order has changed. Please review it before confirming.",
            status_code=409,
            details={
                "expected_total": str(money(data.expected_total)),
                "current_total": str(totals.total),
                "quote": quote_payload(lines, coupon_result, totals, slot, store),
            },
        )
    return Prepared(cart, items, branch, zone, slot, lines, coupon_result, totals, contact, ship, store, min_order)


def quote_payload(
    lines, coupon: CouponResult | None, totals: pricing.Totals, slot: DeliverySlot, store: StoreSettings
) -> dict:
    return {
        "currency": store.currency,
        "lines": [
            {
                "product_id": ln.product.id,
                "name": ln.product.name,
                "quantity": str(ln.quantity),
                "unit": ln.product.sale_unit.symbol,
                "unit_price": str(ln.unit_price),
                "line_total": str(ln.line_total),
                "is_estimate": ln.product.is_variable_weight,
                "promotion": ln.promo.label if ln.promo else None,
            }
            for ln in lines
        ],
        "subtotal": str(totals.subtotal),
        "promo_savings": str(totals.promo_savings),
        "coupon": {
            "code": coupon.coupon.code,
            "discount": str(totals.coupon_discount),
            "description": coupon.description,
        }
        if coupon
        else None,
        "delivery_fee": str(totals.delivery_fee),
        "delivery_fee_before_free": str(totals.delivery_fee_before_free),
        "free_delivery": totals.free_delivery,
        "tax_included": str(totals.tax_total) if store.prices_include_tax else None,
        "tax_added": None if store.prices_include_tax else str(totals.tax_total),
        "total": str(totals.total),
        "max_charge": str(totals.authorized_amount),
        "weight_buffer": str(totals.variable_weight_buffer),
        "has_weighed_items": any(ln.product.is_variable_weight for ln in lines),
        "slot": {
            "id": slot.id,
            "date": slot.date.isoformat(),
            "start": slot.start_time.strftime("%H:%M"),
            "end": slot.end_time.strftime("%H:%M"),
            "kind": slot.kind,
        },
        "weight_policy": {"tolerance_percent": str(store.weight_tolerance_percent)},
    }


def quote(cart: Cart, user, data: CheckoutInput) -> dict:
    p = prepare(cart, user, data)
    return quote_payload(p.lines, p.coupon, p.totals, p.slot, p.settings)


# ----------------------------------------------------------------------------------------- placing
@dataclass
class Placed:
    order: Order
    payment: object | None
    replayed: bool = False


def _create_order(p: Prepared, user, data: CheckoutInput, key: str) -> tuple[Order, list[OrderItem]]:
    now = timezone.now()
    is_card = data.payment_method == PaymentMethod.CARD
    slot = p.slot
    tz = slot_start(slot).tzinfo
    order = None
    for _ in range(5):  # order numbers are random; retry on the (very unlikely) collision
        try:
            with transaction.atomic():
                order = Order.objects.create(
                    customer=user,
                    contact_name=p.contact["name"],
                    contact_email=p.contact["email"],
                    contact_phone=p.contact["phone"],
                    branch=p.branch,
                    fulfilment_type=data.fulfilment_type,
                    slot=slot,
                    zone=p.zone,
                    slot_starts_at=slot_start(slot),
                    slot_ends_at=dt.datetime.combine(slot.date, slot.end_time, tzinfo=tz),
                    substitution_policy=data.substitution_policy or p.cart.substitution_policy,
                    customer_note=data.customer_note[:500],
                    currency=p.settings.currency,
                    subtotal=p.totals.subtotal,
                    promo_savings=p.totals.promo_savings,
                    coupon_code=p.coupon.coupon.code if p.coupon else "",
                    coupon_discount=p.totals.coupon_discount,
                    delivery_fee=p.totals.delivery_fee,
                    tax_total=p.totals.tax_total,
                    total=p.totals.total,
                    authorized_amount=p.totals.authorized_amount,
                    status=OrderStatus.PENDING_PAYMENT if is_card else OrderStatus.CONFIRMED,
                    payment_method=data.payment_method,
                    checkout_key=key,
                    placed_at=now,
                    confirmed_at=None if is_card else now,
                    reservation_expires_at=now + dt.timedelta(minutes=dj_settings.RESERVATION_TTL_MINUTES)
                    if is_card
                    else None,
                    **p.ship,
                )
            break
        except IntegrityError as exc:
            if "number" not in str(exc):
                raise
    if order is None:
        raise DomainError(
            ErrorCode.INTERNAL_ERROR, "Could not allocate an order number. Please try again.", status_code=500
        )

    first_images = {
        img.product_id: img.image.name
        for img in ProductImage.objects.filter(product_id__in=[ln.product.id for ln in p.lines])
        .order_by("product_id", "sort_order", "id")
        .distinct("product_id")
    }
    rows = []
    for ln in p.lines:
        rows.append(
            OrderItem(
                order=order,
                product=ln.product,
                name=ln.product.name,
                sku=ln.product.sku,
                image_path=first_images.get(ln.product.id, ""),
                unit_symbol=ln.product.sale_unit.symbol,
                unit_name=ln.product.sale_unit.name,
                is_variable_weight=ln.product.is_variable_weight,
                tax_rate=ln.product.tax_rate,
                base_unit_price=ln.base_unit_price,
                unit_price=ln.unit_price,
                promo_label=ln.promo.label if ln.promo else "",
                promo_kind=ln.promo.kind if ln.promo else "",
                promo_params=ln.promo.params if ln.promo else None,
                ordered_qty=ln.quantity,
                line_total_estimated=ln.line_total,
                coupon_share=ln.coupon_share,
                substitution_pref=ln.substitution_pref,
            )
        )
    return order, OrderItem.objects.bulk_create(rows)


def place_order(*, cart: Cart | None, user, data: CheckoutInput, idempotency_key: str, actor_key: str) -> Placed:
    with transaction.atomic():
        record, created = IdempotencyRecord.claim(IDEMPOTENCY_SCOPE, actor_key, idempotency_key, data.fingerprint())
        if not created:
            if record.request_hash != IdempotencyRecord.hash_payload(data.fingerprint()):
                raise DomainError(
                    ErrorCode.IDEMPOTENCY_CONFLICT,
                    "This request key was already used with different details. Please refresh and try again.",
                    status_code=422,
                )
            order = Order.objects.select_related("branch").get(number=record.resource_id)
            payment = order.payments.order_by("-created_at").first()
            return Placed(order, payment, replayed=True)
        if cart is None:
            raise DomainError(ErrorCode.CART_EMPTY, "Your basket is empty.", status_code=409)
        cart = Cart.objects.select_for_update().get(pk=cart.pk)
        if cart.status != CartStatus.ACTIVE:
            raise DomainError(ErrorCode.CART_EMPTY, "Your basket is empty.", status_code=409)

        p = prepare(cart, user, data)
        order, items = _create_order(p, user, data, idempotency_key)

        reserve_requests = [
            inventory.ReserveRequest(item, ln.product, ln.quantity) for item, ln in zip(items, p.lines, strict=True)
        ]
        inventory.reserve(reserve_requests, p.branch.id, p.slot.date)
        book_slot(p.slot.id, kind=p.slot.kind, branch_id=p.branch.id, zone_id=p.slot.zone_id)
        if p.coupon:
            coupons.redeem(p.coupon, order, user, p.contact["email"])
        payment = payments.create_payment_attempt(order, data.payment_method)

        OrderStatusHistory.objects.create(
            order=order,
            from_status="",
            to_status=order.status,
            actor=user,
            actor_label=getattr(user, "email", "guest"),
            public_note="Order placed",
        )
        if order.status == OrderStatus.CONFIRMED:
            OrderStatusHistory.objects.create(
                order=order,
                from_status=OrderStatus.PENDING_PAYMENT,
                to_status=OrderStatus.CONFIRMED,
                actor_label="system",
                public_note="Order confirmed — you'll pay on delivery/pickup",
            )
        if user is not None and data.save_address and data.address and not data.address_id:
            Address.objects.get_or_create(
                user=user,
                line1=data.address["line1"],
                postal_code=data.address.get("postal_code", ""),
                defaults={
                    k: data.address.get(k, "")
                    for k in ("recipient_name", "phone", "line2", "city", "area", "instructions")
                },
            )
        Cart.objects.filter(pk=cart.pk).update(status=CartStatus.CONVERTED)
        record.resource_type, record.resource_id = "order", order.number
        record.save(update_fields=["resource_type", "resource_id"])

        from apps.notifications.services import notify_order

        notify_order(order, "ORDER_PLACED" if order.status == OrderStatus.PENDING_PAYMENT else "ORDER_CONFIRMED_COD")
        logger.info(
            "order_placed",
            extra={
                "order": order.number,
                "total": str(order.total),
                "method": data.payment_method,
                "lines": len(items),
            },
        )
    return Placed(order, payment)
