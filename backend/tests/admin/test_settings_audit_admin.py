"""Staff settings (`settings.manage`) and the read-only audit log (`audit.read`)."""

import datetime as dt

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core import audit, rbac
from apps.core.models import AuditLog, StoreSettings
from tests.admin.conftest import results
from tests.admin.helpers import BAD_UPLOADS, STAFF_ROLES, details, stored_files, upload

pytestmark = pytest.mark.django_db


@pytest.fixture
def media(settings, tmp_path):
    """Point uploads at a throw-away folder so the test can assert exactly which files exist."""
    settings.MEDIA_ROOT = str(tmp_path)
    return tmp_path


BASE = "/api/v1/admin/"
SETTINGS = BASE + "settings/"
AUDIT = BASE + "audit/"
SETTINGS_STAFF = {"SUPER_ADMIN", "ADMIN"}
AUDIT_STAFF = {"SUPER_ADMIN", "ADMIN"}


def audits(action):
    return AuditLog.objects.filter(action=action)


# =============================================================================================== settings
class TestSettingsAccess:
    def test_anonymous_and_customers_are_refused(self, user):
        assert APIClient().get(SETTINGS).status_code == 401
        c = APIClient()
        c.force_authenticate(user)
        assert c.get(SETTINGS).status_code == 403 and c.patch(SETTINGS, {"name": "x"}, format="json").status_code == 403

    def test_documented_matrix_matches_rbac(self):
        assert {r for r in rbac.STAFF_ROLES if rbac.role_has(r, "settings.manage")} == SETTINGS_STAFF
        assert {r for r in rbac.STAFF_ROLES if rbac.role_has(r, "audit.read")} == AUDIT_STAFF

    @pytest.mark.parametrize("role", STAFF_ROLES)
    def test_role_matrix(self, role, staff, settings_obj):
        c = staff(role)
        allowed = role in SETTINGS_STAFF
        assert c.get(SETTINGS).status_code == (200 if allowed else 403)
        assert c.patch(SETTINGS, {"tagline": f"By {role}"}, format="json").status_code == (200 if allowed else 403)
        assert c.post(SETTINGS + "logo/", {"image": upload("PNG")}, format="multipart").status_code == (
            200 if allowed else 403
        )
        assert c.delete(SETTINGS + "logo/").status_code == (204 if allowed else 403)


class TestSettingsEditing:
    def test_get_exposes_the_editable_settings_and_the_placeholder_flag(self, admin, settings_obj):
        data = admin.get(SETTINGS).json()
        assert data["name"] == "Orchard Row" and data["currency"] == "USD" and data["brand_primary"] == "#1F3D2B"
        assert (
            data["socials_are_placeholders"] is True
            and data["logo"] is None
            and data["weight_tolerance_percent"] == "10.00"
        )
        assert {
            "locale",
            "timezone",
            "instagram_url",
            "card_payments_enabled",
            "cash_on_delivery_enabled",
            "demo_mode",
        } <= set(data)

    def test_patch_changes_values_and_audits_before_and_after(self, admin, settings_obj):
        res = admin.patch(
            SETTINGS,
            {"name": "Fresh Co", "brand_primary": "#0a3d2b", "currency": "EUR", "locale": "de-DE", "timezone": "Europe/Berlin", "weight_tolerance_percent": "7.50",
             "instagram_url": "https://instagram.com/freshco", "socials_are_placeholders": False},
            format="json",
        )  # fmt: skip
        assert res.status_code == 200, res.content
        data = res.json()
        assert (
            data["name"] == "Fresh Co"
            and data["brand_primary"] == "#0A3D2B"
            and data["currency"] == "EUR"
            and data["weight_tolerance_percent"] == "7.50"
        )
        assert data["socials_are_placeholders"] is False
        stored = StoreSettings.objects.get(pk=1)
        assert stored.timezone == "Europe/Berlin" and stored.instagram_url == "https://instagram.com/freshco"
        entry = audits("settings.updated").get()
        assert entry.before["name"] == "Orchard Row" and entry.after["name"] == "Fresh Co"
        assert (
            entry.before["currency"] == "USD"
            and entry.after["currency"] == "EUR"
            and entry.before["socials_are_placeholders"] is True
        )
        assert entry.actor == admin.user and entry.target_type == "StoreSettings"

    def test_every_change_writes_its_own_audit_line(self, admin, settings_obj):
        admin.patch(SETTINGS, {"tagline": "One"}, format="json")
        admin.patch(SETTINGS, {"tagline": "Two"}, format="json")
        lines = list(audits("settings.updated").order_by("id"))
        assert [(e.before["tagline"], e.after["tagline"]) for e in lines] == [
            ("Fresh, honestly labelled.", "One"),
            ("One", "Two"),
        ]

    def test_the_storefront_sees_the_change_immediately(self, admin, api, settings_obj):
        assert api.get("/api/v1/store/").json()["name"] == "Orchard Row"  # warms the 5-minute settings cache
        admin.patch(SETTINGS, {"name": "Fresh Co", "tagline": "Straight from the farm"}, format="json")
        public = api.get("/api/v1/store/").json()
        assert public["name"] == "Fresh Co" and public["tagline"] == "Straight from the farm"

    def test_a_patch_only_touches_the_fields_it_names(self, admin, settings_obj):
        admin.patch(SETTINGS, {"support_phone": "555-1234"}, format="json")
        stored = StoreSettings.objects.get(pk=1)
        assert stored.support_phone == "555-1234" and stored.name == "Orchard Row" and stored.currency == "USD"

    def test_read_only_and_file_fields_are_not_mass_assignable(self, admin, settings_obj):
        res = admin.patch(
            SETTINGS, {"updated_at": "2001-01-01T00:00:00Z", "id": 5, "pk": 7, "tagline": "ok"}, format="json"
        )
        stored = StoreSettings.objects.get(pk=1)
        assert (
            res.status_code == 200
            and stored.updated_at.year != 2001
            and StoreSettings.objects.count() == 1
            and stored.pk == 1
        )
        bad = admin.patch(SETTINGS, {"logo": "../../etc/passwd"}, format="json")  # a path is not a file
        assert bad.status_code == 400 and "logo" in details(bad)
        assert StoreSettings.objects.get(pk=1).logo.name in ("", None)

    @pytest.mark.parametrize(
        ("field", "bad"),
        [
            ("brand_primary", "#12345"), ("brand_primary", "red"), ("brand_primary", "#GGGGGG"), ("brand_accent", "1F3D2B"),
            ("currency", "usd"), ("currency", "US"), ("currency", "USDX"), ("currency", "U$D"), ("currency", ""),
            ("timezone", "Mars/Phobos"), ("timezone", "../../etc/passwd"), ("timezone", ""), ("timezone", "Europe/Lon don"),
            ("locale", "english"), ("locale", "en_US"), ("locale", "e"), ("locale", ""),
            ("weight_tolerance_percent", "50.01"), ("weight_tolerance_percent", "-0.01"), ("weight_tolerance_percent", "abc"),
            ("instagram_url", "http://instagram.com/x"), ("facebook_url", "javascript:alert(1)"), ("x_url", "ftp://x.com/a"),
            ("youtube_url", "not a url"), ("tiktok_url", "//tiktok.com/x"),
            ("support_email", "nope"), ("complaint_window_hours", 0), ("complaint_window_hours", 99999), ("min_order_value", "-1"),
            ("name", ""), ("name", "x" * 81), ("tagline", "x" * 141),
        ],
    )  # fmt: skip
    def test_validation(self, admin, settings_obj, field, bad):
        res = admin.patch(SETTINGS, {field: bad}, format="json")
        assert res.status_code == 400 and res.json()["error"]["code"] == "VALIDATION_ERROR" and field in details(res), (
            field,
            bad,
            res.content,
        )
        assert not audits("settings.updated").exists()
        assert StoreSettings.objects.get(pk=1).currency == "USD"

    @pytest.mark.parametrize(
        ("field", "good"),
        [
            ("weight_tolerance_percent", "0"), ("weight_tolerance_percent", "50"), ("currency", "GBP"), ("locale", "en"), ("locale", "zh-Hans-CN"),
            ("timezone", "UTC"), ("timezone", "America/New_York"), ("facebook_url", "https://facebook.com/freshco"), ("x_url", ""), ("brand_accent", "#B8532F"),
        ],
    )  # fmt: skip
    def test_boundaries_that_are_fine(self, admin, settings_obj, field, good):
        assert admin.patch(SETTINGS, {field: good}, format="json").status_code == 200

    def test_at_least_one_payment_method_must_stay_on(self, admin, settings_obj):
        both = admin.patch(SETTINGS, {"card_payments_enabled": False, "cash_on_delivery_enabled": False}, format="json")
        assert both.status_code == 400 and "card_payments_enabled" in details(both)
        assert admin.patch(SETTINGS, {"card_payments_enabled": False}, format="json").status_code == 200
        last = admin.patch(SETTINGS, {"cash_on_delivery_enabled": False}, format="json")  # card is already off
        assert last.status_code == 400
        assert StoreSettings.objects.get(pk=1).cash_on_delivery_enabled is True

    def test_placeholder_flag_stays_until_someone_says_otherwise(self, admin, settings_obj):
        admin.patch(SETTINGS, {"instagram_url": "https://instagram.com/real"}, format="json")
        assert (
            admin.get(SETTINGS).json()["socials_are_placeholders"] is True
        )  # other networks may still be placeholders


class TestLogo:
    @pytest.mark.parametrize("fmt", ["JPEG", "PNG", "WEBP"])
    def test_upload_stores_a_normalised_original(self, fmt, admin, settings_obj, media):
        res = admin.post(SETTINGS + "logo/", {"image": upload(fmt)}, format="multipart")
        assert res.status_code == 200, res.content
        stored = StoreSettings.objects.get(pk=1)
        assert stored.logo.name.startswith("brand/") and stored.logo.name.endswith(".webp")
        assert res.json()["logo"].endswith(stored.logo.name) and stored_files(media) == {stored.logo.name}
        assert audits("settings.logo_updated").get().after["logo"] == stored.logo.name

    def test_replacing_removes_the_old_file_and_delete_removes_the_current_one(self, admin, settings_obj, media):
        admin.post(SETTINGS + "logo/", {"image": upload("PNG")}, format="multipart")
        first = StoreSettings.objects.get(pk=1).logo.name
        admin.post(SETTINGS + "logo/", {"image": upload("JPEG")}, format="multipart")
        second = StoreSettings.objects.get(pk=1).logo.name
        assert first != second and stored_files(media) == {second}
        assert admin.delete(SETTINGS + "logo/").status_code == 204
        assert StoreSettings.objects.get(pk=1).logo.name in ("", None) and stored_files(media) == set()
        assert audits("settings.logo_removed").count() == 1

    @pytest.mark.parametrize("kind", sorted(BAD_UPLOADS))
    def test_unsafe_files_are_rejected_and_the_old_logo_survives(self, kind, admin, settings_obj, media):
        admin.post(SETTINGS + "logo/", {"image": upload("PNG")}, format="multipart")
        keep = StoreSettings.objects.get(pk=1).logo.name
        res = admin.post(SETTINGS + "logo/", {"image": BAD_UPLOADS[kind]()}, format="multipart")
        assert res.status_code == 400 and "image" in details(res)  # keyed by the form field that was uploaded
        assert StoreSettings.objects.get(pk=1).logo.name == keep and stored_files(media) == {keep}

    def test_oversize_logo_is_rejected(self, admin, settings_obj, media, settings):
        settings.IMAGE_UPLOAD_MAX_BYTES = 1500
        res = admin.post(SETTINGS + "logo/", {"image": upload("PNG")}, format="multipart")
        assert res.status_code == 400 and stored_files(media) == set()

    def test_a_logo_can_travel_with_other_settings_in_one_multipart_patch(self, admin, settings_obj, media):
        res = admin.patch(SETTINGS, {"name": "Fresh Co", "logo": upload("WEBP")}, format="multipart")
        assert res.status_code == 200 and res.json()["name"] == "Fresh Co" and res.json()["logo"]
        assert len(stored_files(media)) == 1
        bad = admin.patch(SETTINGS, {"name": "Changed Again", "logo": BAD_UPLOADS["svg"]()}, format="multipart")
        assert bad.status_code == 400 and "logo" in details(bad)
        assert StoreSettings.objects.get(pk=1).name == "Fresh Co"  # nothing from the failed request was saved
        assert len(stored_files(media)) == 1

    def test_the_public_store_endpoint_serves_the_logo(self, admin, api, settings_obj, media):
        admin.post(SETTINGS + "logo/", {"image": upload("PNG")}, format="multipart")
        assert api.get("/api/v1/store/").json()["logo"].endswith(StoreSettings.objects.get(pk=1).logo.name)


# =============================================================================================== audit log
@pytest.fixture
def trail(staff):
    """A handful of entries by different people over several days."""
    alice, bob = staff("ADMIN"), staff("STORE_MANAGER")
    now = timezone.now()
    rows = [
        (alice.user, "product.created", "Product", "11", now - dt.timedelta(days=5)),
        (alice.user, "product.price_changed", "Product", "11", now - dt.timedelta(days=4)),
        (bob.user, "stock.adjusted", "StockLevel", "7", now - dt.timedelta(days=3)),
        (bob.user, "branch.updated", "Branch", "2", now - dt.timedelta(days=2)),
        ("system", "payment.late_authorization_voided", "Payment", "40", now - dt.timedelta(days=1)),
    ]
    made = []
    for actor, action, ttype, tid, when in rows:
        entry = audit.record(actor, action, None, target_type=ttype, target_id=tid, before={"x": 1}, after={"x": 2})
        AuditLog.objects.filter(pk=entry.pk).update(
            created_at=when
        )  # QuerySet.update bypasses the append-only guard on purpose (test setup)
        made.append(entry.pk)
    return SimpleNamespaceLike(alice=alice, bob=bob, ids=made)


class SimpleNamespaceLike:
    def __init__(self, **kw):
        self.__dict__.update(kw)


class TestAuditLog:
    @pytest.mark.parametrize("role", STAFF_ROLES)
    def test_role_matrix(self, role, staff, trail):
        c = staff(role)
        allowed = role in AUDIT_STAFF
        assert c.get(AUDIT).status_code == (200 if allowed else 403)
        assert c.get(AUDIT + "actions/").status_code == (200 if allowed else 403)

    def test_anonymous_and_customers_are_refused(self, user):
        assert APIClient().get(AUDIT).status_code == 401
        c = APIClient()
        c.force_authenticate(user)
        assert c.get(AUDIT).status_code == 403

    def test_lists_newest_first_with_before_and_after(self, admin, trail):
        rows = results(admin.get(AUDIT, {"target_type": "Product"}))
        assert [r["action"] for r in rows] == ["product.price_changed", "product.created"]
        assert (
            rows[0]["before"] == {"x": 1}
            and rows[0]["after"] == {"x": 2}
            and rows[0]["actor_email"] == trail.alice.user.email
        )
        everything = [r["created_at"] for r in results(admin.get(AUDIT))]
        assert everything == sorted(everything, reverse=True)

    def test_filters(self, admin, trail):
        actions = lambda **p: [r["action"] for r in results(admin.get(AUDIT, p))]  # noqa: E731
        assert set(actions(actor=trail.bob.user.email)) >= {"stock.adjusted", "branch.updated"}
        assert set(actions(actor=trail.bob.user.email)).isdisjoint({"product.created"})
        assert actions(actor="system") == ["payment.late_authorization_voided"]
        assert actions(actor_email=trail.bob.user.email) == actions(actor=trail.bob.user.email)  # alias
        assert actions(action="product.") == ["product.price_changed", "product.created"]
        assert actions(action="product.price") == ["product.price_changed"]
        assert actions(action="roduct.") == []  # a prefix, not a substring
        assert actions(target_type="stocklevel") == ["stock.adjusted"]
        assert actions(target_type="Product", target_id="11") == ["product.price_changed", "product.created"]
        assert actions(target_id="40") == ["payment.late_authorization_voided"]
        assert actions(target_id="999") == []

    def test_date_range_is_inclusive(self, admin, trail):
        today = timezone.localdate()

        def window(lo, hi):
            params = {
                "date_from": (today - dt.timedelta(days=lo)).isoformat(),
                "date_to": (today - dt.timedelta(days=hi)).isoformat(),
            }
            return [r["action"] for r in results(admin.get(AUDIT, params))]

        assert window(3, 2) == ["branch.updated", "stock.adjusted"]
        assert window(5, 5) == ["product.created"]
        only_from = results(admin.get(AUDIT, {"date_from": (today - dt.timedelta(days=1)).isoformat()}))
        assert "payment.late_authorization_voided" in [r["action"] for r in only_from] and "stock.adjusted" not in [
            r["action"] for r in only_from
        ]
        assert admin.get(AUDIT, {"date_from": "yesterday"}).status_code == 400
        assert admin.get(AUDIT, {"date_to": "2026-13-45"}).status_code == 400

    def test_pagination(self, admin, trail):
        page = admin.get(AUDIT, {"page_size": 2}).json()
        assert page["count"] >= 5 and len(page["results"]) == 2 and page["total_pages"] >= 3 and page["next"]
        second = admin.get(AUDIT, {"page_size": 2, "page": 2}).json()
        assert {r["id"] for r in page["results"]}.isdisjoint({r["id"] for r in second["results"]})

    def test_the_log_is_strictly_read_only(self, admin, trail):
        pk = trail.ids[0]
        before = AuditLog.objects.count()
        for call in (
            lambda: admin.post(AUDIT, {"action": "forged"}, format="json"),
            lambda: admin.put(f"{AUDIT}{pk}/", {"action": "forged"}, format="json"),
            lambda: admin.patch(f"{AUDIT}{pk}/", {"action": "forged"}, format="json"),
            lambda: admin.delete(f"{AUDIT}{pk}/"),
        ):
            assert call().status_code == 405
        assert AuditLog.objects.count() == before and AuditLog.objects.get(pk=pk).action == "product.created"

    def test_distinct_action_list(self, admin, trail):
        admin.patch(SETTINGS, {"tagline": "x"}, format="json")
        admin.patch(SETTINGS, {"tagline": "y"}, format="json")
        actions = admin.get(AUDIT + "actions/").json()
        assert isinstance(actions, list) and actions == sorted(set(actions))
        assert {"product.created", "stock.adjusted", "settings.updated"} <= set(actions) and actions.count(
            "settings.updated"
        ) == 1

    def test_detail_endpoint(self, admin, trail):
        row = admin.get(f"{AUDIT}{trail.ids[2]}/").json()
        assert row["action"] == "stock.adjusted" and row["target_id"] == "7"
        assert admin.get(f"{AUDIT}999999/").status_code == 404

    def test_credentials_never_reach_the_trail(self, admin, staff):
        member = staff("STORE_MANAGER")
        admin.patch(f"{BASE}staff/{member.user.id}/", {"full_name": "Renamed Person"}, format="json")
        raw = admin.get(AUDIT).content.decode().lower()
        assert "md5$" not in raw and member.user.password.lower() not in raw
