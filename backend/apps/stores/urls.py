from django.urls import path

from . import views

urlpatterns = [
    path("branches/", views.BranchListView.as_view(), name="branch-list"),
    path("delivery/check/", views.DeliveryCheckView.as_view(), name="delivery-check"),
    path("delivery-slots/", views.SlotListView.as_view(), name="delivery-slots"),
]
