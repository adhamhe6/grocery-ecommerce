"""Staff support-case API: branch scoping, review / resolve / reject, and honest refund reporting."""

from decimal import Decimal

import pytest
from rest_framework.test import APIClient

from apps.core import rbac
from apps.core.models import AuditLog
from apps.orders.models import SupportCase
from apps.payments.models import Payment, Refund
from apps.payments.providers.base import ProviderError, RefundResult
from apps.payments.providers.demo import DemoProvider
from tests.admin.conftest import results
from tests.admin.helpers import STAFF_ROLES, details

pytestmark = pytest.mark.django_db
D = Decimal
URL = "/api/v1/admin/cases/"
READERS = {"SUPER_ADMIN", "ADMIN", "STORE_MANAGER", "FULFILMENT_STAFF", "CUSTOMER_SUPPORT"}
HANDLERS = {"SUPER_ADMIN", "ADMIN", "STORE_MANAGER", "CUSTOMER_SUPPORT"}


def audits(action):
    return AuditLog.objects.filter(action=action)


@pytest.fixture
def milk(product_factory):
    return product_factory(sku="MILK", name="Whole milk", price="10.00", unit="each")


@pytest.fixture
def make_case(order_factory, milk, branch):
    """make_case(...) -> SupportCase on a delivered order with a collected payment of `captured` (default 20.00)."""

    def _make(
        *,
        method="CARD",
        captured="20.00",
        branch_obj=None,
        kind="DAMAGED",
        payment_state="CAPTURED",
        collect=True,
        **case_kw,
    ):
        order, items = order_factory(
            [(milk, 2)], branch_obj=branch_obj or branch, status="COMPLETED", payment_method=method,
            total=D(captured), final_total=D(captured), payment_status="PAID",
        )  # fmt: skip
        if collect:
            Payment.objects.create(
                order=order, provider="cod" if method == "COD" else "demo", method=method, state=payment_state,
                amount=D(captured), captured_amount=D(captured) if payment_state == "CAPTURED" else D("0"), currency="USD",
            )  # fmt: skip
        return SupportCase.objects.create(
            order=order, order_item=items[milk.id], kind=kind, description="Bottle leaked all over the bag", **case_kw
        )

    return _make


class TestAccess:
    def test_anonymous_and_customers_are_refused(self, make_case, user):
        case = make_case()
        assert APIClient().get(URL).status_code == 401
        c = APIClient()
        c.force_authenticate(user)
        assert (
            c.get(URL).status_code == 403
            and c.post(f"{URL}{case.id}/resolve/", {"resolution": "NONE"}, format="json").status_code == 403
        )

    def test_documented_matrix_matches_rbac(self):
        assert {r for r in rbac.STAFF_ROLES if rbac.role_has(r, "orders.read")} == READERS
        assert {r for r in rbac.STAFF_ROLES if rbac.role_has(r, "support.manage")} == HANDLERS

    @pytest.mark.parametrize("role", STAFF_ROLES)
    def test_reading_needs_orders_read_and_changes_need_support_manage(self, role, staff, make_case):
        c = staff(role, all_branches=True)
        case = make_case()
        assert c.get(URL).status_code == (200 if role in READERS else 403)
        assert c.get(f"{URL}{case.id}/").status_code == (200 if role in READERS else 403)
        assert c.post(f"{URL}{case.id}/review/", format="json").status_code == (200 if role in HANDLERS else 403), role
        res = c.post(f"{URL}{case.id}/resolve/", {"resolution": "NONE", "staff_notes": "ok"}, format="json")
        assert res.status_code == (200 if role in HANDLERS else 403), (role, res.content)
        other = make_case()
        assert c.post(f"{URL}{other.id}/reject/", {"staff_notes": "not valid"}, format="json").status_code == (
            200 if role in HANDLERS else 403
        )

    def test_cases_cannot_be_created_edited_or_deleted_through_this_api(self, admin, make_case):
        case = make_case()
        assert admin.post(URL, {"kind": "OTHER"}, format="json").status_code == 405
        assert admin.patch(f"{URL}{case.id}/", {"status": "RESOLVED"}, format="json").status_code == 405
        assert admin.delete(f"{URL}{case.id}/").status_code == 405


class TestScopingAndListing:
    def test_staff_only_see_cases_from_their_branches(self, staff, make_case, branch, second_branch):
        mine, theirs = make_case(), make_case(branch_obj=second_branch)
        c = staff("CUSTOMER_SUPPORT", branches=[branch])
        assert [r["id"] for r in results(c.get(URL))] == [mine.id]
        assert c.get(f"{URL}{theirs.id}/").status_code == 404
        assert [
            r["id"] for r in results(c.get(URL, {"branch": second_branch.id}))
        ] == []  # a filter can't widen the scope
        for action, body in (("review", {}), ("resolve", {"resolution": "NONE"}), ("reject", {"staff_notes": "x"})):
            assert c.post(f"{URL}{theirs.id}/{action}/", body, format="json").status_code == 404
        theirs.refresh_from_db()
        assert theirs.status == "OPEN" and not audits("case.resolved").exists()
        assert {r["id"] for r in results(staff("STORE_MANAGER", all_branches=True).get(URL))} == {mine.id, theirs.id}
        assert results(staff("CUSTOMER_SUPPORT").get(URL)) == []

    def test_filters(self, admin, make_case, second_branch):
        a = make_case(kind="MISSING")
        b = make_case(kind="LATE", branch_obj=second_branch)
        SupportCase.objects.filter(pk=b.pk).update(status="RESOLVED")
        ids = lambda **p: sorted(r["id"] for r in results(admin.get(URL, p)))  # noqa: E731
        assert ids() == sorted([a.id, b.id])
        assert ids(status="OPEN") == [a.id] and ids(status="open,resolved") == sorted([a.id, b.id])
        assert ids(kind="late") == [b.id] and ids(kind="MISSING,LATE") == sorted([a.id, b.id])
        assert ids(branch=second_branch.id) == [b.id]
        assert ids(q=a.order.number) == [a.id]
        assert (
            admin.get(URL, {"status": "DONE"}).status_code == 400
            and admin.get(URL, {"kind": "NOPE"}).status_code == 400
        )

    def test_detail_shows_the_order_the_refunds_and_what_can_still_be_refunded(self, admin, make_case):
        case = make_case(captured="20.00")
        data = admin.get(f"{URL}{case.id}/").json()
        assert (
            data["order_number"] == case.order.number
            and data["status"] == "OPEN"
            and data["kind_label"] == "Damaged / poor quality"
        )
        assert (
            data["refundable"] == "20.00"
            and data["payment_method"] == "CARD"
            and data["refunds"] == []
            and data["refund_status"] is None
        )
        assert data["branch"]["name"] == "Central" and data["order_item"]["name"] == "Whole milk"
        assert (
            "refundable" in admin.get(f"{URL}{case.id}/").json() and results(admin.get(URL))[0]["refundable"] is None
        )  # list stays cheap
        uncollected = make_case(collect=False)
        assert admin.get(f"{URL}{uncollected.id}/").json()["refundable"] is None


class TestReview:
    def test_review_assigns_the_handler_and_is_audited(self, staff, make_case):
        case = make_case()
        c = staff("CUSTOMER_SUPPORT", all_branches=True)
        res = c.post(f"{URL}{case.id}/review/", format="json")
        assert (
            res.status_code == 200 and res.json()["status"] == "IN_REVIEW" and res.json()["handled_by"] == c.user.email
        )
        entry = audits("case.review_started").get()
        assert entry.before["status"] == "OPEN" and entry.after["status"] == "IN_REVIEW" and entry.actor == c.user
        assert c.post(f"{URL}{case.id}/review/", format="json").status_code == 200  # same person again: no-op
        assert audits("case.review_started").count() == 1

    def test_somebody_elses_review_cannot_be_taken_over(self, staff, make_case):
        case = make_case()
        first, second = staff("CUSTOMER_SUPPORT", all_branches=True), staff("STORE_MANAGER", all_branches=True)
        first.post(f"{URL}{case.id}/review/", format="json")
        res = second.post(f"{URL}{case.id}/review/", format="json")
        assert res.status_code == 409 and first.user.email in res.json()["error"]["message"]
        assert (
            second.post(f"{URL}{case.id}/resolve/", {"resolution": "NONE"}, format="json").status_code == 200
        )  # but anyone may resolve


class TestResolveWithRefund:
    def test_card_refund_that_really_succeeded_is_reported_as_completed(self, admin, make_case):
        case = make_case(captured="20.00")
        res = admin.post(
            f"{URL}{case.id}/resolve/",
            {"resolution": "REFUND", "refund_amount": "8.00", "staff_notes": "One bottle leaked"},
            format="json",
        )
        assert res.status_code == 200, res.content
        data = res.json()
        assert (
            data["status"] == "RESOLVED"
            and data["resolution"] == "REFUND"
            and data["refund_amount"] == "8.00"
            and data["staff_notes"] == "One bottle leaked"
        )
        assert (
            data["refund"]["status"] == "SUCCEEDED"
            and data["refund"]["completed"] is True
            and data["refund"]["method"] == "PROVIDER"
        )
        assert data["refund_status"] == "SUCCEEDED" and data["handled_by"] == admin.user.email and data["resolved_at"]
        refund = Refund.objects.get()
        assert (
            refund.support_case_id == case.id
            and refund.idempotency_key == f"case-{case.id}"
            and refund.requested_by == admin.user
        )
        assert refund.amount == D("8.00") and refund.status == "SUCCEEDED" and "One bottle leaked" in refund.reason
        payment = Payment.objects.get()
        assert payment.refunded_amount == D("8.00") and payment.state == "PARTIALLY_REFUNDED"
        case.order.refresh_from_db()
        assert case.order.payment_status == "PARTIALLY_REFUNDED"
        entry = audits("case.resolved").get()
        assert (
            entry.before["status"] == "OPEN"
            and entry.after["status"] == "RESOLVED"
            and entry.after["refund"]["completed"] is True
        )

    def test_goodwill_for_the_full_amount_refunds_the_order(self, admin, make_case):
        case = make_case(captured="20.00")
        res = admin.post(
            f"{URL}{case.id}/resolve/", {"resolution": "GOODWILL", "refund_amount": "20.00"}, format="json"
        )
        assert res.json()["refund"]["completed"] is True and Payment.objects.get().state == "REFUNDED"

    def test_cash_on_delivery_refunds_are_pending_until_someone_hands_over_the_money(self, admin, make_case):
        case = make_case(method="COD", captured="20.00")
        res = admin.post(f"{URL}{case.id}/resolve/", {"resolution": "REFUND", "refund_amount": "5.00"}, format="json")
        assert res.status_code == 200
        refund = res.json()["refund"]
        assert refund["status"] == "PENDING" and refund["completed"] is False and refund["method"] == "MANUAL"
        assert "NOT yet paid out" in refund["message"]
        assert res.json()["status"] == "RESOLVED" and res.json()["refund_status"] == "PENDING"
        assert (
            Payment.objects.get().refunded_amount == D("0.00") and Refund.objects.get().status == "PENDING"
        )  # nothing claimed as moved

    def test_a_provider_outage_leaves_the_refund_pending_and_says_so(self, admin, make_case, monkeypatch):
        def down(self, payment, amount, key):
            raise ProviderError("timeout")

        monkeypatch.setattr(DemoProvider, "refund", down)
        case = make_case()
        res = admin.post(f"{URL}{case.id}/resolve/", {"resolution": "REFUND", "refund_amount": "4.00"}, format="json")
        refund = res.json()["refund"]
        assert res.status_code == 200 and refund["status"] == "PENDING" and refund["completed"] is False
        assert "couldn't be reached" in refund["message"] and "NOT been issued" in refund["message"]
        assert Payment.objects.get().refunded_amount == D("0.00") and Refund.objects.get().failure_message.startswith(
            "Provider unreachable"
        )

    def test_a_refund_the_provider_rejects_leaves_the_case_open_and_retryable(self, admin, make_case, monkeypatch):
        case = make_case()
        monkeypatch.setattr(
            DemoProvider, "refund", lambda self, payment, amount, key: RefundResult("FAILED", "re_x", "Card closed")
        )
        res = admin.post(
            f"{URL}{case.id}/resolve/",
            {"resolution": "REFUND", "refund_amount": "4.00", "staff_notes": "try"},
            format="json",
        )
        assert res.status_code == 502 and res.json()["error"]["code"] == "PAYMENT_FAILED"
        case.refresh_from_db()
        assert (
            case.status == "OPEN" and case.resolution == "NONE" and case.refund_amount == 0 and case.staff_notes == ""
        )
        assert Refund.objects.count() == 0 and Payment.objects.get().refunded_amount == 0  # rolled back as one unit
        assert audits("case.refund_failed").get().summary == "Card closed" and not audits("case.resolved").exists()
        monkeypatch.undo()  # the provider recovers: the same request now works because the failed attempt left no idempotency trace
        again = admin.post(f"{URL}{case.id}/resolve/", {"resolution": "REFUND", "refund_amount": "4.00"}, format="json")
        assert again.status_code == 200 and again.json()["refund"]["completed"] is True and Refund.objects.count() == 1

    def test_cannot_refund_more_than_what_is_still_refundable(self, admin, make_case):
        case = make_case(captured="20.00")
        res = admin.post(f"{URL}{case.id}/resolve/", {"resolution": "REFUND", "refund_amount": "20.01"}, format="json")
        assert (
            res.status_code == 409
            and res.json()["error"]["code"] == "REFUND_NOT_ALLOWED"
            and res.json()["error"]["details"]["refundable"] == "20.00"
        )
        case.refresh_from_db()
        assert case.status == "OPEN" and not Refund.objects.exists() and not audits("case.resolved").exists()

    def test_earlier_refunds_on_the_same_order_shrink_the_limit(self, admin, make_case):
        first = make_case(captured="20.00")
        admin.post(f"{URL}{first.id}/resolve/", {"resolution": "REFUND", "refund_amount": "15.00"}, format="json")
        second = SupportCase.objects.create(order=first.order, kind="MISSING", description="Also missing cheese")
        res = admin.post(f"{URL}{second.id}/resolve/", {"resolution": "REFUND", "refund_amount": "6.00"}, format="json")
        assert res.status_code == 409 and res.json()["error"]["details"]["refundable"] == "5.00"
        assert admin.post(
            f"{URL}{second.id}/resolve/", {"resolution": "REFUND", "refund_amount": "5.00"}, format="json"
        ).json()["refund"]["completed"]
        assert Payment.objects.get().state == "REFUNDED" and Refund.objects.count() == 2

    def test_pending_manual_refunds_also_count_against_the_limit(self, admin, make_case):
        first = make_case(method="COD", captured="20.00")
        admin.post(f"{URL}{first.id}/resolve/", {"resolution": "REFUND", "refund_amount": "18.00"}, format="json")
        second = SupportCase.objects.create(order=first.order, kind="OTHER", description="More")
        res = admin.post(f"{URL}{second.id}/resolve/", {"resolution": "REFUND", "refund_amount": "3.00"}, format="json")
        assert res.status_code == 409 and res.json()["error"]["details"]["refundable"] == "2.00"

    def test_money_cannot_move_before_the_payment_was_collected(self, admin, make_case):
        authorised = make_case(payment_state="AUTHORIZED")
        res = admin.post(
            f"{URL}{authorised.id}/resolve/", {"resolution": "REFUND", "refund_amount": "1.00"}, format="json"
        )
        assert res.status_code == 409 and res.json()["error"]["code"] == "REFUND_NOT_ALLOWED"
        no_payment = make_case(collect=False)
        assert (
            admin.post(
                f"{URL}{no_payment.id}/resolve/", {"resolution": "REFUND", "refund_amount": "1.00"}, format="json"
            ).status_code
            == 409
        )
        assert not Refund.objects.exists() and SupportCase.objects.filter(status="OPEN").count() == 2


class TestResolveWithoutRefund:
    def test_no_action_and_replacement_resolutions(self, admin, make_case):
        a, b = make_case(), make_case()
        res = admin.post(
            f"{URL}{a.id}/resolve/", {"resolution": "NONE", "staff_notes": "Photos show nothing wrong"}, format="json"
        )
        assert (
            res.status_code == 200
            and res.json()["status"] == "RESOLVED"
            and res.json()["refund"] is None
            and res.json()["refund_amount"] == "0.00"
        )
        res = admin.post(
            f"{URL}{b.id}/resolve/",
            {"resolution": "REPLACEMENT", "staff_notes": "New bottle on next order"},
            format="json",
        )
        assert res.json()["resolution"] == "REPLACEMENT" and not Refund.objects.exists()

    @pytest.mark.parametrize(
        ("body", "field"),
        [
            ({"resolution": "REFUND"}, "refund_amount"),
            ({"resolution": "GOODWILL", "refund_amount": "0"}, "refund_amount"),
            ({"resolution": "NONE", "refund_amount": "5.00"}, "refund_amount"),
            ({"resolution": "REPLACEMENT", "refund_amount": "1.00"}, "refund_amount"),
            ({"resolution": "REFUND", "refund_amount": "-1"}, "refund_amount"),
            ({"resolution": "REFUND", "refund_amount": "1.005"}, "refund_amount"),
            ({"resolution": "REFUND", "refund_amount": "lots"}, "refund_amount"),
            ({"resolution": "MAGIC"}, "resolution"),
            ({}, "resolution"),
        ],
    )
    def test_validation(self, admin, make_case, body, field):
        case = make_case()
        res = admin.post(f"{URL}{case.id}/resolve/", body, format="json")
        assert res.status_code == 400 and res.json()["error"]["code"] == "VALIDATION_ERROR" and field in details(res)
        case.refresh_from_db()
        assert case.status == "OPEN" and not Refund.objects.exists()


class TestReject:
    def test_rejecting_needs_a_reason_the_customer_can_be_given(self, admin, make_case):
        case = make_case()
        for body in ({}, {"staff_notes": ""}, {"staff_notes": "   "}):
            res = admin.post(f"{URL}{case.id}/reject/", body, format="json")
            assert res.status_code == 400 and "staff_notes" in details(res)
        case.refresh_from_db()
        assert case.status == "OPEN"
        res = admin.post(
            f"{URL}{case.id}/reject/", {"staff_notes": "Reported after the complaint window"}, format="json"
        )
        assert res.status_code == 200 and res.json()["status"] == "REJECTED" and res.json()["resolution"] == "NONE"
        assert (
            res.json()["staff_notes"] == "Reported after the complaint window"
            and res.json()["resolved_at"]
            and res.json()["handled_by"] == admin.user.email
        )
        entry = audits("case.rejected").get()
        assert entry.before["status"] == "OPEN" and entry.after["status"] == "REJECTED"
        assert not Refund.objects.exists()

    def test_resolve_with_status_rejected_is_the_same_as_reject(self, admin, make_case):
        case = make_case()
        blank = admin.post(f"{URL}{case.id}/resolve/", {"status": "REJECTED"}, format="json")
        assert blank.status_code == 400 and "staff_notes" in details(blank)
        res = admin.post(
            f"{URL}{case.id}/resolve/", {"status": "rejected", "staff_notes": "Outside the window"}, format="json"
        )
        assert res.status_code == 200 and res.json()["status"] == "REJECTED" and audits("case.rejected").count() == 1


class TestImmutability:
    def test_a_resolved_case_cannot_be_changed_or_refunded_twice(self, admin, make_case):
        case = make_case(captured="20.00")
        admin.post(
            f"{URL}{case.id}/resolve/",
            {"resolution": "REFUND", "refund_amount": "5.00", "staff_notes": "first"},
            format="json",
        )
        for action, body in (
            ("resolve", {"resolution": "REFUND", "refund_amount": "5.00"}),
            ("resolve", {"resolution": "NONE"}),
            ("review", {}),
            ("reject", {"staff_notes": "changed my mind"}),
        ):
            res = admin.post(f"{URL}{case.id}/{action}/", body, format="json")
            assert (
                res.status_code == 409
                and res.json()["error"]["code"] == "INVALID_STATE"
                and "resolved" in res.json()["error"]["message"]
            ), action
        case.refresh_from_db()
        assert case.staff_notes == "first" and case.refund_amount == D("5.00") and case.status == "RESOLVED"
        assert Refund.objects.count() == 1 and Payment.objects.get().refunded_amount == D("5.00")
        assert audits("case.resolved").count() == 1

    def test_a_rejected_case_is_final_too(self, admin, make_case):
        case = make_case()
        admin.post(f"{URL}{case.id}/reject/", {"staff_notes": "no evidence"}, format="json")
        assert admin.post(f"{URL}{case.id}/resolve/", {"resolution": "NONE"}, format="json").status_code == 409
        assert admin.post(f"{URL}{case.id}/review/", format="json").status_code == 409
        assert SupportCase.objects.get(pk=case.pk).status == "REJECTED"
