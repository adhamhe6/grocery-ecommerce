"""POST /api/v1/admin/purchase-orders/<id>/close/ — permission, state machine, idempotency, audit."""

import pytest

from apps.core.models import AuditLog
from apps.purchasing.models import POStatus, PurchaseOrder, Supplier

pytestmark = pytest.mark.django_db
PO = "/api/v1/admin/purchase-orders/"


@pytest.fixture
def supplier():
    return Supplier.objects.create(code="milldairy", name="Millbrook Dairy", lead_time_days=2)


@pytest.fixture
def partly_received(staff, branch, supplier, product_factory):
    rice = product_factory(sku="RICE", name="Rice 1kg", price="3.00")
    buyer = staff("PURCHASING_MANAGER", branches=[branch])
    body = {
        "supplier_id": supplier.id,
        "branch_id": branch.id,
        "lines": [{"product_id": rice.id, "qty_ordered": "20", "unit_cost": "1.10"}],
    }
    po = buyer.post(PO, body, format="json").json()
    assert buyer.post(f"{PO}{po['id']}/submit/").status_code == 200
    line = buyer.get(f"{PO}{po['id']}/").json()["lines"][0]
    receive = {"idempotency_key": "receive-key-0001", "lines": [{"po_line_id": line["id"], "qty_accepted": "12"}]}
    assert buyer.post(f"{PO}{po['id']}/receive/", receive, format="json").json()["status"] == "PARTIALLY_RECEIVED"
    return buyer, po["id"]


def test_close_short_then_no_more_receiving(partly_received):
    buyer, pk = partly_received
    res = buyer.post(f"{PO}{pk}/close/", {"reason": "supplier cannot deliver the rest"}, format="json")
    assert res.status_code == 200, res.content
    assert res.json()["status"] == "CLOSED" and res.json()["status_label"] == "Closed (short)"
    assert "supplier cannot deliver the rest" in res.json()["notes"]
    line = buyer.get(f"{PO}{pk}/").json()["lines"][0]
    late = {"idempotency_key": "receive-key-0002", "lines": [{"po_line_id": line["id"], "qty_accepted": "1"}]}
    refused = buyer.post(f"{PO}{pk}/receive/", late, format="json")
    assert refused.status_code == 409 and refused.json()["error"]["code"] == "INVALID_STATE"
    assert buyer.post(f"{PO}{pk}/cancel/", {"reason": "x"}, format="json").status_code == 409


def test_close_is_idempotent_and_audited_once(partly_received):
    buyer, pk = partly_received
    first = buyer.post(f"{PO}{pk}/close/", {}, format="json")
    second = buyer.post(f"{PO}{pk}/close/", {}, format="json")
    assert (first.status_code, second.status_code) == (200, 200)
    assert second.json()["status"] == "CLOSED"
    assert AuditLog.objects.filter(action="po.closed").count() == 1


def test_closing_an_order_with_no_receipt_is_refused_with_a_hint(staff, branch, supplier, product_factory):
    buyer = staff("PURCHASING_MANAGER", branches=[branch])
    rice = product_factory(sku="RICE", name="Rice 1kg", price="3.00")
    body = {
        "supplier_id": supplier.id,
        "branch_id": branch.id,
        "lines": [{"product_id": rice.id, "qty_ordered": "20", "unit_cost": "1.10"}],
    }
    po = buyer.post(PO, body, format="json").json()
    buyer.post(f"{PO}{po['id']}/submit/")
    res = buyer.post(f"{PO}{po['id']}/close/", {}, format="json")
    assert res.status_code == 409 and "Cancel it" in res.json()["error"]["message"]
    assert PurchaseOrder.objects.get(pk=po["id"]).status == POStatus.SUBMITTED


@pytest.mark.parametrize(
    ("role", "allowed"),
    [
        ("ADMIN", True),
        ("PURCHASING_MANAGER", True),
        ("STORE_MANAGER", False),  # may read purchasing but not write it
        ("INVENTORY_MANAGER", False),
        ("FULFILMENT_STAFF", False),
        ("CUSTOMER_SUPPORT", False),
    ],
)
def test_close_needs_the_purchasing_write_capability(staff, branch, partly_received, role, allowed):
    _, pk = partly_received
    c = staff(role, branches=[branch])
    res = c.post(f"{PO}{pk}/close/", {}, format="json")
    assert (res.status_code == 200) is allowed, (role, res.status_code)
    if not allowed:
        assert res.status_code == 403
        assert PurchaseOrder.objects.get(pk=pk).status == POStatus.PARTIALLY_RECEIVED


def test_close_requires_a_logged_in_staff_user(api, partly_received):
    _, pk = partly_received
    assert api.post(f"{PO}{pk}/close/", {}, format="json").status_code in (401, 403)


def test_a_purchasing_manager_cannot_close_another_branchs_order(staff, second_branch, partly_received):
    _, pk = partly_received
    other = staff("PURCHASING_MANAGER", branches=[second_branch])
    assert other.post(f"{PO}{pk}/close/", {}, format="json").status_code == 404
    assert PurchaseOrder.objects.get(pk=pk).status == POStatus.PARTIALLY_RECEIVED
