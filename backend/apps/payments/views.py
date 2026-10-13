from __future__ import annotations

import datetime as dt
import uuid

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.exceptions import DomainError, ErrorCode
from apps.orders import workflow
from apps.orders.models import OrderStatus
from apps.orders.serializers import order_detail
from apps.orders.views import get_order_for_request, order_queryset

from . import services
from .models import Payment, PaymentState
from .providers import ProviderError
from .providers.demo import SIGNATURE_HEADER, sign


class WebhookView(APIView):
    """Provider → us. Authenticated by the provider's signature only (no session, no CSRF)."""

    authentication_classes: list = []
    permission_classes = [AllowAny]
    throttle_classes: list = []

    @extend_schema(request=None, responses={200: dict})
    def post(self, request, provider):
        body = request._request.body
        code, payload = services.handle_webhook(provider, request._request.headers, body)
        return Response(payload, status=code)


def _demo_enabled() -> bool:
    return settings.PAYMENT_PROVIDER == "demo" and settings.PAYMENTS_ALLOW_DEMO


class DemoPaymentView(APIView):
    """Back end of the storefront's demonstration payment page. 404 whenever the demo adapter is not active."""

    authentication_classes: list = []
    permission_classes = [AllowAny]

    def _payment(self, reference):
        if not _demo_enabled():
            raise DomainError(ErrorCode.NOT_FOUND, "Not found.", status_code=404)
        payment = Payment.objects.select_related("order").filter(provider="demo", provider_reference=reference).first()
        if payment is None:
            raise DomainError(ErrorCode.NOT_FOUND, "We couldn't find that payment.", status_code=404)
        return payment

    @extend_schema(responses={200: dict})
    def get(self, request, reference):
        p = self._payment(reference)
        return Response(
            {
                "order_number": p.order.number,
                "amount": str(p.amount),
                "currency": p.currency,
                "state": p.state,
                "mode": "demo",
                "notice": "This is a demonstration payment page. No card is charged and no money moves.",
                "tracking_token": None,
            }
        )

    @extend_schema(request=None, responses={200: dict})
    def post(self, request, reference):
        outcome = (request.data.get("outcome") or "").lower()
        kind = {"succeed": "payment.authorized", "fail": "payment.failed", "cancel": "payment.cancelled"}.get(outcome)
        if kind is None:
            raise DomainError(ErrorCode.VALIDATION_ERROR, "outcome must be succeed, fail or cancel.")
        p = self._payment(reference)
        event = {
            "id": f"evt_{uuid.uuid4().hex}",
            "type": kind,
            "reference": reference,
            "payment_id": p.pk,
            "amount": str(p.amount),
        }
        if outcome == "fail":
            event.update(failure_code="card_declined", message="The (simulated) card was declined.")
        body = services.webhook_body(event)
        # Deliver through the same verified path a real provider uses.
        code, payload = services.handle_webhook("demo", {SIGNATURE_HEADER: sign(body)}, body)
        if code != 200:
            raise DomainError(
                ErrorCode.PAYMENT_FAILED, "The demo payment event could not be processed.", status_code=502
            )
        return Response({"result": payload["status"], "order_number": p.order.number, "outcome": outcome})


class RetryPaymentSerializer(serializers.Serializer):
    method = serializers.ChoiceField(choices=["CARD", "COD"], required=False)


class RetryPaymentView(APIView):
    permission_classes = [AllowAny]

    @extend_schema(request=RetryPaymentSerializer, responses={200: dict})
    def post(self, request, number):
        from apps.notifications.services import notify_order

        ser = RetryPaymentSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        order = get_order_for_request(request, number)
        with transaction.atomic():
            locked = workflow.lock_order(order)
            if locked.status != OrderStatus.PENDING_PAYMENT:
                raise DomainError(ErrorCode.INVALID_STATE, "This order isn't waiting for payment.", status_code=409)
            method = ser.validated_data.get("method") or locked.payment_method
            open_attempt = locked.payments.filter(state=PaymentState.REQUIRES_ACTION).first()
            if method == "COD":
                from apps.core.models import StoreSettings

                if not StoreSettings.load().cash_on_delivery_enabled:
                    raise DomainError(ErrorCode.VALIDATION_ERROR, "Pay-on-delivery isn't available.")
                services.void_open_payments(locked)
                services.create_payment_attempt(locked, "COD")
                locked.payment_method = "COD"
                locked.reservation_expires_at = None
                locked.save(update_fields=["payment_method", "reservation_expires_at", "updated_at"])
                confirmed = workflow.transition(
                    locked,
                    OrderStatus.CONFIRMED,
                    note="Customer switched to pay on delivery/pickup",
                    public_note="Order confirmed — you'll pay on delivery/pickup",
                )
                notify_order(confirmed, "ORDER_CONFIRMED_COD")
                payment = None
            else:
                if open_attempt is None:
                    payment = services.create_payment_attempt(locked, "CARD")
                else:
                    payment = open_attempt
                # A retry earns a fresh payment window, capped at one hour from when the order was placed.
                window = timezone.now() + dt.timedelta(minutes=settings.RESERVATION_TTL_MINUTES)
                locked.reservation_expires_at = min(window, locked.placed_at + dt.timedelta(hours=1))
                locked.payment_method = "CARD"
                locked.save(update_fields=["reservation_expires_at", "payment_method", "updated_at"])
        init_failed = False
        if payment is not None and not payment.provider_reference:
            try:
                services.init_with_provider(payment.pk)
            except ProviderError:
                init_failed = True
        data = order_detail(order_queryset().get(pk=order.pk))
        data["payment_init_failed"] = init_failed
        return Response(data)
