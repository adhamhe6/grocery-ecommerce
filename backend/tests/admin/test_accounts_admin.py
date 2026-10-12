"""Staff accounts API: customers (support view), staff management guard rails, and /me/permissions."""

import re
from decimal import Decimal
from types import SimpleNamespace

import pytest
from django.contrib.auth.tokens import default_token_generator
from django.core import mail
from django.utils.encoding import force_str
from django.utils.http import urlsafe_base64_decode
from rest_framework.test import APIClient

from apps.accounts.admin_api import StaffViewSet
from apps.accounts.models import Address, User
from apps.core import rbac
from apps.core.exceptions import DomainError
from apps.core.models import AuditLog
from apps.orders.models import SupportCase
from tests.admin.conftest import results
from tests.admin.helpers import STAFF_ROLES, details
from tests.conftest import make_user

pytestmark = pytest.mark.django_db
D = Decimal
BASE = "/api/v1/admin/"
CUSTOMERS = BASE + "customers/"
STAFF = BASE + "staff/"
CUSTOMER_READERS = {"SUPER_ADMIN", "ADMIN", "STORE_MANAGER", "CUSTOMER_SUPPORT"}
CUSTOMER_MANAGERS = {"SUPER_ADMIN", "ADMIN", "CUSTOMER_SUPPORT"}
STAFF_MANAGERS = {"SUPER_ADMIN", "ADMIN"}


def audits(action):
    return AuditLog.objects.filter(action=action)


# =============================================================================================== customers
@pytest.fixture
def shoppers(product_factory, order_factory, branch, second_branch):
    thing = product_factory(sku="C1", name="Thing")
    alice = make_user(email="alice@example.com", full_name="Alice Adams", phone="+1 555 0101")
    bob = make_user(email="bob@example.com", full_name="Bob Brown", phone="+1 555 0202")
    cara = make_user(email="cara@example.com", full_name="Cara Cole", is_active=False)  # never ordered
    Address.objects.create(
        user=alice,
        recipient_name="Alice",
        phone="555-0101",
        line1="1 Elm St",
        city="Riverton",
        postal_code="RW1 1AA",
        is_default=True,
    )
    o1, _ = order_factory([(thing, 1)], customer=alice, status="COMPLETED", total=D("22.00"), final_total=D("20.00"))
    o2, _ = order_factory([(thing, 1)], customer=alice, status="COMPLETED", total=D("12.00"), final_total=D("10.50"))
    o3, _ = order_factory([(thing, 1)], customer=alice, status="CONFIRMED", total=D("99.00"))
    o4, _ = order_factory([(thing, 1)], customer=alice, status="CANCELLED", total=D("15.00"), final_total=D("15.00"))
    o5, _ = order_factory(
        [(thing, 1)], customer=bob, branch_obj=second_branch, status="COMPLETED", total=D("5.00"), final_total=D("5.00")
    )
    SupportCase.objects.create(order=o1, customer=alice, kind="MISSING", description="No milk in the bag")
    return SimpleNamespace(alice=alice, bob=bob, cara=cara, orders=[o1, o2, o3, o4, o5])


class TestCustomerAccess:
    def test_anonymous_and_customers_are_refused(self, shoppers, user):
        assert APIClient().get(CUSTOMERS).status_code == 401
        c = APIClient()
        c.force_authenticate(user)
        assert c.get(CUSTOMERS).status_code == 403 and c.get(f"{CUSTOMERS}{shoppers.alice.id}/").status_code == 403

    def test_documented_matrix_matches_rbac(self):
        assert {r for r in rbac.STAFF_ROLES if rbac.role_has(r, "customers.read")} == CUSTOMER_READERS
        assert {r for r in rbac.STAFF_ROLES if rbac.role_has(r, "customers.manage")} == CUSTOMER_MANAGERS

    @pytest.mark.parametrize("role", STAFF_ROLES)
    def test_reading_needs_customers_read_and_switching_accounts_off_needs_customers_manage(
        self, role, staff, shoppers
    ):
        c = staff(role, all_branches=True)
        assert c.get(CUSTOMERS).status_code == (200 if role in CUSTOMER_READERS else 403)
        assert c.get(f"{CUSTOMERS}{shoppers.alice.id}/").status_code == (200 if role in CUSTOMER_READERS else 403)
        res = c.patch(f"{CUSTOMERS}{shoppers.alice.id}/", {"is_active": True}, format="json")
        assert res.status_code == (200 if role in CUSTOMER_MANAGERS else 403), (role, res.content)


class TestCustomerListAndDetail:
    def test_list_with_order_figures(self, admin, shoppers):
        rows = {r["email"]: r for r in results(admin.get(CUSTOMERS))}
        assert set(rows) == {"alice@example.com", "bob@example.com", "cara@example.com"}
        assert rows["alice@example.com"]["orders_count"] == 4 and rows["cara@example.com"]["orders_count"] == 0
        assert rows["alice@example.com"]["lifetime_spend"] == "30.50"  # only COMPLETED orders' final totals
        assert (
            rows["cara@example.com"]["lifetime_spend"] == "0.00" and rows["cara@example.com"]["last_order_at"] is None
        )

    def test_lifetime_spend_counts_only_completed_orders_at_their_final_total(self, admin, shoppers):
        detail = admin.get(f"{CUSTOMERS}{shoppers.alice.id}/").json()
        assert (
            detail["lifetime_spend"] == "30.50"
        )  # 20.00 + 10.50; not the 22.00 / 12.00 estimates, not CONFIRMED 99.00 or CANCELLED 15.00

    def test_detail_has_profile_addresses_orders_and_cases(self, admin, shoppers):
        d = admin.get(f"{CUSTOMERS}{shoppers.alice.id}/").json()
        assert d["full_name"] == "Alice Adams" and d["phone"] == "+1 555 0101" and d["is_active"] is True
        assert d["addresses"][0]["line1"] == "1 Elm St"
        assert len(d["orders"]) == 4
        newest = d["orders"][0]
        assert set(newest) >= {"number", "status", "total", "placed_at"} and newest["total"] in {
            "22.00",
            "12.00",
            "99.00",
            "15.00",
        }
        completed = next(o for o in d["orders"] if o["total"] == "22.00")
        assert completed["final_total"] == "20.00" and completed["status"] == "COMPLETED"
        assert [c["kind"] for c in d["cases"]] == ["MISSING"] and d["cases"][0]["order_number"] == shoppers.orders[
            0
        ].number

    def test_search_and_filters(self, admin, shoppers):
        emails = lambda **p: sorted(r["email"] for r in results(admin.get(CUSTOMERS, p)))  # noqa: E731
        assert emails(search="alice") == ["alice@example.com"]
        assert emails(search="Brown") == ["bob@example.com"]
        assert emails(search="0202") == ["bob@example.com"]
        assert emails(is_active="false") == ["cara@example.com"]
        assert emails(has_orders="true") == ["alice@example.com", "bob@example.com"]
        assert emails(has_orders="false") == ["cara@example.com"]
        assert [r["email"] for r in results(admin.get(CUSTOMERS, {"ordering": "-orders_count"}))][
            0
        ] == "alice@example.com"
        assert [r["email"] for r in results(admin.get(CUSTOMERS, {"ordering": "full_name"}))] == [
            "alice@example.com",
            "bob@example.com",
            "cara@example.com",
        ]

    def test_staff_accounts_are_not_customers(self, admin, staff):
        other = staff("STORE_MANAGER")
        assert admin.get(f"{CUSTOMERS}{other.user.id}/").status_code == 404
        assert other.user.email not in str(results(admin.get(CUSTOMERS)))

    def test_pagination_shape(self, admin, shoppers):
        page = admin.get(CUSTOMERS, {"page_size": 2}).json()
        assert page["count"] == 3 and len(page["results"]) == 2 and page["total_pages"] == 2


class TestCustomerPrivacy:
    def test_secrets_never_appear_in_list_or_detail(self, admin, shoppers):
        raw = admin.get(CUSTOMERS).content.decode() + admin.get(f"{CUSTOMERS}{shoppers.alice.id}/").content.decode()
        for forbidden in (
            "password",
            "md5$",
            "pbkdf2",
            "argon2",
            "tracking",
            "token",
            "last_login",
            "is_superuser",
            "session",
        ):
            assert forbidden not in raw.lower(), forbidden
        for order in shoppers.orders:
            assert order.tracking_token not in raw
        stored_hash = User.objects.get(pk=shoppers.alice.pk).password
        assert stored_hash not in raw

    def test_payment_data_is_not_part_of_the_customer_view(self, admin, shoppers):
        d = admin.get(f"{CUSTOMERS}{shoppers.alice.id}/").json()
        for order in d["orders"]:
            assert not ({"payment_status", "payments", "refunds", "authorized_amount", "card"} & set(order))


class TestCustomerBranchScoping:
    def test_branch_staff_only_meet_customers_who_ordered_at_their_branches(
        self, staff, shoppers, branch, second_branch
    ):
        here = staff("CUSTOMER_SUPPORT", branches=[branch])
        there = staff("CUSTOMER_SUPPORT", branches=[second_branch])
        assert [r["email"] for r in results(here.get(CUSTOMERS))] == ["alice@example.com"]
        assert [r["email"] for r in results(there.get(CUSTOMERS))] == [
            "bob@example.com"
        ]  # never-ordered customers are invisible
        assert here.get(f"{CUSTOMERS}{shoppers.bob.id}/").status_code == 404
        assert there.get(f"{CUSTOMERS}{shoppers.alice.id}/").status_code == 404
        assert here.get(f"{CUSTOMERS}{shoppers.cara.id}/").status_code == 404
        assert staff("CUSTOMER_SUPPORT").get(CUSTOMERS).json()["results"] == []  # unassigned staff see nobody

    def test_scoped_staff_cannot_switch_off_customers_outside_their_branches(self, staff, shoppers, branch):
        here = staff("CUSTOMER_SUPPORT", branches=[branch])
        res = here.patch(f"{CUSTOMERS}{shoppers.bob.id}/", {"is_active": False}, format="json")
        assert res.status_code == 404
        shoppers.bob.refresh_from_db()
        assert shoppers.bob.is_active is True

    def test_figures_and_history_are_limited_to_the_viewers_branches(
        self, staff, shoppers, product_factory, order_factory, branch, second_branch
    ):
        thing = product_factory(sku="C9", name="Other thing")
        o, _ = order_factory(
            [(thing, 1)],
            customer=shoppers.alice,
            branch_obj=second_branch,
            status="COMPLETED",
            total=D("8.00"),
            final_total=D("7.00"),
        )
        SupportCase.objects.create(order=o, customer=shoppers.alice, kind="LATE", description="Late")
        north = staff("CUSTOMER_SUPPORT", branches=[second_branch])
        row = results(north.get(CUSTOMERS))
        alice = next(r for r in row if r["email"] == "alice@example.com")
        assert alice["orders_count"] == 1 and alice["lifetime_spend"] == "7.00"
        detail = north.get(f"{CUSTOMERS}{shoppers.alice.id}/").json()
        assert [o["total"] for o in detail["orders"]] == ["8.00"] and [c["kind"] for c in detail["cases"]] == ["LATE"]
        central = staff("CUSTOMER_SUPPORT", branches=[branch]).get(f"{CUSTOMERS}{shoppers.alice.id}/").json()
        assert len(central["orders"]) == 4 and central["lifetime_spend"] == "30.50"

    def test_all_branches_flag_and_global_roles_see_everyone(self, staff, shoppers):
        assert len(results(staff("STORE_MANAGER", all_branches=True).get(CUSTOMERS))) == 3
        assert len(results(staff("ADMIN").get(CUSTOMERS))) == 3


class TestCustomerUpdate:
    def test_only_is_active_changes_and_it_is_audited_without_contact_details(self, staff, shoppers):
        c = staff("CUSTOMER_SUPPORT", all_branches=True)
        res = c.patch(
            f"{CUSTOMERS}{shoppers.alice.id}/",
            {
                "is_active": False,
                "role": "ADMIN",
                "email": "evil@example.com",
                "full_name": "Hacked",
                "phone": "0",
                "is_staff": True,
                "is_superuser": True,
                "password": "x",
            },
            format="json",
        )
        assert res.status_code == 200 and res.json()["is_active"] is False
        alice = User.objects.get(pk=shoppers.alice.pk)
        assert (alice.role, alice.email, alice.full_name, alice.phone) == (
            "CUSTOMER",
            "alice@example.com",
            "Alice Adams",
            "+1 555 0101",
        )
        assert alice.is_staff is False and alice.is_superuser is False and alice.check_password("Orchard-Row-9!x")
        entry = audits("customer.updated").get()
        assert entry.before == {"id": alice.pk, "is_active": True} and entry.after == {
            "id": alice.pk,
            "is_active": False,
        }
        assert entry.actor == c.user and "alice@example.com" not in str(entry.before) + str(entry.after)

    def test_put_and_delete_do_not_exist(self, admin, shoppers):
        assert admin.put(f"{CUSTOMERS}{shoppers.alice.id}/", {"is_active": False}, format="json").status_code == 405
        assert admin.delete(f"{CUSTOMERS}{shoppers.alice.id}/").status_code == 405
        assert admin.post(CUSTOMERS, {"email": "x@example.com"}, format="json").status_code == 405

    def test_a_deactivated_customer_can_no_longer_sign_in(self, admin, shoppers, api):
        def login():
            return api.post(
                "/api/v1/auth/login/", {"email": "alice@example.com", "password": "Orchard-Row-9!x"}, format="json"
            )

        assert login().status_code == 200
        admin.patch(f"{CUSTOMERS}{shoppers.alice.id}/", {"is_active": False}, format="json")
        assert login().status_code == 401


# =============================================================================================== staff
def new_staff(branch, **kw):
    return {
        "email": "New.Person@Example.com",
        "full_name": "New Person",
        "phone": "555-0000",
        "role": "STORE_MANAGER",
        "branches": [branch.id],
        **kw,
    }


class TestStaffAccess:
    def test_anonymous_and_customers_are_refused(self, user):
        assert APIClient().get(STAFF).status_code == 401
        c = APIClient()
        c.force_authenticate(user)
        assert c.get(STAFF).status_code == 403

    def test_documented_matrix_matches_rbac(self):
        assert {r for r in rbac.STAFF_ROLES if rbac.role_has(r, "staff.manage")} == STAFF_MANAGERS

    @pytest.mark.parametrize("role", STAFF_ROLES)
    def test_only_staff_managers_can_list_or_create(self, role, staff, branch):
        c = staff(role)
        assert c.get(STAFF).status_code == (200 if role in STAFF_MANAGERS else 403)
        res = c.post(STAFF, new_staff(branch, email=f"hire-{role.lower()}@example.com"), format="json")
        assert res.status_code == (201 if role in STAFF_MANAGERS else 403), (role, res.content)


class TestStaffCreation:
    def test_new_accounts_get_an_unusable_password_and_a_working_reset_link(self, admin, branch, api):
        res = admin.post(STAFF, new_staff(branch), format="json")
        assert res.status_code == 201, res.content
        data = res.json()
        assert (
            data["email"] == "new.person@example.com"
            and data["role"] == "STORE_MANAGER"
            and data["role_label"] == "Store manager"
        )
        assert data["branches"] == [branch.id] and data["has_password"] is False and data["invite_email_queued"] is True
        user = User.objects.get(email="new.person@example.com")
        assert user.has_usable_password() is False and user.is_staff is False and user.is_active
        assert list(user.branches.all()) == [branch]
        assert not user.check_password("") and not user.check_password(None)

        assert len(mail.outbox) == 1 and mail.outbox[0].to == ["new.person@example.com"]
        link = re.search(r"/account/reset-password\?uid=([^&\s]+)&token=([^\s]+)", mail.outbox[0].body)
        assert link, mail.outbox[0].body
        uid, token = link.groups()
        assert User.objects.get(
            pk=force_str(urlsafe_base64_decode(uid))
        ) == user and default_token_generator.check_token(user, token)
        done = api.post(
            "/api/v1/auth/password-reset/confirm/",
            {"uid": uid, "token": token, "new_password": "A-brand-new-Pass-77"},
            format="json",
        )
        assert done.status_code == 204
        assert (
            api.post(
                "/api/v1/auth/login/",
                {"email": "new.person@example.com", "password": "A-brand-new-Pass-77"},
                format="json",
            ).status_code
            == 200
        )

    def test_creation_is_audited_without_credentials(self, admin, branch):
        admin.post(STAFF, new_staff(branch), format="json")
        entry = audits("staff.created").get()
        assert (
            entry.after["role"] == "STORE_MANAGER"
            and entry.after["branches"] == [branch.id]
            and entry.actor == admin.user
        )
        assert "password" not in str(entry.after).lower()

    def test_email_is_unique_ignoring_case_and_cannot_clash_with_customers(self, admin, branch, user):
        assert admin.post(STAFF, new_staff(branch), format="json").status_code == 201
        dup = admin.post(STAFF, new_staff(branch, email="NEW.person@example.COM"), format="json")
        assert dup.status_code == 400 and "email" in details(dup)
        clash = admin.post(
            STAFF, new_staff(branch, email=user.email.upper()), format="json"
        )  # an existing customer's address
        assert clash.status_code == 400 and "email" in details(clash)
        assert User.objects.filter(email__iexact="new.person@example.com").count() == 1

    @pytest.mark.parametrize(
        ("overrides", "field"),
        [
            ({"role": "CUSTOMER"}, "role"),
            ({"role": "WIZARD"}, "role"),
            ({"email": "nope"}, "email"),
            ({"full_name": " "}, "full_name"),
            ({"branches": [987654]}, "branches"),
            ({"role": ""}, "role"),
        ],
    )
    def test_validation(self, admin, branch, overrides, field):
        res = admin.post(STAFF, new_staff(branch, **overrides), format="json")
        assert res.status_code == 400 and field in details(res)
        assert not User.objects.filter(full_name="New Person").exists()

    def test_creating_staff_survives_a_mail_queue_outage_and_says_so(self, admin, branch, monkeypatch):
        from apps.accounts import admin_api

        def broken(*a, **kw):
            raise ConnectionError("broker down")

        monkeypatch.setattr(admin_api.send_password_reset_email, "delay", broken)
        res = admin.post(STAFF, new_staff(branch), format="json")
        assert res.status_code == 201 and res.json()["invite_email_queued"] is False
        assert User.objects.filter(email="new.person@example.com").exists()

    def test_resend_invite_only_for_people_who_have_not_set_a_password(self, admin, branch, staff):
        created = admin.post(STAFF, new_staff(branch), format="json").json()
        mail.outbox.clear()
        assert admin.post(f"{STAFF}{created['id']}/resend-invite/", format="json").json() == {
            "invite_email_queued": True
        }
        assert len(mail.outbox) == 1 and audits("staff.invite_sent").count() == 1
        active = staff("STORE_MANAGER")
        res = admin.post(f"{STAFF}{active.user.id}/resend-invite/", format="json")
        assert res.status_code == 409 and "already set a password" in res.json()["error"]["message"]


class TestStaffGuardRails:
    def test_only_a_super_admin_creates_admin_accounts(self, staff, branch):
        admin_client, super_client = staff("ADMIN"), staff("SUPER_ADMIN")
        for role in ("ADMIN", "SUPER_ADMIN"):
            res = admin_client.post(
                STAFF, new_staff(branch, role=role, email=f"{role.lower()}@example.com"), format="json"
            )
            assert res.status_code == 403 and res.json()["error"]["code"] == "FORBIDDEN", role
            assert not User.objects.filter(email=f"{role.lower()}@example.com").exists()
        assert (
            admin_client.post(
                STAFF, new_staff(branch, role="CUSTOMER_SUPPORT", email="cs@example.com"), format="json"
            ).status_code
            == 201
        )
        assert (
            super_client.post(STAFF, new_staff(branch, role="ADMIN", email="a2@example.com"), format="json").status_code
            == 201
        )
        assert (
            super_client.post(
                STAFF, new_staff(branch, role="SUPER_ADMIN", email="s2@example.com"), format="json"
            ).status_code
            == 201
        )

    def test_an_admin_cannot_modify_admins_or_super_admins_or_promote_anyone_to_them(self, staff, branch):
        admin_client = staff("ADMIN")
        peer, boss, clerk = staff("ADMIN"), staff("SUPER_ADMIN"), staff("STORE_MANAGER")
        for target in (peer, boss):
            assert (
                admin_client.patch(f"{STAFF}{target.user.id}/", {"full_name": "Renamed"}, format="json").status_code
                == 403
            )
            assert admin_client.delete(f"{STAFF}{target.user.id}/").status_code == 403
            assert admin_client.post(f"{STAFF}{target.user.id}/resend-invite/", format="json").status_code == 403
        assert admin_client.patch(f"{STAFF}{clerk.user.id}/", {"role": "ADMIN"}, format="json").status_code == 403
        assert admin_client.patch(f"{STAFF}{clerk.user.id}/", {"role": "SUPER_ADMIN"}, format="json").status_code == 403
        assert (
            admin_client.patch(f"{STAFF}{clerk.user.id}/", {"role": "INVENTORY_MANAGER"}, format="json").status_code
            == 200
        )
        for user in (peer.user, boss.user):
            user.refresh_from_db()
            assert user.full_name != "Renamed" and user.is_active

    def test_a_super_admin_can_manage_admins(self, staff):
        boss, peer = staff("SUPER_ADMIN"), staff("ADMIN")
        assert boss.patch(f"{STAFF}{peer.user.id}/", {"role": "STORE_MANAGER"}, format="json").status_code == 200
        assert boss.patch(f"{STAFF}{peer.user.id}/", {"role": "ADMIN"}, format="json").status_code == 200

    def test_nobody_changes_their_own_role_or_deactivates_themselves(self, staff):
        boss = staff("SUPER_ADMIN")
        staff("SUPER_ADMIN")  # a second super admin exists, so this is the *self* rule, not the last-super-admin rule
        me = f"{STAFF}{boss.user.id}/"
        for call in (
            lambda: boss.patch(me, {"role": "ADMIN"}, format="json"),
            lambda: boss.patch(me, {"is_active": False}, format="json"),
            lambda: boss.delete(me),
        ):
            res = call()
            assert res.status_code == 403 and res.json()["error"]["code"] == "FORBIDDEN"
        boss.user.refresh_from_db()
        assert boss.user.role == "SUPER_ADMIN" and boss.user.is_active
        assert (
            boss.patch(me, {"role": "SUPER_ADMIN", "full_name": "Boss Renamed"}, format="json").status_code == 200
        )  # no actual role change

    def test_the_only_super_admin_cannot_leave_the_building(self, staff):
        boss = staff("SUPER_ADMIN")
        assert boss.patch(f"{STAFF}{boss.user.id}/", {"role": "ADMIN"}, format="json").status_code == 403
        assert boss.delete(f"{STAFF}{boss.user.id}/").status_code == 403
        assert User.objects.filter(role="SUPER_ADMIN", is_active=True).count() == 1

    def test_last_active_super_admin_guard(self, staff):
        """Defence in depth: even if the usual rules were bypassed (e.g. the acting super admin was deactivated a moment ago),
        the last active SUPER_ADMIN still can't be demoted or deactivated."""
        last = make_user(email="last@staff.example.com", role="SUPER_ADMIN")
        ghost = make_user(email="ghost@staff.example.com", role="SUPER_ADMIN", is_active=False)
        view = StaffViewSet()
        view.request = SimpleNamespace(user=ghost)
        from django.db import transaction

        with transaction.atomic():
            for new_role, active in (("ADMIN", True), ("SUPER_ADMIN", False)):
                with pytest.raises(DomainError) as exc:
                    view.enforce_rules(last, new_role, active)
                assert (
                    exc.value.code == "INVALID_STATE"
                    and exc.value.status_code == 409
                    and "last active super admin" in exc.value.message
                )
            view.enforce_rules(last, "SUPER_ADMIN", True)  # unchanged is fine
            make_user(email="second@staff.example.com", role="SUPER_ADMIN")
            view.enforce_rules(last, "ADMIN", True)  # now another one exists

    def test_demoting_a_super_admin_while_another_remains_works_and_leaves_exactly_one(self, staff):
        first, second = staff("SUPER_ADMIN"), staff("SUPER_ADMIN")
        assert first.patch(f"{STAFF}{second.user.id}/", {"role": "ADMIN"}, format="json").status_code == 200
        assert User.objects.filter(role="SUPER_ADMIN", is_active=True).count() == 1
        # `second` was authenticated as a super admin when the demotion landed (a race between two requests): the
        # request still must not be able to remove the one super admin that is left.
        raced = second.patch(f"{STAFF}{first.user.id}/", {"role": "ADMIN"}, format="json")
        assert raced.status_code == 409 and raced.json()["error"]["code"] == "INVALID_STATE"
        assert "last active super admin" in raced.json()["error"]["message"]
        assert second.delete(f"{STAFF}{first.user.id}/").status_code == 409
        second.user.refresh_from_db()  # a fresh request sees the ex-super admin for what they are now
        assert second.patch(f"{STAFF}{first.user.id}/", {"role": "ADMIN"}, format="json").status_code == 403
        first.user.refresh_from_db()
        assert first.user.role == "SUPER_ADMIN" and first.user.is_active


class TestStaffUpdates:
    def test_role_and_branch_changes_are_audited(self, staff, branch, second_branch):
        boss = staff("SUPER_ADMIN")
        member = staff("STORE_MANAGER", branches=[branch])
        res = boss.patch(
            f"{STAFF}{member.user.id}/",
            {"role": "INVENTORY_MANAGER", "branches": [second_branch.id], "all_branches": True},
            format="json",
        )
        assert (
            res.status_code == 200
            and res.json()["role"] == "INVENTORY_MANAGER"
            and res.json()["branches"] == [second_branch.id]
        )
        role = audits("staff.role_changed").get()
        assert (
            role.before == {"role": "STORE_MANAGER"}
            and role.after == {"role": "INVENTORY_MANAGER"}
            and role.actor == boss.user
        )
        branches = audits("staff.branches_changed").get()
        assert branches.before == {"branches": [branch.id], "all_branches": False} and branches.after == {
            "branches": [second_branch.id],
            "all_branches": True,
        }
        full = audits("staff.updated").get()
        assert full.before["role"] == "STORE_MANAGER" and full.after["role"] == "INVENTORY_MANAGER"

    def test_a_plain_edit_writes_only_the_generic_audit_line(self, admin, staff):
        member = staff("STORE_MANAGER")
        admin.patch(f"{STAFF}{member.user.id}/", {"phone": "555-9999"}, format="json")
        assert (
            audits("staff.updated").count() == 1
            and not audits("staff.role_changed").exists()
            and not audits("staff.branches_changed").exists()
        )

    def test_flags_passwords_and_emails_cannot_be_mass_assigned(self, admin, staff):
        member = staff("STORE_MANAGER")
        before_hash = member.user.password
        res = admin.patch(
            f"{STAFF}{member.user.id}/",
            {
                "is_superuser": True,
                "is_staff": True,
                "password": "hacked",
                "last_login": "2001-01-01T00:00:00Z",
                "id": 1,
                "created_at": "2001-01-01T00:00:00Z",
            },
            format="json",
        )
        assert res.status_code == 200
        member.user.refresh_from_db()
        assert (
            not member.user.is_superuser
            and not member.user.is_staff
            and member.user.password == before_hash
            and member.user.last_login is None
        )
        assert member.user.created_at.year != 2001

    def test_email_cannot_be_changed(self, admin, staff):
        member = staff("STORE_MANAGER")
        res = admin.patch(f"{STAFF}{member.user.id}/", {"email": "other@example.com"}, format="json")
        assert res.status_code == 400 and "email" in details(res)
        assert (
            admin.patch(
                f"{STAFF}{member.user.id}/",
                {"email": member.user.email.upper(), "full_name": "Same Mail"},
                format="json",
            ).status_code
            == 200
        )

    def test_delete_deactivates_and_reactivation_is_a_patch(self, admin, staff, api):
        member = staff("FULFILMENT_STAFF")
        member.user.set_password("Orchard-Row-9!x")
        member.user.save()
        res = admin.delete(f"{STAFF}{member.user.id}/")
        assert res.status_code == 200 and res.json()["is_active"] is False
        assert User.objects.filter(pk=member.user.pk, is_active=False).exists()
        assert (
            api.post(
                "/api/v1/auth/login/", {"email": member.user.email, "password": "Orchard-Row-9!x"}, format="json"
            ).status_code
            == 401
        )
        entry = audits("staff.deactivated").get()
        assert entry.before["is_active"] is True and entry.after["is_active"] is False
        assert [s["id"] for s in results(admin.get(STAFF, {"is_active": "false"}))] == [member.user.id]
        assert admin.patch(f"{STAFF}{member.user.id}/", {"is_active": True}, format="json").json()["is_active"] is True
        assert (
            admin.delete(f"{STAFF}{member.user.id}/").status_code == 200
            and admin.delete(f"{STAFF}{member.user.id}/").status_code == 200
        )
        assert audits("staff.deactivated").count() == 2  # idempotent: the second delete wrote nothing

    def test_listing_filters_and_exclusions(self, admin, staff, branch, second_branch, user):
        a = staff("STORE_MANAGER", branches=[branch])
        b = staff("CUSTOMER_SUPPORT", branches=[second_branch])
        listed = results(admin.get(STAFF))
        assert user.email not in str(listed) and {s["id"] for s in listed} >= {a.user.id, b.user.id, admin.user.id}
        assert [s["id"] for s in results(admin.get(STAFF, {"role": "customer_support"}))] == [b.user.id]
        assert [s["id"] for s in results(admin.get(STAFF, {"branch": branch.id}))] == [a.user.id]
        assert [s["id"] for s in results(admin.get(STAFF, {"search": b.user.email}))] == [b.user.id]
        assert admin.get(f"{STAFF}{user.id}/").status_code == 404  # customers are not staff
        assert admin.patch(f"{STAFF}{user.id}/", {"role": "ADMIN"}, format="json").status_code == 404

    def test_list_never_exposes_credentials(self, admin, staff):
        staff("STORE_MANAGER")
        raw = admin.get(STAFF).content.decode().lower()
        assert "md5$" not in raw and '"password"' not in raw and "token" not in raw


# =============================================================================================== /me/permissions
class TestMyPermissions:
    URL = BASE + "me/permissions/"

    def test_anonymous_and_customers_are_refused(self, user):
        assert APIClient().get(self.URL).status_code == 401
        c = APIClient()
        c.force_authenticate(user)
        assert c.get(self.URL).status_code == 403

    @pytest.mark.parametrize("role", STAFF_ROLES)
    def test_capabilities_and_label_follow_the_role(self, role, staff, branch, second_branch):
        res = staff(role, branches=[branch]).get(self.URL)
        data = res.json()
        assert res.status_code == 200 and data["role"] == role and data["role_label"] == dict(rbac.ROLE_CHOICES)[role]
        assert data["capabilities"] == sorted(rbac.capabilities_for(role))
        if role in rbac.GLOBAL_ROLES:
            assert data["branch_scope"]["global"] is True and data["branch_scope"]["branch_ids"] is None
            assert {b["code"] for b in data["branch_scope"]["branches"]} == {"central", "north"}
        else:
            assert data["branch_scope"] == {
                "global": False,
                "branch_ids": [branch.id],
                "branches": [{"id": branch.id, "code": "central", "name": "Central"}],
            }

    def test_all_branches_flag_is_global_scope(self, staff, branch, second_branch):
        data = staff("STORE_MANAGER", all_branches=True).get(self.URL).json()
        assert data["branch_scope"]["global"] is True and len(data["branch_scope"]["branches"]) == 2

    def test_unassigned_branch_staff_have_an_empty_scope(self, staff, branch):
        data = staff("FULFILMENT_STAFF").get(self.URL).json()
        assert data["branch_scope"] == {"global": False, "branch_ids": [], "branches": []}
