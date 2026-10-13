"""DRF permission classes and branch scoping — every check runs on the server."""

from __future__ import annotations

from rest_framework.permissions import SAFE_METHODS, BasePermission

from . import rbac


def user_has_capability(user, capability: str) -> bool:
    return bool(user and user.is_authenticated and user.is_active and rbac.role_has(user.role, capability))


def branch_ids_for(user) -> list[int] | None:
    """None = unrestricted (all branches); otherwise the explicit list of branch ids."""
    if user.role in rbac.GLOBAL_ROLES or getattr(user, "all_branches", False):
        return None
    cached = getattr(user, "_branch_ids", None)
    if cached is None:
        cached = list(user.branches.values_list("id", flat=True))
        user._branch_ids = cached
    return cached


def scope_by_branch(queryset, user, field: str = "branch_id"):
    ids = branch_ids_for(user)
    if ids is None:
        return queryset
    return queryset.filter(**{f"{field}__in": ids})


def can_access_branch(user, branch_id: int | None) -> bool:
    ids = branch_ids_for(user)
    return ids is None or branch_id in ids


class IsStaffUser(BasePermission):
    def has_permission(self, request, view):
        u = request.user
        return bool(u and u.is_authenticated and u.is_active and u.role in rbac.STAFF_ROLES)


class HasCapability(BasePermission):
    """Use on views with `capability = "x.y"` or `capability_map = {"list": "x.read", "create": "x.write"}`.

    Safe methods may use `read_capability`; unsafe methods use `capability` (falling back to read_capability).
    """

    def has_permission(self, request, view):
        u = request.user
        if not (u and u.is_authenticated and u.is_active):
            return False
        mapping = getattr(view, "capability_map", None)
        action = getattr(view, "action", None)
        if mapping and action in mapping:
            needed = mapping[action]
        elif request.method in SAFE_METHODS:
            needed = getattr(view, "read_capability", None) or getattr(view, "capability", None)
        else:
            needed = getattr(view, "capability", None)
        if needed is None:
            return False
        return user_has_capability(u, needed)


class IsOwner(BasePermission):
    """Object-level: obj.user (or obj.customer) must be the requesting user."""

    def has_object_permission(self, request, view, obj):
        owner = getattr(obj, "user", None) or getattr(obj, "customer", None)
        return owner is not None and owner == request.user
