"""Automatic promotions and coupons (dates are relative to today so the demo never goes stale)."""

from __future__ import annotations

from decimal import Decimal

from apps.catalog.models import Category, Product
from apps.promotions.models import Coupon, CouponKind, CouponScope, Promotion, PromotionKind, PromotionScope

from .common import Tally, midnight
from .ops_data import COUPONS, PROMOTIONS


def seed_promotions(products: dict[str, Product], cats: dict[str, Category], tally: Tally) -> None:
    for spec in PROMOTIONS:
        promo = Promotion.objects.filter(name=spec["name"]).first()
        if promo is not None and not promo.is_demo:
            tally.skip("Promotion", f"{spec['name']!r} exists and is not demo data; left unchanged")
            continue
        created = promo is None
        promo = promo or Promotion(name=spec["name"])
        promo.label, promo.kind, promo.scope = spec["label"], PromotionKind(spec["kind"]), PromotionScope(spec["scope"])
        promo.percent = Decimal(spec["percent"]) if "percent" in spec else None
        promo.amount_off = Decimal(spec["amount_off"]) if "amount_off" in spec else None
        promo.multibuy_qty = spec.get("multibuy_qty")
        promo.multibuy_price = Decimal(spec["multibuy_price"]) if "multibuy_price" in spec else None
        promo.starts_at, promo.ends_at = midnight(spec["starts"]), midnight(spec["ends"])
        promo.is_active, promo.is_demo = spec["active"], True
        promo.save()
        promo.products.set([products[n] for n in spec.get("products", []) if n in products])
        promo.categories.set([cats[s] for s in spec.get("categories", []) if s in cats])
        tally.add("Promotion", created)


def seed_coupons(cats: dict[str, Category], tally: Tally) -> None:
    for spec in COUPONS:
        coupon = Coupon.objects.filter(code__iexact=spec["code"]).first()
        if coupon is not None and not coupon.is_demo:
            tally.skip("Coupon", f"{spec['code']} exists and is not demo data; left unchanged")
            continue
        created = coupon is None
        coupon = coupon or Coupon(code=spec["code"], used_count=spec.get("used_count", 0))
        coupon.description, coupon.kind = spec["description"], CouponKind(spec["kind"])
        coupon.value = Decimal(spec["value"])
        coupon.max_discount = Decimal(spec["max_discount"]) if "max_discount" in spec else None
        coupon.min_order_value = Decimal(spec["min_order_value"])
        coupon.first_order_only = spec.get("first_order_only", False)
        coupon.per_customer_limit = spec.get("per_customer_limit", 1)
        coupon.usage_limit = spec.get("usage_limit")
        coupon.scope = CouponScope(spec.get("scope", "ALL"))
        coupon.starts_at = midnight(spec["starts"])
        coupon.ends_at = midnight(spec["ends"]) if spec["ends"] is not None else None
        coupon.is_demo = True
        if created:
            coupon.is_active = True
        coupon.save()
        coupon.categories.set([cats[s] for s in spec.get("categories", []) if s in cats])
        tally.add("Coupon", created)
