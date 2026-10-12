from __future__ import annotations

from typing import Any

from .logging import get_request_id
from .models import AuditLog


def _client_ip(request) -> str | None:
    if request is None:
        return None
    fwd = request.META.get("HTTP_X_FORWARDED_FOR", "")
    return (fwd.split(",")[0].strip() if fwd else request.META.get("REMOTE_ADDR")) or None


def record(
    actor,
    action: str,
    target: Any = None,
    *,
    summary: str = "",
    before: dict | None = None,
    after: dict | None = None,
    request=None,
    target_type: str = "",
    target_id: str = "",
) -> AuditLog:
    """Write an audit entry. `actor` may be a User, None (system) or a label string."""
    from apps.accounts.models import User

    is_user = isinstance(actor, User)
    if target is not None:
        target_type = target_type or target.__class__.__name__
        target_id = target_id or str(getattr(target, "pk", ""))
    return AuditLog.objects.create(
        actor=actor if is_user else None,
        actor_label=(actor.email if is_user else (actor or "system")),
        action=action,
        target_type=target_type,
        target_id=target_id,
        summary=summary[:300],
        before=before,
        after=after,
        ip_address=_client_ip(request),
        request_id=get_request_id() if get_request_id() != "-" else "",
    )
