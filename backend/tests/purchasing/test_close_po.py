"""Closing a purchase order short: the operation the cancel error message ("Close it instead of cancelling") promised."""

from decimal import Decimal

import pytest

from apps.core.exceptions import DomainError
from apps.core.models import AuditLog
from apps.inventory import services as inv
from apps.inventory.models import StockLevel
from apps.purchasing import services as po_svc
from apps.purchasing.models import POStatus, Supplier
from tests.conftest import make_user
from tests.purchasing.test_purchasing import line_row, make_po

pytestmark = pytest.mark.django_db
D = Decimal


@pytest.fixture
def buyer():
    return make_user(email="buyer@example.com", role="PURCHASING_MANAGER")


@pytest.fixture
def supplier():
    return Supplier.objects.create(code="dairy-co", name="Millbrook Dairy", lead_time_days=2)


@pytest.fixture
def rice(product_factory):
    return product_factory(sku="RICE", name="Basmati rice 1kg", price="3.10")


@pytest.fixture
def partly_received(supplier, branch, buyer, rice):
    po = make_po(supplier, branch, buyer, [{"product_id": rice.id, "qty_ordered": 20, "unit_cost": "1.9"}])
    po_svc.receive_goods(po, [line_row(po, rice, 12)], idempotency_key="rcpt-part-001", actor=buyer)
    po.refresh_from_db()
    assert po.status == POStatus.PARTIALLY_RECEIVED
    return po


class TestClosePurchaseOrder:
    def test_a_partly_received_order_can_be_closed_and_keeps_its_stock(self, partly_received, buyer, rice):
        closed = po_svc.close_purchase_order(partly_received, buyer, "supplier discontinued the line")
        assert closed.status == POStatus.CLOSED
        assert "Closed short: supplier discontinued the line" in closed.notes
        assert StockLevel.objects.get(product=rice).on_hand == 12  # what arrived stays on the shelf
        pl = closed.lines.get()
        assert (pl.qty_ordered, pl.qty_received) == (20, 12)  # the shortfall stays visible
        assert AuditLog.objects.filter(action="po.closed").count() == 1
        assert inv.check_invariants() == []

    def test_nothing_more_can_be_received_against_a_closed_order(self, partly_received, buyer, rice):
        po_svc.close_purchase_order(partly_received, buyer)
        with pytest.raises(DomainError) as exc:
            po_svc.receive_goods(
                partly_received, [line_row(partly_received, rice, 1)], idempotency_key="rcpt-late-01", actor=buyer
            )
        assert exc.value.code == "INVALID_STATE" and "closed" in exc.value.message.lower()
        assert StockLevel.objects.get(product=rice).on_hand == 12

    def test_a_replayed_receipt_key_still_returns_the_original_receipt_after_closing(
        self, partly_received, buyer, rice
    ):
        first, _ = po_svc.receive_goods(
            partly_received, [line_row(partly_received, rice, 2)], idempotency_key="rcpt-part-002", actor=buyer
        )
        po_svc.close_purchase_order(partly_received, buyer)
        again, replayed = po_svc.receive_goods(
            partly_received, [line_row(partly_received, rice, 2)], idempotency_key="rcpt-part-002", actor=buyer
        )
        assert replayed and again.pk == first.pk

    def test_closing_is_idempotent(self, partly_received, buyer):
        po_svc.close_purchase_order(partly_received, buyer, "short shipment")
        again = po_svc.close_purchase_order(partly_received, buyer, "short shipment")
        assert again.status == POStatus.CLOSED
        assert AuditLog.objects.filter(action="po.closed").count() == 1  # no second audit row
        assert again.notes.count("Closed short") == 1  # and the note is not appended twice

    def test_a_fully_received_order_is_already_complete_and_stays_received(self, supplier, branch, buyer, rice):
        po = make_po(supplier, branch, buyer, [{"product_id": rice.id, "qty_ordered": 5, "unit_cost": "1.9"}])
        po_svc.receive_goods(po, [line_row(po, rice, 5)], idempotency_key="rcpt-full-001", actor=buyer)
        out = po_svc.close_purchase_order(po, buyer)
        assert out.status == POStatus.RECEIVED
        assert AuditLog.objects.filter(action="po.closed").count() == 0

    @pytest.mark.parametrize("to_status", ["DRAFT", "SUBMITTED", "CONFIRMED"])
    def test_an_order_nothing_arrived_for_is_cancelled_not_closed(self, supplier, branch, buyer, rice, to_status):
        po = make_po(
            supplier, branch, buyer, [{"product_id": rice.id, "qty_ordered": 5, "unit_cost": "1.9"}], submit=False
        )
        if to_status != "DRAFT":
            po = po_svc.submit_po(po, buyer)
        if to_status == "CONFIRMED":
            po = po_svc.confirm_po(po, buyer)
        with pytest.raises(DomainError) as exc:
            po_svc.close_purchase_order(po, buyer)
        assert exc.value.code == "INVALID_STATE" and exc.value.status_code == 409
        po.refresh_from_db()
        assert po.status == to_status

    def test_a_cancelled_order_cannot_be_closed(self, supplier, branch, buyer, rice):
        po = make_po(supplier, branch, buyer, [{"product_id": rice.id, "qty_ordered": 5, "unit_cost": "1.9"}])
        po_svc.cancel_po(po, buyer, "ordered by mistake")
        with pytest.raises(DomainError) as exc:
            po_svc.close_purchase_order(po, buyer)
        assert exc.value.code == "INVALID_STATE"

    def test_the_cancel_message_now_points_at_something_real(self, partly_received, buyer):
        with pytest.raises(DomainError) as exc:
            po_svc.cancel_po(partly_received, buyer, "changed mind")
        assert "Close it instead of cancelling" in exc.value.message
        po_svc.close_purchase_order(partly_received, buyer)  # ... and that operation exists
        with pytest.raises(DomainError) as exc:
            po_svc.cancel_po(partly_received, buyer, "changed mind")
        assert exc.value.code == "INVALID_STATE" and "closed" in exc.value.message.lower()
        assert "instead" not in exc.value.message

    def test_a_closed_order_leaves_the_open_order_figures_but_counts_against_the_supplier(
        self, partly_received, buyer, rice, branch, supplier
    ):
        StockLevel.objects.filter(product=rice).update(low_stock_threshold=D("100"))
        before = po_svc.replenishment_suggestions(branch.id)[0]
        assert before["on_order"] == "8.000"
        po_svc.close_purchase_order(partly_received, buyer)
        assert po_svc.replenishment_suggestions(branch.id)[0]["on_order"] == "0"
        perf = po_svc.supplier_performance(supplier)
        assert perf["orders"] == 1 and perf["fill_rate"] == "60.0"  # 12 of 20 delivered; the shortfall is not hidden
