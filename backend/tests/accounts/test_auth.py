import re

import pytest
from django.contrib.auth import get_user_model
from django.core import mail
from django.db import IntegrityError, transaction
from rest_framework.test import APIClient

from tests.conftest import make_user

User = get_user_model()
PASSWORD = "Orchard-Row-9!x"
pytestmark = pytest.mark.django_db


def test_all_configured_auth_backends_import():
    """Regression for the legacy app, where a missing backend module made every login/admin login 500."""
    from django.conf import settings
    from django.utils.module_loading import import_string

    for dotted in getattr(settings, "AUTHENTICATION_BACKENDS", []):
        import_string(dotted)


def test_register_creates_user_hashes_password_and_signs_in(api):
    res = api.post(
        "/api/v1/auth/register/", {"email": "New@Example.com", "password": PASSWORD, "full_name": "New Shopper"}
    )
    assert res.status_code == 201, res.content
    user = User.objects.get(email="new@example.com")
    assert user.password != PASSWORD and user.check_password(PASSWORD)
    assert user.role == "CUSTOMER" and not user.is_staff
    assert api.get("/api/v1/account/me/").json()["email"] == "new@example.com"


def test_duplicate_registration_is_case_insensitive_and_clear(api, user):
    res = api.post("/api/v1/auth/register/", {"email": user.email.upper(), "password": PASSWORD, "full_name": "Dup"})
    assert res.status_code == 400
    body = res.json()["error"]
    assert body["code"] == "VALIDATION_ERROR" and "already exists" in body["details"]["email"][0]
    assert User.objects.count() == 1


def test_two_users_with_the_same_first_name_can_register(api):
    """Legacy bug: username=first_name caused an IntegrityError / HTTP 500."""
    for i in range(2):
        res = api.post(
            "/api/v1/auth/register/", {"email": f"sam{i}@example.com", "password": PASSWORD, "full_name": "Sam Smith"}
        )
        assert res.status_code == 201
        api.post("/api/v1/auth/logout/")


@pytest.mark.parametrize("password", ["short1!", "password1234", "12345678901234", "orchard-row@example.com"])
def test_weak_passwords_rejected(api, password):
    res = api.post(
        "/api/v1/auth/register/", {"email": "orchard-row@example.com", "password": password, "full_name": "Weak Pw"}
    )
    assert res.status_code == 400
    assert "password" in res.json()["error"]["details"] or "non_field_errors" in res.json()["error"]["details"]


def test_login_logout_roundtrip_and_session_cookie_flags(api, user):
    res = api.post("/api/v1/auth/login/", {"email": "SHOPPER@example.com", "password": PASSWORD})
    assert res.status_code == 200 and res.json()["email"] == user.email
    cookie = res.cookies["sessionid"]
    assert cookie["httponly"] and cookie["samesite"] == "Lax"
    assert api.get("/api/v1/account/me/").status_code == 200
    assert api.post("/api/v1/auth/logout/").status_code == 204
    assert api.get("/api/v1/account/me/").status_code == 401


def test_invalid_credentials_have_generic_message(api, user):
    wrong_pw = api.post("/api/v1/auth/login/", {"email": user.email, "password": "nope-nope-nope"})
    no_user = api.post("/api/v1/auth/login/", {"email": "ghost@example.com", "password": "nope-nope-nope"})
    assert wrong_pw.status_code == no_user.status_code == 401
    assert wrong_pw.json()["error"]["message"] == no_user.json()["error"]["message"]
    assert wrong_pw.json()["error"]["code"] == "INVALID_CREDENTIALS"


def test_login_locks_out_after_repeated_failures(api, user):
    for _ in range(5):
        assert api.post("/api/v1/auth/login/", {"email": user.email, "password": "wrong-wrong-1"}).status_code == 401
    locked = api.post("/api/v1/auth/login/", {"email": user.email, "password": PASSWORD})
    assert locked.status_code == 429 and locked.json()["error"]["code"] == "RATE_LIMITED"


def test_inactive_user_cannot_log_in(api):
    make_user(email="gone@example.com", is_active=False)
    assert api.post("/api/v1/auth/login/", {"email": "gone@example.com", "password": PASSWORD}).status_code == 401


def test_login_requires_csrf_token_like_a_real_browser(csrf_api, user):
    assert csrf_api.post("/api/v1/auth/login/", {"email": user.email, "password": PASSWORD}).status_code == 403
    token = csrf_api.get("/api/v1/auth/csrf/").json()["csrfToken"]
    ok = csrf_api.post("/api/v1/auth/login/", {"email": user.email, "password": PASSWORD}, HTTP_X_CSRFTOKEN=token)
    assert ok.status_code == 200


def test_authenticated_unsafe_requests_need_csrf(csrf_api, user):
    token = csrf_api.get("/api/v1/auth/csrf/").json()["csrfToken"]
    csrf_api.post("/api/v1/auth/login/", {"email": user.email, "password": PASSWORD}, HTTP_X_CSRFTOKEN=token)
    assert csrf_api.patch("/api/v1/account/me/", {"full_name": "Changed"}).status_code == 403
    token = csrf_api.cookies["csrftoken"].value
    assert csrf_api.patch("/api/v1/account/me/", {"full_name": "Changed"}, HTTP_X_CSRFTOKEN=token).status_code == 200


def test_profile_update_cannot_escalate_role(auth_api, user):
    res = auth_api.patch(
        "/api/v1/account/me/", {"full_name": "Renamed", "role": "SUPER_ADMIN", "is_staff": True, "email": "x@y.com"}
    )
    assert res.status_code == 200
    user.refresh_from_db()
    assert (
        user.full_name == "Renamed"
        and user.role == "CUSTOMER"
        and not user.is_staff
        and user.email == "shopper@example.com"
    )


def test_password_change_requires_current_password(auth_api, user):
    bad = auth_api.post(
        "/api/v1/account/password/", {"current_password": "wrong", "new_password": "Brand-New-Pass-77!"}
    )
    assert bad.status_code == 400
    ok = auth_api.post(
        "/api/v1/account/password/", {"current_password": PASSWORD, "new_password": "Brand-New-Pass-77!"}
    )
    assert ok.status_code == 204
    user.refresh_from_db()
    assert user.check_password("Brand-New-Pass-77!")


def test_password_reset_flow_single_use_and_no_enumeration(api, user):
    unknown = api.post("/api/v1/auth/password-reset/", {"email": "nobody@example.com"})
    known = api.post("/api/v1/auth/password-reset/", {"email": user.email})
    assert unknown.status_code == known.status_code == 202 and unknown.json() == known.json()
    assert len(mail.outbox) == 1
    match = re.search(r"uid=([^&\s]+)&token=([^\s]+)", mail.outbox[0].body)
    uid, token = match.groups()
    new = "Reset-Password-4321!"
    assert (
        api.post("/api/v1/auth/password-reset/confirm/", {"uid": uid, "token": token, "new_password": new}).status_code
        == 204
    )
    user.refresh_from_db()
    assert user.check_password(new)
    again = api.post(
        "/api/v1/auth/password-reset/confirm/", {"uid": uid, "token": token, "new_password": "Another-Pass-99!x"}
    )
    assert again.status_code == 400 and again.json()["error"]["code"] == "INVALID_RESET_LINK"


def test_password_reset_rejects_forged_token_and_uid(api, user):
    res = api.post(
        "/api/v1/auth/password-reset/confirm/",
        {"uid": "bogus", "token": "bogus-token", "new_password": "Reset-Password-4321!"},
    )
    assert res.status_code == 400 and res.json()["error"]["code"] == "INVALID_RESET_LINK"
    user.refresh_from_db()
    assert user.check_password(PASSWORD)


def test_addresses_are_private_to_their_owner(auth_api, user, other_user):
    created = auth_api.post(
        "/api/v1/addresses/",
        {
            "recipient_name": "Test Shopper",
            "phone": "+1 555 0100",
            "line1": "5 Elm St",
            "city": "Riverton",
            "postal_code": "RW1 2AB",
        },
    )
    assert created.status_code == 201 and created.json()["is_default"] is True
    foreign = APIClient()
    foreign.force_authenticate(other_user)
    addr_id = created.json()["id"]
    assert foreign.get(f"/api/v1/addresses/{addr_id}/").status_code == 404
    assert foreign.delete(f"/api/v1/addresses/{addr_id}/").status_code == 404
    assert foreign.get("/api/v1/addresses/").json() == []
    assert foreign.patch(f"/api/v1/addresses/{addr_id}/", {"line1": "hijack"}).status_code == 404


def test_only_one_default_address_per_user(auth_api, user):
    payload = {"recipient_name": "A", "phone": "+1 555 0100", "line1": "1 A St", "city": "Riverton"}
    first = auth_api.post("/api/v1/addresses/", payload).json()
    second = auth_api.post("/api/v1/addresses/", {**payload, "line1": "2 B St", "is_default": True}).json()
    assert (
        user.addresses.filter(is_default=True).count() == 1 and user.addresses.get(is_default=True).pk == second["id"]
    )
    auth_api.post(f"/api/v1/addresses/{first['id']}/make-default/")
    assert user.addresses.get(is_default=True).pk == first["id"]


def test_db_rejects_two_default_addresses():
    user = make_user(email="db@example.com")
    from apps.accounts.models import Address

    Address.objects.create(user=user, recipient_name="a", phone="1", line1="x", city="c", is_default=True)
    with pytest.raises(IntegrityError), transaction.atomic():
        Address.objects.create(user=user, recipient_name="b", phone="1", line1="y", city="c", is_default=True)


def test_email_uniqueness_enforced_case_insensitively_in_db():
    make_user(email="Case@Example.com")
    with pytest.raises(IntegrityError), transaction.atomic():
        User.objects.bulk_create([User(email="case@example.com", full_name="dup")])


def test_staff_flags_follow_role():
    admin = make_user(email="a@example.com", role="ADMIN")
    manager = make_user(email="m@example.com", role="STORE_MANAGER")
    assert admin.is_staff and not manager.is_staff  # only technical roles reach Django admin
    assert "orders.fulfil" in manager.capabilities()


def test_session_endpoint_is_200_for_visitors_and_members_and_sets_the_csrf_cookie(api, user):
    visitor = api.get("/api/v1/auth/session/")
    assert visitor.status_code == 200
    assert visitor.json() == {"user": None}
    assert "csrftoken" in visitor.cookies
    api.post("/api/v1/auth/login/", {"email": user.email, "password": "Orchard-Row-9!x"}, format="json")
    member = api.get("/api/v1/auth/session/").json()["user"]
    assert member["email"] == user.email
    assert "password" not in member


def test_csrf_trusts_the_storefront_origin_that_proxies_the_api_and_nothing_else(csrf_api, user, settings):
    """Browsers post from the storefront origin to a proxied API whose Host differs. That origin must be accepted
    (regression: every write was a 403 behind the proxy) while a foreign origin carrying a valid token is refused."""
    assert settings.FRONTEND_URL in settings.CSRF_TRUSTED_ORIGINS
    token = csrf_api.get("/api/v1/auth/csrf/", secure=True).json()["csrfToken"]
    body = {"email": user.email, "password": PASSWORD}
    foreign = csrf_api.post(
        "/api/v1/auth/login/", body, HTTP_X_CSRFTOKEN=token, HTTP_ORIGIN="https://evil.example", secure=True
    )
    assert foreign.status_code == 403
    ok = csrf_api.post(
        "/api/v1/auth/login/", body, HTTP_X_CSRFTOKEN=token, HTTP_ORIGIN=settings.FRONTEND_URL, secure=True
    )
    assert ok.status_code == 200
