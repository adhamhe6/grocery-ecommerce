from django.urls import path

from . import views

urlpatterns = [
    path("pages/", views.PageListView.as_view(), name="page-list"),
    path("pages/<slug:slug>/", views.PageDetailView.as_view(), name="page-detail"),
    path("articles/", views.ArticleListView.as_view(), name="article-list"),
    path("articles/<slug:slug>/", views.ArticleDetailView.as_view(), name="article-detail"),
    path("faqs/", views.FAQListView.as_view(), name="faq-list"),
    path("newsletter/subscribe/", views.NewsletterSubscribeView.as_view(), name="newsletter-subscribe"),
    path("newsletter/confirm/", views.NewsletterConfirmView.as_view(), name="newsletter-confirm"),
    path("newsletter/unsubscribe/", views.NewsletterUnsubscribeView.as_view(), name="newsletter-unsubscribe"),
    path("contact/", views.ContactView.as_view(), name="contact"),
    path("seo/sitemap/", views.SitemapView.as_view(), name="sitemap"),
]
