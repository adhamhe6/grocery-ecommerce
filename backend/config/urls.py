from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path, re_path
from django.views.static import serve as serve_static
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

from apps.core import views as core_views

urlpatterns = [
    path("healthz", core_views.healthz),
    path("readyz", core_views.readyz),
    path("api/v1/", include("config.api_urls")),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="docs"),
]
if settings.DJANGO_ADMIN_ENABLED:
    # Break-glass tool for super admins. The staff dashboard is the supported interface, so this stays off in production
    # unless an operator turns it on deliberately (and ideally restricts the path at the reverse proxy).
    urlpatterns += [path("django-admin/", admin.site.urls)]
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
elif settings.SERVE_MEDIA:
    # Convenience for single-host/demo deployments only (Django's static server is not built for heavy traffic).
    # Production should serve MEDIA_ROOT from object storage or a CDN/reverse proxy and leave SERVE_MEDIA off.
    urlpatterns += [re_path(r"^media/(?P<path>.*)$", serve_static, {"document_root": settings.MEDIA_ROOT})]
