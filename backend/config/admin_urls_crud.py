"""Staff (admin) API routes for catalog, marketing, content, accounts/staff, settings and audit.

Owned by the "admin CRUD" workstream. Register routers here; `config/admin_urls.py` includes this module.
"""

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.accounts import admin_api as accounts_admin
from apps.catalog import admin_api as catalog_admin
from apps.catalog import admin_taxonomy as taxonomy_admin
from apps.content import admin_api as content_admin
from apps.core import admin_views as core_admin
from apps.orders import admin_cases
from apps.promotions import admin_api as promotions_admin

router = DefaultRouter()
# -- catalog
router.register("products", catalog_admin.ProductViewSet, basename="admin-product")
router.register("categories", taxonomy_admin.CategoryViewSet, basename="admin-category")
router.register("brands", taxonomy_admin.BrandViewSet, basename="admin-brand")
router.register("collections", taxonomy_admin.CollectionViewSet, basename="admin-collection")
router.register("units", taxonomy_admin.UnitViewSet, basename="admin-unit")
router.register("allergens", taxonomy_admin.AllergenViewSet, basename="admin-allergen")
router.register("reviews", taxonomy_admin.ReviewModerationViewSet, basename="admin-review")
# -- marketing
router.register("promotions", promotions_admin.PromotionViewSet, basename="admin-promotion")
router.register("coupons", promotions_admin.CouponViewSet, basename="admin-coupon")
# -- content
router.register("banners", content_admin.BannerViewSet, basename="admin-banner")
router.register("pages", content_admin.PageViewSet, basename="admin-page")
router.register("articles", content_admin.ArticleViewSet, basename="admin-article")
router.register("faqs", content_admin.FAQViewSet, basename="admin-faq")
router.register("newsletter", content_admin.NewsletterViewSet, basename="admin-newsletter")
router.register("contact-messages", content_admin.ContactMessageViewSet, basename="admin-contact-message")
# -- accounts
router.register("customers", accounts_admin.CustomerViewSet, basename="admin-customer")
router.register("staff", accounts_admin.StaffViewSet, basename="admin-staff")
# -- support, audit
router.register("cases", admin_cases.SupportCaseViewSet, basename="admin-case")
router.register("audit", core_admin.AuditLogViewSet, basename="admin-audit")

urlpatterns = [
    path("me/permissions/", core_admin.MyPermissionsView.as_view(), name="admin-me-permissions"),
    path("settings/", core_admin.StoreSettingsView.as_view(), name="admin-settings"),
    path("settings/logo/", core_admin.StoreLogoView.as_view(), name="admin-settings-logo"),
    path("", include(router.urls)),
]
