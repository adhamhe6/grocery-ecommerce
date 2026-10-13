"""Staff API → /api/v1/admin/…  (split in two modules so independent workstreams don't edit the same file)."""

from django.urls import include, path

urlpatterns = [
    path("", include("config.admin_urls_ops")),
    path("", include("config.admin_urls_crud")),
]
