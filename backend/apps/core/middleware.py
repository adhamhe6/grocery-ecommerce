import re
import uuid
import zoneinfo

from django.utils import timezone

from .logging import reset_request_id, set_request_id

_VALID = re.compile(r"^[A-Za-z0-9._-]{8,64}$")


def store_timezone() -> zoneinfo.ZoneInfo:
    """The store's configured timezone (cached settings object); the process default if it is unset or invalid."""
    from .models import StoreSettings

    try:
        return zoneinfo.ZoneInfo(StoreSettings.load().timezone)
    except Exception:  # noqa: BLE001 - unknown zone name or the settings row can't be read yet (e.g. mid-migration)
        return timezone.get_default_timezone()


def activate_store_tz(**_kwargs) -> None:
    """Celery `task_prerun` hook: workers have no request, so activate the store timezone per task."""
    timezone.activate(store_timezone())


class RequestIDMiddleware:
    """Attach a correlation id to every request/response and to every log line."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        incoming = request.META.get("HTTP_X_REQUEST_ID", "")
        request_id = incoming if _VALID.match(incoming) else uuid.uuid4().hex
        request.request_id = request_id
        token = set_request_id(request_id)
        try:
            response = self.get_response(request)
        finally:
            reset_request_id(token)
        response["X-Request-ID"] = request_id
        return response


class StoreTimezoneMiddleware:
    """Make "today" mean the store's today.

    Expiry buffers, delivery windows and reports are all decided in the store's timezone (Dashboard → Store settings).
    Django's `localdate()` follows the *active* timezone, so activating it per request keeps every one of those calls
    consistent without threading a timezone through each function. Background tasks do the same via `activate_store_tz`.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        with timezone.override(store_timezone()):
            return self.get_response(request)
