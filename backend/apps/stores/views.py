from __future__ import annotations

from collections import OrderedDict

from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.exceptions import DomainError, ErrorCode

from .models import Branch, SlotKind
from .serializers import BranchSerializer, SlotSerializer, ZoneSerializer
from .services import available_slots, find_zone


class PublicView(APIView):
    permission_classes = [AllowAny]
    authentication_classes: list = []


class BranchListView(PublicView):
    @extend_schema(responses=BranchSerializer(many=True))
    def get(self, request):
        qs = Branch.objects.filter(is_active=True).prefetch_related("hours").order_by("-is_default", "name")
        return Response(BranchSerializer(qs, many=True).data)


class DeliveryCheckView(PublicView):
    """Tells a visitor whether we deliver to a postcode/area — before they fill the basket."""

    @extend_schema(
        parameters=[OpenApiParameter("postal_code", str), OpenApiParameter("area", str)], responses={200: dict}
    )
    def get(self, request):
        postal, area = request.query_params.get("postal_code", ""), request.query_params.get("area", "")
        if not (postal or area):
            raise DomainError(ErrorCode.VALIDATION_ERROR, "Enter a postcode or area to check delivery.")
        zone = find_zone(postal_code=postal, area=area)
        if zone is None:
            return Response(
                {"serviceable": False, "message": "We don't deliver there yet — store pickup is available."}
            )
        return Response(
            {
                "serviceable": True,
                "branch": {"id": zone.branch_id, "name": zone.branch.name},
                "zone": ZoneSerializer(zone).data,
            }
        )


class SlotListView(PublicView):
    @extend_schema(
        parameters=[
            OpenApiParameter("kind", str),
            OpenApiParameter("branch", int),
            OpenApiParameter("postal_code", str),
            OpenApiParameter("area", str),
            OpenApiParameter("days", int),
        ],
        responses={200: dict},
    )
    def get(self, request):
        kind = request.query_params.get("kind", SlotKind.DELIVERY)
        if kind not in SlotKind.values:
            raise DomainError(ErrorCode.VALIDATION_ERROR, "kind must be DELIVERY or PICKUP")
        days = min(max(int(request.query_params.get("days", 7) or 7), 1), 14)
        zone = None
        if kind == SlotKind.DELIVERY:
            zone = find_zone(
                postal_code=request.query_params.get("postal_code", ""), area=request.query_params.get("area", "")
            )
            if zone is None:
                raise DomainError(
                    ErrorCode.ADDRESS_NOT_SERVICEABLE,
                    "We don't deliver to this address yet. Try store pickup or a different address.",
                )
            branch = zone.branch
        else:
            branch_id = request.query_params.get("branch")
            branch = (
                Branch.objects.filter(pk=branch_id, is_active=True, offers_pickup=True).first()
                if branch_id and branch_id.isdigit()
                else None
            )
            if branch is None:
                raise DomainError(ErrorCode.VALIDATION_ERROR, "Choose a pickup branch.")
        slots = available_slots(branch, kind, zone, days=days)
        grouped: OrderedDict[str, list] = OrderedDict()
        for slot in slots:
            grouped.setdefault(slot.date.isoformat(), []).append(SlotSerializer(slot).data)
        return Response(
            {
                "branch": {"id": branch.id, "name": branch.name},
                "zone": ZoneSerializer(zone).data if zone else None,
                "days": [{"date": d, "slots": s} for d, s in grouped.items()],
            }
        )
