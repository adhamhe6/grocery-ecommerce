"""Staff API for payments, refunds, provider events and daily reconciliation."""

from __future__ import annotations

import datetime as dt
from decimal import Decimal

from django.db.models import Count, Q, Sum
from drf_spectacular.utils import extend_schema
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.exceptions import DomainError, ErrorCode
from apps.core.money import ZERO, money
from apps.core.pagination import StandardPagination
from apps.core.permissions import HasCapability, IsStaffUser, branch_ids_for, scope_by_branch
from apps.orders.models import Order, OrderStatus

from .models import Payment, PaymentEvent, PaymentState, Refund, RefundStatus


def payment_row(p: Payment) -> dict:
    return {
        "id": p.id,
        "order": p.order.number,
        "branch": p.order.branch.name,
        "provider": p.provider,
        "method": p.method,
        "state": p.state,
        "state_label": p.get_state_display(),
        "amount": str(p.amount),
        "captured": str(p.captured_amount),
        "refunded": str(p.refunded_amount),
        "currency": p.currency,
        "reference": p.provider_reference,
        "attempt": p.attempt,
        "failure_code": p.failure_code,
        "failure_message": p.failure_message,
        "created_at": p.created_at,
        "captured_at": p.captured_at,
        "is_demo": p.is_demo,
    }


class PaymentViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsAuthenticated, IsStaffUser, HasCapability]
    read_capability = "finance.read"
    pagination_class = StandardPagination

    def get_queryset(self):
        qs = scope_by_branch(Payment.objects.select_related("order__branch"), self.request.user, "order__branch_id")
        p = self.request.query_params
        if p.get("state"):
            qs = qs.filter(state__in=p["state"].split(","))
        if p.get("provider"):
            qs = qs.filter(provider=p["provider"])
        if p.get("date_from"):
            qs = qs.filter(created_at__date__gte=p["date_from"])
        if p.get("date_to"):
            qs = qs.filter(created_at__date__lte=p["date_to"])
        if q := (p.get("search") or "").strip():
            qs = qs.filter(
                Q(order__number__icontains=q)
                | Q(provider_reference__icontains=q)
                | Q(order__contact_email__icontains=q)
            )
        return qs.order_by("-created_at", "-id")

    def list(self, request, *args, **kwargs):
        page = self.paginate_queryset(self.get_queryset())
        return self.get_paginated_response([payment_row(p) for p in page])

    def retrieve(self, request, *args, **kwargs):
        p = self.get_object()
        data = payment_row(p)
        data["events"] = [
            {"at": e.received_at, "type": e.event_type, "event_id": e.event_id, "outcome": e.outcome, "error": e.error}
            for e in p.events.all()[:100]
        ]
        data["refunds"] = [
            {
                "id": r.id,
                "amount": str(r.amount),
                "status": r.status,
                "method": r.method,
                "reason": r.reason,
                "reference": r.reference,
                "created_at": r.created_at,
            }
            for r in p.refunds.all()
        ]
        return Response(data)

    @extend_schema(responses={200: dict})
    @action(detail=False, methods=["get"])
    def refunds(self, request):
        qs = scope_by_branch(
            Refund.objects.select_related("order__branch", "requested_by", "payment"), request.user, "order__branch_id"
        )
        if request.query_params.get("status"):
            qs = qs.filter(status__in=request.query_params["status"].split(","))
        page = self.paginate_queryset(qs.order_by("-created_at"))
        return self.get_paginated_response(
            [
                {
                    "id": r.id,
                    "order": r.order.number,
                    "amount": str(r.amount),
                    "status": r.status,
                    "method": r.method,
                    "reason": r.reason,
                    "reference": r.reference,
                    "failure": r.failure_message,
                    "requested_by": r.requested_by.email if r.requested_by_id else "system",
                    "created_at": r.created_at,
                    "completed_at": r.completed_at,
                }
                for r in page
            ]
        )

    @extend_schema(responses={200: dict})
    @action(detail=False, methods=["get"])
    def events(self, request):
        qs = PaymentEvent.objects.select_related("payment__order__branch")
        ids = branch_ids_for(request.user)
        if ids is not None:
            qs = qs.filter(payment__order__branch_id__in=ids)
        if request.query_params.get("outcome"):
            qs = qs.filter(outcome=request.query_params["outcome"])
        page = self.paginate_queryset(qs.order_by("-received_at")[:1000])
        return self.get_paginated_response(
            [
                {
                    "id": e.id,
                    "at": e.received_at,
                    "provider": e.provider,
                    "type": e.event_type,
                    "event_id": e.event_id,
                    "outcome": e.outcome,
                    "error": e.error,
                    "order": e.payment.order.number if e.payment_id else None,
                }
                for e in page
            ]
        )


class ReconciliationView(APIView):
    """Does the money add up? Compares payments to orders for a day and lists every discrepancy explicitly."""

    permission_classes = [IsAuthenticated, IsStaffUser, HasCapability]
    read_capability = "finance.read"

    @extend_schema(responses={200: dict})
    def get(self, request):
        raw = request.query_params.get("date")
        try:
            day = dt.date.fromisoformat(raw) if raw else dt.date.today()
        except ValueError:
            raise DomainError(ErrorCode.VALIDATION_ERROR, "date must look like 2026-10-31.") from None
        branches = branch_ids_for(request.user)
        pays = Payment.objects.filter(captured_at__date=day).select_related("order")
        refunds = Refund.objects.filter(status=RefundStatus.SUCCEEDED, completed_at__date=day)
        if branches is not None:
            pays, refunds = pays.filter(order__branch_id__in=branches), refunds.filter(order__branch_id__in=branches)
        by_provider = [
            {
                "provider": r["provider"],
                "method": r["method"],
                "payments": r["n"],
                "captured": str(money(r["captured"] or ZERO)),
            }
            for r in pays.values("provider", "method")
            .annotate(n=Count("id"), captured=Sum("captured_amount"))
            .order_by("provider")
        ]
        refunded = refunds.aggregate(v=Sum("amount"))["v"] or ZERO
        discrepancies = []
        for p in pays:
            if (
                p.order.final_total is not None
                and p.captured_amount != p.order.final_total
                and p.state in (PaymentState.CAPTURED, PaymentState.PARTIALLY_REFUNDED, PaymentState.REFUNDED)
            ):
                discrepancies.append(
                    {
                        "type": "CAPTURE_MISMATCH",
                        "order": p.order.number,
                        "detail": f"Captured {p.captured_amount} but the order's final total is {p.order.final_total}",
                    }
                )
        order_qs = Order.objects.all() if branches is None else Order.objects.filter(branch_id__in=branches)
        stuck = (
            order_qs.filter(status=OrderStatus.COMPLETED, completed_at__date=day)
            .exclude(
                payments__state__in=[PaymentState.CAPTURED, PaymentState.PARTIALLY_REFUNDED, PaymentState.REFUNDED]
            )
            .distinct()
        )
        for o in stuck:
            discrepancies.append(
                {
                    "type": "COMPLETED_WITHOUT_CAPTURE",
                    "order": o.number,
                    "detail": "Order is completed but no payment was captured/collected",
                }
            )
        pending_refunds = Refund.objects.filter(status=RefundStatus.PENDING)
        if branches is not None:
            pending_refunds = pending_refunds.filter(order__branch_id__in=branches)
        for r in pending_refunds.select_related("order"):
            discrepancies.append(
                {
                    "type": "REFUND_PENDING",
                    "order": r.order.number,
                    "detail": f"Refund of {r.amount} is still {r.get_method_display().lower()} and unconfirmed",
                }
            )
        open_holds = Payment.objects.filter(
            state=PaymentState.AUTHORIZED,
            order__status__in=[OrderStatus.COMPLETED, OrderStatus.CANCELLED, OrderStatus.PAYMENT_FAILED],
        )
        if branches is not None:
            open_holds = open_holds.filter(order__branch_id__in=branches)
        for p in open_holds.select_related("order"):
            discrepancies.append(
                {
                    "type": "STALE_AUTHORISATION",
                    "order": p.order.number,
                    "detail": f"A {p.amount} authorisation is still open on a {p.order.status.lower()} order",
                }
            )
        total = sum((Decimal(r["captured"]) for r in by_provider), ZERO)
        return Response(
            {
                "date": day.isoformat(),
                "by_provider": by_provider,
                "captured_total": str(money(total)),
                "refunded_total": str(money(refunded)),
                "net": str(money(total - refunded)),
                "discrepancies": discrepancies,
                "ok": not discrepancies,
            }
        )
