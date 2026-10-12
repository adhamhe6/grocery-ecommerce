"""Staff (admin) API routes for catalog, marketing, content, accounts/staff, settings and audit.

Owned by the "admin CRUD" workstream. Register routers here; `config/admin_urls.py` includes this module.
"""

from django.urls import include, path  # noqa: F401
from rest_framework.routers import DefaultRouter

router = DefaultRouter()

urlpatterns = [
    path("", include(router.urls)),
]
