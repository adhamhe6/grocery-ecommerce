"""Staff API for orders: queue, pick sheet, fulfilment actions, cancellations and refunds.

Every action maps to a service function that enforces the business rules (state machine, weight tolerance,
substitution policy, payment capture). The API never accepts a raw status string.
"""

from __future__ import annotations

import datetime as dt
from decimal import Decimal

from django.db import transaction
from django.db.models import Count, Exists, OuterRef, Prefetch, Q
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.accounts.models import User
from apps.core import audit
from apps.core.exceptions import DomainError, ErrorCode
from apps.core.pagination import StandardPagination
from apps.core.permissions import HasCapability, IsStaffUser, scope_by_branch, user_has_capability
from apps.inventory.models import Allocation, AllocationState
from apps.payments import services as payments
from apps.payments.models import Refund, RefundStatus

from . import fulfilment, workflow
from .models import Order, OrderItem, OrderItemStatus, OrderStatus, Substitution, SubstitutionStatus
from .serializers import media_url

STORAGE_ORDER = {"AMBIENT": 0, "CHILLED": 1, "FROZEN": 2}
QUEUE_STATUSES = [
    OrderStatus.CONFIRMED,
    OrderStatus.PICKING,
    OrderStatus.PACKING,
    OrderStatus.READY_FOR_PICKUP,
    OrderStatus.READY_FOR_DISPATCH,
    OrderStatus.OUT_FOR_DELIVERY,
]


def qs_str(value):
    from apps.core.money import qty_str

    return qty_str(value)


def order_row(o: Order) -> dict:
    return {
        "number": o.number,
        "status": o.status,
        "status_label": o.get_status_display(),
        "payment_status": o.payment_status,
        "payment_method": o.payment_method,
        "fulfilment_type": o.fulfilment_type,
        "placed_at": o.placed_at,
        "slot_starts_at": o.slot_starts_at,
        "slot_ends_at": o.slot_ends_at,
        "customer": o.contact_name,
        "is_guest": o.customer_id is None,
        "customer_id": o.customer_id,
        "branch": o.branch.name,
        "branch_id": o.branch_id,
        "total": str(o.total),
        "final_total": str(o.final_total) if o.final_total is not None else None,
        "item_count": getattr(o, "item_count", None),
        "assigned_to": o.assigned_to.full_name if o.assigned_to_id else None,
        "awaiting_customer": getattr(o, "awaiting_customer", False),
        "is_late": bool(
            o.slot_starts_at
            and o.slot_starts_at < timezone.now()
            and o.status in (OrderStatus.CONFIRMED, OrderStatus.PICKING)
        ),
        "substitution_policy": o.substitution_policy,
    }


def staff_item(item: OrderItem, lots: dict[int, list]) -> dict:
    p = item.product
    return {
        "id": item.id,
        "product_id": item.product_id,
        "name": item.name,
        "sku": item.sku,
        "image": media_url(item.image_path),
        "unit": item.unit_symbol,
        "storage": p.storage_type,
        "category": p.category.name,
        "ordered_qty": qs_str(item.ordered_qty),
        "picked_qty": qs_str(item.picked_qty),
        "qty_min": qs_str(p.qty_min),  # the product's ordering rules, so a picking UI steps correctly
        "qty_step": qs_str(p.qty_step),
        "unit_price": str(item.unit_price),
        "line_total_estimated": str(item.line_total_estimated),
        "line_total_final": str(item.line_total_final) if item.line_total_final is not None else None,
        "status": item.status,
        "is_variable_weight": item.is_variable_weight,
        "is_substitute": item.substitute_for_id is not None,
        "substitute_for": item.substitute_for_id,
        "substitution_pref": item.substitution_pref,
        "picker_note": item.picker_note,
        "lots": lots.get(item.id, []),
        "tolerance": (
            {
                "min": qs_str(fulfilment.tolerance_bounds(item, fulfilment.StoreSettings.load())[0]),
                "max": qs_str(fulfilment.tolerance_bounds(item, fulfilment.StoreSettings.load())[1]),
            }
            if item.is_variable_weight
            else None
        ),
    }


def order_detail(o: Order) -> dict:
    allocs = Allocation.objects.filter(
        order_item__order=o, state__in=[AllocationState.RESERVED, AllocationState.COMMITTED]
    ).select_related("batch")
    lots: dict[int, list] = {}
    for a in allocs:
        if a.batch_id:
            lots.setdefault(a.order_item_id, []).append(
                {"lot": a.batch.lot_code, "expiry": a.batch.expiry_date, "qty": qs_str(a.qty), "state": a.state}
            )
    items = sorted(
        o.items.all(), key=lambda i: (STORAGE_ORDER.get(i.product.storage_type, 0), i.product.category.name, i.name)
    )
    subs = Substitution.objects.filter(order_item__order=o).select_related("order_item", "substitute_product")
    store = fulfilment.StoreSettings.load()
    return {
        **order_row(o),
        "contact": {"name": o.contact_name, "email": o.contact_email, "phone": o.contact_phone},
        "address": {
            "recipient": o.ship_recipient,
            "phone": o.ship_phone,
            "line1": o.ship_line1,
            "line2": o.ship_line2,
            "city": o.ship_city,
            "area": o.ship_area,
            "postal_code": o.ship_postal_code,
            "instructions": o.ship_instructions,
        }
        if o.fulfilment_type == "DELIVERY"
        else None,
        "customer_note": o.customer_note,
        "currency": o.currency,
        "items": [staff_item(i, lots) for i in items],
        "substitutions": [
            {
                "id": s.id,
                "item_id": s.order_item_id,
                "original": s.order_item.name,
                "substitute": s.substitute_product.name,
                "status": s.status,
                "policy": s.policy_snapshot,
                "charged_unit_price": str(s.charged_unit_price),
                "list_unit_price": str(s.list_unit_price),
                "price_difference": str(s.price_difference),
                "reason": s.reason,
            }
            for s in subs
        ],
        "totals": {
            "subtotal": str(o.subtotal),
            "promo_savings": str(o.promo_savings),
            "coupon_code": o.coupon_code,
            "coupon_discount": str(o.coupon_discount),
            "delivery_fee": str(o.delivery_fee),
            "tax_total": str(o.tax_total),
            "total": str(o.total),
            "max_charge": str(o.authorized_amount),
            "final_total": str(o.final_total) if o.final_total is not None else None,
        },
        "policy": {
            "weight_tolerance_percent": str(store.weight_tolerance_percent),
            "substitution_price_cap": store.substitution_price_cap,
        },
        "history": [
            {
                "at": h.created_at,
                "from": h.from_status,
                "to": h.to_status,
                "by": h.actor_label,
                "note": h.note,
                "public_note": h.public_note,
            }
            for h in o.history.all()
        ],
        "payments": [
            {
                "id": p.id,
                "provider": p.provider,
                "method": p.method,
                "state": p.state,
                "amount": str(p.amount),
                "captured": str(p.captured_amount),
                "refunded": str(p.refunded_amount),
                "attempt": p.attempt,
                "reference": p.provider_reference,
                "failure": p.failure_message,
                "is_demo": p.is_demo,
            }
            for p in o.payments.all()
        ],
        "refunds": [
            {
                "id": r.id,
                "amount": str(r.amount),
                "status": r.status,
                "method": r.method,
                "reason": r.reason,
                "reference": r.reference,
                "failure": r.failure_message,
                "created_at": r.created_at,
                "completed_at": r.completed_at,
            }
            for r in o.refunds.all()
        ],
        "cases": [{"id": c.id, "kind": c.kind, "status": c.status, "created_at": c.created_at} for c in o.cases.all()],
        "allowed_transitions": workflow.allowed_next(o),
    }


class PickSerializer(serializers.Serializer):
    picked_qty = serializers.DecimalField(max_digits=10, decimal_places=3, min_value=Decimal("0"))
    note = serializers.CharField(max_length=300, required=False, allow_blank=True, default="")
    override = serializers.BooleanField(required=False, default=False)


class ReasonSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=300, required=False, allow_blank=True, default="")


class ProposeSerializer(serializers.Serializer):
    product_id = serializers.IntegerField(min_value=1)
    quantity = serializers.DecimalField(max_digits=10, decimal_places=3, required=False, allow_null=True)
    reason = serializers.CharField(max_length=300, required=False, allow_blank=True, default="")


class DecideSerializer(serializers.Serializer):
    approve = serializers.BooleanField()
    note = serializers.CharField(max_length=200, required=False, allow_blank=True, default="")


class CompleteSerializer(serializers.Serializer):
    collected_amount = serializers.DecimalField(max_digits=12, decimal_places=2, required=False, allow_null=True)
    reference = serializers.CharField(max_length=120, required=False, allow_blank=True, default="")


class AssignSerializer(serializers.Serializer):
    user_id = serializers.IntegerField(allow_null=True)


class RefundSerializer(serializers.Serializer):
    amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0.01"))
    reason = serializers.CharField(max_length=300)
    idempotency_key = serializers.CharField(max_length=120, min_length=8)
    manual = serializers.BooleanField(required=False, default=False)


class ManualRefundSerializer(serializers.Serializer):
    reference = serializers.CharField(max_length=120)


class OrderAdminViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsAuthenticated, IsStaffUser, HasCapability]
    lookup_field = "number"
    lookup_value_regex = r"[A-Za-z0-9\-]+"
    pagination_class = StandardPagination
    capability_map = {
        "list": "orders.read",
        "retrieve": "orders.read",
        "queue": "orders.read",
        "item_substitutes": "orders.read",
        "start_picking": "orders.fulfil",
        "finish_picking": "orders.fulfil",
        "reopen_picking": "orders.fulfil",
        "finish_packing": "orders.fulfil",
        "dispatch_order": "orders.fulfil",
        "complete": "orders.fulfil",
        "pick_item": "orders.fulfil",
        "unavailable": "orders.fulfil",
        "propose": "orders.fulfil",
        "remove_item": "orders.fulfil",
        "cancel": "orders.manage",
        "assign": "orders.manage",
        "decide": "orders.manage",
        "refund": "orders.refund",
        "complete_manual_refund": "orders.refund",
    }

    def get_queryset(self):
        qs = Order.objects.select_related("branch", "assigned_to", "customer").annotate(item_count=Count("items"))
        qs = qs.annotate(
            awaiting_customer=Exists(
                Substitution.objects.filter(
                    order_item__order=OuterRef("pk"), status=SubstitutionStatus.AWAITING_CUSTOMER
                )
            )
        )
        if self.action == "retrieve" or self.action not in ("list", "queue"):
            qs = qs.prefetch_related(
                Prefetch("items", queryset=OrderItem.objects.select_related("product__category")),
                "history",
                "payments",
                "refunds",
                "cases",
            )
        qs = scope_by_branch(
            qs, self.request.user, "branch_id"
        )  # other branches' orders simply don't exist for this user
        p = self.request.query_params
        if p.get("status"):
            qs = qs.filter(status__in=p["status"].split(","))
        if p.get("branch") and p["branch"].isdigit():
            qs = qs.filter(branch_id=p["branch"])
        if p.get("fulfilment_type"):
            qs = qs.filter(fulfilment_type=p["fulfilment_type"])
        if p.get("payment_status"):
            qs = qs.filter(payment_status=p["payment_status"])
        if p.get("placed_from"):
            qs = qs.filter(placed_at__date__gte=p["placed_from"])
        if p.get("placed_to"):
            qs = qs.filter(placed_at__date__lte=p["placed_to"])
        if p.get("slot_date"):
            qs = qs.filter(slot_starts_at__date=p["slot_date"])
        if p.get("mine") == "true":
            qs = qs.filter(assigned_to=self.request.user)
        if p.get("needs_attention") == "true":
            qs = qs.filter(Q(awaiting_customer=True) | Q(payment_status="FAILED"))
        if q := (p.get("search") or "").strip():
            qs = qs.filter(
                Q(number__icontains=q)
                | Q(contact_name__icontains=q)
                | Q(contact_email__icontains=q)
                | Q(contact_phone__icontains=q)
            )
        order = p.get("ordering", "-placed_at")
        return qs.order_by(
            order if order.lstrip("-") in {"placed_at", "slot_starts_at", "total", "status"} else "-placed_at", "-id"
        )

    def list(self, request, *args, **kwargs):
        page = self.paginate_queryset(self.filter_queryset(self.get_queryset()))
        return self.get_paginated_response([order_row(o) for o in page])

    def retrieve(self, request, *args, **kwargs):
        return Response(order_detail(self.get_object()))

    def _fresh(self, number: str) -> Response:
        order = self.get_queryset().get(number=number)
        return Response(order_detail(order))

    def _item(self, order: Order, item_id: int) -> OrderItem:
        item = OrderItem.objects.filter(pk=item_id, order=order).first()  # the item must belong to *this* order
        if item is None:
            raise DomainError(ErrorCode.NOT_FOUND, "That item isn't part of this order.", status_code=404)
        return item

    # ---------------------------------------------------------------- queue
    @extend_schema(responses={200: dict})
    @action(detail=False, methods=["get"])
    def queue(self, request):
        """Orders still to be picked/packed/handed over, grouped by slot window, with lateness and progress flags."""
        qs = self.get_queryset().filter(status__in=QUEUE_STATUSES)
        date = request.query_params.get("date")
        if date:
            qs = qs.filter(slot_starts_at__date=date)
        else:
            qs = qs.filter(slot_starts_at__lt=timezone.now() + dt.timedelta(days=2))
        orders = list(qs.order_by("slot_starts_at", "placed_at")[:300])
        progress = {
            r["order_id"]: r
            for r in OrderItem.objects.filter(order__in=orders)
            .values("order_id")
            .annotate(
                total=Count(
                    "id",
                    filter=~Q(
                        status__in=[OrderItemStatus.REMOVED, OrderItemStatus.SUBSTITUTED, OrderItemStatus.PROPOSED]
                    ),
                ),
                done=Count("id", filter=Q(status__in=[OrderItemStatus.PICKED, OrderItemStatus.SHORT])),
            )
        }
        groups: dict[str, dict] = {}
        for o in orders:
            key = o.slot_starts_at.isoformat() if o.slot_starts_at else "none"
            g = groups.setdefault(
                key, {"slot_starts_at": o.slot_starts_at, "slot_ends_at": o.slot_ends_at, "orders": []}
            )
            row = order_row(o)
            pr = progress.get(o.id, {"total": 0, "done": 0})
            row.update(lines=pr["total"], lines_done=pr["done"])
            g["orders"].append(row)
        counts = {s: sum(1 for o in orders if o.status == s) for s in QUEUE_STATUSES}
        return Response({"counts": counts, "groups": list(groups.values())})

    # ---------------------------------------------------------------- order-level actions
    @extend_schema(request=None, responses={200: dict})
    @action(detail=True, methods=["post"], url_path="start-picking")
    def start_picking(self, request, number=None):
        order = self.get_object()
        fulfilment.start_picking(order, request.user)
        return self._fresh(number)

    @extend_schema(request=None, responses={200: dict})
    @action(detail=True, methods=["post"], url_path="finish-picking")
    def finish_picking(self, request, number=None):
        fulfilment.finish_picking(self.get_object(), request.user)
        return self._fresh(number)

    @extend_schema(request=None, responses={200: dict})
    @action(detail=True, methods=["post"], url_path="reopen-picking")
    def reopen_picking(self, request, number=None):
        fulfilment.reopen_picking(self.get_object(), request.user)
        return self._fresh(number)

    @extend_schema(request=None, responses={200: dict})
    @action(detail=True, methods=["post"], url_path="finish-packing")
    def finish_packing(self, request, number=None):
        fulfilment.finish_packing(self.get_object(), request.user)
        return self._fresh(number)

    @extend_schema(request=None, responses={200: dict})
    @action(detail=True, methods=["post"], url_path="dispatch", url_name="dispatch")
    def dispatch_order(
        self, request, number=None
    ):  # NB: must not be called `dispatch` (that overrides APIView.dispatch)
        fulfilment.dispatch(self.get_object(), request.user)
        return self._fresh(number)

    @extend_schema(request=CompleteSerializer, responses={200: dict})
    @action(detail=True, methods=["post"])
    def complete(self, request, number=None):
        ser = CompleteSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        fulfilment.complete(
            self.get_object(),
            request.user,
            collected_amount=ser.validated_data.get("collected_amount"),
            reference=ser.validated_data["reference"],
        )
        return self._fresh(number)

    @extend_schema(request=ReasonSerializer, responses={200: dict})
    @action(detail=True, methods=["post"])
    def cancel(self, request, number=None):
        ser = ReasonSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        workflow.cancel_order(
            self.get_object(), actor=request.user, reason=ser.validated_data["reason"], by_customer=False
        )
        return self._fresh(number)

    @extend_schema(request=AssignSerializer, responses={200: dict})
    @action(detail=True, methods=["post"])
    def assign(self, request, number=None):
        ser = AssignSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        order = self.get_object()
        user = None
        if ser.validated_data["user_id"] is not None:
            user = User.objects.filter(
                pk=ser.validated_data["user_id"],
                is_active=True,
                role__in=["FULFILMENT_STAFF", "STORE_MANAGER", "ADMIN", "SUPER_ADMIN"],
            ).first()
            if user is None or (not user_has_capability(user, "orders.fulfil")):
                raise DomainError(ErrorCode.VALIDATION_ERROR, "Choose a fulfilment team member.")
            from apps.core.permissions import can_access_branch

            if not can_access_branch(user, order.branch_id):
                raise DomainError(ErrorCode.VALIDATION_ERROR, "That person doesn't work at this branch.")
        with transaction.atomic():
            Order.objects.filter(pk=order.pk).update(assigned_to=user)
            workflow.add_history(order, f"Assigned to {user.email if user else 'nobody'}", actor=request.user)
        return self._fresh(number)

    # ---------------------------------------------------------------- item-level actions
    @extend_schema(request=PickSerializer, responses={200: dict})
    @action(detail=True, methods=["post"], url_path=r"items/(?P<item_id>\d+)/pick")
    def pick_item(self, request, number=None, item_id=None):
        ser = PickSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        order = self.get_object()
        item = self._item(order, int(item_id))
        override = ser.validated_data["override"]
        if override and not user_has_capability(request.user, "orders.manage"):
            raise DomainError(ErrorCode.FORBIDDEN, "Only a manager can override the weight tolerance.", status_code=403)
        fulfilment.pick_item(
            item.id, ser.validated_data["picked_qty"], request.user, note=ser.validated_data["note"], override=override
        )
        return self._fresh(number)

    @extend_schema(request=ReasonSerializer, responses={200: dict})
    @action(detail=True, methods=["post"], url_path=r"items/(?P<item_id>\d+)/unavailable")
    def unavailable(self, request, number=None, item_id=None):
        ser = ReasonSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        item = self._item(self.get_object(), int(item_id))
        fulfilment.mark_unavailable(item.id, request.user, ser.validated_data["reason"] or "Not available")
        return self._fresh(number)

    @extend_schema(responses={200: dict})
    @action(detail=True, methods=["get"], url_path=r"items/(?P<item_id>\d+)/substitutes")
    def item_substitutes(self, request, number=None, item_id=None):
        item = self._item(self.get_object(), int(item_id))
        return Response(
            {
                "policy": fulfilment.effective_policy(item.order, item),
                "candidates": fulfilment.candidate_substitutes(item.id),
            }
        )

    @extend_schema(request=ProposeSerializer, responses={200: dict})
    @action(detail=True, methods=["post"], url_path=r"items/(?P<item_id>\d+)/substitute")
    def propose(self, request, number=None, item_id=None):
        ser = ProposeSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        item = self._item(self.get_object(), int(item_id))
        d = ser.validated_data
        fulfilment.propose_substitution(
            item.id, d["product_id"], request.user, quantity=d.get("quantity"), reason=d["reason"]
        )
        return self._fresh(number)

    @extend_schema(request=ReasonSerializer, responses={200: dict})
    @action(detail=True, methods=["post"], url_path=r"items/(?P<item_id>\d+)/remove")
    def remove_item(self, request, number=None, item_id=None):
        ser = ReasonSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        item = self._item(self.get_object(), int(item_id))
        fulfilment.remove_item(item.id, request.user, ser.validated_data["reason"])
        return self._fresh(number)

    @extend_schema(request=DecideSerializer, responses={200: dict})
    @action(detail=True, methods=["post"], url_path=r"substitutions/(?P<sub_id>\d+)/decide")
    def decide(self, request, number=None, sub_id=None):
        ser = DecideSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        order = self.get_object()
        sub = Substitution.objects.filter(pk=sub_id, order_item__order=order).first()
        if sub is None:
            raise DomainError(ErrorCode.NOT_FOUND, "That substitution isn't part of this order.", status_code=404)
        if not ser.validated_data["note"].strip():
            raise DomainError(
                ErrorCode.VALIDATION_ERROR,
                "Say how the customer answered (e.g. 'phoned at 10:42') — it is recorded on the order.",
            )
        fulfilment.decide_substitution(
            sub.pk, ser.validated_data["approve"], request.user, on_behalf_note=ser.validated_data["note"]
        )
        return self._fresh(number)

    # ---------------------------------------------------------------- refunds
    @extend_schema(request=RefundSerializer, responses={200: dict})
    @action(detail=True, methods=["post"])
    def refund(self, request, number=None):
        ser = RefundSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        order = self.get_object()
        with transaction.atomic():
            refund = payments.request_refund(
                order, d["amount"], d["reason"], request.user, d["idempotency_key"], manual=d["manual"]
            )
        audit.record(
            request.user,
            "refund.api",
            refund,
            summary=f"{order.number} {d['amount']} → {refund.status}",
            request=request,
        )
        data = order_detail(self.get_queryset().get(number=number))
        data["refund_result"] = {"id": refund.id, "status": refund.status, "message": refund.failure_message}
        return Response(data)

    @extend_schema(request=ManualRefundSerializer, responses={200: dict})
    @action(detail=True, methods=["post"], url_path=r"refunds/(?P<refund_id>\d+)/complete")
    def complete_manual_refund(self, request, number=None, refund_id=None):
        ser = ManualRefundSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        order = self.get_object()
        refund = Refund.objects.filter(pk=refund_id, order=order, status=RefundStatus.PENDING).first()
        if refund is None:
            raise DomainError(ErrorCode.NOT_FOUND, "No pending refund with that id on this order.", status_code=404)
        with transaction.atomic():
            payments.complete_manual_refund(refund, ser.validated_data["reference"], request.user)
        return self._fresh(number)
