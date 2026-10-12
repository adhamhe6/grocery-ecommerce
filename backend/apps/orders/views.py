from __future__ import annotations

from django.db.models import Count, Prefetch
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.cart import services as cart_services
from apps.core.exceptions import DomainError, ErrorCode
from apps.core.pagination import StandardPagination
from apps.payments import services as payment_services
from apps.payments.providers import ProviderError

from . import checkout, workflow
from .models import Order
from .serializers import (
    CancelSerializer,
    CaseCreateSerializer,
    CheckoutInputSerializer,
    SupportCaseSerializer,
    TrackSerializer,
    order_detail,
    order_summary,
)

ORDER_RELATED = ("branch", "customer")


def order_queryset():
    return Order.objects.select_related(*ORDER_RELATED).prefetch_related(
        "items", "payments", "refunds", "cases", Prefetch("history")
    )


def get_order_for_request(request, number: str) -> Order:
    """Owner (signed in) or holder of the order's unguessable tracking token. Anything else is a 404, never a 403."""
    qs = order_queryset().filter(number=number)
    if request.user.is_authenticated:
        order = qs.filter(customer=request.user).first()
        if order:
            return order
    token = request.query_params.get("token") or request.headers.get("X-Order-Token")
    if token:
        order = qs.filter(tracking_token=token).first()
        if order:
            return order
    raise DomainError(ErrorCode.NOT_FOUND, "We couldn't find that order.", status_code=404)


def _input_from(ser: CheckoutInputSerializer) -> checkout.CheckoutInput:
    d = ser.validated_data
    return checkout.CheckoutInput(
        fulfilment_type=d["fulfilment_type"],
        slot_id=d["slot_id"],
        payment_method=d["payment_method"],
        branch_id=d.get("branch_id"),
        address_id=d.get("address_id"),
        address=dict(d["address"]) if d.get("address") else None,
        contact=dict(d.get("contact") or {}),
        substitution_policy=d.get("substitution_policy"),
        customer_note=d.get("customer_note", ""),
        expected_total=d.get("expected_total"),
        save_address=d.get("save_address", False),
    )


class CheckoutQuoteView(APIView):
    permission_classes = [AllowAny]

    @extend_schema(request=CheckoutInputSerializer, responses={200: dict})
    def post(self, request):
        ser = CheckoutInputSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        cart = cart_services.get_cart(request)
        if cart is None:
            raise DomainError(ErrorCode.CART_EMPTY, "Your basket is empty.", status_code=409)
        user = request.user if request.user.is_authenticated else None
        return Response(checkout.quote(cart, user, _input_from(ser)))


class CheckoutView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "checkout"

    @extend_schema(request=CheckoutInputSerializer, responses={201: dict})
    def post(self, request):
        key = (request.headers.get("Idempotency-Key") or "").strip()
        if not (8 <= len(key) <= 120):
            raise DomainError(
                ErrorCode.IDEMPOTENCY_KEY_REQUIRED,
                "An Idempotency-Key header (8–120 characters) is required so retries can't create duplicate orders.",
            )
        ser = CheckoutInputSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        user = request.user if request.user.is_authenticated else None
        cart = cart_services.get_cart(request)
        actor_key = f"user:{user.pk}" if user else f"guest:{request.COOKIES.get(cart_services.CART_COOKIE, '')}"
        placed = checkout.place_order(
            cart=cart, user=user, data=_input_from(ser), idempotency_key=key, actor_key=actor_key
        )
        payment = placed.payment
        init_failed = False
        if payment is not None and payment.state == "REQUIRES_ACTION" and not payment.provider_reference:
            try:
                payment = payment_services.init_with_provider(payment.pk)
            except ProviderError:
                init_failed = True  # order is safely PENDING_PAYMENT; the customer can retry from the order page
        order = order_queryset().get(pk=placed.order.pk)
        data = order_detail(order, include_token=True)
        data["payment_init_failed"] = init_failed
        data["replayed"] = placed.replayed
        return Response(data, status=status.HTTP_200_OK if placed.replayed else status.HTTP_201_CREATED)


class OrderListView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(responses={200: dict})
    def get(self, request):
        qs = (
            Order.objects.filter(customer=request.user)
            .select_related("branch")
            .annotate(item_count=Count("items"))
            .order_by("-placed_at")
        )
        paginator = StandardPagination()
        paginator.page_size = 10
        page = paginator.paginate_queryset(qs, request)
        return paginator.get_paginated_response([order_summary(o) for o in page])


class OrderDetailView(APIView):
    permission_classes = [AllowAny]

    @extend_schema(responses={200: dict})
    def get(self, request, number):
        return Response(order_detail(get_order_for_request(request, number)))


class OrderTrackView(APIView):
    """Guests find an order with number + the email used at checkout (rate limited)."""

    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "tracking"

    @extend_schema(request=TrackSerializer, responses={200: dict})
    def post(self, request):
        ser = TrackSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        order = (
            order_queryset()
            .filter(
                number=ser.validated_data["number"].strip().upper(), contact_email__iexact=ser.validated_data["email"]
            )
            .first()
        )
        if order is None:
            raise DomainError(ErrorCode.NOT_FOUND, "We couldn't find an order with those details.", status_code=404)
        return Response(order_detail(order, include_token=True))


class OrderCancelView(APIView):
    permission_classes = [AllowAny]

    @extend_schema(request=CancelSerializer, responses={200: dict})
    def post(self, request, number):
        ser = CancelSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        order = get_order_for_request(request, number)
        workflow.cancel_order(
            order,
            actor=request.user if request.user.is_authenticated else None,
            reason=ser.validated_data["reason"],
            by_customer=True,
        )
        return Response(order_detail(order_queryset().get(pk=order.pk)))


class OrderCasesView(APIView):
    permission_classes = [AllowAny]

    @extend_schema(responses=SupportCaseSerializer(many=True))
    def get(self, request, number):
        order = get_order_for_request(request, number)
        return Response(SupportCaseSerializer(order.cases.all(), many=True).data)

    @extend_schema(request=CaseCreateSerializer, responses={201: SupportCaseSerializer})
    def post(self, request, number):
        from . import support

        ser = CaseCreateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        order = get_order_for_request(request, number)
        case = support.open_case(order, request.user if request.user.is_authenticated else None, **ser.validated_data)
        return Response(SupportCaseSerializer(case).data, status=status.HTTP_201_CREATED)
