from django.urls import path

from . import views

urlpatterns = [
    path("products/", views.ProductListView.as_view(), name="product-list"),
    path("products/<slug:slug>/", views.ProductDetailView.as_view(), name="product-detail"),
    path("products/<slug:slug>/reviews/", views.ProductReviewsView.as_view(), name="product-reviews"),
    path("categories/", views.CategoryListView.as_view(), name="category-list"),
    path("brands/", views.BrandListView.as_view(), name="brand-list"),
    path("collections/", views.CollectionListView.as_view(), name="collection-list"),
    path("search/suggest/", views.SuggestView.as_view(), name="search-suggest"),
    path("home/", views.HomeView.as_view(), name="home"),
]
