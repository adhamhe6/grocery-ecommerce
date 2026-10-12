"""Staff content API: banners, pages, articles, FAQs, newsletter subscribers and the contact inbox."""

import csv
import datetime as dt
import io

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.content.models import FAQ, Article, Banner, ContactMessage, NewsletterSubscriber, Page
from apps.core import rbac
from apps.core.models import AuditLog
from tests.admin.conftest import results
from tests.admin.helpers import BAD_UPLOADS, STAFF_ROLES, details, stored_files, upload

pytestmark = pytest.mark.django_db


@pytest.fixture
def media(settings, tmp_path):
    """Point uploads at a throw-away folder so the test can assert exactly which files exist."""
    settings.MEDIA_ROOT = str(tmp_path)
    return tmp_path


BASE = "/api/v1/admin/"
CONTENT_STAFF = {"SUPER_ADMIN", "ADMIN", "MARKETING_MANAGER"}
NEWSLETTER_STAFF = CONTENT_STAFF | {"STORE_MANAGER"}  # content.manage or reports.export
INBOX_STAFF = {"SUPER_ADMIN", "ADMIN", "STORE_MANAGER", "CUSTOMER_SUPPORT"}  # customers.read

HTML_ATTACKS = [
    "<script>alert(1)</script>",
    "Hello <b>world</b>",
    "<img src=x onerror=alert(1)>",
    "text </div> more",
    "<!-- hidden -->",
    "<IFRAME src='https://evil.example'></IFRAME>",
    "<a href='x'>y</a>",
    "<?php echo 1 ?>",
    "[click me](javascript:alert(1))",
    "[click me]( JavaScript:alert(1))",
    "[ref]: data:text/html;base64,AAAA",
]
MARKDOWN_THAT_IS_FINE = [
    "# Heading\n\n**bold** and _italic_\n\n- one\n- two\n\n[link](https://example.com/page)",
    "Cook for 2 < 3 minutes, then 5 > 4",
    "I <3 groceries",
    "Visit <https://example.com> or <mailto:hello@example.com>",
    "Entities like &lt;b&gt; are text, not tags",
]


def audits(action):
    return AuditLog.objects.filter(action=action)


class TestAccess:
    PATHS = ["banners", "pages", "articles", "faqs", "newsletter", "contact-messages"]

    @pytest.mark.parametrize("path", PATHS)
    def test_anonymous_gets_401_and_customers_get_403(self, path, user):
        assert APIClient().get(f"{BASE}{path}/").status_code == 401
        c = APIClient()
        c.force_authenticate(user)
        res = c.get(f"{BASE}{path}/")
        assert res.status_code == 403 and res.json()["error"]["code"] == "FORBIDDEN"

    def test_documented_matrices_match_rbac(self):
        def holders(*caps):
            return {r for r in rbac.STAFF_ROLES if any(rbac.role_has(r, c) for c in caps)}

        assert holders("content.manage") == CONTENT_STAFF
        assert holders("content.manage", "reports.export") == NEWSLETTER_STAFF
        assert holders("customers.read") == INBOX_STAFF

    @pytest.mark.parametrize("role", STAFF_ROLES)
    def test_content_is_for_content_managers_only(self, role, staff):
        c = staff(role)
        allowed = role in CONTENT_STAFF
        bodies = {
            "banners": {"title": "Sale", "placement": "HERO"},
            "pages": {"title": "Terms", "body": "text"},
            "articles": {"title": "Pasta", "kind": "RECIPE", "summary": "Quick", "body": "Boil."},
            "faqs": {"question": "Q?", "answer": "A."},
        }
        for path, body in bodies.items():
            assert c.get(f"{BASE}{path}/").status_code == (200 if allowed else 403), (role, path)
            res = c.post(f"{BASE}{path}/", body, format="json")
            assert res.status_code == (201 if allowed else 403), (role, path, res.content)

    @pytest.mark.parametrize("role", STAFF_ROLES)
    def test_newsletter_and_inbox_roles(self, role, staff):
        c = staff(role)
        assert c.get(f"{BASE}newsletter/").status_code == (200 if role in NEWSLETTER_STAFF else 403)
        assert c.get(f"{BASE}newsletter/export/").status_code == (200 if role in NEWSLETTER_STAFF else 403)
        assert c.get(f"{BASE}contact-messages/").status_code == (200 if role in INBOX_STAFF else 403)


class TestServerOwnedFields:
    @pytest.mark.parametrize(
        ("path", "body"),
        [
            ("banners", {"title": "Sale"}),
            ("pages", {"title": "Terms", "body": "text"}),
            ("articles", {"title": "Pasta", "kind": "RECIPE", "summary": "Quick", "body": "Boil."}),
            ("faqs", {"question": "Q?", "answer": "A."}),
        ],
    )
    def test_ids_and_timestamps_cannot_be_chosen(self, admin, path, body):
        res = admin.post(
            f"{BASE}{path}/",
            {**body, "id": 4242, "created_at": "2001-01-01T00:00:00Z", "updated_at": "2001-01-01T00:00:00Z"},
            format="json",
        )
        assert res.status_code == 201 and res.json()["id"] != 4242
        assert not str(res.json().get("created_at", "")).startswith("2001")
        patched = admin.patch(
            f"{BASE}{path}/{res.json()['id']}/", {"id": 1, "created_at": "2001-01-01T00:00:00Z"}, format="json"
        )
        assert patched.status_code == 200 and patched.json()["id"] == res.json()["id"]
        assert not str(patched.json().get("created_at", "")).startswith("2001")


# =============================================================================================== banners
class TestBanners:
    URL = BASE + "banners/"

    @pytest.mark.parametrize(
        "link",
        ["/offers", "/c/fruit?sort=price&page=2", "/", "https://partner.example/shop", "https://partner.example"],
    )
    def test_safe_links_are_accepted(self, admin, link):
        res = admin.post(self.URL, {"title": "Sale", "cta_label": "Shop", "cta_link": link}, format="json")
        assert res.status_code == 201 and res.json()["cta_link"] == link

    @pytest.mark.parametrize(
        "link",
        [
            "javascript:alert(1)",
            "//evil.example/steal",
            "http://insecure.example",
            "data:text/html,<script>1</script>",
            "/\\evil.example",
            "ftp://x.example",
            "evil.example",
            "/path with space",
        ],
    )
    def test_unsafe_links_are_rejected(self, admin, link):
        res = admin.post(self.URL, {"title": "Sale", "cta_label": "Shop", "cta_link": link}, format="json")
        assert res.status_code == 400 and "cta_link" in details(res), (link, res.content)
        assert not Banner.objects.exists()

    def test_scheduling_is_validated_and_exposed(self, admin):
        bad = admin.post(
            self.URL,
            {"title": "X", "starts_at": "2026-12-02T00:00:00Z", "ends_at": "2026-12-01T00:00:00Z"},
            format="json",
        )
        assert bad.status_code == 400 and "ends_at" in details(bad)
        now = timezone.now()
        live = admin.post(
            self.URL,
            {
                "title": "Live",
                "starts_at": (now - dt.timedelta(hours=1)).isoformat(),
                "ends_at": (now + dt.timedelta(hours=1)).isoformat(),
            },
            format="json",
        )
        future = admin.post(
            self.URL, {"title": "Soon", "starts_at": (now + dt.timedelta(days=2)).isoformat()}, format="json"
        )
        assert live.json()["is_live"] is True and future.json()["is_live"] is False
        assert [b["title"] for b in results(admin.get(self.URL, {"live": "true"}))] == ["Live"]
        assert admin.post(self.URL, {"title": "Off", "is_active": False}, format="json").json()["is_live"] is False

    def test_updates_are_audited_with_before_and_after(self, admin):
        pk = admin.post(self.URL, {"title": "Old title", "placement": "STRIP"}, format="json").json()["id"]
        admin.patch(f"{self.URL}{pk}/", {"title": "New title", "sort_order": 3}, format="json")
        entry = audits("banner.updated").get()
        assert (
            entry.before["title"] == "Old title"
            and entry.after["title"] == "New title"
            and entry.after["sort_order"] == 3
        )
        assert audits("banner.created").get().after["placement"] == "STRIP"
        assert results(admin.get(self.URL, {"placement": "strip"}))[0]["id"] == pk

    def test_the_cached_home_page_follows_banner_edits_at_once(self, admin, api):
        pk = admin.post(
            self.URL, {"title": "Spring sale", "cta_label": "Shop", "cta_link": "/offers"}, format="json"
        ).json()["id"]
        assert [b["title"] for b in api.get("/api/v1/home/").json()["banners"]] == [
            "Spring sale"
        ]  # warms the 60 s cache
        admin.patch(f"{self.URL}{pk}/", {"title": "Summer sale"}, format="json")
        assert [b["title"] for b in api.get("/api/v1/home/").json()["banners"]] == ["Summer sale"]
        admin.patch(f"{self.URL}{pk}/", {"is_active": False}, format="json")
        assert api.get("/api/v1/home/").json()["banners"] == []
        admin.patch(f"{self.URL}{pk}/", {"is_active": True}, format="json")
        assert api.get("/api/v1/home/").json()["banners"] != []
        admin.delete(f"{self.URL}{pk}/")
        assert api.get("/api/v1/home/").json()["banners"] == []

    def test_banner_images_go_through_the_pipeline(self, admin, media):
        pk = admin.post(self.URL, {"title": "Hero"}, format="json").json()["id"]
        res = admin.post(f"{self.URL}{pk}/image/", {"image": upload("PNG")}, format="multipart")
        assert res.status_code == 200 and set(res.json()["image"]) == {"original", "320", "640", "1024"}
        banner = Banner.objects.get(pk=pk)
        assert (
            banner.image_widths == [320, 640, 1024]
            and banner.image.name.startswith("banners/")
            and len(stored_files(media)) == 4
        )
        assert audits("banner.image_updated").get().after["image_widths"] == [320, 640, 1024]

    @pytest.mark.parametrize("kind", sorted(BAD_UPLOADS))
    def test_unsafe_banner_images_are_rejected(self, kind, admin, media):
        pk = admin.post(self.URL, {"title": "Hero"}, format="json").json()["id"]
        res = admin.post(f"{self.URL}{pk}/image/", {"image": BAD_UPLOADS[kind]()}, format="multipart")
        assert res.status_code == 400 and "image" in details(res) and stored_files(media) == set()

    def test_removing_the_image_or_the_banner_deletes_the_files(self, admin, media):
        pk = admin.post(self.URL, {"title": "Hero"}, format="json").json()["id"]
        admin.post(f"{self.URL}{pk}/image/", {"image": upload("JPEG")}, format="multipart")
        assert admin.delete(f"{self.URL}{pk}/image/").status_code == 204 and stored_files(media) == set()
        admin.post(f"{self.URL}{pk}/image/", {"image": upload("JPEG")}, format="multipart")
        assert admin.delete(f"{self.URL}{pk}/").status_code == 204 and stored_files(media) == set()
        assert audits("banner.deleted").count() == 1


# =============================================================================================== pages
class TestPages:
    URL = BASE + "pages/"

    def test_markdown_pages_with_a_visible_template_flag(self, admin):
        res = admin.post(
            self.URL,
            {
                "title": "Returns policy",
                "summary": "How returns work",
                "body": "# Returns\n\nFresh food **can't** be returned.",
                "is_template": True,
            },
            format="json",
        )
        assert res.status_code == 201
        assert (
            res.json()["slug"] == "returns-policy"
            and res.json()["is_template"] is True
            and res.json()["is_published"] is True
        )
        assert [p["slug"] for p in results(admin.get(self.URL, {"is_template": "true"}))] == ["returns-policy"]
        cleared = admin.patch(f"{self.URL}{res.json()['id']}/", {"is_template": False}, format="json")
        assert cleared.json()["is_template"] is False
        assert audits("page.updated").get().before["is_template"] is True

    @pytest.mark.parametrize("text", HTML_ATTACKS)
    @pytest.mark.parametrize("field", ["body", "summary", "title"])
    def test_raw_html_is_rejected_in_every_text_field(self, admin, text, field):
        body = {"title": "Terms", "summary": "Plain", "body": "Plain"}
        res = admin.post(self.URL, {**body, field: text}, format="json")
        assert res.status_code == 400 and res.json()["error"]["code"] == "VALIDATION_ERROR", (field, text, res.content)
        assert "HTML isn't allowed, use Markdown" in details(res)[field]
        assert not Page.objects.exists()

    @pytest.mark.parametrize("text", MARKDOWN_THAT_IS_FINE)
    def test_genuine_markdown_is_accepted(self, admin, text):
        res = admin.post(self.URL, {"title": "Guide", "body": text}, format="json")
        assert res.status_code == 201 and Page.objects.get().body == text

    def test_html_cannot_be_smuggled_in_through_an_update(self, admin):
        pk = admin.post(self.URL, {"title": "Terms", "body": "ok"}, format="json").json()["id"]
        res = admin.patch(f"{self.URL}{pk}/", {"body": "ok <script>x</script>"}, format="json")
        assert res.status_code == 400 and Page.objects.get().body == "ok"
        assert admin.put(f"{self.URL}{pk}/", {"title": "Terms", "body": "<b>x</b>"}, format="json").status_code == 400

    def test_slug_rules_and_audit(self, admin):
        first = admin.post(self.URL, {"title": "Privacy", "body": "x"}, format="json").json()
        second = admin.post(self.URL, {"title": "Privacy", "body": "x"}, format="json").json()
        assert first["slug"] == "privacy" and second["slug"] == "privacy-2"
        dup = admin.post(self.URL, {"title": "Other", "slug": "privacy", "body": "x"}, format="json")
        assert dup.status_code == 400 and "slug" in details(dup)
        assert admin.delete(f"{self.URL}{second['id']}/").status_code == 204
        assert audits("page.deleted").get().before["slug"] == "privacy-2"

    def test_unpublishing_hides_it_from_the_public(self, admin, api):
        pk = admin.post(self.URL, {"title": "Cookies", "body": "x"}, format="json").json()["id"]
        assert api.get("/api/v1/pages/cookies/").status_code == 200
        admin.patch(f"{self.URL}{pk}/", {"is_published": False}, format="json")
        assert api.get("/api/v1/pages/cookies/").status_code == 404


# =============================================================================================== articles
class TestArticles:
    URL = BASE + "articles/"

    def body(self, **kw):
        return {
            "kind": "RECIPE",
            "title": "Tomato pasta",
            "summary": "Ready in 20 minutes",
            "body": "## Method\n\nBoil, drain, toss.",
            **kw,
        }

    def test_create_with_product_links_and_recipe_details(self, admin, product_factory):
        a, b = product_factory(sku="PA", name="Pasta"), product_factory(sku="TO", name="Tomatoes")
        res = admin.post(self.URL, self.body(products=[a.id, b.id], servings=4, total_minutes=20), format="json")
        assert res.status_code == 201
        data = res.json()
        assert (
            data["slug"] == "tomato-pasta"
            and sorted(data["products"]) == sorted([a.id, b.id])
            and data["servings"] == 4
            and data["is_live"] is True
        )
        entry = audits("article.created").get()
        assert sorted(entry.after["products"]) == sorted([a.id, b.id]) and entry.after["kind"] == "RECIPE"

    @pytest.mark.parametrize("field", ["body", "summary", "title"])
    @pytest.mark.parametrize("text", HTML_ATTACKS[:5])
    def test_raw_html_is_rejected(self, admin, field, text):
        res = admin.post(self.URL, self.body(**{field: text}), format="json")
        assert res.status_code == 400 and "HTML isn't allowed, use Markdown" in details(res)[field]
        assert not Article.objects.exists()

    def test_kind_products_and_numbers_are_validated(self, admin):
        assert admin.post(self.URL, self.body(kind="BLOG"), format="json").status_code == 400
        assert admin.post(self.URL, self.body(products=[987654]), format="json").status_code == 400
        assert admin.post(self.URL, self.body(servings=-1), format="json").status_code == 400
        assert admin.post(self.URL, {"kind": "GUIDE", "title": "No body"}, format="json").status_code == 400

    def test_filters_and_scheduling(self, admin):
        admin.post(self.URL, self.body(), format="json")
        admin.post(self.URL, self.body(kind="GUIDE", title="Storing herbs"), format="json")
        future = (timezone.now() + dt.timedelta(days=3)).isoformat()
        scheduled = admin.post(self.URL, self.body(title="Christmas menu", published_at=future), format="json").json()
        assert scheduled["is_live"] is False
        assert {a["title"] for a in results(admin.get(self.URL, {"kind": "recipe"}))} == {
            "Tomato pasta",
            "Christmas menu",
        }
        assert [a["title"] for a in results(admin.get(self.URL, {"kind": "GUIDE"}))] == ["Storing herbs"]
        assert admin.get(self.URL, {"kind": "blog"}).status_code == 400

    def test_images_use_the_pipeline_and_are_removed_with_the_article(self, admin, media):
        pk = admin.post(self.URL, self.body(), format="json").json()["id"]
        res = admin.post(f"{self.URL}{pk}/image/", {"image": upload("WEBP")}, format="multipart")
        assert res.status_code == 200 and set(res.json()["image"]) == {"original", "320", "640", "1024"}
        assert Article.objects.get(pk=pk).image_widths == [320, 640, 1024] and len(stored_files(media)) == 4
        bad = admin.post(f"{self.URL}{pk}/image/", {"image": BAD_UPLOADS["svg"]()}, format="multipart")
        assert bad.status_code == 400 and len(stored_files(media)) == 4  # the good image is untouched
        assert admin.delete(f"{self.URL}{pk}/").status_code == 204 and stored_files(media) == set()

    def test_the_home_page_guides_follow_publishing_at_once(self, admin, api):
        pk = admin.post(self.URL, self.body(), format="json").json()["id"]
        assert [g["slug"] for g in api.get("/api/v1/home/").json()["guides"]] == ["tomato-pasta"]
        admin.patch(f"{self.URL}{pk}/", {"is_published": False}, format="json")
        assert api.get("/api/v1/home/").json()["guides"] == []

    def test_update_audit_has_before_and_after(self, admin):
        pk = admin.post(self.URL, self.body(), format="json").json()["id"]
        admin.patch(f"{self.URL}{pk}/", {"is_published": False}, format="json")
        entry = audits("article.updated").get()
        assert entry.before["is_published"] is True and entry.after["is_published"] is False


# =============================================================================================== FAQs
class TestFaqs:
    URL = BASE + "faqs/"

    def test_crud_ordering_and_audit(self, admin):
        a = admin.post(
            self.URL,
            {"question": "Do you deliver?", "answer": "Yes, daily.", "topic": "Delivery", "sort_order": 2},
            format="json",
        ).json()
        admin.post(
            self.URL, {"question": "Cost?", "answer": "From $4.", "topic": "Delivery", "sort_order": 1}, format="json"
        )
        assert [f["question"] for f in results(admin.get(self.URL))] == ["Cost?", "Do you deliver?"]
        assert [f["question"] for f in results(admin.get(self.URL, {"topic": "delivery"}))] == [
            "Cost?",
            "Do you deliver?",
        ]
        admin.patch(f"{self.URL}{a['id']}/", {"answer": "Yes, every day."}, format="json")
        assert audits("faq.updated").get().before["answer"] == "Yes, daily."
        assert admin.delete(f"{self.URL}{a['id']}/").status_code == 204 and FAQ.objects.count() == 1

    @pytest.mark.parametrize("text", HTML_ATTACKS[:4])
    def test_html_is_rejected(self, admin, text):
        res = admin.post(self.URL, {"question": "Q?", "answer": text}, format="json")
        assert res.status_code == 400 and "HTML isn't allowed, use Markdown" in details(res)["answer"]


# =============================================================================================== newsletter
@pytest.fixture
def subscribers(db):
    now = timezone.now()
    return {
        "confirmed": NewsletterSubscriber.objects.create(
            email="yes@example.com", token="tok-confirmed", confirmed_at=now
        ),
        "pending": NewsletterSubscriber.objects.create(email="pending@example.com", token="tok-pending"),
        "gone": NewsletterSubscriber.objects.create(
            email="gone@example.com", token="tok-gone", confirmed_at=now, unsubscribed_at=now
        ),
    }


class TestNewsletterAdmin:
    URL = BASE + "newsletter/"

    def test_list_shows_emails_and_state_but_never_tokens(self, admin, subscribers):
        res = admin.get(self.URL)
        rows = {r["email"]: r for r in results(res)}
        assert {e: r["status"] for e, r in rows.items()} == {
            "yes@example.com": "CONFIRMED",
            "pending@example.com": "PENDING",
            "gone@example.com": "UNSUBSCRIBED",
        }
        assert "tok-" not in res.content.decode() and "token" not in rows["yes@example.com"]
        assert [r["email"] for r in results(admin.get(self.URL, {"status": "confirmed"}))] == ["yes@example.com"]
        assert [r["email"] for r in results(admin.get(self.URL, {"search": "PEND"}))] == ["pending@example.com"]
        assert admin.get(self.URL, {"status": "maybe"}).status_code == 400

    def test_subscribers_are_read_only_here(self, admin, subscribers):
        pk = subscribers["confirmed"].pk
        assert admin.post(self.URL, {"email": "x@example.com"}, format="json").status_code == 405
        assert admin.patch(f"{self.URL}{pk}/", {"email": "x@example.com"}, format="json").status_code == 405
        assert admin.delete(f"{self.URL}{pk}/").status_code == 405

    def test_csv_export_has_only_emails_of_people_we_may_mail_and_is_audited(self, staff, subscribers):
        res = staff("MARKETING_MANAGER").get(self.URL + "export/")
        assert (
            res.status_code == 200
            and res["Content-Type"].startswith("text/csv")
            and "attachment" in res["Content-Disposition"]
        )
        rows = list(csv.reader(io.StringIO(res.content.decode())))
        assert rows == [
            ["email"],
            ["yes@example.com"],
        ]  # pending (never confirmed) and unsubscribed people are excluded
        for secret in ("tok-confirmed", "tok-pending", "created_at"):
            assert secret not in res.content.decode()
        entry = audits("newsletter.exported").get()
        assert entry.actor.role == "MARKETING_MANAGER" and "1 confirmed" in entry.summary

    def test_spreadsheet_formulas_in_addresses_are_defused(self, admin):
        NewsletterSubscriber.objects.create(email="=HYPERLINK(1)@example.com", token="t1", confirmed_at=timezone.now())
        NewsletterSubscriber.objects.create(email="+44@example.com", token="t2", confirmed_at=timezone.now())
        rows = list(csv.reader(io.StringIO(admin.get(self.URL + "export/").content.decode())))[1:]
        assert sorted(r[0] for r in rows) == ["'+44@example.com", "'=HYPERLINK(1)@example.com"]


# =============================================================================================== contact inbox
@pytest.fixture
def inbox(db):
    return [
        ContactMessage.objects.create(
            name="Ann",
            email="ann@example.com",
            topic="ORDER",
            message="Where is my order?",
            order_number="OR-261012-ABCDE",
        ),
        ContactMessage.objects.create(
            name="Bob", email="bob@example.com", topic="FEEDBACK", message="Lovely strawberries", status="HANDLED"
        ),
    ]


class TestContactInbox:
    URL = BASE + "contact-messages/"

    def test_list_filters_and_detail(self, staff, inbox):
        c = staff("CUSTOMER_SUPPORT")
        assert {m["name"] for m in results(c.get(self.URL))} == {"Ann", "Bob"}
        assert [m["name"] for m in results(c.get(self.URL, {"status": "new"}))] == ["Ann"]
        assert [m["name"] for m in results(c.get(self.URL, {"topic": "feedback"}))] == ["Bob"]
        assert [m["name"] for m in results(c.get(self.URL, {"q": "OR-261012"}))] == ["Ann"]
        detail = c.get(f"{self.URL}{inbox[0].id}/").json()
        assert (
            detail["email"] == "ann@example.com"
            and detail["message"] == "Where is my order?"
            and detail["status"] == "NEW"
        )

    def test_handling_records_who_when_and_audits(self, staff, inbox):
        c = staff("STORE_MANAGER")
        res = c.post(f"{self.URL}{inbox[0].id}/handle/", {"note": "Called her back"}, format="json")
        assert res.status_code == 200 and res.json()["status"] == "HANDLED" and res.json()["handled_by"] == c.user.email
        msg = ContactMessage.objects.get(pk=inbox[0].pk)
        assert msg.handled_at is not None and msg.staff_note == "Called her back"
        entry = audits("contact_message.handled").get()
        assert entry.before == {"status": "NEW"} and entry.after == {"status": "HANDLED", "note": "Called her back"}
        again = c.post(f"{self.URL}{inbox[0].id}/handle/", {}, format="json")
        assert again.status_code == 409 and again.json()["error"]["code"] == "INVALID_STATE"

    def test_messages_cannot_be_edited_or_deleted(self, admin, inbox):
        pk = inbox[0].pk
        assert (
            admin.patch(f"{self.URL}{pk}/", {"message": "changed", "status": "HANDLED"}, format="json").status_code
            == 405
        )
        assert admin.delete(f"{self.URL}{pk}/").status_code == 405
        assert admin.post(self.URL, {"name": "x"}, format="json").status_code == 405

    def test_staff_without_customer_access_cannot_handle(self, staff, inbox):
        assert staff("MARKETING_MANAGER").post(f"{self.URL}{inbox[0].id}/handle/", {}, format="json").status_code == 403
        assert ContactMessage.objects.get(pk=inbox[0].pk).status == "NEW"
