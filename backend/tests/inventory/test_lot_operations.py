"""Regression tests for lot-level stock operations: write-offs with open reservations, DEPLETED lots being
refilled, and transfers into a destination that already holds the same lot code."""

import datetime as dt
from decimal import Decimal

import pytest
from django.db import transaction
from django.db.models import Sum

from apps.core.exceptions import DomainError
from apps.inventory import services as inv
from apps.inventory.models import (
    Allocation,
    AllocationState,
    Batch,
    BatchStatus,
    MovementKind,
    QualityStatus,
    StockMovement,
)
from tests.inventory.test_inventory import TODAY, level, receive, reserve_for

pytestmark = pytest.mark.django_db
D = Decimal


@pytest.fixture
def milk(product_factory):
    return product_factory(sku="MK", name="Milk", tracks_batches=True, is_perishable=True, sell_buffer_days=1)


def open_allocations(batch=None, order_item=None):
    qs = Allocation.objects.filter(state=AllocationState.RESERVED)
    if batch is not None:
        qs = qs.filter(batch=batch)
    if order_item is not None:
        qs = qs.filter(order_item=order_item)
    return qs


def assert_counters_match_allocations(product, branch):
    """The invariant: Σ open allocations per level and per batch equal the reserved counters (and nothing is negative)."""
    lv = level(product, branch)
    total = open_allocations().filter(product=product, branch=branch).aggregate(s=Sum("qty"))["s"] or D("0")
    assert total == lv.reserved, f"open allocations {total} != level.reserved {lv.reserved}"
    for batch in Batch.objects.filter(product=product, branch=branch):
        total = open_allocations(batch=batch).aggregate(s=Sum("qty"))["s"] or D("0")
        assert total == batch.qty_reserved, (
            f"{batch.lot_code}: allocations {total} != qty_reserved {batch.qty_reserved}"
        )
    assert inv.check_invariants() == []


class TestWriteOffWithOpenReservations:
    """`record_waste` used to clamp the counters of an EXPIRED/QUARANTINED lot but leave the RESERVED allocation rows,
    so the next pick or cancellation subtracted the quantity twice and the CHECK constraints rejected it."""

    def test_expired_lot_is_written_off_by_moving_its_reservation_to_another_lot(self, milk, branch, order_factory):
        old = receive(milk, branch, 6, lot_code="OLD", expiry_date=TODAY + dt.timedelta(days=3))
        good = receive(milk, branch, 10, lot_code="GOOD", expiry_date=TODAY + dt.timedelta(days=9))
        order, items = order_factory([(milk, 4)])
        item = items[milk.id]
        reserve_for(item, milk, 4, branch)  # FEFO: all 4 on OLD
        assert open_allocations(batch=old).get().qty == 4
        with transaction.atomic():  # the lot expires with the reservation still on it
            Batch.objects.filter(pk=old.pk).update(status=BatchStatus.EXPIRED)
        with transaction.atomic():
            inv.record_waste(milk, branch.id, D("6"), reason_code="EXPIRED", batch=old, on_date=TODAY)
        old.refresh_from_db()
        good.refresh_from_db()
        assert (old.qty_remaining, old.qty_reserved) == (0, 0)
        assert (good.qty_remaining, good.qty_reserved) == (10, 4)
        assert (level(milk, branch).on_hand, level(milk, branch).reserved) == (10, 4)
        assert open_allocations(batch=old).count() == 0
        assert open_allocations(order_item=item).get().batch_id == good.id
        assert_counters_match_allocations(milk, branch)
        # ... and the affected order still picks, from the other lot.
        with transaction.atomic():
            inv.commit_pick(item, D("4"), on_date=TODAY)
        good.refresh_from_db()
        assert good.qty_remaining == 6 and good.qty_reserved == 0
        sale = StockMovement.objects.get(kind=MovementKind.SALE)
        assert sale.batch_id == good.id and sale.qty_delta == -4
        assert_counters_match_allocations(milk, branch)

    def test_the_affected_order_can_still_be_cancelled_after_the_write_off(self, milk, branch, order_factory):
        old = receive(milk, branch, 5, lot_code="OLD", expiry_date=TODAY + dt.timedelta(days=3))
        good = receive(milk, branch, 5, lot_code="GOOD", expiry_date=TODAY + dt.timedelta(days=9))
        order, items = order_factory([(milk, 5)])
        reserve_for(items[milk.id], milk, 5, branch)
        Batch.objects.filter(pk=old.pk).update(status=BatchStatus.EXPIRED)
        with transaction.atomic():
            inv.record_waste(milk, branch.id, D("5"), reason_code="EXPIRED", batch=old, on_date=TODAY)
        with transaction.atomic():
            assert inv.release_order(order) == 1
        good.refresh_from_db()
        assert (good.qty_remaining, good.qty_reserved) == (5, 0)
        assert (level(milk, branch).on_hand, level(milk, branch).reserved) == (5, 0)
        assert_counters_match_allocations(milk, branch)

    def test_quarantine_then_waste_moves_the_reservation_and_the_pick_works(self, milk, branch, order_factory):
        recalled = receive(milk, branch, 8, lot_code="RECALL", expiry_date=TODAY + dt.timedelta(days=3))
        good = receive(milk, branch, 8, lot_code="GOOD", expiry_date=TODAY + dt.timedelta(days=9))
        order, items = order_factory([(milk, 3)])
        reserve_for(items[milk.id], milk, 3, branch)
        with transaction.atomic():
            inv.set_batch_status(recalled, status=BatchStatus.QUARANTINED)
        with transaction.atomic():
            inv.record_waste(milk, branch.id, D("8"), reason_code="QUALITY", batch=recalled, on_date=TODAY)
        recalled.refresh_from_db()
        assert (recalled.qty_remaining, recalled.qty_reserved) == (0, 0)
        assert recalled.status == BatchStatus.QUARANTINED  # a written-off blocked lot keeps its blocking status
        assert_counters_match_allocations(milk, branch)
        with transaction.atomic():
            inv.commit_pick(items[milk.id], D("3"), on_date=TODAY)
        good.refresh_from_db()
        assert (good.qty_remaining, good.qty_reserved) == (5, 0)
        assert_counters_match_allocations(milk, branch)

    def test_failed_quality_lot_is_treated_like_a_blocked_lot(self, milk, branch, order_factory):
        bad = receive(milk, branch, 4, lot_code="BAD", expiry_date=TODAY + dt.timedelta(days=3))
        good = receive(milk, branch, 4, lot_code="GOOD", expiry_date=TODAY + dt.timedelta(days=9))
        order, items = order_factory([(milk, 4)])
        reserve_for(items[milk.id], milk, 4, branch)
        with transaction.atomic():
            inv.set_batch_status(bad, quality_status=QualityStatus.FAILED)
            inv.record_waste(milk, branch.id, D("4"), reason_code="QUALITY", batch=bad, on_date=TODAY)
        good.refresh_from_db()
        assert good.qty_reserved == 4
        assert_counters_match_allocations(milk, branch)

    def test_without_cover_the_write_off_is_refused_with_a_clear_error_and_changes_nothing(
        self, milk, branch, order_factory
    ):
        old = receive(milk, branch, 6, lot_code="OLD", expiry_date=TODAY + dt.timedelta(days=3))
        order, items = order_factory([(milk, 4)])
        reserve_for(items[milk.id], milk, 4, branch)
        Batch.objects.filter(pk=old.pk).update(status=BatchStatus.EXPIRED)
        before = StockMovement.objects.count()
        with pytest.raises(DomainError) as exc, transaction.atomic():
            inv.record_waste(milk, branch.id, D("6"), reason_code="EXPIRED", batch=old, on_date=TODAY)
        assert exc.value.code == "INSUFFICIENT_STOCK" and exc.value.status_code == 409
        assert order.number in exc.value.message
        assert exc.value.details["writable_off"] == "2"  # 6 on hand - 4 reserved
        old.refresh_from_db()
        assert (old.qty_remaining, old.qty_reserved) == (6, 4)
        assert StockMovement.objects.count() == before
        assert_counters_match_allocations(milk, branch)
        # The unreserved part can still be binned straight away ...
        with transaction.atomic():
            inv.record_waste(milk, branch.id, D("2"), reason_code="EXPIRED", batch=old, on_date=TODAY)
        assert_counters_match_allocations(milk, branch)
        # ... and once the order is cancelled the rest can follow.
        with transaction.atomic():
            inv.release_order(order)
            inv.record_waste(milk, branch.id, D("4"), reason_code="EXPIRED", batch=old, on_date=TODAY)
        old.refresh_from_db()
        assert old.qty_remaining == 0 and level(milk, branch).on_hand == 0
        assert_counters_match_allocations(milk, branch)

    def test_a_refused_write_off_does_not_leave_half_moved_reservations_in_the_caller_transaction(
        self, milk, branch, order_factory
    ):
        """Two orders on the blocked lot; only one of them could be moved. The caller may catch the error and carry on in
        the same transaction, so nothing may stay half-done."""
        old = receive(milk, branch, 6, lot_code="OLD", expiry_date=TODAY + dt.timedelta(days=3))
        small = receive(milk, branch, 2, lot_code="SMALL", expiry_date=TODAY + dt.timedelta(days=9))
        o1, i1 = order_factory([(milk, 3)])
        o2, i2 = order_factory([(milk, 3)])
        reserve_for(i1[milk.id], milk, 3, branch)
        reserve_for(i2[milk.id], milk, 3, branch)  # OLD: 6 reserved, SMALL untouched (2 free)
        Batch.objects.filter(pk=old.pk).update(status=BatchStatus.EXPIRED)
        with transaction.atomic():
            with pytest.raises(DomainError):
                inv.record_waste(milk, branch.id, D("6"), reason_code="EXPIRED", batch=old, on_date=TODAY)
            # still inside the caller's transaction: the counters must already be consistent
            assert_counters_match_allocations(milk, branch)
        old.refresh_from_db()
        small.refresh_from_db()
        assert (old.qty_reserved, small.qty_reserved) == (6, 0)

    def test_partial_write_off_moves_only_as_many_reservations_as_needed(self, milk, branch, order_factory):
        old = receive(milk, branch, 10, lot_code="OLD", expiry_date=TODAY + dt.timedelta(days=3))
        good = receive(milk, branch, 10, lot_code="GOOD", expiry_date=TODAY + dt.timedelta(days=9))
        o1, i1 = order_factory([(milk, 4)])
        o2, i2 = order_factory([(milk, 4)])
        reserve_for(i1[milk.id], milk, 4, branch)
        reserve_for(i2[milk.id], milk, 4, branch)  # OLD: 8 reserved of 10
        Batch.objects.filter(pk=old.pk).update(status=BatchStatus.EXPIRED)
        with transaction.atomic():  # writing off 5 leaves 5 on the lot: one 4-unit reservation has to move
            inv.record_waste(milk, branch.id, D("5"), reason_code="EXPIRED", batch=old, on_date=TODAY)
        old.refresh_from_db()
        good.refresh_from_db()
        assert (old.qty_remaining, old.qty_reserved, good.qty_reserved) == (5, 4, 4)
        assert_counters_match_allocations(milk, branch)
        for item in (i1[milk.id], i2[milk.id]):  # both orders still pick (one from each lot)
            with transaction.atomic():
                inv.commit_pick(item, D("4"), on_date=TODAY)
        assert_counters_match_allocations(milk, branch)

    def test_only_the_unreserved_part_of_a_blocked_lot_needs_no_replanning(self, milk, branch, order_factory):
        old = receive(milk, branch, 6, lot_code="OLD", expiry_date=TODAY + dt.timedelta(days=3))
        order, items = order_factory([(milk, 4)])
        reserve_for(items[milk.id], milk, 4, branch)
        Batch.objects.filter(pk=old.pk).update(status=BatchStatus.EXPIRED)
        with transaction.atomic():
            inv.record_waste(milk, branch.id, D("2"), reason_code="EXPIRED", batch=old, on_date=TODAY)
        assert open_allocations(batch=old).get().qty == 4  # untouched
        assert_counters_match_allocations(milk, branch)

    def test_a_live_lot_still_cannot_be_written_off_below_its_reservations(self, milk, branch, order_factory):
        live = receive(milk, branch, 6, lot_code="LIVE", expiry_date=TODAY + dt.timedelta(days=9))
        receive(milk, branch, 6, lot_code="OTHER", expiry_date=TODAY + dt.timedelta(days=12))
        order, items = order_factory([(milk, 4)])
        reserve_for(items[milk.id], milk, 4, branch)
        with pytest.raises(DomainError) as exc, transaction.atomic():
            inv.record_waste(milk, branch.id, D("5"), reason_code="DAMAGED", batch=live, on_date=TODAY)
        assert exc.value.code == "INSUFFICIENT_STOCK"
        assert_counters_match_allocations(milk, branch)

    def test_write_off_via_the_api_keeps_the_invariants(self, milk, branch, order_factory, api):
        from tests.conftest import make_user

        staff = make_user(email="inv@example.com", role="ADMIN")
        api.force_authenticate(staff)
        old = receive(milk, branch, 6, lot_code="OLD", expiry_date=TODAY + dt.timedelta(days=3))
        order, items = order_factory([(milk, 4)])
        reserve_for(items[milk.id], milk, 4, branch)
        Batch.objects.filter(pk=old.pk).update(status=BatchStatus.EXPIRED)
        body = {
            "product_id": milk.id,
            "branch_id": branch.id,
            "batch_id": old.id,
            "quantity": "6",
            "reason_code": "EXPIRED",
        }
        res = api.post("/api/v1/admin/inventory/waste/", body, format="json")
        assert res.status_code == 409, res.content
        assert order.number in res.json()["error"]["message"]
        assert_counters_match_allocations(milk, branch)


class TestDepletedLotsComeBackIntoSale:
    def _depleted_lot(self, milk, branch, order_factory):
        lot = receive(milk, branch, 3, lot_code="L1", expiry_date=TODAY + dt.timedelta(days=9))
        order, items = order_factory([(milk, 3)])
        reserve_for(items[milk.id], milk, 3, branch)
        with transaction.atomic():
            inv.commit_pick(items[milk.id], D("3"), on_date=TODAY)
        lot.refresh_from_db()
        assert (lot.status, lot.qty_remaining) == (BatchStatus.DEPLETED, 0)
        return lot

    def test_receiving_into_a_depleted_lot_makes_it_sellable_again(self, milk, branch, order_factory):
        lot = self._depleted_lot(milk, branch, order_factory)
        receive(milk, branch, 5, lot_code="L1", expiry_date=lot.expiry_date)
        lot.refresh_from_db()
        assert (lot.status, lot.qty_remaining) == (BatchStatus.ACTIVE, 5)
        order, items = order_factory([(milk, 2)])
        allocs = reserve_for(items[milk.id], milk, 2, branch)  # shoppers can buy it
        assert [a.batch.lot_code for a in allocs] == ["L1"]
        assert inv.check_invariants() == []

    def test_a_failed_quality_lot_gets_a_truthful_status_but_stays_unsellable(self, milk, branch, order_factory):
        lot = receive(
            milk,
            branch,
            3,
            lot_code="F1",
            expiry_date=TODAY + dt.timedelta(days=9),
            quality_status=QualityStatus.FAILED,
        )
        with transaction.atomic():
            inv.record_waste(milk, branch.id, D("3"), reason_code="QUALITY", batch=lot)
        lot.refresh_from_db()
        assert lot.status == BatchStatus.DEPLETED
        receive(milk, branch, 2, lot_code="F1", expiry_date=lot.expiry_date, quality_status=QualityStatus.FAILED)
        lot.refresh_from_db()
        assert (lot.qty_remaining, lot.quality_status) == (2, QualityStatus.FAILED)
        assert lot.status != BatchStatus.DEPLETED  # units are on hand, so it must not claim to be used up ...
        order, items = order_factory([(milk, 1)])
        with pytest.raises(DomainError) as exc:  # ... but the failed inspection still keeps it off the shelf
            reserve_for(items[milk.id], milk, 1, branch)
        assert exc.value.code == "INSUFFICIENT_STOCK"

    def test_a_depleted_lot_whose_date_has_passed_comes_back_as_expired_not_sellable(self, milk, branch, order_factory):
        lot = self._depleted_lot(milk, branch, order_factory)
        past = TODAY - dt.timedelta(days=30)
        Batch.objects.filter(pk=lot.pk).update(expiry_date=past, sellable_until=past - dt.timedelta(days=1))
        receive(milk, branch, 2, lot_code="L1", expiry_date=past)
        lot.refresh_from_db()
        assert (lot.status, lot.qty_remaining) == (BatchStatus.EXPIRED, 2)
        assert inv.check_invariants() == []

    def test_transferring_a_whole_lot_creates_a_sellable_destination_lot(self, milk, branch, second_branch):
        """The source is depleted by the transfer; the new destination lot used to inherit that DEPLETED status."""
        src = receive(milk, branch, 4, lot_code="L1", expiry_date=TODAY + dt.timedelta(days=9))
        with transaction.atomic():
            inv.transfer_stock(milk, branch.id, second_branch.id, D("4"), batch=src)
        src.refresh_from_db()
        dest = Batch.objects.get(branch=second_branch, lot_code="L1")
        assert src.status == BatchStatus.DEPLETED
        assert (dest.status, dest.qty_remaining) == (BatchStatus.ACTIVE, 4)
        assert inv.check_invariants() == []

    def test_transferring_into_a_depleted_destination_lot_reactivates_it(self, milk, branch, second_branch):
        src = receive(milk, branch, 4, lot_code="L1", expiry_date=TODAY + dt.timedelta(days=9))
        with transaction.atomic():
            inv.transfer_stock(milk, branch.id, second_branch.id, D("4"), batch=src)  # src depleted
        dest = Batch.objects.get(branch=second_branch, lot_code="L1")
        with transaction.atomic():
            inv.transfer_stock(milk, second_branch.id, branch.id, D("1"), batch=dest)
        src.refresh_from_db()
        assert (src.status, src.qty_remaining) == (BatchStatus.ACTIVE, 1)  # merged into the depleted original
        with transaction.atomic():
            inv.transfer_stock(milk, second_branch.id, branch.id, D("3"), batch=dest)  # now dest is depleted
        dest.refresh_from_db()
        assert dest.status == BatchStatus.DEPLETED
        src.refresh_from_db()
        assert (src.status, src.qty_remaining) == (BatchStatus.ACTIVE, 4)
        with transaction.atomic():
            inv.transfer_stock(milk, branch.id, second_branch.id, D("2"), batch=src)
        dest.refresh_from_db()
        assert (dest.status, dest.qty_remaining) == (BatchStatus.ACTIVE, 2)
        assert inv.check_invariants() == []


class TestTransferIntoAnExistingLot:
    def test_a_different_expiry_date_is_refused_like_receive_stock(self, milk, branch, second_branch):
        src = receive(milk, branch, 10, lot_code="L1", expiry_date=TODAY + dt.timedelta(days=9))
        receive(milk, second_branch, 2, lot_code="L1", expiry_date=TODAY + dt.timedelta(days=20))
        with pytest.raises(DomainError) as exc, transaction.atomic():
            inv.transfer_stock(milk, branch.id, second_branch.id, D("3"), batch=src)
        assert exc.value.code == "VALIDATION_ERROR" and "different expiry date" in exc.value.message
        # all-or-nothing: neither side moved
        assert level(milk, branch).on_hand == 10 and level(milk, second_branch).on_hand == 2
        src.refresh_from_db()
        assert src.qty_remaining == 10
        assert inv.check_invariants() == []

    def test_a_blocked_source_lot_cannot_be_merged_into_a_live_destination_lot(self, milk, branch, second_branch):
        src = receive(milk, branch, 10, lot_code="L1", expiry_date=TODAY + dt.timedelta(days=9))
        live = receive(milk, second_branch, 2, lot_code="L1", expiry_date=src.expiry_date)
        with transaction.atomic():
            inv.set_batch_status(src, status=BatchStatus.QUARANTINED)
        with pytest.raises(DomainError) as exc, transaction.atomic():
            inv.transfer_stock(milk, branch.id, second_branch.id, D("3"), batch=src)
        assert exc.value.code == "VALIDATION_ERROR"
        live.refresh_from_db()
        assert (live.status, live.quality_status, live.qty_remaining) == (BatchStatus.ACTIVE, QualityStatus.PASSED, 2)

    def test_a_failed_quality_source_lot_cannot_be_merged_into_a_passed_destination_lot(
        self, milk, branch, second_branch
    ):
        src = receive(milk, branch, 10, lot_code="L1", expiry_date=TODAY + dt.timedelta(days=9))
        live = receive(milk, second_branch, 2, lot_code="L1", expiry_date=src.expiry_date)
        with transaction.atomic():
            inv.set_batch_status(src, quality_status=QualityStatus.FAILED)
        with pytest.raises(DomainError), transaction.atomic():
            inv.transfer_stock(milk, branch.id, second_branch.id, D("3"), batch=src)
        live.refresh_from_db()
        assert live.quality_status == QualityStatus.PASSED and live.qty_remaining == 2

    def test_good_stock_is_not_silently_merged_into_a_quarantined_destination_lot(self, milk, branch, second_branch):
        src = receive(milk, branch, 10, lot_code="L1", expiry_date=TODAY + dt.timedelta(days=9))
        dest = receive(milk, second_branch, 2, lot_code="L1", expiry_date=src.expiry_date)
        with transaction.atomic():
            inv.set_batch_status(dest, status=BatchStatus.QUARANTINED)
        with pytest.raises(DomainError) as exc, transaction.atomic():
            inv.transfer_stock(milk, branch.id, second_branch.id, D("3"), batch=src)
        assert exc.value.code == "VALIDATION_ERROR" and "status" in exc.value.message
        dest.refresh_from_db()
        assert (dest.status, dest.qty_remaining) == (BatchStatus.QUARANTINED, 2)

    def test_two_quarantined_lots_with_the_same_code_may_be_merged(self, milk, branch, second_branch):
        src = receive(milk, branch, 10, lot_code="L1", expiry_date=TODAY + dt.timedelta(days=9))
        dest = receive(milk, second_branch, 2, lot_code="L1", expiry_date=src.expiry_date)
        with transaction.atomic():
            inv.set_batch_status(src, status=BatchStatus.QUARANTINED)
            inv.set_batch_status(dest, status=BatchStatus.QUARANTINED)
            inv.transfer_stock(milk, branch.id, second_branch.id, D("3"), batch=src)
        dest.refresh_from_db()
        assert (dest.status, dest.qty_remaining) == (BatchStatus.QUARANTINED, 5)
        assert inv.check_invariants() == []

    def test_a_quarantined_lot_arrives_quarantined_at_a_new_destination(self, milk, branch, second_branch):
        src = receive(milk, branch, 10, lot_code="L1", expiry_date=TODAY + dt.timedelta(days=9))
        with transaction.atomic():
            inv.set_batch_status(src, status=BatchStatus.QUARANTINED)
            inv.transfer_stock(milk, branch.id, second_branch.id, D("10"), batch=src)  # whole lot
        dest = Batch.objects.get(branch=second_branch, lot_code="L1")
        assert (dest.status, dest.qty_remaining) == (BatchStatus.QUARANTINED, 10)

    def test_same_expiry_and_status_merges_as_before(self, milk, branch, second_branch):
        src = receive(milk, branch, 10, lot_code="L1", expiry_date=TODAY + dt.timedelta(days=9))
        receive(milk, second_branch, 2, lot_code="L1", expiry_date=src.expiry_date)
        with transaction.atomic():
            inv.transfer_stock(milk, branch.id, second_branch.id, D("3"), batch=src)
        dest = Batch.objects.get(branch=second_branch, lot_code="L1")
        assert (dest.qty_remaining, dest.qty_received) == (5, 5)
        assert inv.check_invariants() == []
