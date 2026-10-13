import datetime as dt
from decimal import Decimal

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.models import AuditLog
from apps.stores.models import Branch, BranchClosure, DeliverySlot, DeliveryZone, SlotTemplate
from tests.admin.conftest import results

pytestmark = pytest.mark.django_db
D = Decimal
ADMIN_GETS = [
    "/api/v1/admin/branches/",
    "/api/v1/admin/zones/",
    "/api/v1/admin/slots/",
    "/api/v1/admin/slot-templates/",
    "/api/v1/admin/closures/",
]


class TestAccessControl:
    @pytest.mark.parametrize("url", ADMIN_GETS)
    def test_anonymous_gets_401_and_customers_get_403(self, url, user):
        assert APIClient().get(url).status_code == 401
        c = APIClient()
        c.force_authenticate(user)
        res = c.get(url)
        assert res.status_code == 403 and res.json()["error"]["code"] == "FORBIDDEN"

    def test_role_matrix_for_branch_management(self, staff, branch):
        payload = {"code": "east", "name": "East", "slug": "east", "address_line1": "1 East Rd", "city": "Riverton"}
        for role, allowed in [
            ("ADMIN", True),
            ("SUPER_ADMIN", True),
            ("STORE_MANAGER", False),
            ("INVENTORY_MANAGER", False),
            ("FULFILMENT_STAFF", False),
            ("MARKETING_MANAGER", False),
        ]:
            c = staff(role, branches=[branch])
            res = c.post(
                "/api/v1/admin/branches/",
                {**payload, "code": f"e-{role.lower()}", "slug": f"e-{role.lower()}"},
                format="json",
            )
            assert (res.status_code == 201) is allowed, (role, res.status_code, res.content)
            assert c.get("/api/v1/admin/branches/").status_code == 200  # everyone on staff can read their branches

    def test_slot_management_belongs_to_managers_not_pickers(self, staff, branch, zone):
        slot = DeliverySlot.objects.create(
            branch=branch,
            zone=zone,
            kind="DELIVERY",
            date=timezone.localdate() + dt.timedelta(days=3),
            start_time=dt.time(9),
            end_time=dt.time(11),
            capacity=5,
        )
        assert (
            staff("STORE_MANAGER", branches=[branch])
            .patch(f"/api/v1/admin/slots/{slot.id}/", {"capacity": 8}, format="json")
            .status_code
            == 200
        )
        assert (
            staff("FULFILMENT_STAFF", branches=[branch])
            .patch(f"/api/v1/admin/slots/{slot.id}/", {"capacity": 9}, format="json")
            .status_code
            == 403
        )
        assert staff("FULFILMENT_STAFF", branches=[branch]).get("/api/v1/admin/slots/").status_code == 200


class TestBranchScoping:
    def test_branch_staff_only_see_and_touch_their_own_branch(self, staff, branch, second_branch, zone):
        other_zone = DeliveryZone.objects.create(
            branch=second_branch, name="North", postcode_prefixes=["RW9"], delivery_fee=D("3")
        )
        future = timezone.localdate() + dt.timedelta(days=3)
        mine = DeliverySlot.objects.create(
            branch=branch,
            zone=zone,
            kind="DELIVERY",
            date=future,
            start_time=dt.time(9),
            end_time=dt.time(11),
            capacity=5,
        )
        theirs = DeliverySlot.objects.create(
            branch=second_branch,
            zone=other_zone,
            kind="DELIVERY",
            date=future,
            start_time=dt.time(9),
            end_time=dt.time(11),
            capacity=5,
        )
        mgr = staff("STORE_MANAGER", branches=[branch])
        assert [b["code"] for b in results(mgr.get("/api/v1/admin/branches/"))] == ["central"]
        assert [s["id"] for s in results(mgr.get("/api/v1/admin/slots/"))] == [mine.id]
        assert [z["name"] for z in results(mgr.get("/api/v1/admin/zones/"))] == ["Inner"]
        # cross-branch access looks like "not found" and is never writable
        assert mgr.get(f"/api/v1/admin/slots/{theirs.id}/").status_code == 404
        assert mgr.patch(f"/api/v1/admin/slots/{theirs.id}/", {"capacity": 1}, format="json").status_code == 404
        tpl = {
            "branch": second_branch.id,
            "zone": other_zone.id,
            "kind": "DELIVERY",
            "weekday": 1,
            "start_time": "09:00",
            "end_time": "11:00",
            "capacity": 4,
        }
        assert mgr.post("/api/v1/admin/slot-templates/", tpl, format="json").status_code == 403
        assert (
            mgr.post("/api/v1/admin/slots/generate/", {"branch_id": second_branch.id}, format="json").status_code == 403
        )
        theirs.refresh_from_db()
        assert theirs.capacity == 5

    def test_global_roles_see_everything_and_all_branches_flag_works(self, staff, branch, second_branch):
        assert len(results(staff("ADMIN").get("/api/v1/admin/branches/"))) == 2
        assert len(results(staff("STORE_MANAGER", all_branches=True).get("/api/v1/admin/branches/"))) == 2
        assert len(results(staff("STORE_MANAGER").get("/api/v1/admin/branches/"))) == 0  # unassigned staff see nothing

    def test_my_branches_endpoint(self, staff, branch, second_branch):
        res = staff("STORE_MANAGER", branches=[second_branch]).get("/api/v1/admin/my-branches/").json()
        assert res["global"] is False and [b["code"] for b in res["branches"]] == ["north"]
        assert staff("ADMIN").get("/api/v1/admin/my-branches/").json()["global"] is True


class TestBranchesAndHours:
    def payload(self, **kw):
        hours = [{"weekday": d, "opens": "08:00", "closes": "20:00", "is_closed": False} for d in range(6)] + [
            {"weekday": 6, "is_closed": True}
        ]
        return {
            "code": "east",
            "name": "East",
            "slug": "east",
            "address_line1": "1 East Rd",
            "city": "Riverton",
            "hours": hours,
            **kw,
        }

    def test_create_with_hours_and_default_flip(self, admin, branch):
        res = admin.post("/api/v1/admin/branches/", self.payload(is_default=True), format="json")
        assert res.status_code == 201 and len(res.json()["hours"]) == 7
        assert Branch.objects.filter(is_default=True).get().code == "east"
        branch.refresh_from_db()
        assert branch.is_default is False

    def test_hours_validation(self, admin):
        bad = self.payload()
        bad["hours"][0] = {"weekday": 0, "opens": "20:00", "closes": "08:00", "is_closed": False}
        assert admin.post("/api/v1/admin/branches/", bad, format="json").status_code == 400
        dup = self.payload()
        dup["hours"].append({"weekday": 0, "opens": "08:00", "closes": "09:00", "is_closed": False})
        assert admin.post("/api/v1/admin/branches/", dup, format="json").status_code == 400

    def test_update_replaces_hours_and_is_audited_with_before_after(self, admin, branch):
        res = admin.patch(
            f"/api/v1/admin/branches/{branch.id}/",
            {
                "name": "Central Market",
                "hours": [{"weekday": 0, "opens": "06:00", "closes": "23:00", "is_closed": False}],
            },
            format="json",
        )
        assert res.status_code == 200 and [h["opens"] for h in res.json()["hours"]] == ["06:00:00"]
        entry = AuditLog.objects.filter(action="branch.updated").get()
        assert (
            entry.before["name"] == "Central"
            and entry.after["name"] == "Central Market"
            and entry.actor.role == "ADMIN"
        )

    def test_branch_with_orders_or_stock_cannot_be_deleted(self, admin, branch, order_factory):
        order_factory([])
        res = admin.delete(f"/api/v1/admin/branches/{branch.id}/")
        assert res.status_code == 409 and res.json()["error"]["code"] == "INVALID_STATE"
        fresh = Branch.objects.create(code="tmp", name="Tmp", slug="tmp", address_line1="x", city="y")
        assert admin.delete(f"/api/v1/admin/branches/{fresh.id}/").status_code == 204
        assert AuditLog.objects.filter(action="branch.deleted", target_id=str(fresh.id)).exists()


class TestZonesAndSlots:
    def test_zone_normalises_and_requires_coverage(self, admin, branch):
        res = admin.post(
            "/api/v1/admin/zones/",
            {
                "branch": branch.id,
                "name": "Z",
                "postcode_prefixes": ["rw 3", "RW3", " rw4 "],
                "areas": ["Old Town ", "old town"],
                "delivery_fee": "3.50",
            },
            format="json",
        )
        assert (
            res.status_code == 201
            and res.json()["postcode_prefixes"] == ["RW3", "RW4"]
            and res.json()["areas"] == ["old town"]
        )
        assert (
            admin.post(
                "/api/v1/admin/zones/", {"branch": branch.id, "name": "Empty", "delivery_fee": "1"}, format="json"
            ).status_code
            == 400
        )

    def test_changing_the_zone_fee_updates_future_slots_without_their_own_override(self, admin, branch, zone):
        future = timezone.localdate() + dt.timedelta(days=4)
        plain = DeliverySlot.objects.create(
            branch=branch,
            zone=zone,
            kind="DELIVERY",
            date=future,
            start_time=dt.time(9),
            end_time=dt.time(11),
            capacity=5,
            fee=D("4.00"),
        )
        tpl = SlotTemplate.objects.create(
            branch=branch,
            zone=zone,
            kind="DELIVERY",
            weekday=0,
            start_time=dt.time(12),
            end_time=dt.time(14),
            capacity=5,
            fee=D("9.00"),
        )
        overridden = DeliverySlot.objects.create(
            branch=branch,
            zone=zone,
            kind="DELIVERY",
            date=future,
            start_time=dt.time(12),
            end_time=dt.time(14),
            capacity=5,
            fee=D("9.00"),
            template=tpl,
        )
        assert (
            admin.patch(f"/api/v1/admin/zones/{zone.id}/", {"delivery_fee": "6.00"}, format="json").status_code == 200
        )
        plain.refresh_from_db(), overridden.refresh_from_db()
        assert plain.fee == D("6.00") and overridden.fee == D("9.00")

    def test_template_rules(self, admin, branch, zone, second_branch):
        base = {
            "branch": branch.id,
            "zone": zone.id,
            "kind": "DELIVERY",
            "weekday": 2,
            "start_time": "09:00",
            "end_time": "11:00",
            "capacity": 6,
        }
        assert admin.post("/api/v1/admin/slot-templates/", base, format="json").status_code == 201
        assert (
            admin.post(
                "/api/v1/admin/slot-templates/", {**base, "start_time": "12:00", "end_time": "11:00"}, format="json"
            ).status_code
            == 400
        )
        assert (
            admin.post("/api/v1/admin/slot-templates/", {**base, "zone": None}, format="json").status_code == 400
        )  # delivery needs a zone
        assert (
            admin.post("/api/v1/admin/slot-templates/", {**base, "branch": second_branch.id}, format="json").status_code
            == 400
        )  # zone from another branch

    def test_generation_respects_hours_and_closures_and_is_idempotent(self, admin, branch, zone):
        today = timezone.localdate()
        wd = (today + dt.timedelta(days=1)).weekday()
        SlotTemplate.objects.create(
            branch=branch,
            zone=zone,
            kind="DELIVERY",
            weekday=wd,
            start_time=dt.time(9),
            end_time=dt.time(11),
            capacity=5,
        )
        SlotTemplate.objects.create(
            branch=branch,
            zone=zone,
            kind="DELIVERY",
            weekday=wd,
            start_time=dt.time(5),
            end_time=dt.time(6),
            capacity=5,
        )  # before opening (07:00)
        first = admin.post(
            "/api/v1/admin/slots/generate/", {"branch_id": branch.id, "days_ahead": 2}, format="json"
        ).json()["created"]
        assert first == 1 and DeliverySlot.objects.filter(start_time=dt.time(5)).count() == 0
        assert (
            admin.post(
                "/api/v1/admin/slots/generate/", {"branch_id": branch.id, "days_ahead": 2}, format="json"
            ).json()["created"]
            == 0
        )
        BranchClosure.objects.create(branch=branch, date=today + dt.timedelta(days=1 + 7), reason="holiday")
        admin.post("/api/v1/admin/slots/generate/", {"branch_id": branch.id, "days_ahead": 10}, format="json")
        assert not DeliverySlot.objects.filter(date=today + dt.timedelta(days=8)).exists()

    def test_capacity_cannot_drop_below_bookings_and_booked_slots_cannot_be_deleted(self, admin, branch, zone):
        slot = DeliverySlot.objects.create(
            branch=branch,
            zone=zone,
            kind="DELIVERY",
            date=timezone.localdate() + dt.timedelta(days=2),
            start_time=dt.time(9),
            end_time=dt.time(11),
            capacity=5,
            booked=3,
        )
        res = admin.patch(f"/api/v1/admin/slots/{slot.id}/", {"capacity": 2}, format="json")
        assert res.status_code == 400 and "already booked" in str(res.json())
        assert (
            admin.patch(f"/api/v1/admin/slots/{slot.id}/", {"capacity": 3, "is_open": False}, format="json").status_code
            == 200
        )
        assert admin.delete(f"/api/v1/admin/slots/{slot.id}/").status_code == 409
        assert (
            admin.patch(
                f"/api/v1/admin/slots/{slot.id}/", {"booked": 0, "date": "2030-01-01"}, format="json"
            ).status_code
            == 200
        )
        slot.refresh_from_db()
        assert slot.booked == 3 and slot.date != dt.date(2030, 1, 1)  # read-only fields are not mass-assignable

    def test_closing_a_branch_day_closes_open_slots_unless_customers_booked_them(self, admin, branch, zone):
        day = timezone.localdate() + dt.timedelta(days=5)
        free = DeliverySlot.objects.create(
            branch=branch, zone=zone, kind="DELIVERY", date=day, start_time=dt.time(9), end_time=dt.time(11), capacity=5
        )
        assert (
            admin.post(
                "/api/v1/admin/closures/",
                {"branch": branch.id, "date": day.isoformat(), "reason": "stock take"},
                format="json",
            ).status_code
            == 201
        )
        free.refresh_from_db()
        assert free.is_open is False
        day2 = day + dt.timedelta(days=1)
        DeliverySlot.objects.create(
            branch=branch,
            zone=zone,
            kind="DELIVERY",
            date=day2,
            start_time=dt.time(9),
            end_time=dt.time(11),
            capacity=5,
            booked=1,
        )
        res = admin.post("/api/v1/admin/closures/", {"branch": branch.id, "date": day2.isoformat()}, format="json")
        assert res.status_code == 409 and "already booked" in res.json()["error"]["message"]
        assert not BranchClosure.objects.filter(date=day2).exists()  # the whole request rolled back? (see below)


class TestConcurrentDuplicates:
    def test_a_unique_constraint_race_is_a_409_not_a_500_and_leaves_no_audit_entry(self, admin, monkeypatch):
        """Two staff creating the same record at the same instant: the loser must get an actionable 409."""
        from django.db import IntegrityError
        from rest_framework import serializers as drf_serializers

        original = drf_serializers.ModelSerializer.save

        def racing_save(self, **kwargs):
            if self.Meta.model is Branch:
                raise IntegrityError("duplicate key value violates unique constraint")
            return original(self, **kwargs)

        monkeypatch.setattr(drf_serializers.ModelSerializer, "save", racing_save)
        before = AuditLog.objects.count()
        res = admin.post("/api/v1/admin/branches/", TestBranchesAndHours().payload(), format="json")
        assert res.status_code == 409, res.content
        assert res.json()["error"]["code"] == "INVALID_STATE"
        assert AuditLog.objects.count() == before
