"""Reports must reconcile with the database. Expected values below are computed by hand from the fixtures."""

import datetime as dt
from decimal import Decimal

import pytest
from django.db import models, transaction
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.models import AuditLog
from apps.inventory import services as inv
from apps.orders import fulfilment as ful
from apps.orders import workflow
from apps.orders.models import Order
from apps.payments import services as pay_services
from apps.payments.models import Payment
from apps.promotions.models import Coupon
from tests.admin.conftest import results
from tests.shop import ADDRESS, payload, place, run_to_completion

pytestmark = pytest.mark.django_db
D = Decimal
TODAY = timezone.localdate()
DASH = "/api/v1/admin/dashboard/"


def make_order(
    product, qty, slot, *, method="COD", fulfilment="DELIVERY", email="c@example.com", coupon=None, branch_obj=None
):
    c = APIClient()
    c.post("/api/v1/cart/items/", {"product_id": product.id, "quantity": str(qty)})
    if coupon:
        assert c.post("/api/v1/cart/coupon/", {"code": coupon}).status_code == 200
    body = payload(slot, payment_method=method, contact={"name": "Cust", "email": email, "phone": "555-0100"})
    if fulfilment == "PICKUP":
        body = {
            "fulfilment_type": "PICKUP",
            "branch_id": (branch_obj).id,
            "slot_id": slot.id,
            "payment_method": method,
            "contact": body["contact"],
        }
    res = place(c, body)
    assert res.status_code == 201, res.content
    return Order.objects.get(number=res.json()["number"])


@pytest.fixture
def world(branch, second_branch, zone, milk, cheese, make_slot, stock_up, staff):
    """Central: A (COD, completed) B (card, weighed, completed, partly refunded) C (cancelled) E (confirmed, coupon). North: D (pickup, completed)."""
    picker = staff("FULFILMENT_STAFF", branches=[branch]).user
    stock_up(milk, 20, branch_obj=second_branch)
    Coupon.objects.create(code="TWO", kind="FIXED", value=D("2.00"), per_customer_limit=None)
    a = make_order(milk, 4, make_slot(hour=8), email="a@example.com")
    b = make_order(cheese, "1.5", make_slot(hour=10), method="CARD", email="b@example.com")
    from tests.shop import pay

    pay(APIClient(), b.number, "succeed")
    c = make_order(milk, 2, make_slot(hour=12), email="c@example.com")
    e = make_order(milk, 3, make_slot(hour=14), email="e@example.com", coupon="TWO")
    north_slot = make_slot("PICKUP", branch_obj=second_branch, hour=9, fee="0.00")
    d = make_order(milk, 2, north_slot, fulfilment="PICKUP", branch_obj=second_branch, email="d@example.com")
    north_picker = staff("FULFILMENT_STAFF", branches=[second_branch]).user
    for order in (a, b):
        order.refresh_from_db()
    run_to_completion(a, picker)
    b.refresh_from_db()
    run_to_completion(b, picker, picks={b.items.get().id: D("1.62")})
    d.refresh_from_db()
    run_to_completion(d, north_picker)
    workflow.cancel_order(c, actor=None, reason="changed mind", by_customer=True)
    with transaction.atomic():
        pay_services.request_refund(b, D("3.00"), "bruised", picker, "wr-1")
    return {"a": a, "b": b, "c": c, "d": d, "e": e}


class TestDashboardReconciliation:
    def test_kpis_match_hand_computed_figures(self, staff, world):
        # accepted: A 14.00, B 19.44+4.00=23.44, D 5.00 (pickup), E 3x2.50+4-2=9.50  → 51.94 over 4 orders
        k = staff("ADMIN").get(DASH).json()["kpis"]
        assert (k["orders"], k["gross_sales"], k["aov"]) == (4, "51.94", "12.99")
        assert (k["coupon_discounts"], k["promo_savings"], k["discounts"]) == ("2.00", "0.00", "2.00")
        assert k["refunds"] == "3.00"
        assert k["settled_revenue"] == "39.44"  # captured 14.00 + 23.44 + 5.00 = 42.44, minus the 3.00 refund
        assert (k["completed_orders"], k["net_sales"]) == (3, "39.44")  # completed 42.44 − refund 3.00
        assert k["cancelled_orders"] == 1 and k["pending_orders"] == 1  # E is still open

    def test_independent_orm_aggregates_agree_with_the_api(self, staff, world):
        from django.db.models import Sum
        from django.db.models.functions import Coalesce

        accepted = Order.objects.exclude(status__in=["CANCELLED", "PAYMENT_FAILED", "PENDING_PAYMENT"])
        expected = accepted.aggregate(v=Sum(Coalesce("final_total", "total")))["v"]
        captured = Payment.objects.aggregate(v=Sum("captured_amount"))["v"]
        data = staff("ADMIN").get(DASH).json()
        assert D(data["kpis"]["gross_sales"]) == expected
        assert D(data["kpis"]["settled_revenue"]) == captured - D("3.00")
        assert (
            sum(D(d["gross_sales"]) for d in data["sales_by_day"]) == expected
        )  # the daily series adds up to the headline
        assert sum(s["count"] for s in data["orders_by_status"]) == Order.objects.count()

    def test_branch_scoping_changes_the_numbers_and_forbids_other_branches(self, staff, branch, second_branch, world):
        central = staff("STORE_MANAGER", branches=[branch]).get(DASH).json()["kpis"]
        assert (central["orders"], central["gross_sales"]) == (3, "46.94")  # A + B + E
        north_mgr = staff("STORE_MANAGER", branches=[second_branch])
        assert north_mgr.get(DASH).json()["kpis"]["gross_sales"] == "5.00"
        assert north_mgr.get(DASH + f"?branch={branch.id}").status_code == 403
        assert staff("ADMIN").get(DASH + f"?branch={second_branch.id}").json()["kpis"]["orders"] == 1

    def test_dates_validated_and_period_filters_apply(self, staff, world):
        admin = staff("ADMIN")
        assert admin.get(DASH + "?from=nonsense").status_code == 400
        old = (TODAY - dt.timedelta(days=60)).isoformat()
        older = (TODAY - dt.timedelta(days=40)).isoformat()
        assert admin.get(DASH + f"?from={old}&to={older}").json()["kpis"]["orders"] == 0
        swapped = admin.get(DASH + f"?from={TODAY}&to={old}").json()
        assert swapped["period"]["days"] == 61  # reversed ranges are normalised, not an error

    def test_top_products_and_categories_use_actual_line_values(self, staff, world, milk, cheese):
        data = staff("ADMIN").get(DASH).json()
        tops = {t["name"]: t for t in data["top_products"]}
        assert tops["Mature cheddar"]["revenue"] == "19.44" and tops["Mature cheddar"]["units"] == "1.62"
        # milk lines on accepted orders: A 4 + D 2 + E 3 = 9 units; 22.50
        assert tops["Whole milk 2L"]["units"] == "9" and tops["Whole milk 2L"]["revenue"] == "22.50"
        assert sum(D(c["revenue"]) for c in data["sales_by_category"]) == D("41.94")  # lines only: 19.44 + 22.50

    def test_role_access(self, staff, branch, world):
        for role, ok in [
            ("ADMIN", True),
            ("STORE_MANAGER", True),
            ("MARKETING_MANAGER", True),
            ("PURCHASING_MANAGER", True),
            ("FULFILMENT_STAFF", False),
            ("CUSTOMER_SUPPORT", False),
        ]:
            assert (staff(role, branches=[branch]).get(DASH).status_code == 200) is ok, role
        assert APIClient().get(DASH).status_code == 401


class TestTabularReports:
    def test_sales_report_rows_sum_to_the_summary(self, staff, world):
        rep = staff("ADMIN").get("/api/v1/admin/reports/sales/").json()
        assert sum(D(r["gross_sales"]) for r in rep["rows"]) == D(rep["summary"]["gross_sales"]) == D("51.94")
        assert sum(r["orders"] for r in rep["rows"]) == 4

    def test_a_day_with_only_refunds_still_appears_so_rows_add_up_to_the_summary(self, staff, world):
        """Regression: refunds completed on a day with no new orders used to be missing from the daily rows."""
        import datetime as dt

        from django.utils import timezone

        from apps.payments.models import Refund

        Refund.objects.update(completed_at=timezone.now() - dt.timedelta(days=3))  # the 3.00 refund, three days ago
        rep = staff("ADMIN").get("/api/v1/admin/reports/sales/").json()
        assert sum(D(r["refunds"]) for r in rep["rows"]) == D(rep["summary"]["refunds"]) == D("3.00")
        refund_day = next(r for r in rep["rows"] if D(r["refunds"]) == D("3.00"))
        assert refund_day["orders"] == 0 and refund_day["aov"] == ""  # no orders that day: no average, not 0.00

    def test_zero_average_pick_minutes_is_reported_as_zero_not_blank(self, staff, world):
        from apps.orders.models import Order

        Order.objects.filter(status="COMPLETED").update(ready_at=models.F("picking_started_at"))
        rows = staff("ADMIN").get("/api/v1/admin/reports/branches/").json()["rows"]
        assert any(r["avg_pick_minutes"] == "0.0" for r in rows)

    def test_every_report_renders_and_is_scoped(self, staff, branch, world):
        from apps.reports.queries import REPORTS

        mgr = staff("STORE_MANAGER", branches=[branch])
        for name in REPORTS:
            res = mgr.get(f"/api/v1/admin/reports/{name}/")
            assert res.status_code == 200, (name, res.content)
            body = res.json()
            assert body["columns"] and "rows" in body
        assert mgr.get("/api/v1/admin/reports/nope/").status_code == 404
        branches = mgr.get("/api/v1/admin/reports/branches/").json()["rows"]
        assert [r["branch"] for r in branches] == ["Central"]

    def test_refund_report_distinguishes_completed_refunds_and_cancellations(self, staff, world):
        rep = staff("ADMIN").get("/api/v1/admin/reports/refunds/").json()
        kinds = sorted((r["type"], r["amount"]) for r in rep["rows"])
        assert kinds == [
            ("Cancellation", "9.00"),
            ("Refund", "3.00"),
        ]  # the cancelled order was 2 x 2.50 + 4.00 delivery and rep["summary"]["refunds_completed"] == "3.00"

    def test_product_and_category_reports(self, staff, world):
        prod = staff("ADMIN").get("/api/v1/admin/reports/products/").json()["rows"]
        assert [(r["sku"], r["revenue"]) for r in prod] == [("MILK", "22.50"), ("CHS", "19.44")] or [
            (r["sku"], r["revenue"]) for r in prod
        ] == [("CHS", "19.44"), ("MILK", "22.50")]
        cat = staff("ADMIN").get("/api/v1/admin/reports/categories/").json()
        assert cat["rows"][0]["share_pct"] and D(cat["summary"]["revenue"]) == D("41.94")

    def test_inventory_valuation_values_only_what_has_a_cost(self, staff, branch, product_factory, stock_up):
        costed = product_factory(sku="C1", name="Costed")
        free_text = product_factory(sku="C2", name="No cost recorded")
        stock_up(costed, 10, unit_cost=D("1.50"))
        stock_up(free_text, 4)
        rep = staff("ADMIN").get("/api/v1/admin/reports/inventory-valuation/").json()
        assert rep["summary"] == {"total_value": "15.00", "unvalued_lines": 1}
        assert {r["sku"]: r["value"] for r in rep["rows"]} == {"C1": "15.00", "C2": ""}

    def test_waste_report_values_at_cost_and_counts_unknown_costs(self, staff, branch, product_factory, stock_up):
        p = product_factory(sku="W", name="Wastes", tracks_batches=True, is_perishable=True)
        b = stock_up(p, 10, unit_cost=D("2.00"), lot_code="W1", expiry_date=TODAY - dt.timedelta(days=1))
        q = product_factory(sku="W2", name="Unpriced waste")
        stock_up(q, 5)
        with transaction.atomic():
            inv.record_waste(p, branch.id, D("4"), reason_code="EXPIRED", batch=b)
            inv.record_waste(q, branch.id, D("1"), reason_code="DAMAGED")
        rep = staff("ADMIN").get("/api/v1/admin/reports/expiry-losses/").json()
        assert rep["summary"] == {"total_value": "8.00", "movements_without_cost": 1}
        assert staff("ADMIN").get(DASH).json()["kpis"]["waste"] == {
            "movements": 2,
            "value": "8.00",
            "units": "5",
            "unknown_cost_movements": 1,
        }


class TestCsvExport:
    def test_export_requires_the_export_capability_and_is_audited(self, staff, branch, world):
        assert staff("ADMIN").get("/api/v1/admin/reports/sales/?export=csv").status_code == 200
        res = staff("STORE_MANAGER", branches=[branch]).get("/api/v1/admin/reports/sales/?export=csv")
        assert (
            res.status_code == 200
            and res["Content-Type"].startswith("text/csv")
            and "attachment" in res["Content-Disposition"]
        )
        lines = res.content.decode().strip().splitlines()
        assert lines[0].split(",")[:3] == ["Date", "Orders", "Gross sales"] and len(lines) >= 2
        assert (
            staff("MARKETING_MANAGER", branches=[branch]).get("/api/v1/admin/reports/sales/?export=csv").status_code
            == 403
        )
        assert AuditLog.objects.filter(action="report.exported").count() == 2

    def test_formula_injection_is_neutralised(self, staff, branch, product_factory, stock_up, make_slot, zone):
        evil = product_factory(sku="EVIL", name='=HYPERLINK("http://evil.example","click")', price="6.00")
        stock_up(evil, 5)
        make_order(evil, 1, make_slot(hour=16), email="x@example.com")
        text = staff("ADMIN").get("/api/v1/admin/reports/products/?export=csv").content.decode()
        assert "'=HYPERLINK" in text and "\n=HYPERLINK" not in text and ",=HYPERLINK" not in text


class TestFinance:
    def test_payment_views_respect_roles_and_branches(self, staff, branch, second_branch, world):
        assert staff("FULFILMENT_STAFF", branches=[branch]).get("/api/v1/admin/payments/").status_code == 403
        central = results(staff("STORE_MANAGER", branches=[branch]).get("/api/v1/admin/payments/"))
        assert {p["branch"] for p in central} == {"Central"} and len(central) == 4  # A, B, C(cancelled COD), E
        assert len(results(staff("ADMIN").get("/api/v1/admin/payments/"))) == 5
        detail = staff("ADMIN").get(f"/api/v1/admin/payments/{Payment.objects.get(order=world['b']).id}/").json()
        assert (
            detail["refunded"] == "3.00"
            and detail["refunds"][0]["status"] == "SUCCEEDED"
            and detail["events"][0]["outcome"] == "APPLIED"
        )

    def test_reconciliation_is_clean_then_flags_discrepancies(self, staff, world):
        admin = staff("ADMIN")
        clean = admin.get(f"/api/v1/admin/finance/reconciliation/?date={TODAY}").json()
        assert (
            clean["ok"] is True
            and clean["captured_total"] == "42.44"
            and clean["refunded_total"] == "3.00"
            and clean["net"] == "39.44"
        )
        assert {r["provider"] for r in clean["by_provider"]} == {"cod", "demo"}
        Payment.objects.filter(order=world["a"]).update(captured_amount=D("13.00"))  # simulate a bookkeeping error
        bad = admin.get(f"/api/v1/admin/finance/reconciliation/?date={TODAY}").json()
        assert bad["ok"] is False and any(
            d["type"] == "CAPTURE_MISMATCH" and d["order"] == world["a"].number for d in bad["discrepancies"]
        )
        assert admin.get("/api/v1/admin/finance/reconciliation/?date=garbage").status_code == 400

    def test_pending_manual_refund_shows_up_as_a_discrepancy_until_confirmed(self, staff, world):
        with transaction.atomic():
            refund = pay_services.request_refund(world["a"], D("2.50"), "leak", staff("ADMIN").user, "manual-1")
        assert refund.status == "PENDING"
        rec = staff("ADMIN").get(f"/api/v1/admin/finance/reconciliation/?date={TODAY}").json()
        assert any(d["type"] == "REFUND_PENDING" for d in rec["discrepancies"])


_ = (ful, ADDRESS)
