"""Staff API: customers (support view) and staff accounts.

Customers are read-mostly: support can look people up and switch an account off (`customers.manage`); roles and emails are
never edited here. Staff accounts (`staff.manage`) follow strict guard rails: only a SUPER_ADMIN touches ADMIN / SUPER_ADMIN
accounts, nobody changes their own role or deactivates themselves, and the last active SUPER_ADMIN can never be removed.
"""

from __future__ import annotations

import logging
from decimal import Decimal

from django.contrib.auth.tokens import default_token_generator
from django.db import transaction
from django.db.models import Count, Exists, Max, OuterRef, Q, Sum
from django.db.models.functions import Coalesce
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from apps.core import audit, rbac
from apps.core.admin_utils import AuditedViewSet, bool_param
from apps.core.exceptions import DomainError, ErrorCode
from apps.core.money import money
from apps.core.pagination import StandardPagination
from apps.core.permissions import branch_ids_for
from apps.orders.models import Order, OrderStatus, SupportCase
from apps.stores.models import Branch

from .models import Address, User
from .tasks import send_password_reset_email

logger = logging.getLogger(__name__)

ROLE_LABELS = dict(rbac.ROLE_CHOICES)
STAFF_ROLE_CHOICES = [(r, label) for r, label in rbac.ROLE_CHOICES if r != rbac.CUSTOMER]
PRIVILEGED_ROLES = {rbac.ADMIN, rbac.SUPER_ADMIN}
DETAIL_LIMIT = 50


# =============================================================================================== customers
class CustomerSerializer(serializers.ModelSerializer):
    """List shape. Order figures cover only the branches the viewer may see."""

    orders_count = serializers.IntegerField(read_only=True)
    last_order_at = serializers.DateTimeField(read_only=True)
    lifetime_spend = serializers.SerializerMethodField()
    joined_at = serializers.DateTimeField(source="created_at", read_only=True)

    class Meta:
        model = User
        fields = [
            "id", "email", "full_name", "phone", "is_active", "marketing_opt_in", "joined_at",
            "orders_count", "last_order_at", "lifetime_spend",
        ]  # fmt: skip
        read_only_fields = fields

    def get_lifetime_spend(self, obj) -> str:
        return str(money(getattr(obj, "lifetime_spend", None) or Decimal("0")))


class CustomerDetailSerializer(CustomerSerializer):
    addresses = serializers.SerializerMethodField()
    orders = serializers.SerializerMethodField()
    cases = serializers.SerializerMethodField()

    class Meta(CustomerSerializer.Meta):
        fields = [*CustomerSerializer.Meta.fields, "notify_order_emails", "addresses", "orders", "cases"]
        read_only_fields = fields

    def _scope(self):
        return branch_ids_for(self.context["request"].user)

    def get_addresses(self, obj) -> list:
        return [
            {
                "id": a.id, "label": a.label, "recipient_name": a.recipient_name, "phone": a.phone, "line1": a.line1,
                "line2": a.line2, "city": a.city, "area": a.area, "postal_code": a.postal_code,
                "instructions": a.instructions, "is_default": a.is_default,
            }
            for a in Address.objects.filter(user=obj)
        ]  # fmt: skip

    def get_orders(self, obj) -> list:
        qs = Order.objects.filter(customer=obj).select_related("branch").order_by("-placed_at", "-id")
        ids = self._scope()
        if ids is not None:
            qs = qs.filter(branch_id__in=ids)
        return [
            {
                "number": o.number, "status": o.status, "total": str(money(o.total)),
                "final_total": str(money(o.final_total)) if o.final_total is not None else None,
                "placed_at": o.placed_at, "branch": o.branch.name, "fulfilment_type": o.fulfilment_type,
            }
            for o in qs[:DETAIL_LIMIT]
        ]  # fmt: skip

    def get_cases(self, obj) -> list:
        qs = (
            SupportCase.objects.filter(Q(customer=obj) | Q(order__customer=obj))
            .select_related("order")
            .order_by("-created_at", "-id")
        )
        ids = self._scope()
        if ids is not None:
            qs = qs.filter(order__branch_id__in=ids)
        return [
            {
                "id": c.id, "order_number": c.order.number, "kind": c.kind, "status": c.status,
                "resolution": c.resolution, "refund_amount": str(money(c.refund_amount)),
                "created_at": c.created_at, "resolved_at": c.resolved_at,
            }
            for c in qs.distinct()[:DETAIL_LIMIT]
        ]  # fmt: skip


class CustomerUpdateSerializer(serializers.ModelSerializer):
    """The only thing support may change on a customer account. Role, email and every other field are ignored."""

    class Meta:
        model = User
        fields = ["is_active"]


class CustomerViewSet(AuditedViewSet):
    queryset = User.objects.filter(role=rbac.CUSTOMER)
    serializer_class = CustomerSerializer
    pagination_class = StandardPagination
    http_method_names = ["get", "patch", "head", "options"]
    read_capability = "customers.read"
    capability = "customers.manage"
    search_fields = ["full_name", "email", "phone"]
    ordering_fields = ["full_name", "email", "created_at", "orders_count", "last_order_at", "lifetime_spend"]
    ordering = ["-created_at", "-id"]
    audit_label = "customer"

    def get_serializer_class(self):
        return CustomerDetailSerializer if self.action == "retrieve" else CustomerSerializer

    def get_queryset(self):
        ids = branch_ids_for(self.request.user)
        qs = User.objects.filter(role=rbac.CUSTOMER)
        order_scope = None
        if ids is not None:  # branch staff only meet customers who have ordered at their branches
            qs = qs.filter(Exists(Order.objects.filter(customer=OuterRef("pk"), branch_id__in=ids)))
            order_scope = Q(orders__branch_id__in=ids)
        qs = qs.annotate(
            orders_count=Count("orders", filter=order_scope),
            last_order_at=Max("orders__placed_at", filter=order_scope),
            lifetime_spend=Coalesce(
                Sum(
                    Coalesce("orders__final_total", "orders__total"),
                    filter=Q(orders__status=OrderStatus.COMPLETED) & (order_scope or Q()),
                ),
                Decimal("0"),
            ),
        )
        p = self.request.query_params
        active = bool_param(self.request, "is_active")
        if active is not None:
            qs = qs.filter(is_active=active)
        has_orders = bool_param(self.request, "has_orders")
        if has_orders is not None:
            qs = qs.filter(orders_count__gt=0) if has_orders else qs.filter(orders_count=0)
        if p.get("joined_after"):
            qs = qs.filter(created_at__date__gte=p["joined_after"])
        return qs

    def audit_state(self, instance) -> dict:
        return {"id": instance.pk, "is_active": instance.is_active}  # no contact details in the audit trail

    @extend_schema(request=CustomerUpdateSerializer, responses={200: CustomerDetailSerializer})
    def partial_update(self, request, *args, **kwargs):
        instance = self.get_object()
        ser = CustomerUpdateSerializer(instance, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        self.perform_update(ser)
        detail = CustomerDetailSerializer(self.get_object(), context=self.get_serializer_context())
        return Response(detail.data)


# =============================================================================================== staff
def send_invite(user: User) -> bool:
    """Email a password-set link (the same signed token the reset flow uses). False when the queue is unreachable."""
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    try:
        send_password_reset_email.delay(user.email, uid, default_token_generator.make_token(user))
    except Exception:  # noqa: BLE001 - the account exists either way; staff can resend the invite
        logger.exception("staff_invite_enqueue_failed", extra={"user_id": user.pk})
        return False
    return True


class StaffSerializer(serializers.ModelSerializer):
    role = serializers.ChoiceField(choices=STAFF_ROLE_CHOICES)
    role_label = serializers.SerializerMethodField()
    branches = serializers.PrimaryKeyRelatedField(queryset=Branch.objects.all(), many=True, required=False)
    has_password = serializers.SerializerMethodField()
    email = serializers.EmailField(max_length=254)

    class Meta:
        model = User
        fields = [
            "id", "email", "full_name", "phone", "role", "role_label", "is_active", "all_branches", "branches",
            "has_password", "last_login", "created_at",
        ]  # fmt: skip
        read_only_fields = ["id", "last_login", "created_at"]
        validators: list = []

    def get_role_label(self, obj) -> str:
        return ROLE_LABELS.get(obj.role, obj.role)

    def get_has_password(self, obj) -> bool:
        return obj.has_usable_password()

    def validate_email(self, value):
        value = value.strip().lower()
        if self.instance is not None:
            if value != self.instance.email:
                raise serializers.ValidationError(
                    "A staff member's email can't be changed. Deactivate this account and invite the new address."
                )
            return value
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("An account with this email already exists.")
        return value

    def validate_full_name(self, value):
        value = value.strip()
        if len(value) < 2:
            raise serializers.ValidationError("Please enter the person's full name.")
        return value

    def create(self, validated):
        branches = validated.pop("branches", [])
        # No password is ever chosen for someone else: the account starts unusable and the invite lets them set their own.
        user = User.objects.create_user(password=None, **validated)
        user.branches.set(branches)
        return user

    def update(self, instance, validated):
        branches = validated.pop("branches", None)
        for key, value in validated.items():
            setattr(instance, key, value)
        instance.save()
        if branches is not None:
            instance.branches.set(branches)
        return instance


class StaffViewSet(AuditedViewSet):
    queryset = User.objects.filter(role__in=rbac.STAFF_ROLES).prefetch_related("branches").order_by("full_name", "id")
    serializer_class = StaffSerializer
    pagination_class = StandardPagination
    capability = read_capability = "staff.manage"
    search_fields = ["full_name", "email", "phone"]
    ordering_fields = ["full_name", "email", "role", "created_at", "last_login"]
    audit_label = "staff"

    def get_queryset(self):
        qs = super().get_queryset()
        p = self.request.query_params
        if p.get("role"):
            qs = qs.filter(role=p["role"].upper())
        active = bool_param(self.request, "is_active")
        if active is not None:
            qs = qs.filter(is_active=active)
        if p.get("branch", "").isdigit():
            qs = qs.filter(branches=p["branch"])
        return qs

    def audit_state(self, instance) -> dict:
        return {
            "email": instance.email, "full_name": instance.full_name, "phone": instance.phone, "role": instance.role,
            "is_active": instance.is_active, "all_branches": instance.all_branches,
            "branches": sorted(instance.branches.values_list("pk", flat=True)),
        }  # fmt: skip

    # -- guard rails ------------------------------------------------------------------------------------
    def enforce_rules(self, target: User | None, new_role: str, new_active: bool) -> None:
        actor = self.request.user
        privileged_involved = new_role in PRIVILEGED_ROLES or (target is not None and target.role in PRIVILEGED_ROLES)
        if privileged_involved and actor.role != rbac.SUPER_ADMIN:
            raise PermissionDenied("Only a super admin can create or change admin and super admin accounts.")
        if target is None:
            return
        if target.pk == actor.pk:
            if new_role != target.role:
                raise PermissionDenied("You can't change your own role.")
            if target.is_active and not new_active:
                raise PermissionDenied("You can't deactivate your own account.")
        removing_super = (
            target.role == rbac.SUPER_ADMIN and target.is_active and (new_role != rbac.SUPER_ADMIN or not new_active)
        )
        if removing_super:
            # Lock the other active super admins (not a bare COUNT: FOR UPDATE can't be combined with aggregates), so two
            # super admins demoting each other at the same moment can't both succeed.
            others = len(
                list(
                    User.objects.select_for_update()
                    .filter(role=rbac.SUPER_ADMIN, is_active=True)
                    .exclude(pk=target.pk)
                    .values_list("pk", flat=True)
                )
            )
            if others == 0:
                raise DomainError(
                    ErrorCode.INVALID_STATE,
                    "This is the last active super admin. Promote another super admin first, otherwise nobody could manage staff.",
                    status_code=409,
                )

    def perform_create(self, serializer):
        data = serializer.validated_data
        with transaction.atomic():
            self.enforce_rules(None, data["role"], data.get("is_active", True))
            super().perform_create(serializer)

    def perform_update(self, serializer):
        instance, data = serializer.instance, serializer.validated_data
        before = self.audit_state(instance)
        with transaction.atomic():
            locked = User.objects.select_for_update().get(pk=instance.pk)
            self.enforce_rules(locked, data.get("role", locked.role), data.get("is_active", locked.is_active))
            super().perform_update(serializer)
            after = self.audit_state(serializer.instance)
            if before["role"] != after["role"]:
                audit.record(
                    self.request.user, "staff.role_changed", serializer.instance, summary=serializer.instance.email,
                    before={"role": before["role"]}, after={"role": after["role"]}, request=self.request,
                )  # fmt: skip
            if (before["branches"], before["all_branches"]) != (after["branches"], after["all_branches"]):
                audit.record(
                    self.request.user, "staff.branches_changed", serializer.instance, summary=serializer.instance.email,
                    before={k: before[k] for k in ("branches", "all_branches")},
                    after={k: after[k] for k in ("branches", "all_branches")}, request=self.request,
                )  # fmt: skip

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        body = dict(self.get_serializer(serializer.instance).data)
        body["invite_email_queued"] = send_invite(serializer.instance)
        return Response(body, status=status.HTTP_201_CREATED)

    @extend_schema(responses={200: StaffSerializer})
    def destroy(self, request, *args, **kwargs):
        """DELETE = deactivate. Staff accounts are never erased: audit entries and order history point at them."""
        target = self.get_object()
        with transaction.atomic():
            locked = User.objects.select_for_update().get(pk=target.pk)
            self.enforce_rules(locked, locked.role, False)
            if locked.is_active:
                before = self.audit_state(locked)
                locked.is_active = False
                locked.save(update_fields=["is_active", "updated_at"])
                audit.record(
                    request.user,
                    "staff.deactivated",
                    locked,
                    summary=locked.email,
                    before=before,
                    after=self.audit_state(locked),
                    request=request,
                )
        return Response(self.get_serializer(self.get_object()).data)

    @extend_schema(request=None, responses={200: dict})
    @action(detail=True, methods=["post"], url_path="resend-invite")
    def resend_invite(self, request, pk=None):
        target = self.get_object()
        self.enforce_rules(target, target.role, target.is_active)  # same privilege rule as editing
        if target.has_usable_password():
            raise DomainError(
                ErrorCode.INVALID_STATE,
                "This person has already set a password. They can use 'forgot password' instead.",
                status_code=409,
            )
        if not target.is_active:
            raise DomainError(
                ErrorCode.INVALID_STATE, "Reactivate this account before sending an invite.", status_code=409
            )
        queued = send_invite(target)
        audit.record(request.user, "staff.invite_sent", target, summary=target.email, request=request)
        return Response({"invite_email_queued": queued})
