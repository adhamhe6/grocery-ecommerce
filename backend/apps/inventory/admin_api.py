"""Staff API for stock levels, batches/expiry, movements, adjustments, waste and transfers."""

from __future__ import annotations

import datetime as dt
from decimal import Decimal

from django.db import transaction
from django.db.models import F, Max, Q
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.catalog.models import Product
from apps.core import audit
from apps.core.admin_api import ensure_branch_access
from apps.core.exceptions import DomainError, ErrorCode
from apps.core.money import ZERO, money, qty_str
from apps.core.pagination import StandardPagination
from apps.core.permissions import HasCapability, IsStaffUser, scope_by_branch

from . import services
from .models import Batch, BatchStatus, QualityStatus, StockLevel, StockMovement, WasteReason


class StockSerializer(serializers.Serializer):
    def to_representation(self, lv: StockLevel):
        p = lv.product
        free = lv.on_hand - lv.reserved
        status = (
            "OUT" if free <= 0 else ("LOW" if lv.low_stock_threshold > 0 and free <= lv.low_stock_threshold else "OK")
        )
        return {
            "id": lv.id,
            "product_id": p.id,
            "sku": p.sku,
            "name": p.name,
            "unit": p.sale_unit.symbol,
            "category": p.category.name,
            "branch_id": lv.branch_id,
            "branch": lv.branch.name,
            "tracks_batches": p.tracks_batches,
            "on_hand": qty_str(lv.on_hand),
            "reserved": qty_str(lv.reserved),
            "available": qty_str(free),
            "low_stock_threshold": qty_str(lv.low_stock_threshold),
            "reorder_quantity": qty_str(lv.reorder_quantity),
            "status": status,
            "last_movement_at": getattr(lv, "last_movement", None),
        }


class ThresholdSerializer(serializers.Serializer):
    low_stock_threshold = serializers.DecimalField(
        max_digits=12, decimal_places=3, min_value=Decimal("0"), required=False
    )
    reorder_quantity = serializers.DecimalField(max_digits=12, decimal_places=3, min_value=Decimal("0"), required=False)


class StockViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsAuthenticated, IsStaffUser, HasCapability]
    pagination_class = StandardPagination
    capability_map = {"list": "inventory.read", "retrieve": "inventory.read", "thresholds": "inventory.adjust"}

    def get_queryset(self):
        qs = StockLevel.objects.select_related("product__sale_unit", "product__category", "branch").annotate(
            last_movement=Max("product__movements__created_at", filter=Q(product__movements__branch_id=F("branch_id")))
        )
        qs = scope_by_branch(qs, self.request.user, "branch_id")
        p = self.request.query_params
        if p.get("branch", "").isdigit():
            qs = qs.filter(branch_id=p["branch"])
        if q := (p.get("search") or "").strip():
            qs = qs.filter(Q(product__name__icontains=q) | Q(product__sku__icontains=q))
        if p.get("category", "").isdigit():
            qs = qs.filter(Q(product__category_id=p["category"]) | Q(product__category__parent_id=p["category"]))
        status = p.get("status")
        qs = qs.annotate(free=F("on_hand") - F("reserved"))
        if status == "out":
            qs = qs.filter(free__lte=0)
        elif status == "low":
            qs = qs.filter(free__gt=0, low_stock_threshold__gt=0, free__lte=F("low_stock_threshold"))
        elif status == "low_or_out":
            qs = qs.filter(Q(free__lte=0) | Q(low_stock_threshold__gt=0, free__lte=F("low_stock_threshold")))
        if p.get("tracks_batches") in ("true", "false"):
            qs = qs.filter(product__tracks_batches=(p["tracks_batches"] == "true"))
        ordering = p.get("ordering", "product__name")
        allowed = {"product__name", "-product__name", "free", "-free", "on_hand", "-on_hand", "branch__name"}
        return qs.order_by(ordering if ordering in allowed else "product__name", "id")

    def list(self, request, *args, **kwargs):
        page = self.paginate_queryset(self.get_queryset())
        return self.get_paginated_response(StockSerializer(page, many=True).data)

    def retrieve(self, request, *args, **kwargs):
        return Response(StockSerializer(self.get_object()).data)

    @extend_schema(request=ThresholdSerializer, responses={200: dict})
    @action(detail=True, methods=["patch"])
    def thresholds(self, request, pk=None):
        lv = self.get_object()
        ser = ThresholdSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        before = {"low_stock_threshold": str(lv.low_stock_threshold), "reorder_quantity": str(lv.reorder_quantity)}
        for k, v in ser.validated_data.items():
            setattr(lv, k, v)
        lv.save()
        audit.record(
            request.user,
            "stock.thresholds",
            lv,
            before=before,
            after={k: str(v) for k, v in ser.validated_data.items()},
            request=request,
        )
        return Response(StockSerializer(lv).data)


class MovementViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsAuthenticated, IsStaffUser, HasCapability]
    read_capability = "inventory.read"
    pagination_class = StandardPagination

    def get_queryset(self):
        qs = StockMovement.objects.select_related("product", "branch", "batch", "actor")
        qs = scope_by_branch(qs, self.request.user, "branch_id")
        p = self.request.query_params
        if p.get("branch", "").isdigit():
            qs = qs.filter(branch_id=p["branch"])
        if p.get("product", "").isdigit():
            qs = qs.filter(product_id=p["product"])
        if p.get("kind"):
            qs = qs.filter(kind__in=p["kind"].split(","))
        if p.get("date_from"):
            qs = qs.filter(created_at__date__gte=p["date_from"])
        if p.get("date_to"):
            qs = qs.filter(created_at__date__lte=p["date_to"])
        if q := (p.get("search") or "").strip():
            qs = qs.filter(
                Q(product__name__icontains=q)
                | Q(product__sku__icontains=q)
                | Q(ref_id__icontains=q)
                | Q(batch__lot_code__icontains=q)
            )
        return qs.order_by("-created_at", "-id")

    def _row(self, m: StockMovement) -> dict:
        return {
            "id": m.id,
            "at": m.created_at,
            "kind": m.kind,
            "kind_label": m.get_kind_display(),
            "product_id": m.product_id,
            "sku": m.product.sku,
            "name": m.product.name,
            "branch": m.branch.name,
            "qty_delta": qty_str(m.qty_delta),
            "on_hand_after": qty_str(m.on_hand_after),
            "lot": m.batch.lot_code if m.batch_id else "",
            "reason": m.reason_code,
            "note": m.note,
            "by": m.actor.email if m.actor_id else "system",
            "ref": f"{m.ref_type} {m.ref_id}".strip(),
        }

    def list(self, request, *args, **kwargs):
        page = self.paginate_queryset(self.get_queryset())
        return self.get_paginated_response([self._row(m) for m in page])

    def retrieve(self, request, *args, **kwargs):
        return Response(self._row(self.get_object()))


class BatchStatusSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=[BatchStatus.ACTIVE, BatchStatus.QUARANTINED], required=False)
    quality_status = serializers.ChoiceField(choices=QualityStatus.values, required=False)
    note = serializers.CharField(max_length=200, required=False, allow_blank=True, default="")


class BatchViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsAuthenticated, IsStaffUser, HasCapability]
    pagination_class = StandardPagination
    capability_map = {"list": "inventory.read", "retrieve": "inventory.read", "set_status": "inventory.batches"}

    def get_queryset(self):
        qs = Batch.objects.select_related("product__sale_unit", "branch", "supplier")
        qs = scope_by_branch(qs, self.request.user, "branch_id")
        p = self.request.query_params
        today = timezone.localdate()
        if p.get("branch", "").isdigit():
            qs = qs.filter(branch_id=p["branch"])
        if p.get("product", "").isdigit():
            qs = qs.filter(product_id=p["product"])
        if p.get("status"):
            qs = qs.filter(status__in=p["status"].split(","))
        if p.get("on_hand") == "true":
            qs = qs.filter(qty_remaining__gt=0)
        if p.get("expired") == "true":
            qs = qs.filter(qty_remaining__gt=0, expiry_date__lt=today)
        if p.get("expiring_within", "").isdigit():
            qs = qs.filter(
                qty_remaining__gt=0,
                expiry_date__gte=today,
                expiry_date__lte=today + dt.timedelta(days=int(p["expiring_within"])),
            )
        if q := (p.get("search") or "").strip():
            qs = qs.filter(Q(lot_code__icontains=q) | Q(product__name__icontains=q) | Q(product__sku__icontains=q))
        return qs.order_by("expiry_date", "id")

    def _row(self, b: Batch) -> dict:
        today = timezone.localdate()
        days = (b.expiry_date - today).days if b.expiry_date else None
        value = b.qty_remaining * b.unit_cost if b.unit_cost is not None else None
        return {
            "id": b.id,
            "product_id": b.product_id,
            "sku": b.product.sku,
            "name": b.product.name,
            "unit": b.product.sale_unit.symbol,
            "branch": b.branch.name,
            "branch_id": b.branch_id,
            "lot_code": b.lot_code,
            "supplier": b.supplier.name if b.supplier_id else None,
            "received_on": b.received_on,
            "expiry_date": b.expiry_date,
            "expiry_kind": b.expiry_kind,
            "sellable_until": b.sellable_until,
            "days_to_expiry": days,
            "qty_received": qty_str(b.qty_received),
            "qty_remaining": qty_str(b.qty_remaining),
            "qty_reserved": qty_str(b.qty_reserved),
            "unit_cost": str(b.unit_cost) if b.unit_cost is not None else None,
            "value": str(money(value)) if value is not None else None,
            "status": b.status,
            "quality_status": b.quality_status,
            "is_demo": b.is_demo,
            "risk": (
                "EXPIRED"
                if days is not None and days < 0
                else "TODAY_TOMORROW"
                if days is not None and days <= 1
                else "SOON"
                if days is not None and days <= 3
                else "WATCH"
                if days is not None and days <= 7
                else "OK"
            )
            if b.qty_remaining > 0
            else "NONE",
            "can_sell": b.status == BatchStatus.ACTIVE
            and b.quality_status == QualityStatus.PASSED
            and (b.sellable_until is None or b.sellable_until >= today),
        }

    def list(self, request, *args, **kwargs):
        page = self.paginate_queryset(self.get_queryset())
        return self.get_paginated_response([self._row(b) for b in page])

    def retrieve(self, request, *args, **kwargs):
        b = self.get_object()
        data = self._row(b)
        data["movements"] = [
            {
                "at": m.created_at,
                "kind": m.get_kind_display(),
                "qty_delta": qty_str(m.qty_delta),
                "by": m.actor.email if m.actor_id else "system",
                "ref": f"{m.ref_type} {m.ref_id}".strip(),
                "note": m.note,
            }
            for m in b.movements.select_related("actor").order_by("-created_at")[:50]
        ]
        return Response(data)

    @extend_schema(request=BatchStatusSerializer, responses={200: dict})
    @action(detail=True, methods=["post"], url_path="status")
    def set_status(self, request, pk=None):
        batch = self.get_object()
        ser = BatchStatusSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        if batch.status in (BatchStatus.EXPIRED, BatchStatus.DEPLETED) and d.get("status") == BatchStatus.ACTIVE:
            raise DomainError(
                ErrorCode.INVALID_STATE, "Expired or used-up batches can't be put back on sale.", status_code=409
            )
        before = {"status": batch.status, "quality_status": batch.quality_status}
        with transaction.atomic():
            updated = services.set_batch_status(
                batch, status=d.get("status"), quality_status=d.get("quality_status"), actor=request.user
            )
        audit.record(
            request.user,
            "batch.status",
            updated,
            before=before,
            after={"status": updated.status, "quality_status": updated.quality_status},
            summary=d.get("note", ""),
            request=request,
        )
        return Response(self._row(updated))


class ExpiryView(APIView):
    """Grouped expiry worklist: what is expired, expires today/tomorrow, within 3 and within 7 days."""

    permission_classes = [IsAuthenticated, IsStaffUser, HasCapability]
    read_capability = "inventory.read"

    @extend_schema(responses={200: dict})
    def get(self, request):
        today = timezone.localdate()
        qs = scope_by_branch(
            Batch.objects.filter(qty_remaining__gt=0, expiry_date__isnull=False).exclude(status=BatchStatus.DEPLETED),
            request.user,
            "branch_id",
        )
        if request.query_params.get("branch", "").isdigit():
            qs = qs.filter(branch_id=request.query_params["branch"])
        qs = (
            qs.select_related("product__sale_unit", "branch", "supplier")
            .filter(expiry_date__lte=today + dt.timedelta(days=7))
            .order_by("expiry_date")[:500]
        )
        view = BatchViewSet()
        groups = {"expired": [], "today_tomorrow": [], "within_3": [], "within_7": []}
        for b in qs:
            row = view._row(b)
            groups[
                "expired"
                if row["risk"] == "EXPIRED"
                else "today_tomorrow"
                if row["risk"] == "TODAY_TOMORROW"
                else "within_3"
                if row["risk"] == "SOON"
                else "within_7"
            ].append(row)
        totals = {
            k: {"batches": len(v), "value": str(money(sum((Decimal(r["value"]) for r in v if r["value"]), ZERO)))}
            for k, v in groups.items()
        }
        return Response({"today": today, "groups": groups, "totals": totals, "waste_reasons": WasteReason.choices})


# ----------------------------------------------------------------------------------------- actions
class _BaseOp(serializers.Serializer):
    product_id = serializers.IntegerField(min_value=1)
    branch_id = serializers.IntegerField(min_value=1)
    batch_id = serializers.IntegerField(required=False, allow_null=True)
    note = serializers.CharField(max_length=300, required=False, allow_blank=True, default="")


class AdjustSerializer(_BaseOp):
    delta = serializers.DecimalField(max_digits=12, decimal_places=3, required=False)
    target = serializers.DecimalField(max_digits=12, decimal_places=3, required=False, min_value=Decimal("0"))
    reason = serializers.CharField(max_length=120)


class WasteSerializer(_BaseOp):
    quantity = serializers.DecimalField(max_digits=12, decimal_places=3, min_value=Decimal("0.001"))
    reason_code = serializers.ChoiceField(choices=WasteReason.values)


class TransferSerializer(serializers.Serializer):
    product_id = serializers.IntegerField(min_value=1)
    from_branch_id = serializers.IntegerField(min_value=1)
    to_branch_id = serializers.IntegerField(min_value=1)
    quantity = serializers.DecimalField(max_digits=12, decimal_places=3, min_value=Decimal("0.001"))
    batch_id = serializers.IntegerField(required=False, allow_null=True)
    note = serializers.CharField(max_length=300, required=False, allow_blank=True, default="")


def _product_batch(d, branch_id):
    product = Product.objects.filter(pk=d["product_id"]).first()
    if product is None:
        raise DomainError(ErrorCode.NOT_FOUND, "Unknown product.", status_code=404)
    batch = None
    if d.get("batch_id"):
        batch = Batch.objects.filter(pk=d["batch_id"], product=product, branch_id=branch_id).first()
        if batch is None:
            raise DomainError(
                ErrorCode.NOT_FOUND, "That batch doesn't belong to this product and branch.", status_code=404
            )
    return product, batch


class AdjustView(APIView):
    permission_classes = [IsAuthenticated, IsStaffUser, HasCapability]
    capability = "inventory.adjust"

    @extend_schema(request=AdjustSerializer, responses={200: dict})
    def post(self, request):
        ser = AdjustSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        ensure_branch_access(request.user, d["branch_id"])
        product, batch = _product_batch(d, d["branch_id"])
        with transaction.atomic():
            mv = services.adjust_stock(
                product,
                d["branch_id"],
                delta=d.get("delta"),
                target=d.get("target"),
                reason=d["reason"],
                actor=request.user,
                batch=batch,
                note=d["note"],
            )
            if mv is not None:
                audit.record(
                    request.user,
                    "stock.adjusted",
                    mv,
                    summary=f"{product.sku}: {mv.qty_delta} ({d['reason']})",
                    request=request,
                )
        return Response(
            {
                "movement_id": mv.id if mv else None,
                "changed": mv is not None,
                "on_hand_after": qty_str(mv.on_hand_after) if mv else None,
            }
        )


class WasteView(APIView):
    permission_classes = [IsAuthenticated, IsStaffUser, HasCapability]
    capability = "inventory.waste"

    @extend_schema(request=WasteSerializer, responses={200: dict})
    def post(self, request):
        ser = WasteSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        ensure_branch_access(request.user, d["branch_id"])
        product, batch = _product_batch(d, d["branch_id"])
        with transaction.atomic():
            mv = services.record_waste(
                product,
                d["branch_id"],
                d["quantity"],
                reason_code=d["reason_code"],
                actor=request.user,
                batch=batch,
                note=d["note"],
            )
            audit.record(
                request.user,
                "stock.waste",
                mv,
                summary=f"{product.sku}: {d['quantity']} ({d['reason_code']})",
                request=request,
            )
        return Response({"movement_id": mv.id, "on_hand_after": qty_str(mv.on_hand_after)})


class TransferView(APIView):
    permission_classes = [IsAuthenticated, IsStaffUser, HasCapability]
    capability = "inventory.transfer"

    @extend_schema(request=TransferSerializer, responses={200: dict})
    def post(self, request):
        ser = TransferSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        ensure_branch_access(request.user, d["from_branch_id"])
        ensure_branch_access(
            request.user, d["to_branch_id"]
        )  # a transfer touches both branches: you need access to both
        product, batch = _product_batch(d, d["from_branch_id"])
        with transaction.atomic():
            out, into = services.transfer_stock(
                product,
                d["from_branch_id"],
                d["to_branch_id"],
                d["quantity"],
                actor=request.user,
                batch=batch,
                note=d["note"],
            )
            audit.record(
                request.user,
                "stock.transferred",
                out,
                summary=f"{product.sku}: {d['quantity']} {d['from_branch_id']}→{d['to_branch_id']}",
                request=request,
            )
        return Response({"out_movement_id": out.id, "in_movement_id": into.id})
