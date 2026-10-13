"""Public content endpoints: pages, articles, FAQs, newsletter (double opt-in), contact form and the SEO sitemap."""

import datetime as dt
from decimal import Decimal

import pytest
from django.core import mail
from django.utils import timezone

from apps.catalog.models import Category, Collection
from apps.content.models import FAQ, Article, ContactMessage, NewsletterSubscriber, Page
from apps.promotions.models import Promotion

pytestmark = pytest.mark.django_db
D = Decimal
API = "/api/v1/"


def code(res):
    return res.json().get("error", {}).get("code")


# =============================================================================================== pages
class TestPages:
    @pytest.fixture
    def pages(self):
        Page.objects.create(
            slug="terms", title="Terms", summary="The rules", body="# Terms\n\nBe kind.", is_template=True
        )
        Page.objects.create(slug="about", title="About us", body="We sell fruit.")
        Page.objects.create(slug="draft", title="Draft policy", body="secret draft", is_published=False)

    def test_list_has_only_published_pages_without_their_bodies(self, api, pages):
        res = api.get(API + "pages/")
        assert res.status_code == 200
        rows = res.json()
        assert [p["slug"] for p in rows] == ["about", "terms"]  # alphabetical by title, the draft is hidden
        assert "body" not in rows[0] and "secret draft" not in res.content.decode()
        assert {p["slug"]: p["is_template"] for p in rows} == {"about": False, "terms": True}

    def test_detail_returns_the_markdown_body(self, api, pages):
        data = api.get(API + "pages/terms/").json()
        assert data["body"] == "# Terms\n\nBe kind." and data["title"] == "Terms" and data["is_template"] is True

    def test_drafts_and_unknown_pages_are_404s_in_the_standard_error_shape(self, api, pages):
        for slug in ("draft", "nope"):
            res = api.get(API + f"pages/{slug}/")
            assert res.status_code == 404 and code(res) == "NOT_FOUND"


# =============================================================================================== articles
class TestArticles:
    def make(self, slug, kind="RECIPE", **kw):
        defaults = {"title": slug.replace("-", " ").title(), "summary": "Short", "body": "## Steps\n\nDo it."}
        return Article.objects.create(slug=slug, kind=kind, **{**defaults, **kw})

    def test_list_filters_by_kind_and_hides_drafts_and_scheduled_items(self, api):
        self.make("pasta", "RECIPE", servings=4, total_minutes=20)
        self.make("storing-herbs", "GUIDE")
        self.make("draft-soup", "RECIPE", is_published=False)
        self.make("christmas", "RECIPE", published_at=timezone.now() + dt.timedelta(days=30))
        everything = api.get(API + "articles/").json()
        assert everything["count"] == 2 and {a["slug"] for a in everything["results"]} == {"pasta", "storing-herbs"}
        assert "body" not in everything["results"][0] and everything["results"][0]["image"] is None
        assert [a["slug"] for a in api.get(API + "articles/", {"kind": "recipe"}).json()["results"]] == ["pasta"]
        assert [a["slug"] for a in api.get(API + "articles/", {"kind": "GUIDE"}).json()["results"]] == ["storing-herbs"]
        bad = api.get(API + "articles/", {"kind": "blog"})
        assert bad.status_code == 400 and code(bad) == "VALIDATION_ERROR"

    def test_newest_first_and_paginated(self, api):
        now = timezone.now()
        for n in range(30):
            self.make(f"a-{n}", published_at=now - dt.timedelta(hours=n))
        page = api.get(API + "articles/", {"page_size": 10}).json()
        assert (
            page["count"] == 30
            and page["total_pages"] == 3
            and len(page["results"]) == 10
            and page["results"][0]["slug"] == "a-0"
        )

    def test_detail_embeds_live_product_cards_for_the_linked_products(self, api, product_factory, stock_up):
        pasta = product_factory(sku="PA", name="Penne", price="1.50")
        tomatoes = product_factory(sku="TO", name="Tomatoes", price="2.00")
        gone = product_factory(sku="GN", name="Discontinued", status="ARCHIVED")
        hidden = product_factory(sku="HD", name="Switched off", is_available=False)
        for p in (pasta, tomatoes, gone, hidden):
            stock_up(p, 10)
        recipe = self.make("pasta-night", servings=2)
        recipe.products.add(tomatoes, pasta, gone, hidden)
        Promotion.objects.create(
            name="Pasta deal", label="20% off", kind="PERCENT_OFF", percent=D("20"), scope="PRODUCTS"
        ).products.add(pasta)
        data = api.get(API + "articles/pasta-night/").json()
        assert data["body"].startswith("## Steps") and data["servings"] == 2
        assert [p["name"] for p in data["products"]] == [
            "Penne",
            "Tomatoes",
        ]  # alphabetical; unsellable ones are left out
        card = data["products"][0]
        assert card["price"] == "1.20" and card["base_price"] == "1.50" and card["promotion"]["label"] == "20% off"
        assert card["availability"]["status"] == "IN_STOCK" and {"slug", "sale_unit", "unit_price", "badges"} <= set(
            card
        )

    def test_detail_404s_for_drafts_scheduled_and_unknown(self, api):
        self.make("draft", is_published=False)
        self.make("later", published_at=timezone.now() + dt.timedelta(days=2))
        for slug in ("draft", "later", "missing"):
            assert api.get(API + f"articles/{slug}/").status_code == 404

    def test_an_article_with_no_linked_products_has_an_empty_list(self, api):
        self.make("plain")
        assert api.get(API + "articles/plain/").json()["products"] == []


# =============================================================================================== FAQs
class TestFaqs:
    def test_published_questions_grouped_by_topic_in_order(self, api):
        FAQ.objects.create(question="How fast?", answer="Same day.", topic="Delivery", sort_order=2)
        FAQ.objects.create(question="How much?", answer="From $4.", topic="Delivery", sort_order=1)
        FAQ.objects.create(question="Refunds?", answer="Yes.", topic="Orders")
        FAQ.objects.create(question="Hidden?", answer="Yes.", topic="Orders", is_published=False)
        rows = api.get(API + "faqs/").json()
        assert [(f["topic"], f["question"]) for f in rows] == [
            ("Delivery", "How much?"),
            ("Delivery", "How fast?"),
            ("Orders", "Refunds?"),
        ]
        assert "Hidden?" not in str(rows)


# =============================================================================================== newsletter
SUBSCRIBE = API + "newsletter/subscribe/"
CONFIRM = API + "newsletter/confirm/"
UNSUBSCRIBE = API + "newsletter/unsubscribe/"


def subscribe(api, email="reader@example.com"):
    return api.post(SUBSCRIBE, {"email": email}, format="json")


class TestNewsletter:
    def test_subscribing_sends_a_confirmation_link_and_does_not_subscribe_yet(self, api, settings):
        res = subscribe(api, "  Reader@Example.COM ")
        assert res.status_code == 202 and "confirmation" in res.json()["detail"]
        sub = NewsletterSubscriber.objects.get()
        assert (
            sub.email == "reader@example.com"
            and sub.confirmed_at is None
            and sub.unsubscribed_at is None
            and len(sub.token) >= 32
        )
        assert len(mail.outbox) == 1 and mail.outbox[0].to == ["reader@example.com"]
        assert f"{settings.FRONTEND_URL}/newsletter/confirm?token={sub.token}" in mail.outbox[0].body

    def test_double_opt_in_only_a_click_on_the_emailed_link_subscribes(self, api):
        subscribe(api)
        sub = NewsletterSubscriber.objects.get()
        assert api.post(CONFIRM, {"token": "guess"}, format="json").status_code == 400
        sub.refresh_from_db()
        assert sub.confirmed_at is None
        res = api.post(CONFIRM, {"token": sub.token}, format="json")
        assert res.status_code == 200
        sub.refresh_from_db()
        assert sub.confirmed_at is not None
        stamp = sub.confirmed_at
        assert api.post(CONFIRM, {"token": sub.token}, format="json").status_code == 200  # clicking twice is harmless
        sub.refresh_from_db()
        assert sub.confirmed_at == stamp

    def test_the_answer_is_identical_whether_or_not_the_address_is_known(self, api):
        known_pending = NewsletterSubscriber.objects.create(email="pending@example.com", token="p" * 32)
        confirmed = NewsletterSubscriber.objects.create(
            email="member@example.com", token="m" * 32, confirmed_at=timezone.now()
        )
        gone = NewsletterSubscriber.objects.create(
            email="gone@example.com", token="g" * 32, confirmed_at=timezone.now(), unsubscribed_at=timezone.now()
        )
        answers = {
            email: (r.status_code, r.json())
            for email, r in (
                (e, subscribe(api, e))
                for e in ("brand-new@example.com", known_pending.email, confirmed.email, gone.email)
            )
        }
        assert len(set(map(str, answers.values()))) == 1, answers
        assert next(iter(answers.values()))[0] == 202

    def test_already_subscribed_people_get_no_email_and_pending_ones_get_the_same_link_again(self, api):
        NewsletterSubscriber.objects.create(email="member@example.com", token="m" * 32, confirmed_at=timezone.now())
        pending = NewsletterSubscriber.objects.create(email="pending@example.com", token="p" * 32)
        subscribe(api, "member@example.com")
        assert mail.outbox == []
        subscribe(api, "PENDING@example.com")
        assert len(mail.outbox) == 1 and pending.token in mail.outbox[0].body
        assert NewsletterSubscriber.objects.count() == 2  # no case-variant duplicates

    def test_unsubscribing_with_the_token_and_the_neutral_answer_for_unknown_tokens(self, api):
        NewsletterSubscriber.objects.create(email="member@example.com", token="m" * 32, confirmed_at=timezone.now())
        ok = api.post(UNSUBSCRIBE, {"token": "m" * 32}, format="json")
        unknown = api.post(UNSUBSCRIBE, {"token": "z" * 32}, format="json")
        assert ok.status_code == unknown.status_code == 200 and ok.json() == unknown.json()
        assert NewsletterSubscriber.objects.get().unsubscribed_at is not None
        assert api.post(UNSUBSCRIBE, {}, format="json").status_code == 400

    def test_an_old_confirmation_link_cannot_resurrect_an_unsubscribed_address(self, api):
        subscribe(api)
        token = NewsletterSubscriber.objects.get().token
        api.post(CONFIRM, {"token": token}, format="json")
        api.post(UNSUBSCRIBE, {"token": token}, format="json")
        assert api.post(CONFIRM, {"token": token}, format="json").status_code == 400
        assert NewsletterSubscriber.objects.get().unsubscribed_at is not None

    def test_coming_back_after_unsubscribing_needs_a_fresh_confirmation(self, api):
        sub = NewsletterSubscriber.objects.create(
            email="reader@example.com", token="o" * 32, confirmed_at=timezone.now(), unsubscribed_at=timezone.now()
        )
        subscribe(api)
        sub.refresh_from_db()
        assert sub.unsubscribed_at is None and sub.confirmed_at is None and sub.token != "o" * 32
        assert len(mail.outbox) == 1 and sub.token in mail.outbox[0].body
        assert (
            api.post(CONFIRM, {"token": "o" * 32}, format="json").status_code == 400
        )  # the old link died with the old token
        assert api.post(CONFIRM, {"token": sub.token}, format="json").status_code == 200

    @pytest.mark.parametrize("email", ["", "not-an-email", "a@", "x" * 300 + "@example.com"])
    def test_bad_addresses_are_validation_errors(self, api, email):
        res = subscribe(api, email)
        assert res.status_code == 400 and code(res) == "VALIDATION_ERROR" and "email" in res.json()["error"]["details"]
        assert not NewsletterSubscriber.objects.exists() and mail.outbox == []

    def test_a_mail_queue_outage_does_not_change_the_answer(self, api, monkeypatch):
        from apps.content import views

        reference = subscribe(api, "first@example.com")

        def broken(*a, **kw):
            raise ConnectionError("broker down")

        monkeypatch.setattr(views.send_newsletter_confirmation, "delay", broken)
        outage = subscribe(api, "second@example.com")
        assert (outage.status_code, outage.json()) == (reference.status_code, reference.json())

    def test_subscribing_is_throttled(self, api):
        for n in range(10):
            assert subscribe(api, f"user{n}@example.com").status_code == 202
        limited = subscribe(api, "one-too-many@example.com")
        assert limited.status_code == 429 and code(limited) == "RATE_LIMITED"
        assert not NewsletterSubscriber.objects.filter(email="one-too-many@example.com").exists()
        assert (
            api.post(CONFIRM, {"token": "x"}, format="json").status_code == 429
        )  # same scope: probing tokens is limited too

    def test_csrf_is_enforced_for_anonymous_posts(self, csrf_api):
        res = csrf_api.post(SUBSCRIBE, {"email": "reader@example.com"}, format="json")
        assert res.status_code == 403 and not NewsletterSubscriber.objects.exists()


# =============================================================================================== contact form
CONTACT = API + "contact/"


def contact(**kw):
    return {
        "name": "Ann Shopper",
        "email": "Ann@Example.com",
        "topic": "ORDER",
        "message": "My milk was warm when it arrived.",
        **kw,
    }


class TestContactForm:
    def test_stores_the_message_for_staff(self, api):
        res = api.post(CONTACT, contact(order_number=" or-261012-abcde "), format="json")
        assert res.status_code == 201 and "received" in res.json()["detail"] and set(res.json()) == {"detail"}
        msg = ContactMessage.objects.get()
        assert (msg.name, msg.email, msg.topic, msg.status, msg.order_number) == (
            "Ann Shopper",
            "ann@example.com",
            "ORDER",
            "NEW",
            "OR-261012-ABCDE",
        )
        assert msg.message == "My milk was warm when it arrived." and msg.handled_by is None

    def test_topic_and_order_number_are_optional_and_unknown_orders_are_not_revealed(self, api):
        body = {"name": "Bo", "email": "bo@example.com", "message": "Do you stock oat milk?"}
        assert api.post(CONTACT, body, format="json").status_code == 201
        assert (
            api.post(CONTACT, {**body, "order_number": "OR-000000-ZZZZZ"}, format="json").status_code == 201
        )  # same answer as for a real order
        assert ContactMessage.objects.filter(topic="OTHER").count() == 2

    @pytest.mark.parametrize(
        ("overrides", "field"),
        [
            ({"name": ""}, "name"), ({"name": "A"}, "name"), ({"email": "nope"}, "email"), ({"email": ""}, "email"),
            ({"message": "hi"}, "message"), ({"message": "x" * 3001}, "message"), ({"topic": "LOVE"}, "topic"), ({"order_number": "x" * 21}, "order_number"),
        ],
    )  # fmt: skip
    def test_validation(self, api, overrides, field):
        res = api.post(CONTACT, contact(**overrides), format="json")
        assert res.status_code == 400 and code(res) == "VALIDATION_ERROR" and field in res.json()["error"]["details"]
        assert not ContactMessage.objects.exists()

    def test_signed_in_customers_can_write_too(self, auth_api):
        assert auth_api.post(CONTACT, contact(), format="json").status_code == 201

    def test_throttled(self, api):
        for _ in range(5):
            assert api.post(CONTACT, contact(), format="json").status_code == 201
        res = api.post(CONTACT, contact(), format="json")
        assert res.status_code == 429 and code(res) == "RATE_LIMITED" and ContactMessage.objects.count() == 5

    def test_csrf_is_enforced(self, csrf_api):
        assert (
            csrf_api.post(CONTACT, contact(), format="json").status_code == 403 and not ContactMessage.objects.exists()
        )


# =============================================================================================== sitemap
@pytest.fixture
def site(product_factory, category, units):
    """A storefront with one of everything public and one hidden twin of each."""
    now = timezone.now()
    today = timezone.localdate()
    visible = product_factory(sku="OK", name="Visible pears")
    product_factory(sku="INACT", name="Inactive pears", status="INACTIVE")
    product_factory(sku="ARCH", name="Archived pears", status="ARCHIVED")
    product_factory(sku="OFF", name="Switched off pears", is_available=False)
    dead_cat = Category.objects.create(name="Retired", slug="retired", is_active=False)
    product_factory(sku="INCAT", name="Pears in a retired category", category=dead_cat)
    empty_cat = Category.objects.create(name="Empty shelf", slug="empty-shelf")
    inactive_dept = Category.objects.create(name="Closed dept", slug="closed-dept", is_active=False)
    under_closed = Category.objects.create(name="Under closed", slug="under-closed", parent=inactive_dept)
    product_factory(sku="UNDER", name="Pears under a closed department", category=under_closed)
    Collection.objects.create(name="Live", slug="live-collection")
    Collection.objects.create(name="Off", slug="off-collection", is_active=False)
    Collection.objects.create(name="Not yet", slug="future-collection", starts_on=today + dt.timedelta(days=3))
    Collection.objects.create(name="Over", slug="past-collection", ends_on=today - dt.timedelta(days=3))
    Page.objects.create(slug="terms", title="Terms", body="x")
    Page.objects.create(slug="draft-page", title="Draft", body="x", is_published=False)
    Article.objects.create(slug="live-recipe", kind="RECIPE", title="Live", summary="s", body="b")
    Article.objects.create(slug="draft-recipe", kind="RECIPE", title="Draft", summary="s", body="b", is_published=False)
    Article.objects.create(
        slug="later-recipe",
        kind="RECIPE",
        title="Later",
        summary="s",
        body="b",
        published_at=now + dt.timedelta(days=5),
    )
    return visible, empty_cat


class TestSitemap:
    def test_lists_only_what_a_visitor_can_actually_open(self, api, site):
        res = api.get(API + "seo/sitemap/")
        assert res.status_code == 200
        data = res.json()
        assert set(data) == {"products", "categories", "collections", "pages", "articles"}
        slugs = {key: [row["slug"] for row in rows] for key, rows in data.items()}
        assert slugs["products"] == ["ok"]
        assert slugs["categories"] == ["fresh-produce", "fruit"]  # the department of a populated category is included
        assert slugs["collections"] == ["live-collection"]
        assert slugs["pages"] == ["terms"] and slugs["articles"] == ["live-recipe"]

    def test_entries_carry_only_a_slug_and_a_timestamp(self, api, site):
        res = api.get(API + "seo/sitemap/")
        for rows in res.json().values():
            for row in rows:
                assert set(row) == {"slug", "updated_at"} and row["updated_at"].startswith("20")
        raw = res.content.decode()
        for private in ("sku", "price", "OK", "is_demo", "popularity", "email", "draft", "INACT", "stock"):
            assert private not in raw, private

    def test_needs_no_sign_in_and_follows_catalog_changes(self, api, site):
        visible, _ = site
        assert [p["slug"] for p in api.get(API + "seo/sitemap/").json()["products"]] == [visible.slug]
        visible.status = "INACTIVE"
        visible.save()
        data = api.get(API + "seo/sitemap/").json()
        assert (
            data["products"] == [] and data["categories"] == []
        )  # no purchasable products left, so no empty category pages either

    def test_a_published_page_appears_and_unpublishing_removes_it(self, api, site):
        page = Page.objects.get(slug="terms")
        page.is_published = False
        page.save()
        assert api.get(API + "seo/sitemap/").json()["pages"] == []

    def test_empty_store_returns_empty_lists(self, api):
        assert api.get(API + "seo/sitemap/").json() == {
            "products": [],
            "categories": [],
            "collections": [],
            "pages": [],
            "articles": [],
        }
