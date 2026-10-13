"""Staff (admin) API routes → /api/v1/admin/…"""

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.inventory import admin_api as inventory_admin
from apps.orders import admin_api as orders_admin
from apps.payments import admin_api as payments_admin
from apps.purchasing import admin_api as purchasing_admin
from apps.stores import admin_api as stores_admin

router = DefaultRouter()
router.register("branches", stores_admin.BranchViewSet, basename="admin-branch")
router.register("closures", stores_admin.ClosureViewSet, basename="admin-closure")
router.register("zones", stores_admin.ZoneViewSet, basename="admin-zone")
router.register("slot-templates", stores_admin.TemplateViewSet, basename="admin-slot-template")
router.register("slots", stores_admin.SlotViewSet, basename="admin-slot")
router.register("orders", orders_admin.OrderAdminViewSet, basename="admin-order")
router.register("inventory/stock", inventory_admin.StockViewSet, basename="admin-stock")
router.register("inventory/movements", inventory_admin.MovementViewSet, basename="admin-movement")
router.register("inventory/batches", inventory_admin.BatchViewSet, basename="admin-batch")
router.register("suppliers", purchasing_admin.SupplierViewSet, basename="admin-supplier")
router.register("purchase-orders", purchasing_admin.PurchaseOrderViewSet, basename="admin-po")
router.register("payments", payments_admin.PaymentViewSet, basename="admin-payment")

urlpatterns = [
    path("my-branches/", stores_admin.MyBranchesView.as_view(), name="admin-my-branches"),
    path("inventory/expiry/", inventory_admin.ExpiryView.as_view(), name="admin-expiry"),
    path("inventory/adjust/", inventory_admin.AdjustView.as_view(), name="admin-adjust"),
    path("inventory/waste/", inventory_admin.WasteView.as_view(), name="admin-waste"),
    path("inventory/transfer/", inventory_admin.TransferView.as_view(), name="admin-transfer"),
    path("purchasing/replenishment/", purchasing_admin.ReplenishmentView.as_view(), name="admin-replenishment"),
    path("finance/reconciliation/", payments_admin.ReconciliationView.as_view(), name="admin-reconciliation"),
    path("", include("apps.reports.urls")),
    path("", include(router.urls)),
]
