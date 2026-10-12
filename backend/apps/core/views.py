import time

from django.core.cache import cache
from django.db import connection
from django.http import JsonResponse
from django.views.decorators.http import require_GET


@require_GET
def healthz(request):
    """Liveness: the process is up."""
    return JsonResponse({"status": "ok"})


@require_GET
def readyz(request):
    """Readiness: database is required; Redis is optional (the app degrades without it)."""
    checks = {}
    started = time.perf_counter()
    try:
        with connection.cursor() as cur:
            cur.execute("SELECT 1")
            cur.fetchone()
        checks["database"] = "ok"
    except Exception:  # noqa: BLE001
        checks["database"] = "down"
    try:
        cache.set("readyz", "1", 5)
        checks["cache"] = "ok" if cache.get("readyz") == "1" else "degraded"
    except Exception:  # noqa: BLE001
        checks["cache"] = "degraded"
    ok = checks["database"] == "ok"
    status = "ok" if ok and checks["cache"] == "ok" else ("degraded" if ok else "down")
    return JsonResponse(
        {"status": status, "checks": checks, "latency_ms": round((time.perf_counter() - started) * 1000, 1)},
        status=200 if ok else 503,
    )


from drf_spectacular.utils import extend_schema  # noqa: E402
from rest_framework.permissions import AllowAny  # noqa: E402
from rest_framework.response import Response  # noqa: E402
from rest_framework.views import APIView  # noqa: E402

from .models import StoreSettings  # noqa: E402


class StorePublicView(APIView):
    """Public, cacheable store identity/config the storefront renders from (no code change needed to rebrand)."""

    permission_classes = [AllowAny]
    authentication_classes: list = []

    @extend_schema(responses={200: dict})
    def get(self, request):
        from django.conf import settings as dj

        s = StoreSettings.load()
        provider = dj.PAYMENT_PROVIDER
        return Response(
            {
                "name": s.name,
                "tagline": s.tagline,
                "logo": s.logo.url if s.logo else None,
                "brand": {"primary": s.brand_primary, "accent": s.brand_accent},
                "contact": {
                    "email": s.support_email,
                    "phone": s.support_phone,
                    "hours": s.support_hours,
                    "address": s.address,
                },
                "currency": s.currency,
                "locale": s.locale,
                "timezone": s.timezone,
                "prices_include_tax": s.prices_include_tax,
                "tax_label": s.tax_label,
                "policies": {
                    "weight_tolerance_percent": str(s.weight_tolerance_percent),
                    "substitution_price_cap": s.substitution_price_cap,
                    "complaint_window_hours": s.complaint_window_hours,
                    "min_order_value": str(s.min_order_value),
                },
                "allow_guest_checkout": s.allow_guest_checkout,
                "payment": {
                    "card_enabled": s.card_payments_enabled and provider in ("demo", "stripe"),
                    "cod_enabled": s.cash_on_delivery_enabled,
                    "mode": provider,  # demo | stripe | unconfigured — the UI labels demo payments honestly
                },
                "demo_mode": s.demo_mode,
                "socials": {
                    "instagram": s.instagram_url,
                    "facebook": s.facebook_url,
                    "x": s.x_url,
                    "youtube": s.youtube_url,
                    "tiktok": s.tiktok_url,
                },
                "socials_are_placeholders": s.socials_are_placeholders,
            }
        )
