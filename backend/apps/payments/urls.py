from django.urls import path

from . import views

urlpatterns = [
    path("payments/webhook/<slug:provider>/", views.WebhookView.as_view(), name="payment-webhook"),
    path("payments/demo/<str:reference>/", views.DemoPaymentView.as_view(), name="payment-demo"),
    path("payments/orders/<str:number>/retry/", views.RetryPaymentView.as_view(), name="payment-retry"),
]
