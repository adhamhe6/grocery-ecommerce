"""Staff API: customer support cases.

Reads need `orders.read`, every change needs `support.manage`; both are limited to the staff member's branches
(a case belongs to the branch of its order). Resolving a case with money goes through `payments.services.request_refund`
inside the same transaction, and the response reports the refund's *real* status — a cash-on-delivery or provider-outage
refund is PENDING and is never described as done.
"""

from __future__ import annotations

from decimal import Decimal

from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core import audit
from apps.core.admin_utils import AdminReadOnlyViewSet
from apps.core.exceptions import DomainError, ErrorCode
from apps.core.money import money
from apps.core.pagination import StandardPagination
from apps.core.permissions import scope_by_branch
from apps.payments.models import PaymentState, RefundMethod, RefundStatus
from apps.payments.services import request_refund

from .models import CaseKind, CaseResolution, CaseStatus, SupportCase

FINAL_STATUSES = (CaseStatus.RESOLVED, CaseStatus.REJECTED)


def refundable_amount(order) -> Decimal | None:
    """What can still be refunded on the order's collected payment (None = nothing has been collected)."""
    payment = next(
        (p for p in sorted(order.payments.all(), key=lambda p: p.created_at, reverse=True)
         if p.state in (PaymentState.CAPTURED, PaymentState.PARTIALLY_REFUNDED)),
        None,
    )  # fmt: skip
    if payment is None:
        return None
    pending = sum((r.amount for r in payment.refunds.all() if r.status == RefundStatus.PENDING), Decimal("0"))
    return payment.captured_amount - payment.refunded_amount - pending


def refund_payload(refund) -> dict:
    """The refund exactly as it stands — `completed` is true only when the money has really moved."""
    completed = refund.status == RefundStatus.SUCCEEDED
    if completed:
        message = "The refund has been issued."
    elif refund.status == RefundStatus.FAILED:
        message = "The payment provider rejected the refund."
    elif refund.method == RefundMethod.MANUAL:
        message = (
            "Refund recorded but NOT yet paid out: it is a manual (cash / store credit) refund. "
            "Hand over the money, then record the receipt reference to complete it."
        )
    elif refund.failure_message:
        message = "The payment provider couldn't be reached, so the refund is pending and has NOT been issued yet. Retrying is safe."
    else:
        message = "The refund has been requested and is waiting for the payment provider to confirm it."
    return {
        "id": refund.id,
        "amount": str(money(refund.amount)),
        "status": refund.status,
        "method": refund.method,
        "completed": completed,
        "message": message,
    }


class CaseSerializer(serializers.ModelSerializer):
    order_number = serializers.CharField(source="order.number", read_only=True)
    order_status = serializers.CharField(source="order.status", read_only=True)
    payment_method = serializers.CharField(source="order.payment_method", read_only=True)
    branch = serializers.SerializerMethodField()
    customer = serializers.SerializerMethodField()
    order_item = serializers.SerializerMethodField()
    handled_by = serializers.SerializerMethodField()
    kind_label = serializers.CharField(source="get_kind_display", read_only=True)
    refund_amount = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)
    refund_status = serializers.SerializerMethodField()
    refunds = serializers.SerializerMethodField()
    refundable = serializers.SerializerMethodField()

    class Meta:
        model = SupportCase
        fields = [
            "id", "order_number", "order_status", "payment_method", "branch", "customer", "order_item", "kind", "kind_label",
            "description", "status", "resolution", "refund_amount", "refund_status", "refunds", "refundable",
            "staff_notes", "handled_by", "created_at", "updated_at", "resolved_at",
        ]  # fmt: skip
        read_only_fields = fields

    def get_branch(self, obj) -> dict:
        return {"id": obj.order.branch_id, "name": obj.order.branch.name}

    def get_customer(self, obj) -> dict:
        return {"id": obj.customer_id, "name": obj.customer.full_name if obj.customer_id else obj.order.contact_name}

    def get_order_item(self, obj) -> dict | None:
        return {"id": obj.order_item_id, "name": obj.order_item.name} if obj.order_item_id else None

    def get_handled_by(self, obj) -> str | None:
        return obj.handled_by.email if obj.handled_by_id else None

    def get_refunds(self, obj) -> list:
        return [refund_payload(r) | {"created_at": r.created_at} for r in obj.refunds.all()]

    def get_refund_status(self, obj) -> str | None:
        latest = max(obj.refunds.all(), key=lambda r: r.created_at, default=None)
        return latest.status if latest else None

    def get_refundable(self, obj) -> str | None:
        if not self.context.get("detail"):
            return None
        amount = refundable_amount(obj.order)
        return None if amount is None else str(money(amount))


class ResolveSerializer(serializers.Serializer):
    resolution = serializers.ChoiceField(choices=CaseResolution.choices)
    refund_amount = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=Decimal("0"), required=False)
    staff_notes = serializers.CharField(max_length=2000, required=False, allow_blank=True)

    def validate(self, attrs):
        amount = attrs.get("refund_amount") or Decimal("0")
        attrs["refund_amount"] = amount
        attrs["staff_notes"] = (attrs.get("staff_notes") or "").strip()
        if attrs["resolution"] in (CaseResolution.REFUND, CaseResolution.GOODWILL):
            if amount <= 0:
                raise serializers.ValidationError({"refund_amount": "Enter the amount to refund (greater than 0)."})
        elif amount > 0:
            raise serializers.ValidationError(
                {"refund_amount": "Money can only be refunded with a REFUND or GOODWILL resolution."}
            )
        return attrs


class RejectSerializer(serializers.Serializer):
    staff_notes = serializers.CharField(max_length=2000)

    def validate_staff_notes(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Explain why the case is rejected: the customer is told this reason.")
        return value


def case_state(case: SupportCase) -> dict:
    return {
        "status": case.status, "resolution": case.resolution, "refund_amount": str(case.refund_amount),
        "staff_notes": case.staff_notes, "handled_by": case.handled_by_id,
    }  # fmt: skip


class SupportCaseViewSet(AdminReadOnlyViewSet):
    queryset = (
        SupportCase.objects.select_related("order__branch", "customer", "order_item", "handled_by")
        .prefetch_related("refunds", "order__payments__refunds")
        .order_by("-created_at", "-id")
    )
    serializer_class = CaseSerializer
    pagination_class = StandardPagination
    read_capability = "orders.read"
    capability = "support.manage"

    def get_queryset(self):
        qs = scope_by_branch(super().get_queryset(), self.request.user, "order__branch_id")
        p = self.request.query_params
        for param, valid in (("status", CaseStatus.values), ("kind", CaseKind.values)):
            raw = [v.strip().upper() for v in p.get(param, "").split(",") if v.strip()]
            if raw:
                bad = [v for v in raw if v not in valid]
                if bad:
                    raise serializers.ValidationError({param: [f"Unknown value(s): {', '.join(bad)}."]})
                qs = qs.filter(**{f"{param}__in": raw})
        if p.get("branch", "").isdigit():
            qs = qs.filter(order__branch_id=p["branch"])
        if p.get("q"):
            q = p["q"].strip()
            qs = qs.filter(
                Q(order__number__icontains=q) | Q(order__contact_name__icontains=q) | Q(description__icontains=q)
            )
        return qs

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx["detail"] = self.action != "list"
        return ctx

    # -- helpers -----------------------------------------------------------------------------------------
    def _lock(self) -> SupportCase:
        return SupportCase.objects.select_for_update(of=("self",)).get(pk=self.get_object().pk)

    @staticmethod
    def _ensure_open(case: SupportCase) -> None:
        if case.status in FINAL_STATUSES:
            raise DomainError(
                ErrorCode.INVALID_STATE,
                f"This case is already {case.get_status_display().lower()} and can't be changed. Open a new case if there is more to do.",
                status_code=409,
            )

    def _respond(self, case: SupportCase, **extra) -> Response:
        fresh = self.get_queryset().get(pk=case.pk)
        return Response(CaseSerializer(fresh, context=self.get_serializer_context()).data | extra)

    # -- actions -----------------------------------------------------------------------------------------
    @extend_schema(request=None, responses={200: CaseSerializer})
    @action(detail=True, methods=["post"], url_path="review")
    def review(self, request, pk=None):
        with transaction.atomic():
            case = self._lock()
            self._ensure_open(case)
            if case.status == CaseStatus.IN_REVIEW and case.handled_by_id not in (None, request.user.id):
                raise DomainError(
                    ErrorCode.INVALID_STATE,
                    f"{case.handled_by.email} is already reviewing this case.",
                    status_code=409,
                )
            if case.status != CaseStatus.IN_REVIEW:
                before = case_state(case)
                case.status, case.handled_by = CaseStatus.IN_REVIEW, request.user
                case.save(update_fields=["status", "handled_by", "updated_at"])
                audit.record(
                    request.user, "case.review_started", case, before=before, after=case_state(case), request=request
                )
        return self._respond(case)

    @extend_schema(request=ResolveSerializer, responses={200: dict})
    @action(detail=True, methods=["post"], url_path="resolve")
    def resolve(self, request, pk=None):
        if str(request.data.get("status", "")).upper() == CaseStatus.REJECTED:  # "resolve as rejected" == reject
            return self.reject(request, pk)
        ser = ResolveSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        failure: dict = {}
        refund = None
        try:
            with transaction.atomic():
                case = self._lock()
                self._ensure_open(case)
                before = case_state(case)
                if data["refund_amount"] > 0:
                    order = case.order
                    reason = f"Support case #{case.id} ({case.get_kind_display()})" + (
                        f": {data['staff_notes']}" if data["staff_notes"] else ""
                    )
                    refund = request_refund(
                        order, data["refund_amount"], reason, request.user,
                        idempotency_key=f"case-{case.id}", support_case=case, manual=order.payment_method == "COD",
                    )  # fmt: skip
                    if refund.status == RefundStatus.FAILED:
                        failure.update(case=case, message=refund.failure_message or "refund failed")
                        raise DomainError(
                            ErrorCode.PAYMENT_FAILED,
                            "The payment provider rejected the refund, so the case is still open. Check the order's payment and try again.",
                            status_code=502,
                        )
                case.status, case.resolution = CaseStatus.RESOLVED, data["resolution"]
                case.refund_amount, case.staff_notes = data["refund_amount"], data["staff_notes"]
                case.handled_by, case.resolved_at = request.user, timezone.now()
                case.save()
                audit.record(
                    request.user, "case.resolved", case, before=before,
                    after=case_state(case) | {"refund": refund_payload(refund) if refund else None}, request=request,
                )  # fmt: skip
        except DomainError:
            if failure:  # the failed attempt is rolled back (so a retry can start clean) but the trail is kept
                audit.record(
                    request.user,
                    "case.refund_failed",
                    failure["case"],
                    summary=failure["message"][:300],
                    request=request,
                )
            raise
        return self._respond(case, refund=refund_payload(refund) if refund else None)

    @extend_schema(request=RejectSerializer, responses={200: CaseSerializer})
    @action(detail=True, methods=["post"], url_path="reject")
    def reject(self, request, pk=None):
        ser = RejectSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        with transaction.atomic():
            case = self._lock()
            self._ensure_open(case)
            before = case_state(case)
            case.status, case.resolution, case.refund_amount = CaseStatus.REJECTED, CaseResolution.NONE, Decimal("0")
            case.staff_notes, case.handled_by, case.resolved_at = (
                ser.validated_data["staff_notes"],
                request.user,
                timezone.now(),
            )
            case.save()
            audit.record(request.user, "case.rejected", case, before=before, after=case_state(case), request=request)
        return self._respond(case)
