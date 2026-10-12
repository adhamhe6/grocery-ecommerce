"""Helpers shared by the staff CRUD API modules (catalog, promotions, content, accounts, settings, cases).

Kept separate from `admin_api.py` (the base class) so independent workstreams don't edit the same file.

* `AuditedViewSet` — `AdminViewSet` whose create / update / delete run in ONE transaction together with their
  audit entry, report unique-constraint races as a clean 409, and can include M2M ids in the before/after snapshot.
* Image helpers — turn pipeline `ValidationError`s into 400 field errors and remove stored files (variants too).
* `reject_html` — Markdown-only text fields.
* `QuantityField` — canonical quantity strings (`qty_str`), never trailing zeros.
"""

from __future__ import annotations

import logging
import re

from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.files.storage import default_storage
from django.db import IntegrityError, transaction
from django.utils.text import slugify
from rest_framework import serializers, viewsets
from rest_framework.permissions import SAFE_METHODS, BasePermission, IsAuthenticated
from rest_framework.response import Response

from apps.catalog import images
from apps.core import audit
from apps.core.admin_api import AdminViewSet, snapshot
from apps.core.exceptions import DomainError, ErrorCode
from apps.core.money import qty_str
from apps.core.permissions import HasCapability, IsStaffUser, user_has_capability

logger = logging.getLogger(__name__)


# --------------------------------------------------------------------------------------------- serializer helpers
class QuantityField(serializers.DecimalField):
    """Decimal with canonical output ('3', '0.25', '1.5') — the same format the public catalog API uses."""

    def to_representation(self, value):
        return qty_str(value)


def drf_errors(exc: DjangoValidationError) -> serializers.ValidationError:
    """Django model `ValidationError` -> DRF 400 with field names preserved."""
    if hasattr(exc, "message_dict"):
        return serializers.ValidationError({k: list(v) for k, v in exc.message_dict.items()})
    return serializers.ValidationError(list(exc.messages))


def unique_slug(model, text: str, *, exclude_pk=None, max_length: int | None = None) -> str:
    """slugify(text) made unique for `model` by appending -2, -3 …"""
    max_length = max_length or model._meta.get_field("slug").max_length
    base = (slugify(text) or "item")[: max_length - 6].strip("-") or "item"
    candidate, n = base, 1
    while model.objects.filter(slug=candidate).exclude(pk=exclude_pk).exists():
        n += 1
        candidate = f"{base}-{n}"
    return candidate


def mask_email(email: str) -> str:
    """'alice@example.com' -> 'a***@example.com' (never reveals the local part)."""
    if not email:
        return ""
    local, sep, domain = email.partition("@")
    if not sep:
        return "***"
    return f"{local[:1]}***@{domain}"


# --------------------------------------------------------------------------------------------- Markdown-only text
HTML_MESSAGE = "HTML isn't allowed, use Markdown"
_AUTOLINK = re.compile(r"<(?:https?://|mailto:)[^\s<>]+>", re.IGNORECASE)  # <https://…> is Markdown, not HTML
_HTML_TAG = re.compile(r"<(?:[A-Za-z]|/[A-Za-z]|![A-Za-z\-\[]|\?)")
_DANGEROUS_LINK = re.compile(
    r"\]\(\s*<?\s*(?:javascript|vbscript|data)\s*:|^\s{0,3}\[[^\]]+\]:\s*(?:javascript|vbscript|data):",
    re.IGNORECASE | re.MULTILINE,
)


def reject_html(value: str) -> str:
    """Validator for Markdown fields: any `<tag` is refused (the storefront renders Markdown only)."""
    if value and (_HTML_TAG.search(_AUTOLINK.sub("", value)) or _DANGEROUS_LINK.search(value)):
        raise serializers.ValidationError(HTML_MESSAGE)
    return value


# --------------------------------------------------------------------------------------------- images
class ImageFileSerializer(serializers.Serializer):
    """Multipart body with a single `image` file (what the pipeline will then inspect for real)."""

    image = serializers.FileField(allow_empty_file=False)


def store_image(fieldfile, uploaded, *, field_name: str = "image") -> list[int]:
    """Run the upload through the safe image pipeline; pipeline rejections become a 400 on `field_name`."""
    try:
        return images.save_processed(fieldfile, uploaded)
    except DjangoValidationError as exc:
        raise serializers.ValidationError({field_name: list(exc.messages)}) from None


def delete_image_files(name: str | None, widths=None) -> None:
    """Remove an image and its responsive variants from storage. Missing files are fine; failures are only logged."""
    if not name:
        return
    names = [name] + [images.variant_name(name, w) for w in sorted(set(widths or []) | set(images.VARIANT_WIDTHS))]
    for item in names:
        try:
            default_storage.delete(item)
        except Exception:  # noqa: BLE001 - an orphaned file must never break the request that removed its row
            logger.warning("image_delete_failed", extra={"name": item})


class SingleImageMixin:
    """Upload / replace / remove the one picture of a model with `image` + `image_widths` (category, banner, article).

    Add to an `AuditedViewSet` and expose with::

        @action(detail=True, methods=["post", "delete"], url_path="image", parser_classes=[MultiPartParser, FormParser])
        def image(self, request, pk=None):
            return self.handle_image(request)
    """

    def handle_image(self, request):
        instance = self.get_object()
        old_name = instance.image.name if instance.image else None
        old_widths = list(instance.image_widths or [])
        before = snapshot(instance)
        if request.method == "DELETE":
            with transaction.atomic():
                instance.image, instance.image_widths = None, []
                instance.save(
                    update_fields=["image", "image_widths"]
                    + (["updated_at"] if hasattr(instance, "updated_at") else [])
                )
                audit.record(
                    request.user,
                    f"{self.label}.image_removed",
                    instance,
                    before=before,
                    after=snapshot(instance),
                    request=request,
                )
            delete_image_files(old_name, old_widths)
            return Response(status=204)
        upload = ImageFileSerializer(data=request.data)
        upload.is_valid(raise_exception=True)
        stored = None
        try:
            with transaction.atomic():
                widths = store_image(instance.image, upload.validated_data["image"])
                stored = (instance.image.name, widths)
                instance.image_widths = widths
                instance.save(
                    update_fields=["image", "image_widths"]
                    + (["updated_at"] if hasattr(instance, "updated_at") else [])
                )
                audit.record(
                    request.user,
                    f"{self.label}.image_updated",
                    instance,
                    before=before,
                    after=snapshot(instance),
                    request=request,
                )
        except Exception:
            if stored:  # the row never committed: don't leave its files behind
                delete_image_files(*stored)
            raise
        delete_image_files(old_name, old_widths)  # the replaced picture and its variants
        return Response(self.get_serializer(self.get_object()).data)


# --------------------------------------------------------------------------------------------- permissions
class HasAnyCapability(BasePermission):
    """For views that several roles may use: `any_capability = ("content.manage", "reports.export")`."""

    def has_permission(self, request, view):
        needed = getattr(view, "any_capability", ())
        return any(user_has_capability(request.user, c) for c in needed)


# --------------------------------------------------------------------------------------------- viewsets
class AuditedViewSet(AdminViewSet):
    """`AdminViewSet` + atomic write-and-audit, M2M ids in snapshots and uniqueness races reported as 409.

    Set `audit_m2m = ("products",)` to include those relations (as sorted id lists) in before/after.
    """

    audit_m2m: tuple[str, ...] = ()

    def audit_state(self, instance) -> dict:
        data = snapshot(instance, self.audit_exclude)
        for name in self.audit_m2m:
            data[name] = sorted(getattr(instance, name).values_list("pk", flat=True))
        return data

    def _conflict(self) -> DomainError:
        return DomainError(
            ErrorCode.INVALID_STATE,
            "That conflicts with an existing record (a unique value was just taken). Please reload and try again.",
            status_code=409,
        )

    def perform_create(self, serializer):
        try:
            with transaction.atomic():
                self.check_write_scope(serializer.validated_data)
                instance = serializer.save()
                audit.record(
                    self.request.user,
                    f"{self.label}.created",
                    instance,
                    after=self.audit_state(instance),
                    request=self.request,
                )
        except IntegrityError:
            raise self._conflict() from None

    def perform_update(self, serializer):
        try:
            with transaction.atomic():
                self.check_write_scope(serializer.validated_data)
                before = self.audit_state(serializer.instance)
                instance = serializer.save()
                audit.record(
                    self.request.user,
                    f"{self.label}.updated",
                    instance,
                    before=before,
                    after=self.audit_state(instance),
                    request=self.request,
                )
        except IntegrityError:
            raise self._conflict() from None

    def perform_destroy(self, instance):
        with transaction.atomic():
            before = self.audit_state(instance)
            target_id = str(instance.pk)
            instance.delete()
            audit.record(
                self.request.user,
                f"{self.label}.deleted",
                None,
                before=before,
                request=self.request,
                target_type=self.queryset.model.__name__,
                target_id=target_id,
            )


class AdminReadOnlyViewSet(viewsets.ReadOnlyModelViewSet):
    """Lookup / log endpoints: staff-only, capability-checked, no writes of any kind."""

    permission_classes = [IsAuthenticated, IsStaffUser, HasCapability]
    pagination_class = None
    capability: str | None = None
    read_capability: str | None = None


def is_write_method(request) -> bool:
    return request.method not in SAFE_METHODS


def bool_param(request, name: str) -> bool | None:
    raw = request.query_params.get(name)
    if raw is None or raw == "":
        return None
    return raw.strip().lower() in {"1", "true", "yes", "on"}
