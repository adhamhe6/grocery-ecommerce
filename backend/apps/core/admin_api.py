"""Shared plumbing for the staff (admin) API.

Every admin endpoint:
* requires an authenticated *staff* user (customers get 403, anonymous 401);
* requires a capability from the role matrix (`apps/core/rbac.py`) — checked per HTTP method / DRF action;
* is scoped to the staff member's branches when the model has a branch (non-global roles never see other branches);
* writes an immutable audit-log entry for every create / update / delete with a before/after snapshot.

Subclass `AdminViewSet`, set `capability` (write) and `read_capability` (read), optionally `branch_field`,
`search_fields`, `ordering_fields`, `filterset_fields`, and `audit_label`.
"""

from __future__ import annotations

import datetime as dt
from decimal import Decimal

from django.core.exceptions import PermissionDenied
from django.db import transaction
from django.db.models import Model
from rest_framework import filters, viewsets
from rest_framework.permissions import IsAuthenticated

from apps.core import audit
from apps.core.permissions import HasCapability, IsStaffUser, branch_ids_for, can_access_branch, scope_by_branch

SENSITIVE_FIELDS = {"password", "token", "secret", "tracking_token"}


def snapshot(instance: Model, exclude: set[str] | None = None) -> dict:
    """JSON-safe dict of an instance's concrete fields (for audit before/after)."""
    out = {}
    skip = SENSITIVE_FIELDS | (exclude or set())
    for field in instance._meta.concrete_fields:
        if field.name in skip:
            continue
        value = getattr(instance, field.attname)
        if isinstance(value, Decimal):
            value = str(value)
        elif isinstance(value, dt.datetime | dt.date | dt.time):
            value = value.isoformat()
        elif hasattr(value, "name") and not isinstance(value, str | int | float | bool | type(None)):
            value = str(value)  # file fields
        out[field.name] = value
    return out


def ensure_branch_access(user, branch_id) -> None:
    """Raise 403 unless the staff member may act on this branch."""
    if branch_id is not None and not can_access_branch(user, int(branch_id)):
        raise PermissionDenied("You don't have access to that branch.")


class AdminViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated, IsStaffUser, HasCapability]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    pagination_class = None  # overridden by list-heavy subclasses via StandardPagination
    capability: str | None = None
    read_capability: str | None = None
    branch_field: str | None = None  # e.g. "branch_id" or "product__..." — queryset is scoped by it
    audit_label: str | None = None
    audit_exclude: set[str] = set()

    def get_queryset(self):
        qs = super().get_queryset()
        if self.branch_field:
            qs = scope_by_branch(qs, self.request.user, self.branch_field)
        return qs

    # -- hooks ------------------------------------------------------------------
    @property
    def label(self) -> str:
        return self.audit_label or self.queryset.model._meta.model_name

    def check_write_scope(self, validated: dict) -> None:
        """Override to verify branch access on submitted foreign keys."""
        branch = validated.get("branch") or validated.get("branch_id")
        if branch is not None:
            ensure_branch_access(self.request.user, getattr(branch, "pk", branch))

    # Each write and its audit entry commit together or not at all: there is never a change without a record of it.
    def perform_create(self, serializer):
        self.check_write_scope(serializer.validated_data)
        with transaction.atomic():
            instance = serializer.save()
            audit.record(
                self.request.user,
                f"{self.label}.created",
                instance,
                after=snapshot(instance, self.audit_exclude),
                request=self.request,
            )

    def perform_update(self, serializer):
        self.check_write_scope(serializer.validated_data)
        with transaction.atomic():
            before = snapshot(serializer.instance, self.audit_exclude)
            instance = serializer.save()
            audit.record(
                self.request.user,
                f"{self.label}.updated",
                instance,
                before=before,
                after=snapshot(instance, self.audit_exclude),
                request=self.request,
            )

    def perform_destroy(self, instance):
        with transaction.atomic():
            before = snapshot(instance, self.audit_exclude)
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


def accessible_branch_ids(user) -> list[int] | None:
    return branch_ids_for(user)
