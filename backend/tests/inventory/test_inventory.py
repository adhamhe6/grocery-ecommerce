import datetime as dt
import threading
from decimal import Decimal

import pytest
from django.db import IntegrityError, close_old_connections, connection, transaction

from apps.core.exceptions import DomainError
from apps.inventory import services as inv
from apps.inventory.models import (
    Allocation,
    AllocationState,
    Batch,
    BatchStatus,
    MovementKind,
    QualityStatus,
    StockLevel,
    StockMovement,
)

pytestmark = pytest.mark.django_db
D = Decimal
TODAY = dt.date(2026, 10, 12)


def reserve_for(order_item, product, quantity, branch):
    with transaction.atomic():
        return inv.reserve([inv.ReserveRequest(order_item, product, D(str(quantity)))], branch.id, TODAY)


def receive(product, branch, quantity, **kw):
    with transaction.atomic():
        return inv.receive_stock(product, branch.id, D(str(quantity)), **kw)


def level(product, branch):
    return StockLevel.objects.get(product=product, branch=branch)


class TestPlainStock:
    def test_receive_creates_level_and_movement(self, product_factory, branch):
        p = product_factory(sku="P1", name="Pasta")
        receive(p, branch, 20)
        lv = level(p, branch)
        assert (lv.on_hand, lv.reserved) == (20, 0)
        mv = StockMovement.objects.get()
        assert (mv.kind, mv.qty_delta, mv.on_hand_after) == (MovementKind.RECEIPT, 20, 20)
        assert inv.check_invariants() == []

    def test_reserve_commit_cycle_moves_stock_and_writes_ledger(self, product_factory, branch, order_factory):
        p = product_factory(sku="P2", name="Rice")
        receive(p, branch, 10)
        order, items = order_factory([(p, 4)])
        reserve_for(items[p.id], p, 4, branch)
        assert (level(p, branch).on_hand, level(p, branch).reserved) == (10, 4)
        with transaction.atomic():
            items[p.id].refresh_from_db()
            inv.commit_pick(items[p.id], D("4"))
        assert (level(p, branch).on_hand, level(p, branch).reserved) == (6, 0)
        sale = StockMovement.objects.get(kind=MovementKind.SALE)
        assert sale.qty_delta == -4 and sale.on_hand_after == 6 and sale.ref_id == order.number
        assert inv.check_invariants() == []

    def test_short_pick_releases_unused_reservation(self, product_factory, branch, order_factory):
        p = product_factory(sku="P3", name="Beans")
        receive(p, branch, 10)
        order, items = order_factory([(p, 5)])
        reserve_for(items[p.id], p, 5, branch)
        with transaction.atomic():
            inv.commit_pick(items[p.id], D("3"))
        assert (level(p, branch).on_hand, level(p, branch).reserved) == (7, 0)
        assert inv.check_invariants() == []

    def test_double_commit_is_rejected(self, product_factory, branch, order_factory):
        p = product_factory(sku="P4", name="Oil")
        receive(p, branch, 10)
        order, items = order_factory([(p, 2)])
        reserve_for(items[p.id], p, 2, branch)
        with transaction.atomic():
            inv.commit_pick(items[p.id], D("2"))
        with pytest.raises(DomainError) as exc, transaction.atomic():
            inv.commit_pick(items[p.id], D("2"))
        assert exc.value.code == "INVALID_STATE"
        assert level(p, branch).on_hand == 8

    def test_overselling_is_refused_and_reports_every_short_line(self, product_factory, branch, order_factory):
        a, b, c = (product_factory(sku=f"S{i}", name=f"Item {i}") for i in range(3))
        receive(a, branch, 1)
        receive(b, branch, 5)
        order, items = order_factory([(a, 2), (b, 2), (c, 1)])
        with pytest.raises(DomainError) as exc, transaction.atomic():
            inv.reserve(
                [inv.ReserveRequest(items[x.id], x, D(str(q))) for x, q in ((a, 2), (b, 2), (c, 1))], branch.id, TODAY
            )
        err = exc.value
        assert err.code == "INSUFFICIENT_STOCK" and err.status_code == 409
        assert {i["product_id"] for i in err.details["items"]} == {a.id, c.id}  # b was fine
        assert level(b, branch).reserved == 0  # all-or-nothing

    def test_release_is_idempotent(self, product_factory, branch, order_factory):
        p = product_factory(sku="R1", name="Release me")
        receive(p, branch, 5)
        order, items = order_factory([(p, 3)])
        reserve_for(items[p.id], p, 3, branch)
        with transaction.atomic():
            assert inv.release_order(order) == 1
        with transaction.atomic():
            assert inv.release_order(order) == 0
        assert level(p, branch).reserved == 0

    def test_made_to_order_is_never_reserved(self, product_factory, branch, order_factory):
        p = product_factory(sku="MTO", name="Custom cake", stock_mode="MADE_TO_ORDER")
        order, items = order_factory([(p, 2)])
        assert reserve_for(items[p.id], p, 2, branch) == []
        assert not StockLevel.objects.filter(product=p).exists()

    def test_db_constraints_back_up_the_service(self, product_factory, branch):
        p = product_factory(sku="C1", name="Constrained")
        receive(p, branch, 5)
        lv = level(p, branch)
        with pytest.raises(IntegrityError), transaction.atomic():
            StockLevel.objects.filter(pk=lv.pk).update(reserved=6)  # reserved > on_hand
        with pytest.raises(IntegrityError), transaction.atomic():
            StockLevel.objects.filter(pk=lv.pk).update(on_hand=-1)

    def test_movements_are_immutable(self, product_factory, branch):
        p = product_factory(sku="IM", name="Immutable")
        receive(p, branch, 5)
        mv = StockMovement.objects.get()
        mv.note = "tamper"
        with pytest.raises(IntegrityError):
            mv.save()
        with pytest.raises(IntegrityError):
            mv.delete()


class TestAdjustWasteTransfer:
    def test_adjustment_requires_reason_and_cannot_go_below_reserved(self, product_factory, branch, order_factory):
        p = product_factory(sku="A1", name="Adjustable")
        receive(p, branch, 10)
        order, items = order_factory([(p, 6)])
        reserve_for(items[p.id], p, 6, branch)
        with pytest.raises(DomainError), transaction.atomic():
            inv.adjust_stock(p, branch.id, delta=D("-1"), reason=" ")
        with pytest.raises(DomainError) as exc, transaction.atomic():
            inv.adjust_stock(p, branch.id, target=D("5"), reason="stock take")
        assert exc.value.code == "INSUFFICIENT_STOCK"
        with transaction.atomic():
            inv.adjust_stock(p, branch.id, target=D("8"), reason="stock take", note="2 damaged on shelf")
        assert level(p, branch).on_hand == 8
        mv = StockMovement.objects.filter(kind=MovementKind.ADJUSTMENT).get()
        assert mv.qty_delta == -2 and "stock take" in mv.note
        assert inv.check_invariants() == []

    def test_waste_is_a_negative_movement_with_reason(self, product_factory, branch):
        p = product_factory(sku="W1", name="Wasteful")
        receive(p, branch, 10)
        with transaction.atomic():
            inv.record_waste(p, branch.id, D("3"), reason_code="DAMAGED", note="dropped")
        assert level(p, branch).on_hand == 7
        assert StockMovement.objects.get(kind=MovementKind.WASTE).reason_code == "DAMAGED"
        with pytest.raises(DomainError), transaction.atomic():
            inv.record_waste(p, branch.id, D("99"), reason_code="DAMAGED")

    def test_transfer_moves_stock_and_batches_between_branches(self, product_factory, branch, second_branch):
        p = product_factory(sku="T1", name="Transferable", tracks_batches=True, is_perishable=True)
        b = receive(p, branch, 10, lot_code="L1", expiry_date=TODAY + dt.timedelta(days=9))
        with transaction.atomic():
            inv.transfer_stock(p, branch.id, second_branch.id, D("4"), batch=b)
        assert level(p, branch).on_hand == 6 and level(p, second_branch).on_hand == 4
        dest = Batch.objects.get(branch=second_branch, lot_code="L1")
        assert dest.expiry_date == b.expiry_date and dest.qty_remaining == 4
        assert inv.check_invariants() == []


class TestBatchesFEFO:
    @pytest.fixture
    def milk(self, product_factory):
        return product_factory(sku="MK", name="Milk", tracks_batches=True, is_perishable=True, sell_buffer_days=1)

    def test_batch_tracked_receipt_requires_lot_and_expiry(self, milk, branch):
        with pytest.raises(DomainError), transaction.atomic():
            inv.receive_stock(milk, branch.id, D("5"))

    def test_sellable_until_applies_the_product_buffer(self, milk, branch):
        b = receive(milk, branch, 5, lot_code="L1", expiry_date=TODAY + dt.timedelta(days=5))
        assert b.sellable_until == TODAY + dt.timedelta(days=4)

    def test_allocation_is_first_expiry_first_out(self, milk, branch, order_factory):
        late = receive(milk, branch, 10, lot_code="LATE", expiry_date=TODAY + dt.timedelta(days=10))
        soon = receive(milk, branch, 4, lot_code="SOON", expiry_date=TODAY + dt.timedelta(days=3))
        mid = receive(milk, branch, 4, lot_code="MID", expiry_date=TODAY + dt.timedelta(days=6))
        order, items = order_factory([(milk, 7)])
        allocs = reserve_for(items[milk.id], milk, 7, branch)
        assert [(a.batch.lot_code, a.qty) for a in allocs] == [("SOON", 4), ("MID", 3)]
        soon.refresh_from_db(), mid.refresh_from_db(), late.refresh_from_db()
        assert (soon.qty_reserved, mid.qty_reserved, late.qty_reserved) == (4, 3, 0)
        assert inv.check_invariants() == []

    def test_expired_quarantined_and_failed_batches_are_never_allocated(self, milk, branch, order_factory):
        bad_dates = receive(milk, branch, 10, lot_code="EXP", expiry_date=TODAY - dt.timedelta(days=1))
        quarantined = receive(milk, branch, 10, lot_code="QUA", expiry_date=TODAY + dt.timedelta(days=5))
        failed = receive(
            milk,
            branch,
            10,
            lot_code="QCF",
            expiry_date=TODAY + dt.timedelta(days=5),
            quality_status=QualityStatus.FAILED,
        )
        with transaction.atomic():
            inv.set_batch_status(quarantined, status=BatchStatus.QUARANTINED)
        too_close = receive(
            milk, branch, 10, lot_code="EDGE", expiry_date=TODAY + dt.timedelta(days=0)
        )  # buffer makes it unsellable today
        order, items = order_factory([(milk, 1)])
        with pytest.raises(DomainError) as exc:
            reserve_for(items[milk.id], milk, 1, branch)
        assert exc.value.code == "INSUFFICIENT_STOCK"
        good = receive(milk, branch, 3, lot_code="GOOD", expiry_date=TODAY + dt.timedelta(days=5))
        allocs = reserve_for(items[milk.id], milk, 1, branch)
        assert [a.batch.lot_code for a in allocs] == ["GOOD"]
        for b in (bad_dates, failed, too_close, good):
            b.refresh_from_db()
        assert bad_dates.qty_reserved == 0 and failed.qty_reserved == 0 and too_close.qty_reserved == 0

    def test_commit_consumes_batches_in_fefo_order_and_writes_per_batch_movements(self, milk, branch, order_factory):
        receive(milk, branch, 2, lot_code="SOON", expiry_date=TODAY + dt.timedelta(days=3))
        receive(milk, branch, 5, lot_code="LATER", expiry_date=TODAY + dt.timedelta(days=8))
        order, items = order_factory([(milk, 4)])
        reserve_for(items[milk.id], milk, 4, branch)
        with transaction.atomic():
            inv.commit_pick(items[milk.id], D("4"), on_date=TODAY)
        soon, later = Batch.objects.get(lot_code="SOON"), Batch.objects.get(lot_code="LATER")
        assert (soon.qty_remaining, soon.status) == (0, BatchStatus.DEPLETED) and later.qty_remaining == 3
        sales = list(StockMovement.objects.filter(kind=MovementKind.SALE).order_by("id"))
        assert [(m.batch.lot_code, m.qty_delta) for m in sales] == [("SOON", -2), ("LATER", -2)]
        assert sales[-1].on_hand_after == 3 and inv.check_invariants() == []

    def test_batch_blocked_after_reservation_is_reallocated_at_pick_time(self, milk, branch, order_factory):
        a = receive(milk, branch, 5, lot_code="A", expiry_date=TODAY + dt.timedelta(days=3))
        receive(milk, branch, 5, lot_code="B", expiry_date=TODAY + dt.timedelta(days=9))
        order, items = order_factory([(milk, 3)])
        reserve_for(items[milk.id], milk, 3, branch)
        with transaction.atomic():
            inv.set_batch_status(a, quality_status=QualityStatus.FAILED)  # recall after the order was placed
        with transaction.atomic():
            inv.commit_pick(items[milk.id], D("3"), on_date=TODAY)
        a.refresh_from_db()
        assert a.qty_remaining == 5 and a.qty_reserved == 0  # untouched, still on hand, awaiting write-off
        assert Batch.objects.get(lot_code="B").qty_remaining == 2
        assert inv.check_invariants() == []

    def test_expired_stock_can_be_written_off_and_reconciles(self, milk, branch):
        old = receive(milk, branch, 6, lot_code="OLD", expiry_date=TODAY - dt.timedelta(days=2))
        assert inv.expire_batches(TODAY) == 1
        old.refresh_from_db()
        assert old.status == BatchStatus.EXPIRED
        with transaction.atomic():
            inv.record_waste(milk, branch.id, D("6"), reason_code="EXPIRED", batch=old)
        old.refresh_from_db()
        assert old.qty_remaining == 0 and level(milk, branch).on_hand == 0
        assert inv.check_invariants() == []

    def test_adjusting_batch_tracked_product_needs_a_batch(self, milk, branch):
        b = receive(milk, branch, 5, lot_code="A", expiry_date=TODAY + dt.timedelta(days=5))
        with pytest.raises(DomainError), transaction.atomic():
            inv.adjust_stock(milk, branch.id, delta=D("-1"), reason="count")
        with transaction.atomic():
            inv.adjust_stock(milk, branch.id, delta=D("-1"), reason="count", batch=b)
        b.refresh_from_db()
        assert b.qty_remaining == 4 and inv.check_invariants() == []


@pytest.mark.django_db(transaction=True, serialized_rollback=True)
@pytest.mark.concurrency
class TestConcurrency:
    def _run_threads(self, fn, n):
        results, barrier = [], threading.Barrier(n)

        def worker(i):
            close_old_connections()
            try:
                barrier.wait(timeout=10)
                results.append(("ok", fn(i)))
            except DomainError as exc:
                results.append(("err", exc.code))
            except Exception as exc:  # noqa: BLE001
                results.append(("crash", repr(exc)))
            finally:
                connection.close()

        threads = [threading.Thread(target=worker, args=(i,)) for i in range(n)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(30)
        return results

    def test_twenty_shoppers_race_for_five_units_only_five_win(self, product_factory, branch, order_factory):
        p = product_factory(sku="RACE", name="Last units")
        receive(p, branch, 5)
        items = [order_factory([(p, 1)])[1][p.id] for _ in range(20)]

        def attempt(i):
            with transaction.atomic():
                return inv.reserve([inv.ReserveRequest(items[i], p, D("1"))], branch.id, TODAY)

        results = self._run_threads(attempt, 20)
        assert not [r for r in results if r[0] == "crash"], results
        assert sum(1 for r in results if r[0] == "ok") == 5
        assert sum(1 for r in results if r == ("err", "INSUFFICIENT_STOCK")) == 15
        lv = level(p, branch)
        assert (lv.on_hand, lv.reserved) == (5, 5)
        assert inv.check_invariants() == []

    def test_batch_tracked_race_never_over_allocates_a_batch(self, product_factory, branch, order_factory):
        p = product_factory(sku="RACEB", name="Batch race", tracks_batches=True, is_perishable=True)
        receive(p, branch, 3, lot_code="B1", expiry_date=TODAY + dt.timedelta(days=5))
        receive(p, branch, 3, lot_code="B2", expiry_date=TODAY + dt.timedelta(days=8))
        items = [order_factory([(p, 2)])[1][p.id] for _ in range(6)]

        def attempt(i):
            with transaction.atomic():
                return inv.reserve([inv.ReserveRequest(items[i], p, D("2"))], branch.id, TODAY)

        results = self._run_threads(attempt, 6)
        assert not [r for r in results if r[0] == "crash"], results
        assert sum(1 for r in results if r[0] == "ok") == 3  # 6 units / 2 each
        assert Batch.objects.filter(qty_reserved__gt=models_f("qty_remaining")).count() == 0
        assert inv.check_invariants() == []
        assert Allocation.objects.filter(state=AllocationState.RESERVED).count() >= 3


def models_f(name):
    from django.db.models import F

    return F(name)
