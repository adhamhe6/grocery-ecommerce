from django.urls import path

from . import views

urlpatterns = [
    path("cart/", views.CartView.as_view(), name="cart"),
    path("cart/items/", views.CartItemsView.as_view(), name="cart-items"),
    path("cart/items/<int:product_id>/", views.CartItemDetailView.as_view(), name="cart-item"),
    path("cart/coupon/", views.CartCouponView.as_view(), name="cart-coupon"),
    path("cart/fix/", views.CartFixView.as_view(), name="cart-fix"),
    path("cart/acknowledge/", views.CartAcknowledgeView.as_view(), name="cart-acknowledge"),
    path("cart/reorder/<str:number>/", views.CartReorderView.as_view(), name="cart-reorder"),
    path("favorites/", views.FavoriteListView.as_view(), name="favorites"),
    path("favorites/<int:product_id>/", views.FavoriteDetailView.as_view(), name="favorite"),
    path("compare/", views.ComparisonView.as_view(), name="compare"),
    path("account/comparison/", views.SavedComparisonView.as_view(), name="saved-comparison"),
    path("lists/", views.ShoppingListViewSet.as_view(), name="lists"),
    path("lists/<int:pk>/", views.ShoppingListDetailView.as_view(), name="list-detail"),
    path("lists/<int:pk>/items/<int:product_id>/", views.ShoppingListItemView.as_view(), name="list-item"),
    path("lists/<int:pk>/add-to-cart/", views.ShoppingListToCartView.as_view(), name="list-to-cart"),
]
