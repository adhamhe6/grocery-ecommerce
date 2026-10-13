"""Versioned API routes. Each app contributes its own urlconf."""

from django.urls import include, path

from apps.core.views import StorePublicView

urlpatterns = [
    path("store/", StorePublicView.as_view(), name="store"),
    path("", include("apps.accounts.urls")),
    path("", include("apps.catalog.urls")),
    path("", include("apps.stores.urls")),
    path("", include("apps.cart.urls")),
    path("", include("apps.orders.urls")),
    path("", include("apps.payments.urls")),
    path("", include("apps.content.urls")),
    path("admin/", include("config.admin_urls")),
]
