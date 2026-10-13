"""Staff API: who-am-I (permissions), store settings and the audit log.

* `GET /me/permissions/`  — any staff member: role, capabilities and branch scope (drives the dashboard menus).
* `GET|PATCH /settings/`  — `settings.manage`; every change is audited with before/after.
* `GET /audit/`, `/audit/actions/` — `audit.read`; strictly read-only.
"""

from __future__ import annotations

import datetime as dt
import re
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.core.files.storage import default_storage
from django.db import transaction
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.catalog import images
from apps.core import audit, rbac
from apps.core.admin_api import snapshot
from apps.core.admin_utils import AdminReadOnlyViewSet, ImageFileSerializer, delete_image_files
from apps.core.models import AuditLog, StoreSettings
from apps.core.pagination import StandardPagination
from apps.core.permissions import HasCapability, IsStaffUser, branch_ids_for

ROLE_LABELS = dict(rbac.ROLE_CHOICES)


# =============================================================================================== me / permissions
class MyPermissionsView(APIView):
    """What the signed-in staff member may do, so the UI can hide what the server would refuse anyway."""

    permission_classes = [IsAuthenticated, IsStaffUser]

    @extend_schema(responses={200: dict})
    def get(self, request):
        from apps.stores.models import Branch

        user = request.user
        ids = branch_ids_for(user)
        branches = (
            Branch.objects.filter(is_active=True) if ids is None else Branch.objects.filter(pk__in=ids, is_active=True)
        )
        return Response(
            {
                "id": user.id,
                "email": user.email,
                "full_name": user.full_name,
                "role": user.role,
                "role_label": ROLE_LABELS.get(user.role, user.role),
                "capabilities": sorted(rbac.capabilities_for(user.role)),
                "branch_scope": {
                    "global": ids is None,
                    "branch_ids": None if ids is None else sorted(ids),
                    "branches": [{"id": b.id, "code": b.code, "name": b.name} for b in branches.order_by("name")],
                },
            }
        )


# =============================================================================================== settings
HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
CURRENCY_RE = re.compile(r"^[A-Z]{3}$")
LOCALE_RE = re.compile(r"^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$")
SOCIAL_FIELDS = ["instagram_url", "facebook_url", "x_url", "youtube_url", "tiktok_url"]


class SettingsSerializer(serializers.ModelSerializer):
    logo = serializers.SerializerMethodField()

    class Meta:
        model = StoreSettings
        fields = [
            "name", "legal_name", "tagline", "logo", "brand_primary", "brand_accent",
            "support_email", "support_phone", "support_hours", "address",
            "currency", "locale", "timezone", "prices_include_tax", "tax_label",
            "weight_tolerance_percent", "substitution_price_cap", "complaint_window_hours", "min_order_value",
            "allow_guest_checkout", "card_payments_enabled", "cash_on_delivery_enabled", "demo_mode",
            *SOCIAL_FIELDS, "socials_are_placeholders", "updated_at",
        ]  # fmt: skip
        read_only_fields = ["updated_at"]

    def get_logo(self, obj) -> str | None:
        return default_storage.url(obj.logo.name) if obj.logo else None

    def validate_brand_primary(self, value):
        return self._hex(value)

    def validate_brand_accent(self, value):
        return self._hex(value)

    @staticmethod
    def _hex(value: str) -> str:
        if not HEX_RE.match(value):
            raise serializers.ValidationError("Use a 6-digit hex colour such as #1F3D2B.")
        return value.upper()

    def validate_currency(self, value):
        if not CURRENCY_RE.match(value):
            raise serializers.ValidationError("Use a 3-letter uppercase currency code such as USD or EUR.")
        return value

    def validate_locale(self, value):
        if not LOCALE_RE.match(value):
            raise serializers.ValidationError("Use a language tag such as en-US or fr-CA.")
        return value

    def validate_timezone(self, value):
        try:
            if not re.match(r"^[A-Za-z0-9_+\-/]+$", value):
                raise ValueError(value)
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError, OSError):
            raise serializers.ValidationError(
                "Use an IANA timezone name such as Europe/London or America/New_York."
            ) from None
        return value

    def validate_weight_tolerance_percent(self, value):
        if not 0 <= value <= 50:
            raise serializers.ValidationError("The tolerance must be between 0 and 50 percent.")
        return value

    def validate_min_order_value(self, value):
        if value < 0:
            raise serializers.ValidationError("The minimum order value can't be negative.")
        return value

    def validate_complaint_window_hours(self, value):
        if not 1 <= value <= 24 * 30:
            raise serializers.ValidationError("Use between 1 and 720 hours.")
        return value

    def validate(self, attrs):
        errors = {}
        for field in SOCIAL_FIELDS:
            url = attrs.get(field)
            if url and not url.lower().startswith("https://"):
                errors[field] = "Social links must start with https://"
        card = attrs.get("card_payments_enabled", getattr(self.instance, "card_payments_enabled", True))
        cod = attrs.get("cash_on_delivery_enabled", getattr(self.instance, "cash_on_delivery_enabled", True))
        if not card and not cod:
            errors["card_payments_enabled"] = "Keep at least one payment method switched on, or nobody can check out."
        if errors:
            raise serializers.ValidationError(errors)
        return attrs


class StoreSettingsView(APIView):
    permission_classes = [IsAuthenticated, IsStaffUser, HasCapability]
    capability = read_capability = "settings.manage"
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    @staticmethod
    def _current() -> StoreSettings:
        StoreSettings.objects.get_or_create(pk=1)
        return StoreSettings.objects.select_for_update().get(pk=1)

    @extend_schema(responses=SettingsSerializer)
    def get(self, request):
        return Response(SettingsSerializer(StoreSettings.objects.get_or_create(pk=1)[0]).data)

    @extend_schema(request=SettingsSerializer, responses=SettingsSerializer)
    def patch(self, request):
        data = request.data.copy() if hasattr(request.data, "copy") else dict(request.data)
        upload = data.pop("logo", None) if hasattr(data, "pop") else None
        if isinstance(upload, list):  # QueryDict.pop returns a list
            upload = upload[0] if upload else None
        stored = None
        old_logo = None
        try:
            with transaction.atomic():
                obj = self._current()
                before = snapshot(obj)
                ser = SettingsSerializer(obj, data=data, partial=True)
                ser.is_valid(raise_exception=True)
                if upload not in (None, ""):
                    file_ser = ImageFileSerializer(data={"image": upload})
                    if not file_ser.is_valid():
                        raise serializers.ValidationError({"logo": file_ser.errors["image"]})
                    old_logo = obj.logo.name if obj.logo else None
                    stored = self._store_logo(obj, file_ser.validated_data["image"])
                ser.save()
                audit.record(request.user, "settings.updated", obj, before=before, after=snapshot(obj), request=request)
        except Exception:
            if stored:
                delete_image_files(stored)
            raise
        if stored and old_logo and old_logo != stored:
            delete_image_files(old_logo)
        return Response(SettingsSerializer(StoreSettings.objects.get(pk=1)).data)

    @staticmethod
    def _store_logo(obj: StoreSettings, uploaded, field: str = "logo") -> str:
        """Logo = the pipeline's validated, metadata-free, normalised original (no responsive variants needed)."""
        from django.core.exceptions import ValidationError as DjangoValidationError
        from django.core.files.base import ContentFile

        try:
            original, _variants = images.process(uploaded)
        except DjangoValidationError as exc:
            raise serializers.ValidationError({field: list(exc.messages)}) from None
        name = default_storage.get_available_name(obj.logo.field.generate_filename(obj, "logo.webp"))
        saved = default_storage.save(name, ContentFile(original))
        obj.logo.name = saved
        return saved


class StoreLogoView(APIView):
    """`POST /settings/logo/` (multipart `image`) replaces the logo; `DELETE` removes it."""

    permission_classes = [IsAuthenticated, IsStaffUser, HasCapability]
    capability = read_capability = "settings.manage"
    parser_classes = [MultiPartParser, FormParser]

    @extend_schema(request=ImageFileSerializer, responses=SettingsSerializer)
    def post(self, request):
        file_ser = ImageFileSerializer(data=request.data)
        file_ser.is_valid(raise_exception=True)
        stored = None
        try:
            with transaction.atomic():
                obj = StoreSettingsView._current()
                before = snapshot(obj)
                old = obj.logo.name if obj.logo else None
                stored = StoreSettingsView._store_logo(obj, file_ser.validated_data["image"], field="image")
                obj.save()
                audit.record(
                    request.user, "settings.logo_updated", obj, before=before, after=snapshot(obj), request=request
                )
        except Exception:
            if stored:
                delete_image_files(stored)
            raise
        if old and old != stored:
            delete_image_files(old)
        return Response(SettingsSerializer(StoreSettings.objects.get(pk=1)).data)

    @extend_schema(responses={204: None})
    def delete(self, request):
        with transaction.atomic():
            obj = StoreSettingsView._current()
            before = snapshot(obj)
            old = obj.logo.name if obj.logo else None
            obj.logo = None
            obj.save()
            audit.record(
                request.user, "settings.logo_removed", obj, before=before, after=snapshot(obj), request=request
            )
        delete_image_files(old)
        return Response(status=204)


# =============================================================================================== audit log
class AuditLogSerializer(serializers.ModelSerializer):
    actor_email = serializers.CharField(source="actor_label", read_only=True)

    class Meta:
        model = AuditLog
        fields = [
            "id", "actor", "actor_email", "action", "target_type", "target_id", "summary", "before", "after",
            "ip_address", "request_id", "created_at",
        ]  # fmt: skip
        read_only_fields = fields


def _parse_date(raw: str, name: str) -> dt.date:
    try:
        return dt.date.fromisoformat(raw)
    except ValueError:
        raise serializers.ValidationError({name: ["Use a date like 2026-03-31."]}) from None


class AuditLogViewSet(AdminReadOnlyViewSet):
    """Read-only trail of who did what. Entries cannot be created, changed or deleted through the API (or at all)."""

    queryset = AuditLog.objects.all()
    serializer_class = AuditLogSerializer
    pagination_class = StandardPagination
    read_capability = capability = "audit.read"
    http_method_names = ["get", "head", "options"]

    def get_queryset(self):
        qs = super().get_queryset().order_by("-created_at", "-id")
        p = self.request.query_params
        actor = p.get("actor") or p.get("actor_email")
        if actor:
            qs = qs.filter(actor_label__icontains=actor.strip())
        if p.get("action"):
            qs = qs.filter(action__startswith=p["action"].strip())
        if p.get("target_type"):
            qs = qs.filter(target_type__iexact=p["target_type"].strip())
        if p.get("target_id"):
            qs = qs.filter(target_id=p["target_id"].strip())
        if p.get("date_from"):
            qs = qs.filter(created_at__date__gte=_parse_date(p["date_from"], "date_from"))
        if p.get("date_to"):
            qs = qs.filter(created_at__date__lte=_parse_date(p["date_to"], "date_to"))
        return qs

    @extend_schema(responses={200: list[str]})
    @action(detail=False, methods=["get"], url_path="actions")
    def action_names(self, request):
        """Every distinct action string in the log (for the filter drop-down)."""
        return Response(list(AuditLog.objects.order_by("action").values_list("action", flat=True).distinct()))
