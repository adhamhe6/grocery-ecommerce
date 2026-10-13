"""Public content endpoints (no sign-in): pages, articles, FAQs, newsletter, contact form and the SEO sitemap.

Only published / active / public data is ever returned. The write endpoints (newsletter, contact) are throttled,
keep the default CSRF-enforcing authentication, and answer identically whether or not the address is already known.
"""

from __future__ import annotations

import logging
import secrets

from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.cart.views import annotated_products
from apps.catalog import images
from apps.catalog.models import Category, Collection, Product
from apps.catalog.queries import ProductQuery
from apps.catalog.serializers import ProductCardSerializer
from apps.catalog.views import PublicView, default_branch_id
from apps.core.exceptions import DomainError, ErrorCode
from apps.core.pagination import StandardPagination
from apps.promotions.engine import PromotionIndex, load_index

from .models import FAQ, Article, ArticleKind, ContactMessage, NewsletterSubscriber, Page
from .tasks import send_newsletter_confirmation
from .throttles import PublicFormThrottle

logger = logging.getLogger(__name__)


# =============================================================================================== pages / articles / FAQs
class PagePublicSerializer(serializers.ModelSerializer):
    class Meta:
        model = Page
        fields = ["slug", "title", "summary", "is_template", "updated_at"]
        read_only_fields = fields


class PageDetailPublicSerializer(PagePublicSerializer):
    class Meta(PagePublicSerializer.Meta):
        fields = [*PagePublicSerializer.Meta.fields, "body"]
        read_only_fields = fields


class ArticleListSerializer(serializers.ModelSerializer):
    image = serializers.SerializerMethodField()

    class Meta:
        model = Article
        fields = ["slug", "kind", "title", "summary", "image", "servings", "total_minutes", "published_at"]
        read_only_fields = fields

    def get_image(self, obj):
        return images.variant_urls(obj.image, obj.image_widths) or None


class PageListView(PublicView):
    @extend_schema(responses=PagePublicSerializer(many=True))
    def get(self, request):
        return Response(PagePublicSerializer(Page.objects.filter(is_published=True).order_by("title"), many=True).data)


class PageDetailView(PublicView):
    @extend_schema(responses=PageDetailPublicSerializer)
    def get(self, request, slug):
        page = Page.objects.filter(slug=slug, is_published=True).first()
        if page is None:
            raise DomainError(ErrorCode.NOT_FOUND, "We couldn't find that page.", status_code=404)
        return Response(PageDetailPublicSerializer(page).data)


def live_articles():
    return Article.objects.filter(is_published=True, published_at__lte=timezone.now())


class ArticleListView(PublicView):
    @extend_schema(
        parameters=[OpenApiParameter("kind", str, description="RECIPE or GUIDE")],
        responses=ArticleListSerializer(many=True),
    )
    def get(self, request):
        qs = live_articles().order_by("-published_at", "-id")
        kind = request.query_params.get("kind")
        if kind:
            if kind.upper() not in ArticleKind.values:
                raise serializers.ValidationError({"kind": [f"Use one of: {', '.join(ArticleKind.values)}."]})
            qs = qs.filter(kind=kind.upper())
        paginator = StandardPagination()
        page = paginator.paginate_queryset(qs, request)
        return paginator.get_paginated_response(ArticleListSerializer(page, many=True).data)


class ArticleDetailView(PublicView):
    @extend_schema(responses={200: dict})
    def get(self, request, slug):
        article = live_articles().filter(slug=slug).first()
        if article is None:
            raise DomainError(ErrorCode.NOT_FOUND, "We couldn't find that article.", status_code=404)
        data = dict(ArticleListSerializer(article).data)
        data["body"] = article.body
        # Linked products render as the same cards the catalog uses (live price, promotion, availability).
        # (The article↔product link has no position of its own, so cards are listed alphabetically: a stable order.)
        ids = list(article.products.order_by("name", "id").values_list("pk", flat=True))
        branch_id = default_branch_id()
        data["products"] = ProductCardSerializer(
            annotated_products(ids, branch_id), many=True, context={"promo_index": load_index(), "branch_id": branch_id}
        ).data
        return Response(data)


class FAQListView(PublicView):
    @extend_schema(responses={200: dict})
    def get(self, request):
        rows = FAQ.objects.filter(is_published=True).order_by("topic", "sort_order", "id")
        return Response([{"id": f.id, "topic": f.topic, "question": f.question, "answer": f.answer} for f in rows])


# =============================================================================================== newsletter
class EmailSerializer(serializers.Serializer):
    email = serializers.EmailField(max_length=254)

    def validate_email(self, value):
        return value.strip().lower()


class TokenSerializer(serializers.Serializer):
    token = serializers.CharField(max_length=64)


SUBSCRIBE_REPLY = {
    "detail": "Thanks! If that address can receive our newsletter, we've sent it a confirmation email. "
    "Click the link inside to finish subscribing."
}


def new_token() -> str:
    return secrets.token_urlsafe(24)  # 32 URL-safe characters (192 bits)


class NewsletterSubscribeView(APIView):
    """Double opt-in. The reply is identical for new, pending, confirmed and unsubscribed addresses (no enumeration)."""

    permission_classes = [AllowAny]
    throttle_classes = [PublicFormThrottle]
    throttle_scope = "newsletter"

    @extend_schema(request=EmailSerializer, responses={202: dict})
    def post(self, request):
        ser = EmailSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        email = ser.validated_data["email"]
        token = None
        with transaction.atomic():
            sub = NewsletterSubscriber.objects.select_for_update().filter(email__iexact=email).first()
            if sub is None:
                try:
                    with transaction.atomic():
                        sub = NewsletterSubscriber.objects.create(email=email, token=new_token())
                except IntegrityError:  # a concurrent request just created it
                    sub = NewsletterSubscriber.objects.get(email__iexact=email)
                token = sub.token
            elif sub.unsubscribed_at is not None:  # coming back: confirm again with a fresh link
                sub.unsubscribed_at, sub.confirmed_at, sub.token = None, None, new_token()
                sub.save(update_fields=["unsubscribed_at", "confirmed_at", "token"])
                token = sub.token
            elif sub.confirmed_at is None:  # still waiting: send the same link again
                token = sub.token
            # already confirmed: nothing to send, and nothing to reveal
        if token:
            try:
                send_newsletter_confirmation.delay(email, token)
            except Exception:  # noqa: BLE001 - a queue outage must not turn into a response that reveals the address is new
                logger.exception("newsletter_confirmation_enqueue_failed")
        return Response(SUBSCRIBE_REPLY, status=status.HTTP_202_ACCEPTED)


class NewsletterConfirmView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [PublicFormThrottle]
    throttle_scope = "newsletter"

    @extend_schema(request=TokenSerializer, responses={200: dict})
    def post(self, request):
        ser = TokenSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        invalid = DomainError(
            "INVALID_TOKEN", "This confirmation link isn't valid any more. Please subscribe again.", status_code=400
        )
        with transaction.atomic():
            sub = NewsletterSubscriber.objects.select_for_update().filter(token=ser.validated_data["token"]).first()
            if sub is None or sub.unsubscribed_at is not None:
                raise invalid
            if sub.confirmed_at is None:
                sub.confirmed_at = timezone.now()
                sub.save(update_fields=["confirmed_at"])
        return Response({"detail": "You're subscribed. Thank you!"})


class NewsletterUnsubscribeView(APIView):
    """Token-only (the link in our emails). Always answers the same way, so tokens can't be probed."""

    permission_classes = [AllowAny]
    throttle_classes = [PublicFormThrottle]
    throttle_scope = "newsletter"

    @extend_schema(request=TokenSerializer, responses={200: dict})
    def post(self, request):
        ser = TokenSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        NewsletterSubscriber.objects.filter(token=ser.validated_data["token"], unsubscribed_at__isnull=True).update(
            unsubscribed_at=timezone.now()
        )
        return Response({"detail": "You've been unsubscribed. We won't email you again."})


# =============================================================================================== contact form
class ContactSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=120)
    email = serializers.EmailField(max_length=254)
    topic = serializers.ChoiceField(choices=ContactMessage.Topic.choices, default=ContactMessage.Topic.OTHER)
    message = serializers.CharField(min_length=10, max_length=3000)
    order_number = serializers.CharField(max_length=20, required=False, allow_blank=True, default="")

    def validate_name(self, value):
        value = value.strip()
        if len(value) < 2:
            raise serializers.ValidationError("Please tell us your name.")
        return value

    def validate_order_number(self, value):
        return value.strip().upper()


class ContactView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [PublicFormThrottle]
    throttle_scope = "contact"

    @extend_schema(request=ContactSerializer, responses={201: dict})
    def post(self, request):
        ser = ContactSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        # Whether the order number exists is never checked or revealed here.
        ContactMessage.objects.create(
            name=data["name"], email=data["email"].lower(), topic=data["topic"],
            message=data["message"].strip(), order_number=data["order_number"],
        )  # fmt: skip
        return Response(
            {"detail": "Thanks for getting in touch. We've received your message and will reply by email."},
            status=status.HTTP_201_CREATED,
        )


# =============================================================================================== sitemap
class SitemapView(PublicView):
    """Slugs + last-modified of everything a visitor can actually open. Draft, inactive and staff data never appear."""

    @extend_schema(responses={200: dict})
    def get(self, request):
        now = timezone.now()
        today = timezone.localdate()
        # Same visibility rules as the storefront listing: ACTIVE, switched on, inside an active category chain.
        visible = ProductQuery({}, PromotionIndex([]), None).base()
        category_ids = set(visible.values_list("category_id", flat=True).distinct())
        parent_ids = set(
            Category.objects.filter(pk__in=category_ids, parent__isnull=False).values_list("parent_id", flat=True)
        )
        categories = Category.objects.filter(is_active=True, pk__in=category_ids | parent_ids).filter(
            Q(parent__isnull=True) | Q(parent__is_active=True)
        )
        collections = (
            Collection.objects.filter(is_active=True)
            .filter(Q(starts_on__isnull=True) | Q(starts_on__lte=today))
            .filter(Q(ends_on__isnull=True) | Q(ends_on__gte=today))
        )

        def rows(qs):
            return [
                {"slug": slug, "updated_at": updated}
                for slug, updated in qs.order_by("slug").values_list("slug", "updated_at")
            ]

        return Response(
            {
                "products": rows(Product.objects.filter(pk__in=visible.values("pk"))),
                "categories": rows(categories),
                "collections": rows(collections),
                "pages": rows(Page.objects.filter(is_published=True)),
                "articles": rows(Article.objects.filter(is_published=True, published_at__lte=now)),
            }
        )
