from __future__ import annotations

from django.contrib.postgres.fields import ArrayField
from django.core.validators import RegexValidator
from django.db import models
from django.utils import timezone

from apps.core.models import TimeStampedModel

SAFE_LINK = RegexValidator(
    r"^(/[A-Za-z0-9/_\-.?=&%#]*|https://[A-Za-z0-9.\-]+(/[A-Za-z0-9/_\-.?=&%#]*)?)$",
    "Use a site path starting with / or an https:// URL.",
)


class Banner(TimeStampedModel):
    class Placement(models.TextChoices):
        HERO = "HERO", "Home hero"
        STRIP = "STRIP", "Announcement strip"
        PROMO = "PROMO", "Home promo tile"

    placement = models.CharField(max_length=8, choices=Placement.choices, default=Placement.HERO)
    title = models.CharField(max_length=120)
    subtitle = models.CharField(max_length=240, blank=True)
    image = models.ImageField(upload_to="banners/", blank=True, null=True)
    image_widths = ArrayField(models.PositiveIntegerField(), default=list, blank=True, editable=False)
    cta_label = models.CharField(max_length=40, blank=True)
    cta_link = models.CharField(max_length=300, blank=True, validators=[SAFE_LINK])
    starts_at = models.DateTimeField(default=timezone.now)
    ends_at = models.DateTimeField(null=True, blank=True)
    sort_order = models.PositiveIntegerField(default=100)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["placement", "sort_order", "id"]


class Page(TimeStampedModel):
    """Policy / informational page. Body is Markdown rendered safely on the frontend (no raw HTML)."""

    slug = models.SlugField(max_length=80, unique=True)
    title = models.CharField(max_length=140)
    summary = models.CharField(max_length=300, blank=True)
    body = models.TextField()
    is_published = models.BooleanField(default=True)
    is_template = models.BooleanField(
        default=False, help_text="Placeholder wording that legal/business owners must review before launch"
    )

    class Meta:
        ordering = ["title"]


class ArticleKind(models.TextChoices):
    RECIPE = "RECIPE", "Recipe"
    GUIDE = "GUIDE", "Grocery guide"


class Article(TimeStampedModel):
    kind = models.CharField(max_length=8, choices=ArticleKind.choices)
    slug = models.SlugField(max_length=100, unique=True)
    title = models.CharField(max_length=160)
    summary = models.CharField(max_length=300)
    body = models.TextField()
    image = models.ImageField(upload_to="articles/", blank=True, null=True)
    image_widths = ArrayField(models.PositiveIntegerField(), default=list, blank=True, editable=False)
    products = models.ManyToManyField("catalog.Product", blank=True, related_name="articles")
    servings = models.PositiveSmallIntegerField(null=True, blank=True)
    total_minutes = models.PositiveSmallIntegerField(null=True, blank=True)
    published_at = models.DateTimeField(default=timezone.now)
    is_published = models.BooleanField(default=True)

    class Meta:
        ordering = ["-published_at"]


class FAQ(models.Model):
    question = models.CharField(max_length=200)
    answer = models.TextField()
    topic = models.CharField(max_length=60, default="General")
    sort_order = models.PositiveIntegerField(default=100)
    is_published = models.BooleanField(default=True)

    class Meta:
        ordering = ["topic", "sort_order", "id"]


class NewsletterSubscriber(models.Model):
    email = models.EmailField(unique=True)
    token = models.CharField(max_length=40, unique=True)
    confirmed_at = models.DateTimeField(null=True, blank=True)
    unsubscribed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)


class ContactMessage(models.Model):
    """A message sent through the public contact form. Staff mark it handled once someone has replied."""

    class Topic(models.TextChoices):
        ORDER = "ORDER", "An order"
        DELIVERY = "DELIVERY", "Delivery or pickup"
        PRODUCT = "PRODUCT", "A product"
        REFUND = "REFUND", "Refund or payment"
        ACCOUNT = "ACCOUNT", "My account"
        FEEDBACK = "FEEDBACK", "Feedback"
        OTHER = "OTHER", "Something else"

    class Status(models.TextChoices):
        NEW = "NEW", "New"
        HANDLED = "HANDLED", "Handled"

    name = models.CharField(max_length=120)
    email = models.EmailField()
    topic = models.CharField(max_length=10, choices=Topic.choices, default=Topic.OTHER)
    message = models.TextField(max_length=3000)
    order_number = models.CharField(max_length=20, blank=True)
    status = models.CharField(max_length=8, choices=Status.choices, default=Status.NEW, db_index=True)
    handled_by = models.ForeignKey("accounts.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    handled_at = models.DateTimeField(null=True, blank=True)
    staff_note = models.CharField(max_length=300, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    def __str__(self):
        return f"{self.name} ({self.topic})"
