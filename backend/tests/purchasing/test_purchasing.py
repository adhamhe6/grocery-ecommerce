"""Workflow 4: purchase order → receive → batch & expiry → inventory → FEFO allocation → blocked batches excluded."""

import datetime as dt
import threading
from decimal import Decimal

import pytest
from django.db import close_old_connections, connection, transaction
from django.db.models import Sum
from django.utils import timezone

from apps.core.exceptions import DomainError
from apps.inventory import services as inv
from apps.inventory.models import Batch, MovementKind, StockLevel, StockMovement
from apps.purchasing import services as po_svc
from apps.purchasing.models import GoodsReceipt, POStatus, Supplier, SupplierProduct
from tests.conftest import make_user

pytestmark = pytest.mark.django_db
D = Decimal
TODAY = timezone.localdate()


@pytest.fixture
def buyer():
    return make_user(email="buyer@example.com", role="PURCHASING_MANAGER")


@pytest.fixture
def supplier():
    return Supplier.objects.create(code="dairy-co", name="Millbrook Dairy", lead_time_days=2)


@pytest.fixture
def yoghurt(product_factory):
    return product_factory(
        sku="YOG",
        name="Natural yoghurt 500g",
        price="2.20",
        tracks_batches=True,
        is_perishable=True,
        sell_buffer_days=1,
    )


@pytest.fixture
def rice(product_factory):
    return product_factory(sku="RICE", name="Basmati rice 1kg", price="3.10")


def make_po(supplier, branch, buyer, lines, submit=True):
    po = po_svc.create_po(supplier=supplier, branch_id=branch.id, lines=lines, actor=buyer)
    if submit:
        po = po_svc.submit_po(po, buyer)
    return po


def line_row(po, product, accepted, **kw):
    pl = po.lines.get(product=product)
    return {"po_line_id": pl.id, "qty_accepted": D(str(accepted)), **kw}


class TestPurchaseOrderLifecycle:
    def test_create_edit_submit_confirm(self, supplier, branch, buyer, yoghurt, rice):
        po = make_po(
            supplier,
            branch,
            buyer,
            [
                {"product_id": yoghurt.id, "qty_ordered": 40, "unit_cost": "1.10"},
                {"product_id": rice.id, "qty_ordered": 20, "unit_cost": "1.90"},
            ],
            submit=False,
        )
        assert (
            po.status == POStatus.DRAFT
            and po.number.startswith("PO-")
            and po.expected_date == TODAY + dt.timedelta(days=2)
            and po.total_cost == D("82.00")
        )
        po_svc.set_lines(po, [{"product_id": rice.id, "qty_ordered": 10, "unit_cost": "2.00"}])
        assert po.lines.count() == 1
        po = po_svc.submit_po(po, buyer)
        assert po.status == POStatus.SUBMITTED and po.submitted_at
        with pytest.raises(DomainError):
            po_svc.set_lines(
                po, [{"product_id": rice.id, "qty_ordered": 1, "unit_cost": "1"}]
            )  # no edits after submission
        assert po_svc.confirm_po(po, buyer).status == POStatus.CONFIRMED

    def test_invalid_lines_and_inactive_supplier(self, supplier, branch, buyer, rice):
        with pytest.raises(DomainError):
            make_po(
                supplier, branch, buyer, [{"product_id": rice.id, "qty_ordered": 0, "unit_cost": "1"}], submit=False
            )
        with pytest.raises(DomainError):
            make_po(
                supplier,
                branch,
                buyer,
                [
                    {"product_id": rice.id, "qty_ordered": 1, "unit_cost": "1"},
                    {"product_id": rice.id, "qty_ordered": 2, "unit_cost": "1"},
                ],
                submit=False,
            )
        with pytest.raises(DomainError):
            po_svc.submit_po(po_svc.create_po(supplier=supplier, branch_id=branch.id, lines=[], actor=buyer), buyer)
        supplier.status = "ON_HOLD"
        supplier.save()
        with pytest.raises(DomainError):
            make_po(
                supplier, branch, buyer, [{"product_id": rice.id, "qty_ordered": 1, "unit_cost": "1"}], submit=False
            )

    def test_cancel_only_before_goods_arrive(self, supplier, branch, buyer, rice):
        po = make_po(supplier, branch, buyer, [{"product_id": rice.id, "qty_ordered": 10, "unit_cost": "1.9"}])
        po_svc.receive_goods(po, [line_row(po, rice, 4)], idempotency_key="rcpt-aaaaaa", actor=buyer)
        with pytest.raises(DomainError):
            po_svc.cancel_po(po, buyer, "changed mind")
        fresh = make_po(supplier, branch, buyer, [{"product_id": rice.id, "qty_ordered": 10, "unit_cost": "1.9"}])
        with pytest.raises(DomainError):
            po_svc.cancel_po(fresh, buyer, " ")
        assert po_svc.cancel_po(fresh, buyer, "supplier out of stock").status == POStatus.CANCELLED
        with pytest.raises(DomainError):
            po_svc.receive_goods(fresh, [line_row(fresh, rice, 1)], idempotency_key="rcpt-bbbbbb", actor=buyer)


class TestReceiving:
    def test_receiving_creates_batches_stock_and_ledger_with_expiry(self, supplier, branch, buyer, yoghurt, rice):
        po = make_po(
            supplier,
            branch,
            buyer,
            [
                {"product_id": yoghurt.id, "qty_ordered": 40, "unit_cost": "1.10"},
                {"product_id": rice.id, "qty_ordered": 20, "unit_cost": "1.90"},
            ],
        )
        exp = TODAY + dt.timedelta(days=12)
        receipt, replayed = po_svc.receive_goods(
            po,
            [
                line_row(
                    po,
                    yoghurt,
                    38,
                    qty_rejected=2,
                    reject_reason="crushed cartons",
                    lot_code="Y-1012",
                    expiry_date=exp,
                    expiry_kind="USE_BY",
                ),
                line_row(po, rice, 20),
            ],
            idempotency_key="rcpt-delivery1",
            actor=buyer,
            delivery_note="DN-8841",
        )
        assert not replayed and receipt.number.startswith("GR-") and receipt.lines.count() == 2
        batch = Batch.objects.get(product=yoghurt)
        assert (
            batch.lot_code,
            batch.qty_remaining,
            batch.expiry_date,
            batch.expiry_kind,
            batch.supplier,
            batch.unit_cost,
        ) == ("Y-1012", 38, exp, "USE_BY", supplier, D("1.10"))
        assert batch.sellable_until == exp - dt.timedelta(days=1)
        assert (
            StockLevel.objects.get(product=yoghurt).on_hand == 38 and StockLevel.objects.get(product=rice).on_hand == 20
        )
        assert not Batch.objects.filter(product=rice).exists()  # rice isn't batch-tracked
        mv = StockMovement.objects.get(product=yoghurt)
        assert (mv.kind, mv.qty_delta, mv.batch, mv.ref_id, mv.unit_cost) == (
            MovementKind.RECEIPT,
            38,
            batch,
            receipt.number,
            D("1.10"),
        )
        po.refresh_from_db()
        pl = po.lines.get(product=yoghurt)
        assert po.status == POStatus.PARTIALLY_RECEIVED and (pl.qty_received, pl.qty_rejected) == (38, 2)
        assert inv.check_invariants() == []

    def test_second_delivery_completes_the_order_and_merges_the_same_lot(self, supplier, branch, buyer, yoghurt):
        po = make_po(supplier, branch, buyer, [{"product_id": yoghurt.id, "qty_ordered": 40, "unit_cost": "1.10"}])
        exp = TODAY + dt.timedelta(days=10)
        po_svc.receive_goods(
            po, [line_row(po, yoghurt, 25, lot_code="L7", expiry_date=exp)], idempotency_key="rcpt-part-1", actor=buyer
        )
        po_svc.receive_goods(
            po, [line_row(po, yoghurt, 15, lot_code="L7", expiry_date=exp)], idempotency_key="rcpt-part-2", actor=buyer
        )
        po.refresh_from_db()
        assert po.status == POStatus.RECEIVED and Batch.objects.get().qty_remaining == 40 and po.receipts.count() == 2
        with pytest.raises(DomainError) as exc:
            po_svc.receive_goods(
                po,
                [line_row(po, yoghurt, 1, lot_code="L7", expiry_date=exp)],
                idempotency_key="rcpt-part-3",
                actor=buyer,
            )
        assert exc.value.code == "DUPLICATE_RECEIPT"

    def test_same_key_twice_is_a_noop(self, supplier, branch, buyer, rice):
        po = make_po(supplier, branch, buyer, [{"product_id": rice.id, "qty_ordered": 20, "unit_cost": "1.9"}])
        first, r1 = po_svc.receive_goods(po, [line_row(po, rice, 20)], idempotency_key="rcpt-dbl-click", actor=buyer)
        second, r2 = po_svc.receive_goods(po, [line_row(po, rice, 20)], idempotency_key="rcpt-dbl-click", actor=buyer)
        assert (r1, r2) == (False, True) and first.pk == second.pk
        assert (
            StockLevel.objects.get(product=rice).on_hand == 20
            and GoodsReceipt.objects.count() == 1
            and StockMovement.objects.count() == 1
        )

    def test_a_different_key_for_the_same_delivery_is_caught_by_the_outstanding_quantity(
        self, supplier, branch, buyer, rice
    ):
        po = make_po(supplier, branch, buyer, [{"product_id": rice.id, "qty_ordered": 20, "unit_cost": "1.9"}])
        po_svc.receive_goods(po, [line_row(po, rice, 20)], idempotency_key="rcpt-first-one", actor=buyer)
        with pytest.raises(DomainError) as exc:
            po_svc.receive_goods(po, [line_row(po, rice, 20)], idempotency_key="rcpt-second-ky", actor=buyer)
        assert exc.value.code == "DUPLICATE_RECEIPT"  # PO is already fully received
        assert StockLevel.objects.get(product=rice).on_hand == 20

    def test_over_receipt_beyond_ten_percent_is_refused(self, supplier, branch, buyer, rice):
        po = make_po(supplier, branch, buyer, [{"product_id": rice.id, "qty_ordered": 20, "unit_cost": "1.9"}])
        with pytest.raises(DomainError) as exc:
            po_svc.receive_goods(po, [line_row(po, rice, 23)], idempotency_key="rcpt-over-001", actor=buyer)
        assert "already entered" in exc.value.message and StockLevel.objects.filter(product=rice).count() == 0
        po_svc.receive_goods(
            po, [line_row(po, rice, 22)], idempotency_key="rcpt-over-002", actor=buyer
        )  # +10% is tolerated

    def test_batch_products_need_lot_and_expiry_and_rejections_need_a_reason(
        self, supplier, branch, buyer, yoghurt, rice
    ):
        po = make_po(
            supplier,
            branch,
            buyer,
            [
                {"product_id": yoghurt.id, "qty_ordered": 10, "unit_cost": "1.1"},
                {"product_id": rice.id, "qty_ordered": 10, "unit_cost": "1.9"},
            ],
        )
        with pytest.raises(DomainError):
            po_svc.receive_goods(po, [line_row(po, yoghurt, 10)], idempotency_key="rcpt-nolot-01", actor=buyer)
        with pytest.raises(DomainError):
            po_svc.receive_goods(
                po, [line_row(po, rice, 8, qty_rejected=2)], idempotency_key="rcpt-noreason", actor=buyer
            )
        with pytest.raises(DomainError):
            po_svc.receive_goods(po, [], idempotency_key="rcpt-empty-01", actor=buyer)
        # a failed receipt leaves absolutely nothing behind (all-or-nothing)
        assert (
            GoodsReceipt.objects.count() == 0
            and StockMovement.objects.count() == 0
            and po.lines.filter(qty_received__gt=0).count() == 0
        )

    def test_a_line_from_another_po_is_rejected(self, supplier, branch, buyer, rice, yoghurt):
        a = make_po(supplier, branch, buyer, [{"product_id": rice.id, "qty_ordered": 10, "unit_cost": "1.9"}])
        b = make_po(supplier, branch, buyer, [{"product_id": yoghurt.id, "qty_ordered": 10, "unit_cost": "1.9"}])
        with pytest.raises(DomainError):
            po_svc.receive_goods(
                a,
                [{"po_line_id": b.lines.get().id, "qty_accepted": D("5")}],
                idempotency_key="rcpt-cross-01",
                actor=buyer,
            )

    @pytest.mark.django_db(transaction=True, serialized_rollback=True)
    @pytest.mark.concurrency
    def test_concurrent_double_submit_receives_once(self, supplier, branch, buyer, rice):
        po = make_po(supplier, branch, buyer, [{"product_id": rice.id, "qty_ordered": 20, "unit_cost": "1.9"}])
        rows = [line_row(po, rice, 20)]
        out, barrier = [], threading.Barrier(5)

        def worker():
            close_old_connections()
            try:
                barrier.wait(timeout=10)
                out.append(po_svc.receive_goods(po, rows, idempotency_key="rcpt-concurrent", actor=buyer)[1])
            except Exception as exc:  # noqa: BLE001
                out.append(repr(exc))
            finally:
                connection.close()

        ts = [threading.Thread(target=worker) for _ in range(5)]
        [t.start() for t in ts]
        [t.join(30) for t in ts]
        assert out.count(False) == 1 and out.count(True) == 4, out
        assert StockLevel.objects.get(product=rice).on_hand == 20 and GoodsReceipt.objects.count() == 1


class TestWorkflow4BatchExpiryEndToEnd:
    def test_received_batches_drive_fefo_allocation_and_blocked_stock_is_never_sold(
        self, supplier, branch, buyer, yoghurt, order_factory
    ):
        po = make_po(supplier, branch, buyer, [{"product_id": yoghurt.id, "qty_ordered": 60, "unit_cost": "1.10"}])
        po_svc.receive_goods(
            po,
            [line_row(po, yoghurt, 20, lot_code="LATE", expiry_date=TODAY + dt.timedelta(days=15))],
            idempotency_key="rcpt-wf4-late1",
            actor=buyer,
        )
        po_svc.receive_goods(
            po,
            [line_row(po, yoghurt, 10, lot_code="SOON", expiry_date=TODAY + dt.timedelta(days=4))],
            idempotency_key="rcpt-wf4-soon1",
            actor=buyer,
        )
        po_svc.receive_goods(
            po,
            [line_row(po, yoghurt, 10, lot_code="OLD", expiry_date=TODAY - dt.timedelta(days=1))],
            idempotency_key="rcpt-wf4-old11",
            actor=buyer,
        )
        assert inv.expire_batches(TODAY) == 1  # OLD flips to EXPIRED
        # public availability excludes the expired batch: 30 sellable of 40 on hand
        from rest_framework.test import APIClient

        card = next(r for r in APIClient().get("/api/v1/products/").json()["results"] if r["slug"] == "yog")
        assert card["availability"]["max_orderable"] == "30"
        order, items = order_factory([(yoghurt, 12)])
        with transaction.atomic():
            allocs = inv.reserve([inv.ReserveRequest(items[yoghurt.id], yoghurt, D("12"))], branch.id, TODAY)
        assert [(a.batch.lot_code, a.qty) for a in allocs] == [("SOON", 10), ("LATE", 2)]  # first-expiry-first-out
        assert not any(a.batch.lot_code == "OLD" for a in allocs)
        # quarantine the remaining SOON stock → new orders skip it
        soon = Batch.objects.get(lot_code="SOON")
        with transaction.atomic():
            inv.set_batch_status(soon, status="QUARANTINED")
        order2, items2 = order_factory([(yoghurt, 5)])
        with transaction.atomic():
            allocs2 = inv.reserve([inv.ReserveRequest(items2[yoghurt.id], yoghurt, D("5"))], branch.id, TODAY)
        assert [a.batch.lot_code for a in allocs2] == ["LATE"]
        # stock reconciles: ledger, batches and levels agree
        assert inv.check_invariants() == []
        level = StockLevel.objects.get(product=yoghurt)
        assert (level.on_hand, level.reserved) == (40, 17)
        assert Batch.objects.filter(product=yoghurt).aggregate(s=Sum("qty_remaining"))["s"] == level.on_hand


class TestReplenishmentAndSupplierStats:
    def test_suggestions_use_measured_sales_and_open_orders(self, supplier, branch, buyer, rice, order_factory):
        SupplierProduct.objects.create(supplier=supplier, product=rice, unit_cost=D("1.90"))
        with transaction.atomic():
            inv.receive_stock(rice, branch.id, D("30"))
        level = StockLevel.objects.get(product=rice)
        level.low_stock_threshold, level.reorder_quantity = D("12"), D("40")
        level.save()
        order, items = order_factory([(rice, 24)])
        with transaction.atomic():
            inv.reserve([inv.ReserveRequest(items[rice.id], rice, D("24"))], branch.id, TODAY)
            inv.commit_pick(items[rice.id], D("24"))
        sug = po_svc.replenishment_suggestions(branch.id)
        assert len(sug) == 1
        s = sug[0]
        assert s["sku"] == "RICE" and s["available"] == "6.000" and s["suggested_qty"] == "40.000"
        assert (
            s["avg_daily_sales"] == "0.800"
            and s["days_of_cover"] == "7.5"
            and s["suppliers"][0]["name"] == "Millbrook Dairy"
        )
        po = make_po(supplier, branch, buyer, [{"product_id": rice.id, "qty_ordered": 40, "unit_cost": "1.9"}])
        assert po_svc.replenishment_suggestions(branch.id)[0]["on_order"] == "40.000" and po

    def test_no_sales_history_means_no_invented_velocity(self, branch, rice):
        with transaction.atomic():
            inv.receive_stock(rice, branch.id, D("2"))
        StockLevel.objects.filter(product=rice).update(low_stock_threshold=D("5"))
        s = po_svc.replenishment_suggestions(branch.id)[0]
        assert s["avg_daily_sales"] is None and s["days_of_cover"] is None

    def test_supplier_performance_is_computed_from_receipts_only(self, supplier, branch, buyer, rice):
        assert po_svc.supplier_performance(supplier)["fill_rate"] is None  # no data → no number
        po = make_po(supplier, branch, buyer, [{"product_id": rice.id, "qty_ordered": 100, "unit_cost": "1.9"}])
        po_svc.receive_goods(
            po,
            [line_row(po, rice, 90, qty_rejected=10, reject_reason="torn bags")],
            idempotency_key="rcpt-perf-001",
            actor=buyer,
        )
        perf = po_svc.supplier_performance(supplier)
        assert (
            perf["fill_rate"] == "90.0"
            and perf["rejection_rate"] == "10.0"
            and perf["on_time_rate"] == "100.0"
            and perf["receipts"] == 1
        )
