from django.urls import path

from . import views

urlpatterns = [
    path("dashboard/", views.DashboardView.as_view(), name="admin-dashboard"),
    path("reports/", views.ReportListView.as_view(), name="admin-report-list"),
    path("reports/<slug:name>/", views.ReportView.as_view(), name="admin-report"),
]
