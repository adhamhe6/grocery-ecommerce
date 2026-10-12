"""Staff API: branches, opening hours, closures, delivery zones, slot templates and slots."""

from __future__ import annotations

from django.db import transaction
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.decorators import action
from rest_framework.exceptions import MethodNotAllowed
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core import audit
from apps.core.admin_api import AdminViewSet, ensure_branch_access
from apps.core.exceptions import DomainError, ErrorCode
from apps.core.pagination import StandardPagination
from apps.core.permissions import IsStaffUser, branch_ids_for

from .models import Branch, BranchClosure, BranchHours, DeliverySlot, DeliveryZone, SlotTemplate
from .services import generate_slots


class HoursSerializer(serializers.ModelSerializer):
    class Meta:
        model = BranchHours
        fields = ["weekday", "opens", "closes", "is_closed"]

    def validate(self, attrs):
        if not attrs.get("is_closed") and not (attrs.get("opens") and attrs.get("closes") and attrs["opens"] < attrs["closes"]):
            raise serializers.ValidationError("Opening time must be before closing time (or mark the day closed).")
        return attrs


class BranchSerializer(serializers.ModelSerializer):
    hours = HoursSerializer(many=True, required=False)

    class Meta:
        model = Branch
        fields = [
            "id", "code", "name", "slug", "address_line1", "address_line2", "city", "area", "postal_code", "phone", "email", "timezone",
            "is_active", "is_default", "offers_delivery", "offers_pickup", "prep_minutes", "pickup_instructions", "hours", "is_demo",
        ]
        read_only_fields = ["id", "is_demo"]
        # The partial-unique index guarantees one default; flipping it is handled in create()/update(), not rejected.
        extra_kwargs = {"is_default": {"validators": []}}

    def validate_hours(self, value):
        days = [h["weekday"] for h in value]
        if len(days) != len(set(days)):
            raise serializers.ValidationError("Each weekday can appear only once.")
        return value

    @transaction.atomic
    def create(self, validated):
        hours = validated.pop("hours", [])
        if validated.get("is_default"):
            Branch.objects.filter(is_default=True).update(is_default=False)
        branch = Branch.objects.create(**validated)
        BranchHours.objects.bulk_create([BranchHours(branch=branch, **h) for h in hours])
        return branch

    @transaction.atomic
    def update(self, instance, validated):
        hours = validated.pop("hours", None)
        if validated.get("is_default"):
            Branch.objects.exclude(pk=instance.pk).filter(is_default=True).update(is_default=False)
        for k, v in validated.items():
            setattr(instance, k, v)
        instance.save()
        if hours is not None:
            instance.hours.all().delete()
            BranchHours.objects.bulk_create([BranchHours(branch=instance, **h) for h in hours])
        return instance


class BranchViewSet(AdminViewSet):
    queryset = Branch.objects.prefetch_related("hours").order_by("name")
    serializer_class = BranchSerializer
    read_capability = "catalog.read"  # every staff role can see (their) branches
    capability = "branches.manage"
    branch_field = "id"
    search_fields = ["name", "code", "city"]
    audit_label = "branch"

    def check_write_scope(self, validated):
        pass  # branches.manage is admin-only (global)

    def perform_destroy(self, instance):
        if instance.orders.exists() or instance.stock_levels.exists():
            raise DomainError(ErrorCode.INVALID_STATE, "This branch has orders or stock, so it can't be deleted. Deactivate it instead.", status_code=409)
        super().perform_destroy(instance)


class ClosureSerializer(serializers.ModelSerializer):
    class Meta:
        model = BranchClosure
        fields = ["id", "branch", "date", "reason"]


class ClosureViewSet(AdminViewSet):
    queryset = BranchClosure.objects.select_related("branch").order_by("date")
    serializer_class = ClosureSerializer
    read_capability = "catalog.read"
    capability = "slots.manage"
    branch_field = "branch_id"
    audit_label = "branch_closure"

    @transaction.atomic
    def perform_create(self, serializer):
        # Refuse *before* writing anything if customers already booked slots that day (staff must move those orders first).
        branch, day = serializer.validated_data["branch"], serializer.validated_data["date"]
        slots = DeliverySlot.objects.filter(branch=branch, date=day)
        if slots.filter(booked__gt=0).exists():
            raise DomainError(ErrorCode.INVALID_STATE, "Customers have already booked slots that day. Move or cancel those orders before closing the branch.", status_code=409)
        super().perform_create(serializer)
        slots.update(is_open=False)


class ZoneSerializer(serializers.ModelSerializer):
    class Meta:
        model = DeliveryZone
        fields = ["id", "branch", "name", "postcode_prefixes", "areas", "delivery_fee", "free_delivery_threshold", "min_order_value", "priority", "is_active"]
        read_only_fields = ["id"]

    def validate_postcode_prefixes(self, value):
        return sorted({"".join(v.split()).upper() for v in value if v.strip()})

    def validate_areas(self, value):
        return sorted({v.strip().lower() for v in value if v.strip()})

    def validate(self, attrs):
        if self.instance is None and not (attrs.get("postcode_prefixes") or attrs.get("areas")):
            raise serializers.ValidationError("Add at least one postcode prefix or area so the zone covers somewhere.")
        return attrs

    def update(self, instance, validated):
        old_fee = instance.delivery_fee
        zone = super().update(instance, validated)
        if zone.delivery_fee != old_fee:  # future slots without their own override follow the zone fee
            DeliverySlot.objects.filter(zone=zone, date__gte=timezone.localdate()).filter(template__isnull=True).update(fee=zone.delivery_fee)
            DeliverySlot.objects.filter(zone=zone, date__gte=timezone.localdate(), template__fee__isnull=True).update(fee=zone.delivery_fee)
        return zone


class ZoneViewSet(AdminViewSet):
    queryset = DeliveryZone.objects.select_related("branch").order_by("branch__name", "priority")
    serializer_class = ZoneSerializer
    read_capability = "catalog.read"
    capability = "branches.manage"
    branch_field = "branch_id"
    search_fields = ["name"]
    audit_label = "delivery_zone"


class TemplateSerializer(serializers.ModelSerializer):
    class Meta:
        model = SlotTemplate
        fields = ["id", "branch", "zone", "kind", "weekday", "start_time", "end_time", "capacity", "fee", "is_active"]
        read_only_fields = ["id"]

    def validate(self, attrs):
        start = attrs.get("start_time", getattr(self.instance, "start_time", None))
        end = attrs.get("end_time", getattr(self.instance, "end_time", None))
        if start and end and start >= end:
            raise serializers.ValidationError("The slot must start before it ends.")
        kind = attrs.get("kind", getattr(self.instance, "kind", None))
        zone = attrs.get("zone", getattr(self.instance, "zone", None))
        branch = attrs.get("branch", getattr(self.instance, "branch", None))
        if kind == "DELIVERY" and zone is None:
            raise serializers.ValidationError({"zone": "Delivery slots belong to a delivery zone."})
        if zone is not None and branch is not None and zone.branch_id != branch.id:
            raise serializers.ValidationError({"zone": "That zone belongs to a different branch."})
        return attrs


class TemplateViewSet(AdminViewSet):
    queryset = SlotTemplate.objects.select_related("branch", "zone").order_by("branch__name", "kind", "weekday", "start_time")
    serializer_class = TemplateSerializer
    read_capability = "catalog.read"
    capability = "slots.manage"
    branch_field = "branch_id"
    audit_label = "slot_template"


class SlotSerializer(serializers.ModelSerializer):
    remaining = serializers.IntegerField(read_only=True)

    class Meta:
        model = DeliverySlot
        fields = ["id", "branch", "zone", "kind", "date", "start_time", "end_time", "capacity", "booked", "remaining", "fee", "is_open"]
        read_only_fields = ["id", "booked", "remaining", "branch", "zone", "kind", "date", "start_time", "end_time"]

    def validate_capacity(self, value):
        if self.instance is not None and value < self.instance.booked:
            raise serializers.ValidationError(f"{self.instance.booked} customers have already booked this slot, so capacity can't go below that.")
        if value < 1:
            raise serializers.ValidationError("Capacity must be at least 1.")
        return value


class SlotViewSet(AdminViewSet):
    """Slots are generated from templates; staff adjust capacity, fee and open/closed — they don't delete booked slots."""

    queryset = DeliverySlot.objects.select_related("branch", "zone").order_by("date", "start_time")
    serializer_class = SlotSerializer
    pagination_class = StandardPagination
    read_capability = "catalog.read"
    capability = "slots.manage"
    branch_field = "branch_id"
    audit_label = "slot"

    def create(self, request, *args, **kwargs):  # slots come from templates (POST /generate/), never hand-created
        raise MethodNotAllowed("POST")

    def get_queryset(self):
        qs = super().get_queryset()
        p = self.request.query_params
        if p.get("branch"):
            qs = qs.filter(branch_id=p["branch"])
        if p.get("kind"):
            qs = qs.filter(kind=p["kind"])
        if p.get("date_from"):
            qs = qs.filter(date__gte=p["date_from"])
        if p.get("date_to"):
            qs = qs.filter(date__lte=p["date_to"])
        return qs

    def perform_destroy(self, instance):
        if instance.booked:
            raise DomainError(ErrorCode.INVALID_STATE, "Customers have booked this slot. Close it instead and move their orders.", status_code=409)
        super().perform_destroy(instance)

    @extend_schema(request=None, responses={200: dict})
    @action(detail=False, methods=["post"], url_path="generate")
    def generate(self, request):
        branch = Branch.objects.filter(pk=request.data.get("branch_id")).first()
        if branch is None:
            raise DomainError(ErrorCode.NOT_FOUND, "Choose a branch.", status_code=404)
        ensure_branch_access(request.user, branch.id)
        days = min(max(int(request.data.get("days_ahead", 7)), 1), 28)
        created = generate_slots(branch, days_ahead=days)
        audit.record(request.user, "slot.generated", branch, summary=f"{created} slots for {days} days", request=request)
        return Response({"created": created}, status=status.HTTP_200_OK)


class MyBranchesView(APIView):
    """Branches the signed-in staff member may work in (drives the dashboard's branch switcher)."""

    permission_classes = [IsAuthenticated, IsStaffUser]

    @extend_schema(responses={200: dict})
    def get(self, request):
        ids = branch_ids_for(request.user)
        qs = Branch.objects.filter(is_active=True) if ids is None else Branch.objects.filter(pk__in=ids, is_active=True)
        return Response({"global": ids is None, "branches": [{"id": b.id, "code": b.code, "name": b.name} for b in qs.order_by("name")]})


