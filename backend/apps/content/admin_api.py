"""Staff API: banners, pages, articles, FAQs (capability `content.manage`), newsletter subscribers, contact messages."""

from __future__ import annotations

import csv
import io

from django.db import transaction
from django.db.models import Q
from django.http import HttpResponse
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.catalog.models import Product
from apps.core import audit
from apps.core import cache as core_cache
from apps.core.admin_utils import (
    AdminReadOnlyViewSet,
    AuditedViewSet,
    HasAnyCapability,
    ImageFileSerializer,
    SingleImageMixin,
    bool_param,
    reject_html,
    unique_slug,
)
from apps.core.exceptions import DomainError, ErrorCode
from apps.core.pagination import StandardPagination
from apps.core.permissions import IsStaffUser

from .models import FAQ, Article, ArticleKind, Banner, ContactMessage, NewsletterSubscriber, Page


class HomeCacheMixin:
    """The home page (banners, guides) is cached for 60 s; staff edits should show up at once, not after the TTL."""

    def perform_create(self, serializer):
        super().perform_create(serializer)
        core_cache.bump("home")

    def perform_update(self, serializer):
        super().perform_update(serializer)
        core_cache.bump("home")

    def perform_destroy(self, instance):
        super().perform_destroy(instance)
        core_cache.bump("home")

    def handle_image(self, request):
        response = super().handle_image(request)
        core_cache.bump("home")
        return response


# =============================================================================================== banners
class BannerSerializer(serializers.ModelSerializer):
    image = serializers.SerializerMethodField()
    is_live = serializers.SerializerMethodField()

    class Meta:
        model = Banner
        fields = [
            "id", "placement", "title", "subtitle", "image", "cta_label", "cta_link", "starts_at", "ends_at",
            "sort_order", "is_active", "is_live", "created_at", "updated_at",
        ]  # fmt: skip
        read_only_fields = ["id", "created_at", "updated_at"]

    def get_image(self, obj) -> dict:
        from apps.catalog import images

        return images.variant_urls(obj.image, obj.image_widths)

    def get_is_live(self, obj) -> bool:
        now = timezone.now()
        return obj.is_active and obj.starts_at <= now and (obj.ends_at is None or obj.ends_at > now)

    def validate_cta_link(self, value):
        # SAFE_LINK (model validator) allows any "/…" path — including "//evil.example", a protocol-relative redirect.
        if value.startswith("//"):
            raise serializers.ValidationError("Use a site path starting with a single / or an https:// URL.")
        return value

    def validate(self, attrs):
        starts = attrs.get("starts_at", getattr(self.instance, "starts_at", None))
        ends = attrs.get("ends_at", getattr(self.instance, "ends_at", None))
        if starts and ends and ends <= starts:
            raise serializers.ValidationError({"ends_at": "The end must be after the start."})
        return attrs


class BannerViewSet(HomeCacheMixin, SingleImageMixin, AuditedViewSet):
    queryset = Banner.objects.order_by("placement", "sort_order", "id")
    serializer_class = BannerSerializer
    pagination_class = StandardPagination
    capability = read_capability = "content.manage"
    search_fields = ["title", "subtitle"]
    ordering_fields = ["placement", "sort_order", "starts_at", "created_at"]
    audit_label = "banner"

    def get_queryset(self):
        qs = super().get_queryset()
        if self.request.query_params.get("placement"):
            qs = qs.filter(placement=self.request.query_params["placement"].upper())
        flag = bool_param(self.request, "is_active")
        if flag is not None:
            qs = qs.filter(is_active=flag)
        if bool_param(self.request, "live"):
            now = timezone.now()
            qs = qs.filter(is_active=True, starts_at__lte=now).filter(Q(ends_at__isnull=True) | Q(ends_at__gt=now))
        return qs

    @extend_schema(request=ImageFileSerializer, responses={200: BannerSerializer, 204: None})
    @action(detail=True, methods=["post", "delete"], url_path="image", parser_classes=[MultiPartParser, FormParser])
    def image(self, request, pk=None):
        return self.handle_image(request)

    def perform_destroy(self, instance):
        from apps.core.admin_utils import delete_image_files

        name, widths = (instance.image.name if instance.image else None), instance.image_widths
        super().perform_destroy(instance)
        delete_image_files(name, widths)


# =============================================================================================== pages
class MarkdownSerializer(serializers.ModelSerializer):
    """Base for models whose text fields are Markdown: raw HTML is refused field by field."""

    markdown_fields: tuple[str, ...] = ()

    def validate(self, attrs):
        errors = {}
        for name in self.markdown_fields:
            if name in attrs:
                try:
                    reject_html(attrs[name])
                except serializers.ValidationError as exc:
                    errors[name] = exc.detail
        if errors:
            raise serializers.ValidationError(errors)
        return attrs


class PageSerializer(MarkdownSerializer):
    markdown_fields = ("title", "summary", "body")

    class Meta:
        model = Page
        fields = ["id", "slug", "title", "summary", "body", "is_published", "is_template", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]
        extra_kwargs = {"slug": {"required": False}}

    def validate(self, attrs):
        attrs = super().validate(attrs)
        if self.instance is None and not attrs.get("slug"):
            attrs["slug"] = unique_slug(Page, attrs.get("title", "page"))
        return attrs


class PageViewSet(AuditedViewSet):
    queryset = Page.objects.order_by("title")
    serializer_class = PageSerializer
    capability = read_capability = "content.manage"
    search_fields = ["title", "slug", "summary"]
    ordering_fields = ["title", "slug", "updated_at"]
    audit_label = "page"

    def get_queryset(self):
        qs = super().get_queryset()
        for param, field in (("is_published", "is_published"), ("is_template", "is_template")):
            flag = bool_param(self.request, param)
            if flag is not None:
                qs = qs.filter(**{field: flag})
        return qs


# =============================================================================================== articles
class ArticleSerializer(MarkdownSerializer):
    markdown_fields = ("title", "summary", "body")
    image = serializers.SerializerMethodField()
    products = serializers.PrimaryKeyRelatedField(queryset=Product.objects.all(), many=True, required=False)
    is_live = serializers.SerializerMethodField()

    class Meta:
        model = Article
        fields = [
            "id", "kind", "slug", "title", "summary", "body", "image", "products", "servings", "total_minutes",
            "published_at", "is_published", "is_live", "created_at", "updated_at",
        ]  # fmt: skip
        read_only_fields = ["id", "created_at", "updated_at"]
        extra_kwargs = {"slug": {"required": False}}

    def get_image(self, obj):
        from apps.catalog import images

        return images.variant_urls(obj.image, obj.image_widths)

    def get_is_live(self, obj) -> bool:
        return obj.is_published and obj.published_at <= timezone.now()

    def validate(self, attrs):
        attrs = super().validate(attrs)
        if self.instance is None and not attrs.get("slug"):
            attrs["slug"] = unique_slug(Article, attrs.get("title", "article"))
        return attrs


class ArticleViewSet(HomeCacheMixin, SingleImageMixin, AuditedViewSet):
    queryset = Article.objects.prefetch_related("products").order_by("-published_at", "-id")
    serializer_class = ArticleSerializer
    pagination_class = StandardPagination
    capability = read_capability = "content.manage"
    search_fields = ["title", "slug", "summary"]
    ordering_fields = ["published_at", "title", "created_at"]
    audit_label = "article"
    audit_m2m = ("products",)

    def get_queryset(self):
        qs = super().get_queryset()
        kind = self.request.query_params.get("kind")
        if kind:
            if kind.upper() not in ArticleKind.values:
                raise serializers.ValidationError({"kind": [f"Use one of: {', '.join(ArticleKind.values)}."]})
            qs = qs.filter(kind=kind.upper())
        flag = bool_param(self.request, "is_published")
        if flag is not None:
            qs = qs.filter(is_published=flag)
        return qs

    @extend_schema(request=ImageFileSerializer, responses={200: ArticleSerializer, 204: None})
    @action(detail=True, methods=["post", "delete"], url_path="image", parser_classes=[MultiPartParser, FormParser])
    def image(self, request, pk=None):
        return self.handle_image(request)

    def perform_destroy(self, instance):
        from apps.core.admin_utils import delete_image_files

        name, widths = (instance.image.name if instance.image else None), instance.image_widths
        super().perform_destroy(instance)
        delete_image_files(name, widths)


# =============================================================================================== FAQs
class FAQSerializer(MarkdownSerializer):
    markdown_fields = ("question", "answer")

    class Meta:
        model = FAQ
        fields = ["id", "question", "answer", "topic", "sort_order", "is_published"]
        read_only_fields = ["id"]


class FAQViewSet(AuditedViewSet):
    queryset = FAQ.objects.order_by("topic", "sort_order", "id")
    serializer_class = FAQSerializer
    capability = read_capability = "content.manage"
    search_fields = ["question", "answer", "topic"]
    ordering_fields = ["topic", "sort_order"]
    audit_label = "faq"

    def get_queryset(self):
        qs = super().get_queryset()
        flag = bool_param(self.request, "is_published")
        if flag is not None:
            qs = qs.filter(is_published=flag)
        if self.request.query_params.get("topic"):
            qs = qs.filter(topic__iexact=self.request.query_params["topic"])
        return qs


# =============================================================================================== newsletter
def subscriber_status(sub: NewsletterSubscriber) -> str:
    if sub.unsubscribed_at:
        return "UNSUBSCRIBED"
    return "CONFIRMED" if sub.confirmed_at else "PENDING"


class SubscriberSerializer(serializers.ModelSerializer):
    """Emails and state only. The token is a secret (it unsubscribes / confirms) and is never exposed."""

    status = serializers.SerializerMethodField()

    class Meta:
        model = NewsletterSubscriber
        fields = ["id", "email", "status", "created_at", "confirmed_at", "unsubscribed_at"]
        read_only_fields = fields

    def get_status(self, obj) -> str:
        return subscriber_status(obj)


def _csv_safe(value: str) -> str:
    """Spreadsheet formula injection: a cell starting with = + - @ would be executed by Excel / Sheets."""
    return "'" + value if value[:1] in ("=", "+", "-", "@", "\t", "\r") else value


class NewsletterViewSet(AdminReadOnlyViewSet):
    """Subscribers (read-only). Marketing may read; roles with `reports.export` may export."""

    permission_classes = [IsAuthenticated, IsStaffUser, HasAnyCapability]
    any_capability = ("content.manage", "reports.export")
    queryset = NewsletterSubscriber.objects.order_by("-created_at", "-id")
    serializer_class = SubscriberSerializer
    pagination_class = StandardPagination

    def get_queryset(self):
        qs = super().get_queryset()
        p = self.request.query_params
        wanted = (p.get("status") or "").upper()
        if wanted:
            if wanted not in {"PENDING", "CONFIRMED", "UNSUBSCRIBED"}:
                raise serializers.ValidationError({"status": ["Use PENDING, CONFIRMED or UNSUBSCRIBED."]})
            if wanted == "UNSUBSCRIBED":
                qs = qs.filter(unsubscribed_at__isnull=False)
            elif wanted == "CONFIRMED":
                qs = qs.filter(confirmed_at__isnull=False, unsubscribed_at__isnull=True)
            else:
                qs = qs.filter(confirmed_at__isnull=True, unsubscribed_at__isnull=True)
        if p.get("search"):
            qs = qs.filter(email__icontains=p["search"].strip())
        return qs

    @extend_schema(responses={200: str})
    @action(detail=False, methods=["get"], url_path="export")
    def export(self, request):
        """CSV with one column — `email` — of the people who confirmed and haven't left (the only ones we may mail)."""
        emails = list(
            NewsletterSubscriber.objects.filter(confirmed_at__isnull=False, unsubscribed_at__isnull=True)
            .order_by("email")
            .values_list("email", flat=True)
        )
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow(["email"])
        for email in emails:
            writer.writerow([_csv_safe(email)])
        audit.record(request.user, "newsletter.exported", None, summary=f"{len(emails)} confirmed addresses",
                     request=request, target_type="NewsletterSubscriber")  # fmt: skip
        response = HttpResponse(buffer.getvalue(), content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = 'attachment; filename="newsletter-subscribers.csv"'
        return response


# =============================================================================================== contact messages
class ContactMessageSerializer(serializers.ModelSerializer):
    handled_by = serializers.SerializerMethodField()

    class Meta:
        model = ContactMessage
        fields = [
            "id", "name", "email", "topic", "message", "order_number", "status", "handled_by", "handled_at",
            "staff_note", "created_at",
        ]  # fmt: skip
        read_only_fields = fields

    def get_handled_by(self, obj) -> str | None:
        return obj.handled_by.email if obj.handled_by_id else None


class HandleSerializer(serializers.Serializer):
    note = serializers.CharField(max_length=300, required=False, allow_blank=True)


class ContactMessageViewSet(AdminReadOnlyViewSet):
    """Messages from the public contact form. Anyone who can read customers can work the inbox."""

    queryset = ContactMessage.objects.select_related("handled_by").order_by("-created_at", "-id")
    serializer_class = ContactMessageSerializer
    pagination_class = StandardPagination
    read_capability = capability = "customers.read"

    def get_queryset(self):
        qs = super().get_queryset()
        p = self.request.query_params
        if p.get("status"):
            qs = qs.filter(status=p["status"].upper())
        if p.get("topic"):
            qs = qs.filter(topic=p["topic"].upper())
        if p.get("q"):
            q = p["q"].strip()
            qs = qs.filter(
                Q(name__icontains=q) | Q(email__icontains=q) | Q(message__icontains=q) | Q(order_number__icontains=q)
            )
        return qs

    @extend_schema(request=HandleSerializer, responses={200: ContactMessageSerializer})
    @action(detail=True, methods=["post"], url_path="handle")
    def handle(self, request, pk=None):
        ser = HandleSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        with transaction.atomic():
            message = ContactMessage.objects.select_for_update(of=("self",)).get(pk=self.get_object().pk)
            if message.status == ContactMessage.Status.HANDLED:
                raise DomainError(ErrorCode.INVALID_STATE, "This message has already been handled.", status_code=409)
            before = {"status": message.status}
            message.status = ContactMessage.Status.HANDLED
            message.handled_by, message.handled_at = request.user, timezone.now()
            message.staff_note = ser.validated_data.get("note", "")
            message.save(update_fields=["status", "handled_by", "handled_at", "staff_note"])
            audit.record(
                request.user, "contact_message.handled", message, before=before,
                after={"status": message.status, "note": message.staff_note}, request=request,
            )  # fmt: skip
        return Response(self.get_serializer(message).data)
