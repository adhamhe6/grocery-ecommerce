from __future__ import annotations

from decimal import Decimal

from django.db import IntegrityError, transaction
from django.db.models import Prefetch
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.catalog.models import Product, ProductImage, ProductStatus
from apps.catalog.serializers import ProductCardSerializer
from apps.catalog.views import default_branch_id
from apps.core.exceptions import DomainError, ErrorCode
from apps.inventory.availability import annotate_availability
from apps.promotions.engine import load_index
from apps.stores.models import Branch

from . import services
from .models import ComparisonItem, Favorite, ShoppingList, ShoppingListItem, SubstitutionPolicy
from .pricing import apply_coupon_to_lines

MAX_COMPARE = 4


class AddItemSerializer(serializers.Serializer):
    product_id = serializers.IntegerField(min_value=1)
    quantity = serializers.DecimalField(max_digits=10, decimal_places=3)


class UpdateItemSerializer(serializers.Serializer):
    quantity = serializers.DecimalField(max_digits=10, decimal_places=3, required=False, min_value=Decimal("0"))
    substitution_pref = serializers.ChoiceField(choices=["INHERIT", "ALLOW", "NONE"], required=False)


class CartUpdateSerializer(serializers.Serializer):
    substitution_policy = serializers.ChoiceField(choices=SubstitutionPolicy.values, required=False)
    branch_id = serializers.IntegerField(required=False, allow_null=True)


class CouponSerializer(serializers.Serializer):
    code = serializers.CharField(max_length=40)


def _branch_param(request) -> int | None:
    raw = request.query_params.get("branch") or request.data.get("branch_id") if hasattr(request, "data") else None
    return int(raw) if raw and str(raw).isdigit() else None


def _respond(request, cart, code=status.HTTP_200_OK):
    response = Response(services.build_cart_payload(cart, request, _branch_param(request)), status=code)
    services.attach_cookie(response, request, cart)
    return response


class CartView(APIView):
    permission_classes = [AllowAny]

    @extend_schema(responses={200: dict})
    def get(self, request):
        return _respond(request, services.get_cart(request))

    @extend_schema(request=CartUpdateSerializer, responses={200: dict})
    def patch(self, request):
        ser = CartUpdateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        if data.get("branch_id") and not Branch.objects.filter(pk=data["branch_id"], is_active=True).exists():
            raise DomainError(ErrorCode.VALIDATION_ERROR, "Choose one of our open branches.")
        cart = services.get_cart(request, create=True)
        if "substitution_policy" in data:
            cart.substitution_policy = data["substitution_policy"]
        if "branch_id" in data:
            cart.branch_id = data["branch_id"]
        cart.save()
        return _respond(request, cart)

    def delete(self, request):
        cart = services.get_cart(request)
        if cart:
            services.clear(cart)
        return _respond(request, cart)


class CartItemsView(APIView):
    permission_classes = [AllowAny]

    @extend_schema(request=AddItemSerializer, responses={201: dict})
    def post(self, request):
        ser = AddItemSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        cart = services.get_cart(request, create=True)
        services.add_item(
            cart, ser.validated_data["product_id"], ser.validated_data["quantity"], services.resolve_branch_id(cart)
        )
        return _respond(request, cart, status.HTTP_201_CREATED)


class CartItemDetailView(APIView):
    permission_classes = [AllowAny]

    @extend_schema(request=UpdateItemSerializer, responses={200: dict})
    def patch(self, request, product_id):
        ser = UpdateItemSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        cart = services.get_cart(request)
        if cart is None:
            raise DomainError(ErrorCode.NOT_FOUND, "Your basket is empty.", status_code=404)
        services.set_quantity(
            cart,
            product_id,
            ser.validated_data.get("quantity"),
            services.resolve_branch_id(cart),
            ser.validated_data.get("substitution_pref"),
        )
        return _respond(request, cart)

    def delete(self, request, product_id):
        cart = services.get_cart(request)
        if cart:
            services.remove_item(cart, product_id)
        return _respond(request, cart)


class CartCouponView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "coupon"

    @extend_schema(request=CouponSerializer, responses={200: dict})
    def post(self, request):
        ser = CouponSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        cart = services.get_cart(request, create=True)
        priced, _ = services.load_lines(cart, services.resolve_branch_id(cart))
        user = request.user if request.user.is_authenticated else None
        result = apply_coupon_to_lines(
            ser.validated_data["code"], [ln for _, ln in priced], user=user, email=getattr(user, "email", "")
        )
        if result is None:
            raise DomainError(ErrorCode.INVALID_COUPON, "Enter a code to apply.")
        cart.coupon_code = result.coupon.code
        cart.save(update_fields=["coupon_code", "updated_at"])
        return _respond(request, cart)

    def delete(self, request):
        cart = services.get_cart(request)
        if cart and cart.coupon_code:
            cart.coupon_code = ""
            cart.save(update_fields=["coupon_code", "updated_at"])
        return _respond(request, cart)


class CartFixView(APIView):
    permission_classes = [AllowAny]

    @extend_schema(responses={200: dict})
    def post(self, request):
        cart = services.get_cart(request)
        if cart:
            services.fix_blocking_issues(cart, _branch_param(request))
        return _respond(request, cart)


class CartAcknowledgeView(APIView):
    permission_classes = [AllowAny]

    @extend_schema(responses={200: dict})
    def post(self, request):
        cart = services.get_cart(request)
        if cart:
            services.acknowledge_prices(cart, _branch_param(request))
        return _respond(request, cart)


class CartReorderView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(request=serializers.Serializer, responses={200: dict})
    def post(self, request, number):
        from apps.orders.models import Order

        order = Order.objects.filter(number=number, customer=request.user).first()  # only your own orders
        if order is None:
            raise DomainError(ErrorCode.NOT_FOUND, "We couldn't find that order.", status_code=404)
        cart = services.get_cart(request, create=True)
        summary = services.reorder(cart, order, services.resolve_branch_id(cart))
        payload = services.build_cart_payload(cart, request)
        payload["reorder"] = summary
        return Response(payload)


# ----------------------------------------------------------------------------------------- favourites / comparison / lists
def annotated_products(ids, branch_id):
    products = {
        p.id: p
        for p in annotate_availability(
            Product.objects.filter(pk__in=ids, status=ProductStatus.ACTIVE, is_available=True), branch_id
        )
        .select_related("brand", "category__parent", "sale_unit", "net_content_unit")
        .prefetch_related(Prefetch("images", queryset=ProductImage.objects.order_by("sort_order", "id")))
    }
    return [products[i] for i in ids if i in products]


class FavoriteListView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(responses={200: dict})
    def get(self, request):
        ids = list(Favorite.objects.filter(user=request.user).values_list("product_id", flat=True))
        branch_id = default_branch_id()
        cards = ProductCardSerializer(
            annotated_products(ids, branch_id), many=True, context={"promo_index": load_index(), "branch_id": branch_id}
        )
        return Response({"ids": ids, "products": cards.data})

    @extend_schema(request=serializers.Serializer, responses={201: dict})
    def post(self, request):
        pid = request.data.get("product_id")
        if not Product.objects.filter(pk=pid, status=ProductStatus.ACTIVE).exists():
            raise DomainError(ErrorCode.NOT_FOUND, "We couldn't find that product.", status_code=404)
        Favorite.objects.get_or_create(user=request.user, product_id=pid)
        return Response(
            {"ids": list(Favorite.objects.filter(user=request.user).values_list("product_id", flat=True))},
            status=status.HTTP_201_CREATED,
        )


class FavoriteDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, product_id):
        Favorite.objects.filter(user=request.user, product_id=product_id).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ComparisonView(APIView):
    """Public: `GET /compare/?ids=1,2,3` builds the comparison. Signed-in users also persist their list."""

    permission_classes = [AllowAny]

    @extend_schema(parameters=[OpenApiParameter("ids", str)], responses={200: dict})
    def get(self, request):
        raw = request.query_params.get("ids", "")
        ids = [int(x) for x in raw.split(",") if x.strip().isdigit()][:MAX_COMPARE]
        branch_id = default_branch_id()
        products = annotated_products(ids, branch_id)
        return Response(build_comparison(products, {"promo_index": load_index(), "branch_id": branch_id}))


class SavedComparisonView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(responses={200: dict})
    def get(self, request):
        return Response(
            {"ids": list(ComparisonItem.objects.filter(user=request.user).values_list("product_id", flat=True))}
        )

    @extend_schema(request=serializers.Serializer, responses={200: dict})
    def put(self, request):
        ids = [int(x) for x in (request.data.get("ids") or []) if str(x).isdigit()][:MAX_COMPARE]
        valid = list(Product.objects.filter(pk__in=ids, status=ProductStatus.ACTIVE).values_list("id", flat=True))
        with transaction.atomic():
            ComparisonItem.objects.filter(user=request.user).delete()
            ComparisonItem.objects.bulk_create(
                [ComparisonItem(user=request.user, product_id=i) for i in dict.fromkeys(i for i in ids if i in valid)]
            )
        return Response(
            {"ids": list(ComparisonItem.objects.filter(user=request.user).values_list("product_id", flat=True))}
        )


def build_comparison(products, ctx) -> dict:
    cards = ProductCardSerializer(products, many=True, context=ctx).data
    rows = []
    kinds = set()
    for card, p in zip(cards, products, strict=True):
        n = getattr(p, "nutrition", None)
        up = card["unit_price"]
        if up:
            kinds.add(up["per"])
        rows.append(
            {
                "card": card,
                "brand": card["brand"]["name"] if card["brand"] else None,
                "size": f"{p.net_content.normalize():f} {p.net_content_unit.symbol}"
                if p.net_content and p.net_content_unit_id
                else None,
                "origin": p.origin_country or None,
                "storage": p.get_storage_type_display(),
                "claims": [c.get_kind_display() for c in p.claims.all() if c.verified],
                "nutrition_per_100": (
                    {
                        "energy_kcal": str(n.energy_kcal) if n.energy_kcal is not None else None,
                        "sugars": str(n.sugars) if n.sugars is not None else None,
                        "protein": str(n.protein) if n.protein is not None else None,
                        "basis": n.basis,
                    }
                    if n
                    else None
                ),
            }
        )
    comparable = len(kinds) <= 1 and all(r["card"]["unit_price"] for r in rows)
    warnings = []
    if len(kinds) > 1:
        warnings.append("These products are measured differently (weight vs volume), so unit prices can't be compared.")
    if any(not r["card"]["unit_price"] for r in rows) and len(rows) > 1:
        warnings.append("Some products don't have a pack size on record, so a unit price can't be shown for them.")
    best = None
    if comparable and rows:
        best = min(rows, key=lambda r: Decimal(r["card"]["unit_price"]["amount"]))["card"]["id"]
    return {
        "products": rows,
        "unit_price_comparable": comparable,
        "best_value_id": best if len(rows) > 1 else None,
        "warnings": warnings,
    }


class ShoppingListSerializer(serializers.ModelSerializer):
    items = serializers.SerializerMethodField()

    class Meta:
        model = ShoppingList
        fields = ["id", "name", "items"]
        read_only_fields = ["id"]

    def get_items(self, obj):
        return [
            {
                "product_id": i.product_id,
                "name": i.product.name,
                "slug": i.product.slug,
                "quantity": str(i.quantity.normalize()),
            }
            for i in obj.items.select_related("product")
        ]

    def validate_name(self, value):
        user = self.context["request"].user
        qs = ShoppingList.objects.filter(user=user, name__iexact=value.strip())
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("You already have a list with this name.")
        return value.strip()


class ShoppingListViewSet(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(responses={200: ShoppingListSerializer(many=True)})
    def get(self, request):
        lists = ShoppingList.objects.filter(user=request.user).prefetch_related("items__product")
        return Response(ShoppingListSerializer(lists, many=True, context={"request": request}).data)

    @extend_schema(request=ShoppingListSerializer, responses={201: ShoppingListSerializer})
    def post(self, request):
        ser = ShoppingListSerializer(data=request.data, context={"request": request})
        ser.is_valid(raise_exception=True)
        if ShoppingList.objects.filter(user=request.user).count() >= 20:
            raise DomainError(ErrorCode.VALIDATION_ERROR, "You can keep up to 20 lists.")
        obj = ShoppingList.objects.create(user=request.user, name=ser.validated_data["name"])
        return Response(ShoppingListSerializer(obj, context={"request": request}).data, status=status.HTTP_201_CREATED)


class ShoppingListDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def _get(self, request, pk):
        obj = ShoppingList.objects.filter(pk=pk, user=request.user).first()  # ownership by queryset
        if obj is None:
            raise DomainError(ErrorCode.NOT_FOUND, "We couldn't find that list.", status_code=404)
        return obj

    @extend_schema(responses={200: ShoppingListSerializer})
    def get(self, request, pk):
        return Response(ShoppingListSerializer(self._get(request, pk), context={"request": request}).data)

    def patch(self, request, pk):
        obj = self._get(request, pk)
        ser = ShoppingListSerializer(obj, data=request.data, partial=True, context={"request": request})
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(ser.data)

    def delete(self, request, pk):
        self._get(request, pk).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ShoppingListItemView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(request=serializers.Serializer, responses={200: ShoppingListSerializer})
    def put(self, request, pk, product_id):
        obj = ShoppingList.objects.filter(pk=pk, user=request.user).first()
        if obj is None:
            raise DomainError(ErrorCode.NOT_FOUND, "We couldn't find that list.", status_code=404)
        if not Product.objects.filter(pk=product_id, status=ProductStatus.ACTIVE).exists():
            raise DomainError(ErrorCode.NOT_FOUND, "We couldn't find that product.", status_code=404)
        try:
            quantity = Decimal(str(request.data.get("quantity", "1")))
            if quantity <= 0:
                raise ValueError
        except (ArithmeticError, ValueError):
            raise DomainError(ErrorCode.INVALID_QUANTITY, "Enter a quantity greater than zero.") from None
        try:
            ShoppingListItem.objects.update_or_create(
                shopping_list=obj, product_id=product_id, defaults={"quantity": quantity}
            )
        except IntegrityError:
            raise DomainError(ErrorCode.VALIDATION_ERROR, "Could not save that item.") from None
        return Response(ShoppingListSerializer(obj, context={"request": request}).data)

    def delete(self, request, pk, product_id):
        obj = ShoppingList.objects.filter(pk=pk, user=request.user).first()
        if obj is None:
            raise DomainError(ErrorCode.NOT_FOUND, "We couldn't find that list.", status_code=404)
        obj.items.filter(product_id=product_id).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ShoppingListToCartView(APIView):
    """Move a saved list into the basket with the same validation as adding items by hand."""

    permission_classes = [IsAuthenticated]

    @extend_schema(request=serializers.Serializer, responses={200: dict})
    def post(self, request, pk):
        obj = ShoppingList.objects.filter(pk=pk, user=request.user).first()
        if obj is None:
            raise DomainError(ErrorCode.NOT_FOUND, "We couldn't find that list.", status_code=404)
        cart = services.get_cart(request, create=True)
        branch_id = services.resolve_branch_id(cart)
        added, skipped = [], []
        for item in obj.items.select_related("product"):
            try:
                services.add_item(cart, item.product_id, item.quantity, branch_id)
                added.append(item.product.name)
            except DomainError as exc:
                skipped.append({"name": item.product.name, "reason": exc.message})
        payload = services.build_cart_payload(cart, request)
        payload["list_result"] = {"added": added, "skipped": skipped}
        return Response(payload)
