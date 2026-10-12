import datetime as dt
from decimal import Decimal

import pytest
from django.utils import timezone

from apps.core.models import AuditLog
from apps.inventory import services as inv
from apps.inventory.models import Batch, StockLevel, StockMovement
from apps.purchasing.models import Supplier
from tests.admin.conftest import results

pytestmark = pytest.mark.django_db
D = Decimal
INV = "/api/v1/admin/inventory/"
TODAY = timezone.localdate()


@pytest.fixture
def yoghurt(product_factory):
    return product_factory(
        sku="YOG", name="Yoghurt 500g", price="2.20", tracks_batches=True, is_perishable=True, sell_buffer_days=1
    )


@pytest.fixture
def rice(product_factory, stock_up):
    p = product_factory(sku="RICE", name="Rice 1kg", price="3.00")
    stock_up(p, 20)
    return p


class TestStockAndMovements:
    def test_role_matrix_for_reading_and_changing_stock(self, staff, branch, rice):
        for role, can_read, can_adjust in [
            ("ADMIN", True, True),
            ("STORE_MANAGER", True, True),
            ("INVENTORY_MANAGER", True, True),
            ("PURCHASING_MANAGER", True, False),
            ("FULFILMENT_STAFF", True, False),
            ("CUSTOMER_SUPPORT", False, False),
            ("MARKETING_MANAGER", False, False),
        ]:
            c = staff(role, branches=[branch])
            assert (c.get(INV + "stock/").status_code == 200) is can_read, role
            res = c.post(
                INV + "adjust/",
                {"product_id": rice.id, "branch_id": branch.id, "delta": "0.000", "reason": "noop test"},
                format="json",
            )
            assert (res.status_code == 200) is can_adjust, (role, res.status_code)

    def test_stock_list_filters_and_branch_scoping(self, staff, branch, second_branch, rice, product_factory, stock_up):
        low = product_factory(sku="LOW", name="Low item")
        stock_up(low, 3)
        StockLevel.objects.filter(product=low).update(low_stock_threshold=D("5"))
        stock_up(rice, 7, branch_obj=second_branch)
        mgr = staff("STORE_MANAGER", branches=[branch])
        rows = results(mgr.get(INV + "stock/"))
        assert {r["branch_id"] for r in rows} == {branch.id}  # never the other branch
        assert [r["sku"] for r in results(mgr.get(INV + "stock/?status=low"))] == ["LOW"]
        assert [r["sku"] for r in results(mgr.get(INV + "stock/?search=rice"))] == ["RICE"]
        row = next(r for r in rows if r["sku"] == "LOW")
        assert (row["on_hand"], row["available"], row["status"]) == ("3", "3", "LOW")
        assert len(results(staff("ADMIN").get(INV + "stock/"))) == 3

    def test_adjustment_requires_reason_is_audited_and_cannot_cross_branches(self, staff, branch, second_branch, rice):
        mgr = staff("INVENTORY_MANAGER", branches=[branch])
        assert (
            mgr.post(
                INV + "adjust/",
                {"product_id": rice.id, "branch_id": branch.id, "target": "18", "reason": " "},
                format="json",
            ).status_code
            == 400
        )
        res = mgr.post(
            INV + "adjust/",
            {
                "product_id": rice.id,
                "branch_id": branch.id,
                "target": "18",
                "reason": "stock take",
                "note": "2 torn bags",
            },
            format="json",
        )
        assert res.status_code == 200 and res.json()["on_hand_after"] == "18"
        assert AuditLog.objects.filter(action="stock.adjusted").count() == 1
        assert (
            mgr.post(
                INV + "adjust/",
                {"product_id": rice.id, "branch_id": second_branch.id, "delta": "1", "reason": "x"},
                format="json",
            ).status_code
            == 403
        )
        mv = results(mgr.get(INV + "movements/?kind=ADJUSTMENT"))[0]
        assert mv["qty_delta"] == "-2" and mv["by"] == mgr.user.email and "stock take" in mv["note"]

    def test_negative_stock_and_reserved_stock_are_protected(self, staff, branch, rice, order_factory):
        order, items = order_factory([(rice, 15)])
        from django.db import transaction

        with transaction.atomic():
            inv.reserve([inv.ReserveRequest(items[rice.id], rice, D("15"))], branch.id, TODAY)
        mgr = staff("INVENTORY_MANAGER", branches=[branch])
        res = mgr.post(
            INV + "adjust/",
            {"product_id": rice.id, "branch_id": branch.id, "target": "10", "reason": "count"},
            format="json",
        )
        assert res.status_code == 409 and res.json()["error"]["code"] == "INSUFFICIENT_STOCK"
        assert (
            mgr.post(
                INV + "waste/",
                {"product_id": rice.id, "branch_id": branch.id, "quantity": "6", "reason_code": "DAMAGED"},
                format="json",
            ).status_code
            == 409
        )

    def test_waste_and_transfer(self, staff, branch, second_branch, rice):
        mgr = staff("STORE_MANAGER", branches=[branch])
        assert (
            mgr.post(
                INV + "waste/",
                {
                    "product_id": rice.id,
                    "branch_id": branch.id,
                    "quantity": "2",
                    "reason_code": "DAMAGED",
                    "note": "dropped pallet",
                },
                format="json",
            ).status_code
            == 200
        )
        assert (
            mgr.post(
                INV + "waste/",
                {"product_id": rice.id, "branch_id": branch.id, "quantity": "2", "reason_code": "BOGUS"},
                format="json",
            ).status_code
            == 400
        )
        t = {"product_id": rice.id, "from_branch_id": branch.id, "to_branch_id": second_branch.id, "quantity": "5"}
        assert mgr.post(INV + "transfer/", t, format="json").status_code == 403  # needs access to BOTH branches
        both = staff("STORE_MANAGER", branches=[branch, second_branch])
        assert both.post(INV + "transfer/", t, format="json").status_code == 200
        assert (
            StockLevel.objects.get(product=rice, branch=branch).on_hand == 13
            and StockLevel.objects.get(product=rice, branch=second_branch).on_hand == 5
        )
        assert inv.check_invariants() == []

    def test_fulfilment_staff_cannot_change_stock(self, staff, branch, rice):
        picker = staff("FULFILMENT_STAFF", branches=[branch])
        for path, body in [
            ("adjust/", {"delta": "1", "reason": "x"}),
            ("waste/", {"quantity": "1", "reason_code": "DAMAGED"}),
        ]:
            assert (
                picker.post(
                    INV + path, {"product_id": rice.id, "branch_id": branch.id, **body}, format="json"
                ).status_code
                == 403
            )


class TestBatchesAndExpiry:
    @pytest.fixture
    def batches(self, yoghurt, branch):
        out = {}
        from django.db import transaction

        for lot, days in [("OLD", -2), ("TOMORROW", 1), ("THREE", 3), ("WEEK", 6), ("LATER", 20)]:
            with transaction.atomic():
                out[lot] = inv.receive_stock(
                    yoghurt,
                    branch.id,
                    D("10"),
                    lot_code=lot,
                    expiry_date=TODAY + dt.timedelta(days=days),
                    unit_cost=D("1.10"),
                )
        inv.expire_batches(TODAY)
        return out

    def test_expiry_worklist_groups_batches_by_urgency_with_value(self, staff, branch, batches):
        data = staff("INVENTORY_MANAGER", branches=[branch]).get(INV + "expiry/").json()
        assert {k: [b["lot_code"] for b in v] for k, v in data["groups"].items()} == {
            "expired": ["OLD"],
            "today_tomorrow": ["TOMORROW"],
            "within_3": ["THREE"],
            "within_7": ["WEEK"],
        }
        assert data["totals"]["expired"] == {"batches": 1, "value": "11.00"}
        old = data["groups"]["expired"][0]
        assert old["status"] == "EXPIRED" and old["can_sell"] is False and old["days_to_expiry"] == -2

    def test_batch_filters_detail_and_scoping(self, staff, branch, second_branch, batches):
        mgr = staff("STORE_MANAGER", branches=[branch])
        assert [b["lot_code"] for b in results(mgr.get(INV + "batches/?expired=true"))] == ["OLD"]
        assert [b["lot_code"] for b in results(mgr.get(INV + "batches/?expiring_within=3"))] == ["TOMORROW", "THREE"]
        detail = mgr.get(INV + f"batches/{batches['LATER'].id}/").json()
        assert detail["movements"][0]["kind"] == "Goods received"
        assert (
            staff("STORE_MANAGER", branches=[second_branch]).get(INV + f"batches/{batches['LATER'].id}/").status_code
            == 404
        )

    def test_quarantine_blocks_sale_and_is_audited_but_expired_cannot_be_revived(self, staff, branch, batches, yoghurt):
        mgr = staff("INVENTORY_MANAGER", branches=[branch])
        res = mgr.post(
            INV + f"batches/{batches['LATER'].id}/status/",
            {"status": "QUARANTINED", "note": "supplier recall notice"},
            format="json",
        )
        assert res.status_code == 200 and res.json()["can_sell"] is False
        assert AuditLog.objects.filter(action="batch.status").get().after["status"] == "QUARANTINED"
        from rest_framework.test import APIClient

        card = next(r for r in APIClient().get("/api/v1/products/").json()["results"] if r["slug"] == "yog")
        # OLD is expired and LATER is now quarantined; TOMORROW (sellable until today), THREE and WEEK remain: 3 × 10
        assert card["availability"]["max_orderable"] == "30"
        revive = mgr.post(INV + f"batches/{batches['OLD'].id}/status/", {"status": "ACTIVE"}, format="json")
        assert revive.status_code == 409
        assert (
            staff("FULFILMENT_STAFF", branches=[branch])
            .post(INV + f"batches/{batches['WEEK'].id}/status/", {"status": "QUARANTINED"}, format="json")
            .status_code
            == 403
        )

    def test_writing_off_expired_stock_through_the_api_clears_the_worklist(self, staff, branch, batches, yoghurt):
        mgr = staff("INVENTORY_MANAGER", branches=[branch])
        res = mgr.post(
            INV + "waste/",
            {
                "product_id": yoghurt.id,
                "branch_id": branch.id,
                "batch_id": batches["OLD"].id,
                "quantity": "10",
                "reason_code": "EXPIRED",
            },
            format="json",
        )
        assert res.status_code == 200
        assert mgr.get(INV + "expiry/").json()["groups"]["expired"] == []
        assert inv.check_invariants() == []


class TestPurchasingApi:
    def po_body(self, supplier, branch, product, **kw):
        return {
            "supplier_id": supplier.id,
            "branch_id": branch.id,
            "lines": [{"product_id": product.id, "qty_ordered": "20", "unit_cost": "1.10"}],
            **kw,
        }

    @pytest.fixture
    def supplier(self):
        return Supplier.objects.create(code="milldairy", name="Millbrook Dairy", lead_time_days=2)

    def test_role_matrix(self, staff, branch, supplier, yoghurt):
        body = self.po_body(supplier, branch, yoghurt)
        for role, can_write, can_read in [
            ("ADMIN", True, True),
            ("PURCHASING_MANAGER", True, True),
            ("STORE_MANAGER", False, True),
            ("INVENTORY_MANAGER", False, True),
            ("FULFILMENT_STAFF", False, False),
            ("MARKETING_MANAGER", False, False),
        ]:
            c = staff(role, branches=[branch])
            assert (c.get("/api/v1/admin/purchase-orders/").status_code == 200) is can_read, role
            assert (c.post("/api/v1/admin/purchase-orders/", body, format="json").status_code == 201) is can_write, role
            assert (
                c.post(
                    "/api/v1/admin/suppliers/", {"code": f"s-{role.lower()}", "name": role}, format="json"
                ).status_code
                == 201
            ) is can_write, role

    def test_po_lifecycle_and_idempotent_receiving_via_api(self, staff, branch, supplier, yoghurt):
        buyer = staff("PURCHASING_MANAGER", branches=[branch])
        po = buyer.post("/api/v1/admin/purchase-orders/", self.po_body(supplier, branch, yoghurt), format="json").json()
        base = f"/api/v1/admin/purchase-orders/{po['id']}/"
        assert po["status"] == "DRAFT" and po["total_cost"] == "22.00"
        assert (
            buyer.patch(
                base, {"lines": [{"product_id": yoghurt.id, "qty_ordered": "30", "unit_cost": "1.00"}]}, format="json"
            ).json()["total_cost"]
            == "30.00"
        )
        assert buyer.post(base + "submit/").json()["status"] == "SUBMITTED"
        assert buyer.patch(base, {"lines": []}, format="json").status_code == 409  # locked after submission
        line = buyer.get(base).json()["lines"][0]
        body = {
            "idempotency_key": "receive-key-0001",
            "delivery_note": "DN-1",
            "lines": [
                {
                    "po_line_id": line["id"],
                    "qty_accepted": "28",
                    "qty_rejected": "2",
                    "reject_reason": "crushed",
                    "lot_code": "L1",
                    "expiry_date": (TODAY + dt.timedelta(days=9)).isoformat(),
                }
            ],
        }
        first = buyer.post(base + "receive/", body, format="json").json()
        second = buyer.post(base + "receive/", body, format="json").json()
        assert (
            first["status"] == "PARTIALLY_RECEIVED"
            and first["receipt"]["replayed"] is False
            and second["receipt"]["replayed"] is True
        )
        assert (
            StockLevel.objects.get(product=yoghurt).on_hand == 28
            and Batch.objects.get().lot_code == "L1"
            and StockMovement.objects.count() == 1
        )
        assert (
            second["receipts"][0]["lines"][0]["rejected"] == "2.000"
            or second["receipts"][0]["lines"][0]["rejected"] == "2"
        )
        assert AuditLog.objects.filter(action="po.received").count() == 1

    def test_inventory_managers_cannot_receive_but_purchasing_can_and_branch_scope_holds(
        self, staff, branch, second_branch, supplier, yoghurt
    ):
        buyer = staff("PURCHASING_MANAGER", branches=[branch])
        po = buyer.post("/api/v1/admin/purchase-orders/", self.po_body(supplier, branch, yoghurt), format="json").json()
        buyer.post(f"/api/v1/admin/purchase-orders/{po['id']}/submit/")
        assert (
            staff("INVENTORY_MANAGER", branches=[branch])
            .post(
                f"/api/v1/admin/purchase-orders/{po['id']}/receive/",
                {"idempotency_key": "k" * 10, "lines": []},
                format="json",
            )
            .status_code
            == 403
        )
        north = staff("PURCHASING_MANAGER", branches=[second_branch])
        assert north.get(f"/api/v1/admin/purchase-orders/{po['id']}/").status_code == 404
        assert (
            north.post(
                "/api/v1/admin/purchase-orders/", self.po_body(supplier, branch, yoghurt), format="json"
            ).status_code
            == 403
        )

    def test_supplier_with_history_cannot_be_deleted_and_products_link_roundtrips(
        self, staff, branch, supplier, yoghurt
    ):
        buyer = staff("PURCHASING_MANAGER", branches=[branch])
        base = f"/api/v1/admin/suppliers/{supplier.id}/"
        linked = buyer.put(
            base + "products/",
            [{"product_id": yoghurt.id, "supplier_sku": "MB-YOG-500", "unit_cost": "1.05"}],
            format="json",
        ).json()
        assert linked == [
            {
                "product_id": yoghurt.id,
                "sku": "YOG",
                "name": "Yoghurt 500g",
                "supplier_sku": "MB-YOG-500",
                "unit_cost": "1.0500",
            }
        ]
        buyer.post("/api/v1/admin/purchase-orders/", self.po_body(supplier, branch, yoghurt), format="json")
        assert buyer.delete(base).status_code == 409
        assert buyer.get(base + "performance/").json()["fill_rate"] is None

    def test_replenishment_suggestions_endpoint_is_branch_scoped(self, staff, branch, second_branch, rice):
        StockLevel.objects.filter(product=rice).update(low_stock_threshold=D("30"))
        buyer = staff("PURCHASING_MANAGER", branches=[branch])
        assert [s["sku"] for s in buyer.get(f"/api/v1/admin/purchasing/replenishment/?branch={branch.id}").json()] == [
            "RICE"
        ]
        assert buyer.get(f"/api/v1/admin/purchasing/replenishment/?branch={second_branch.id}").status_code == 403
        assert buyer.get("/api/v1/admin/purchasing/replenishment/").status_code == 400
