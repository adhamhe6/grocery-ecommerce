"""Staff (admin) API routes → /api/v1/admin/…"""

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.stores import admin_api as stores_admin

router = DefaultRouter()
router.register("branches", stores_admin.BranchViewSet, basename="admin-branch")
router.register("closures", stores_admin.ClosureViewSet, basename="admin-closure")
router.register("zones", stores_admin.ZoneViewSet, basename="admin-zone")
router.register("slot-templates", stores_admin.TemplateViewSet, basename="admin-slot-template")
router.register("slots", stores_admin.SlotViewSet, basename="admin-slot")

urlpatterns = [
    path("my-branches/", stores_admin.MyBranchesView.as_view(), name="admin-my-branches"),
    path("", include(router.urls)),
]
