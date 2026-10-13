"""Policy pages (template text), FAQs, recipes, guides and banners."""

from __future__ import annotations

import datetime as dt

from django.utils import timezone

from apps.catalog.models import Product
from apps.content.models import FAQ, Article, ArticleKind, Banner, Page

from . import imaging
from .common import Tally, midnight
from .content_data import ARTICLES, BANNERS, FAQS, PAGES


def seed_pages(tally: Tally) -> None:
    for spec in PAGES:
        page = Page.objects.filter(slug=spec["slug"]).first()
        if page is not None and not page.is_template:
            tally.skip(
                "Page", f"{spec['slug']!r} has been replaced with real text (is_template is off); left unchanged"
            )
            continue
        created = page is None
        page = page or Page(slug=spec["slug"])
        page.title, page.summary, page.body = spec["title"], spec["summary"], spec["body"]
        page.is_template = True
        if created:
            page.is_published = True
        page.save()
        tally.add("Page", created)


def seed_faqs(tally: Tally) -> None:
    for topic, sort_order, question, answer in FAQS:
        faq = FAQ.objects.filter(question=question).first()
        created = faq is None
        faq = faq or FAQ(question=question)
        faq.answer, faq.topic, faq.sort_order = answer, topic, sort_order
        if created:
            faq.is_published = True
        faq.save()
        tally.add("FAQ", created)


def seed_articles(
    products: dict[str, Product], tally: Tally, with_images: bool = False, refresh_images: bool = False
) -> None:
    now = timezone.now()
    for spec in ARTICLES:
        article = Article.objects.filter(slug=spec["slug"]).first()
        created = article is None
        article = article or Article(slug=spec["slug"])
        article.kind = ArticleKind(spec["kind"])
        article.title, article.summary, article.body = spec["title"], spec["summary"], spec["body"]
        article.servings, article.total_minutes = spec["servings"], spec["total_minutes"]
        article.published_at = now - dt.timedelta(days=spec["published_ago"])
        if created:
            article.is_published = True
        article.save()
        article.products.set([products[n] for n in spec["products"] if n in products])
        tally.add("Article", created)
        if with_images:
            outcome = imaging.attach_article_image(article, spec["slug"], refresh_images)
            if outcome != "missing":
                tally.add("Article image", outcome == "created")


def seed_banners(tally: Tally, with_images: bool, refresh_images: bool) -> None:
    for placement, title, subtitle, cta_label, cta_link, art_key, sort_order in BANNERS:
        banner = Banner.objects.filter(title=title).first()
        created = banner is None
        banner = banner or Banner(title=title)
        banner.placement = Banner.Placement(placement)
        banner.subtitle, banner.cta_label, banner.cta_link, banner.sort_order = (
            subtitle,
            cta_label,
            cta_link,
            sort_order,
        )
        banner.starts_at, banner.ends_at = midnight(-30), None
        if created:
            banner.is_active = True
        banner.full_clean()  # enforces the safe-link validator on cta_link
        banner.save()
        tally.add("Banner", created)
        if with_images and art_key:
            outcome = imaging.attach_banner_image(banner, art_key, refresh_images)
            if outcome == "missing":
                tally.warn(f"no banner artwork found for {art_key!r} (run scripts/generate_demo_images.py)")
            else:
                tally.add("Banner image", outcome == "created")
