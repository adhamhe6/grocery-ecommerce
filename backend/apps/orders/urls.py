from django.urls import path

from . import views

urlpatterns = [
    path("checkout/quote/", views.CheckoutQuoteView.as_view(), name="checkout-quote"),
    path("checkout/", views.CheckoutView.as_view(), name="checkout"),
    path("orders/", views.OrderListView.as_view(), name="order-list"),
    path("orders/track/", views.OrderTrackView.as_view(), name="order-track"),
    path("orders/<str:number>/", views.OrderDetailView.as_view(), name="order-detail"),
    path("orders/<str:number>/cancel/", views.OrderCancelView.as_view(), name="order-cancel"),
    path(
        "orders/<str:number>/substitutions/<int:pk>/",
        views.SubstitutionDecisionView.as_view(),
        name="substitution-decision",
    ),
    path("orders/<str:number>/cases/", views.OrderCasesView.as_view(), name="order-cases"),
]
