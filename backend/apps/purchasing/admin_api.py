"""Staff API for suppliers, purchase orders, goods receiving and replenishment."""

from __future__ import annotations

import datetime as dt
from decimal import Decimal

from django.db import transaction
from django.db.models import Count, Q
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core import audit
from apps.core.admin_api import AdminViewSet, ensure_branch_access
from apps.core.exceptions import DomainError, ErrorCode
from apps.core.money import money, qty_str
from apps.core.pagination import StandardPagination
from apps.core.permissions import HasCapability, IsStaffUser, scope_by_branch

from . import services
from .models import POStatus, PurchaseOrder, Supplier, SupplierProduct


class SupplierSerializer(serializers.ModelSerializer):
    product_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Supplier
        fields = [
            "id",
            "code",
            "name",
            "contact_name",
            "email",
            "phone",
            "address",
            "status",
            "lead_time_days",
            "notes",
            "product_count",
            "is_demo",
        ]
        read_only_fields = ["id", "is_demo", "product_count"]


class SupplierViewSet(AdminViewSet):
    queryset = Supplier.objects.annotate(product_count=Count("products")).order_by("name")
    serializer_class = SupplierSerializer
    pagination_class = StandardPagination
    read_capability = "purchasing.read"
    capability = "purchasing.write"
    search_fields = ["name", "code", "contact_name", "email"]
    audit_label = "supplier"

    def get_queryset(self):
        qs = super().get_queryset()
        if self.request.query_params.get("status"):
            qs = qs.filter(status=self.request.query_params["status"])
        return qs

    def perform_destroy(self, instance):
        if instance.purchase_orders.exists() or instance.batches.exists():
            raise DomainError(
                ErrorCode.INVALID_STATE,
                "This supplier has purchase orders or stock history. Set it to inactive instead.",
                status_code=409,
            )
        super().perform_destroy(instance)

    @extend_schema(responses={200: dict})
    @action(detail=True, methods=["get", "put"], url_path="products")
    def products(self, request, pk=None):
        supplier = self.get_object()
        if request.method == "PUT":
            if not request.user.is_authenticated or "purchasing.write" not in request.user.capabilities():
                raise DomainError(ErrorCode.FORBIDDEN, "You can't change supplier products.", status_code=403)
            rows = request.data if isinstance(request.data, list) else request.data.get("products", [])
            seen = set()
            with transaction.atomic():
                supplier.supplierproduct_set.all().delete()
                for row in rows:
                    pid = int(row["product_id"])
                    if pid in seen:
                        continue
                    seen.add(pid)
                    cost = Decimal(str(row["unit_cost"])) if row.get("unit_cost") not in (None, "") else None
                    if cost is not None and cost < 0:
                        raise DomainError(ErrorCode.VALIDATION_ERROR, "Unit cost can't be negative.")
                    SupplierProduct.objects.create(
                        supplier=supplier,
                        product_id=pid,
                        supplier_sku=str(row.get("supplier_sku", ""))[:60],
                        unit_cost=cost,
                    )
                audit.record(
                    request.user,
                    "supplier.products_updated",
                    supplier,
                    summary=f"{len(seen)} products",
                    request=request,
                )
        rows = SupplierProduct.objects.filter(supplier=supplier).select_related("product")
        return Response(
            [
                {
                    "product_id": r.product_id,
                    "sku": r.product.sku,
                    "name": r.product.name,
                    "supplier_sku": r.supplier_sku,
                    "unit_cost": str(r.unit_cost) if r.unit_cost is not None else None,
                }
                for r in rows
            ]
        )

    @extend_schema(responses={200: dict})
    @action(detail=True, methods=["get"])
    def performance(self, request, pk=None):
        since = request.query_params.get("since")
        return Response(
            services.supplier_performance(self.get_object(), since=dt.date.fromisoformat(since) if since else None)
        )


class LineSerializer(serializers.Serializer):
    product_id = serializers.IntegerField(min_value=1)
    qty_ordered = serializers.DecimalField(max_digits=12, decimal_places=3, min_value=Decimal("0.001"))
    unit_cost = serializers.DecimalField(max_digits=10, decimal_places=4, min_value=Decimal("0"))


class POInputSerializer(serializers.Serializer):
    supplier_id = serializers.IntegerField(min_value=1, required=False)
    branch_id = serializers.IntegerField(min_value=1, required=False)
    expected_date = serializers.DateField(required=False, allow_null=True)
    notes = serializers.CharField(required=False, allow_blank=True, default="")
    lines = LineSerializer(many=True, required=False)


class ReceiveLineSerializer(serializers.Serializer):
    po_line_id = serializers.IntegerField(min_value=1)
    qty_accepted = serializers.DecimalField(
        max_digits=12, decimal_places=3, min_value=Decimal("0"), required=False, default=Decimal("0")
    )
    qty_rejected = serializers.DecimalField(
        max_digits=12, decimal_places=3, min_value=Decimal("0"), required=False, default=Decimal("0")
    )
    reject_reason = serializers.CharField(max_length=200, required=False, allow_blank=True, default="")
    lot_code = serializers.CharField(max_length=60, required=False, allow_blank=True, default="")
    expiry_date = serializers.DateField(required=False, allow_null=True)
    expiry_kind = serializers.ChoiceField(choices=["BEST_BEFORE", "USE_BY"], required=False, default="BEST_BEFORE")


class ReceiveSerializer(serializers.Serializer):
    idempotency_key = serializers.CharField(min_length=8, max_length=80)
    delivery_note = serializers.CharField(max_length=120, required=False, allow_blank=True, default="")
    notes = serializers.CharField(max_length=300, required=False, allow_blank=True, default="")
    lines = ReceiveLineSerializer(many=True)


class ReasonSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=300)


def po_row(po: PurchaseOrder) -> dict:
    return {
        "id": po.id,
        "number": po.number,
        "supplier": po.supplier.name,
        "supplier_id": po.supplier_id,
        "branch": po.branch.name,
        "branch_id": po.branch_id,
        "status": po.status,
        "status_label": po.get_status_display(),
        "expected_date": po.expected_date,
        "submitted_at": po.submitted_at,
        "created_at": po.created_at,
        "total_cost": str(money(sum((line.qty_ordered * line.unit_cost for line in po.lines.all()), Decimal("0")))),
        "line_count": len(po.lines.all()),
    }


def po_detail(po: PurchaseOrder) -> dict:
    return {
        **po_row(po),
        "notes": po.notes,
        "is_demo": po.is_demo,
        "lines": [
            {
                "id": ln.id,
                "product_id": ln.product_id,
                "sku": ln.product.sku,
                "name": ln.product.name,
                "unit": ln.product.sale_unit.symbol,
                "tracks_batches": ln.product.tracks_batches,
                "qty_ordered": qty_str(ln.qty_ordered),
                "unit_cost": str(ln.unit_cost),
                "qty_received": qty_str(ln.qty_received),
                "qty_rejected": qty_str(ln.qty_rejected),
                "outstanding": qty_str(max(ln.qty_ordered - ln.qty_received, Decimal("0"))),
            }
            for ln in po.lines.all()
        ],
        "receipts": [
            {
                "number": r.number,
                "at": r.created_at,
                "by": r.received_by.email if r.received_by_id else "",
                "delivery_note": r.delivery_note,
                "lines": [
                    {
                        "product": rl.po_line.product.name,
                        "accepted": qty_str(rl.qty_accepted),
                        "rejected": qty_str(rl.qty_rejected),
                        "reject_reason": rl.reject_reason,
                        "lot": rl.lot_code,
                        "expiry": rl.expiry_date,
                    }
                    for rl in r.lines.all()
                ],
            }
            for r in po.receipts.select_related("received_by").prefetch_related("lines__po_line__product")
        ],
    }


class PurchaseOrderViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsAuthenticated, IsStaffUser, HasCapability]
    pagination_class = StandardPagination
    capability_map = {
        "list": "purchasing.read",
        "retrieve": "purchasing.read",
        "create": "purchasing.write",
        "update": "purchasing.write",
        "partial_update": "purchasing.write",
        "submit": "purchasing.write",
        "confirm": "purchasing.write",
        "cancel": "purchasing.write",
        "receive": "purchasing.receive",
    }
    http_method_names = ["get", "post", "put", "patch", "head", "options"]

    def get_queryset(self):
        qs = PurchaseOrder.objects.select_related("supplier", "branch").prefetch_related("lines__product__sale_unit")
        qs = scope_by_branch(qs, self.request.user, "branch_id")
        p = self.request.query_params
        if p.get("status"):
            qs = qs.filter(status__in=p["status"].split(","))
        if p.get("supplier", "").isdigit():
            qs = qs.filter(supplier_id=p["supplier"])
        if p.get("branch", "").isdigit():
            qs = qs.filter(branch_id=p["branch"])
        if p.get("outstanding") == "true":
            qs = qs.filter(status__in=[POStatus.SUBMITTED, POStatus.CONFIRMED, POStatus.PARTIALLY_RECEIVED])
        if q := (p.get("search") or "").strip():
            qs = qs.filter(Q(number__icontains=q) | Q(supplier__name__icontains=q))
        return qs.order_by("-created_at")

    def list(self, request, *args, **kwargs):
        page = self.paginate_queryset(self.get_queryset())
        return self.get_paginated_response([po_row(po) for po in page])

    def retrieve(self, request, *args, **kwargs):
        return Response(po_detail(self.get_object()))

    @extend_schema(request=POInputSerializer, responses={201: dict})
    def create(self, request, *args, **kwargs):
        ser = POInputSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        if "supplier_id" not in d or "branch_id" not in d:
            raise DomainError(ErrorCode.VALIDATION_ERROR, "Choose a supplier and a destination branch.")
        ensure_branch_access(request.user, d["branch_id"])
        supplier = Supplier.objects.filter(pk=d["supplier_id"]).first()
        if supplier is None:
            raise DomainError(ErrorCode.NOT_FOUND, "Unknown supplier.", status_code=404)
        po = services.create_po(
            supplier=supplier,
            branch_id=d["branch_id"],
            lines=[dict(line) for line in d.get("lines", [])],
            actor=request.user,
            expected_date=d.get("expected_date"),
            notes=d.get("notes", ""),
        )
        return Response(po_detail(self.get_queryset().get(pk=po.pk)), status=201)

    @extend_schema(request=POInputSerializer, responses={200: dict})
    def update(self, request, *args, **kwargs):
        ser = POInputSerializer(data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        po = self.get_object()
        d = ser.validated_data
        with transaction.atomic():
            if "lines" in d:
                services.set_lines(po, [dict(line) for line in d["lines"]])
            fresh = PurchaseOrder.objects.select_for_update().get(pk=po.pk)
            if fresh.status != POStatus.DRAFT and ("expected_date" in d or "notes" in d) and "lines" not in d:
                if "notes" in d:
                    fresh.notes = d["notes"]
                if "expected_date" in d:
                    fresh.expected_date = d["expected_date"]
            elif fresh.status == POStatus.DRAFT:
                fresh.notes = d.get("notes", fresh.notes)
                fresh.expected_date = d.get("expected_date", fresh.expected_date)
            fresh.save()
            audit.record(request.user, "po.updated", fresh, summary=fresh.number, request=request)
        return Response(po_detail(self.get_queryset().get(pk=po.pk)))

    partial_update = update

    @extend_schema(request=None, responses={200: dict})
    @action(detail=True, methods=["post"])
    def submit(self, request, pk=None):
        services.submit_po(self.get_object(), request.user)
        return Response(po_detail(self.get_queryset().get(pk=pk)))

    @extend_schema(request=None, responses={200: dict})
    @action(detail=True, methods=["post"])
    def confirm(self, request, pk=None):
        services.confirm_po(self.get_object(), request.user)
        return Response(po_detail(self.get_queryset().get(pk=pk)))

    @extend_schema(request=ReasonSerializer, responses={200: dict})
    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        ser = ReasonSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        services.cancel_po(self.get_object(), request.user, ser.validated_data["reason"])
        return Response(po_detail(self.get_queryset().get(pk=pk)))

    @extend_schema(request=ReceiveSerializer, responses={200: dict})
    @action(detail=True, methods=["post"])
    def receive(self, request, pk=None):
        ser = ReceiveSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        receipt, replayed = services.receive_goods(
            self.get_object(),
            [dict(line) for line in d["lines"]],
            idempotency_key=d["idempotency_key"],
            actor=request.user,
            delivery_note=d["delivery_note"],
            notes=d["notes"],
        )
        data = po_detail(self.get_queryset().get(pk=pk))
        data["receipt"] = {"number": receipt.number, "replayed": replayed}
        return Response(data)


class ReplenishmentView(APIView):
    permission_classes = [IsAuthenticated, IsStaffUser, HasCapability]
    read_capability = "purchasing.read"

    @extend_schema(responses={200: dict})
    def get(self, request):
        raw = request.query_params.get("branch", "")
        if not raw.isdigit():
            raise DomainError(ErrorCode.VALIDATION_ERROR, "Choose a branch.")
        ensure_branch_access(request.user, int(raw))
        return Response(services.replenishment_suggestions(int(raw)))
