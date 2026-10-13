from __future__ import annotations

import datetime as dt
from decimal import Decimal

from django.utils import timezone
from rest_framework import serializers

from apps.core.money import money, qty_str
from apps.inventory.availability import compute_availability
from apps.promotions.engine import PromotionIndex, display_promo

from .models import AllergenLevel, Review
from .pricing_info import pack_label, unit_price_for


def _q(value: Decimal | None) -> str | None:
    return qty_str(value)


class ProductCardSerializer(serializers.Serializer):
    """Compact product representation for lists/cards. Context: `promo_index`, optional `branch_id`."""

    id = serializers.IntegerField()
    sku = serializers.CharField()
    slug = serializers.CharField()
    name = serializers.CharField()
    short_description = serializers.CharField()
    brand = serializers.SerializerMethodField()
    category = serializers.SerializerMethodField()
    image = serializers.SerializerMethodField()
    price = serializers.SerializerMethodField()
    base_price = serializers.SerializerMethodField()
    promotion = serializers.SerializerMethodField()
    sale_unit = serializers.SerializerMethodField()
    pack_label = serializers.SerializerMethodField()
    unit_price = serializers.SerializerMethodField()
    quantity = serializers.SerializerMethodField()
    is_variable_weight = serializers.BooleanField()
    product_type = serializers.CharField()
    storage_type = serializers.CharField()
    availability = serializers.SerializerMethodField()
    badges = serializers.SerializerMethodField()
    rating = serializers.SerializerMethodField()

    # -- helpers ---------------------------------------------------------------
    def _promo(self, obj):
        cache = self.context.setdefault("_promo_cache", {})
        if obj.pk not in cache:
            index: PromotionIndex | None = self.context.get("promo_index")
            cache[obj.pk] = display_promo(index, obj) if index else None
        return cache[obj.pk]

    def get_brand(self, obj):
        return {"name": obj.brand.name, "slug": obj.brand.slug} if obj.brand_id else None

    def get_category(self, obj):
        c = obj.category
        return {"id": c.id, "name": c.name, "slug": c.slug, "parent_slug": c.parent.slug if c.parent_id else None}

    def get_image(self, obj):
        images = list(obj.images.all())
        if not images:
            return None
        first = images[0]
        return {"alt": first.alt_text, "urls": first.urls()}

    def get_price(self, obj):
        promo = self._promo(obj)
        # Multibuy leaves the shelf price unchanged at qty 1; show the real per-unit price.
        if promo and promo.kind != "MULTIBUY":
            return str(promo.unit_price)
        return str(obj.price)

    def get_base_price(self, obj):
        return str(obj.price)

    def get_promotion(self, obj):
        promo = self._promo(obj)
        if not promo:
            return None
        return {"id": promo.promo_id, "label": promo.label, "kind": promo.kind, "params": promo.params}

    def get_sale_unit(self, obj):
        u = obj.sale_unit
        return {"code": u.code, "symbol": u.symbol, "name": u.name, "kind": u.kind}

    def get_pack_label(self, obj):
        return pack_label(obj)

    def get_unit_price(self, obj):
        promo = self._promo(obj)
        price = promo.unit_price if promo and promo.kind != "MULTIBUY" else None
        up = unit_price_for(obj, price)
        return {"amount": str(up["amount"]), "per": up["per"]} if up else None

    def get_quantity(self, obj):
        return {"min": _q(obj.qty_min), "step": _q(obj.qty_step), "max": _q(obj.qty_max)}

    def get_availability(self, obj):
        if hasattr(obj, "avail_qty"):
            avail = compute_availability(obj, obj.avail_qty, getattr(obj, "low_threshold", Decimal("0")))
        else:
            avail = compute_availability(obj, Decimal("0"), Decimal("0"))
        return {"status": avail.status, "max_orderable": _q(avail.max_orderable), "can_order": avail.can_order}

    def get_badges(self, obj):
        badges = []
        if obj.created_at >= timezone.now() - dt.timedelta(days=30):
            badges.append("NEW")
        if self._promo(obj):
            badges.append("OFFER")
        if obj.is_variable_weight:
            badges.append("PRICED_BY_WEIGHT")
        if obj.storage_type == "FROZEN":
            badges.append("FROZEN")
        elif obj.storage_type == "CHILLED":
            badges.append("CHILLED")
        return badges

    def get_rating(self, obj):
        if not obj.rating_count:
            return None
        return {
            "avg": str(obj.rating_avg),
            "count": obj.rating_count,
            "is_demo": bool(getattr(obj, "_reviews_demo", False)),
        }


class ProductDetailSerializer(ProductCardSerializer):
    description = serializers.CharField()
    images = serializers.SerializerMethodField()
    origin = serializers.SerializerMethodField()
    storage_instructions = serializers.CharField()
    ingredients = serializers.CharField()
    packaging = serializers.CharField()
    manufacturer = serializers.CharField()
    allergens = serializers.SerializerMethodField()
    claims = serializers.SerializerMethodField()
    nutrition = serializers.SerializerMethodField()
    unknowns = serializers.SerializerMethodField()
    is_perishable = serializers.BooleanField()
    breadcrumbs = serializers.SerializerMethodField()
    is_demo = serializers.BooleanField()

    def get_images(self, obj):
        return [{"alt": i.alt_text, "urls": i.urls()} for i in obj.images.all()]

    def get_origin(self, obj):
        if not (obj.origin_country or obj.origin_note):
            return None
        return {"country": obj.origin_country, "note": obj.origin_note}

    def get_allergens(self, obj):
        rows = list(obj.allergens.all())
        return {
            "contains": sorted(r.allergen.name for r in rows if r.level == AllergenLevel.CONTAINS),
            "may_contain": sorted(r.allergen.name for r in rows if r.level == AllergenLevel.MAY_CONTAIN),
            "confirmed": obj.allergen_info_complete,
        }

    def get_claims(self, obj):
        return [
            {"kind": c.kind, "label": c.get_kind_display(), "evidence": c.evidence}
            for c in obj.claims.all()
            if c.verified
        ]

    def get_nutrition(self, obj):
        n = getattr(obj, "nutrition", None)
        if n is None:
            return None
        fields = ["energy_kcal", "energy_kj", "fat", "saturates", "carbohydrate", "sugars", "fibre", "protein", "salt"]
        return {
            "basis": n.basis,
            "source": n.source,
            "is_demo": n.is_demo,
            "values": {f: _q(getattr(n, f)) for f in fields if getattr(n, f) is not None},
        }

    def get_unknowns(self, obj):
        """Explicitly list data we don't have — the UI renders 'Not provided' instead of omitting or guessing."""
        missing = []
        if not (obj.origin_country or obj.origin_note):
            missing.append("origin")
        if getattr(obj, "nutrition", None) is None:
            missing.append("nutrition")
        if not obj.ingredients and obj.product_type not in ("LOOSE_PRODUCE", "HOUSEHOLD"):
            missing.append("ingredients")
        if not obj.allergen_info_complete:
            missing.append("allergens")
        if not obj.storage_instructions:
            missing.append("storage")
        return missing

    def get_breadcrumbs(self, obj):
        c, trail = obj.category, []
        if c.parent_id:
            trail.append({"name": c.parent.name, "slug": c.parent.slug})
        trail.append({"name": c.name, "slug": c.slug})
        return trail


class ReviewSerializer(serializers.ModelSerializer):
    author = serializers.SerializerMethodField()

    class Meta:
        model = Review
        fields = ["id", "rating", "title", "body", "verified_purchase", "is_demo", "created_at", "author"]

    def get_author(self, obj):
        first = obj.user.full_name.split()[0] if obj.user.full_name else "Customer"
        return first  # first name only: no email or surname is ever exposed


class ReviewCreateSerializer(serializers.Serializer):
    rating = serializers.IntegerField(min_value=1, max_value=5)
    title = serializers.CharField(max_length=100, required=False, allow_blank=True)
    body = serializers.CharField(max_length=2000, required=False, allow_blank=True)


def money_str(value) -> str:
    return str(money(value))
