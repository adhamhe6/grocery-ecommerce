import { describe, expect, it } from "vitest";
import { buildStaffCreate, buildStaffPatch, EMPTY_STAFF_FORM, formFromStaff, staffSignature, storesSummary, validateStaffForm, type StaffRow } from "@/components/admin/staff/staff-model";

const row: StaffRow = {
  id: 7, email: "sam@example.com", full_name: "Sam Stone", phone: "555-0100", role: "STORE_MANAGER", role_label: "Store manager", is_active: true,
  all_branches: false, branches: [2, 1], has_password: true, last_login: null, created_at: "2026-01-01T00:00:00Z",
};

describe("buildStaffPatch", () => {
  it("is empty when nothing changed (branch order doesn't matter)", () => {
    const initial = formFromStaff(row);
    expect(buildStaffPatch(initial, { ...initial, branches: [1, 2] })).toEqual({});
    expect(buildStaffPatch(initial, { ...initial, full_name: "  Sam Stone " })).toEqual({});
  });
  it("sends only what changed and never the email", () => {
    const initial = formFromStaff(row);
    const patch = buildStaffPatch(initial, { ...initial, email: "other@example.com", role: "INVENTORY_MANAGER", branches: [3, 1], phone: "" });
    expect(patch).toEqual({ role: "INVENTORY_MANAGER", branches: [1, 3], phone: "" });
    expect(patch).not.toHaveProperty("email");
  });
  it("includes all_branches only when toggled", () => {
    const initial = formFromStaff(row);
    expect(buildStaffPatch(initial, { ...initial, all_branches: true })).toEqual({ all_branches: true });
  });
});

describe("buildStaffCreate", () => {
  it("trims, sorts store ids and never includes a password", () => {
    const body = buildStaffCreate({ email: " new@example.com ", full_name: " New Person ", phone: " 555 ", role: "STORE_MANAGER", all_branches: false, branches: [3, 1] });
    expect(body).toEqual({ email: "new@example.com", full_name: "New Person", phone: "555", role: "STORE_MANAGER", all_branches: false, branches: [1, 3] });
    expect(Object.keys(body)).not.toContain("password");
  });
});

describe("validateStaffForm", () => {
  it("requires email, name and role to create", () => {
    expect(Object.keys(validateStaffForm(EMPTY_STAFF_FORM, "create")).sort()).toEqual(["email", "full_name", "role"]);
    expect(validateStaffForm({ ...EMPTY_STAFF_FORM, email: "nope", full_name: "A B", role: "ADMIN" }, "create").email).toMatch(/email/);
    expect(validateStaffForm({ ...EMPTY_STAFF_FORM, email: "a@b.co", full_name: "Al", role: "ADMIN" }, "create")).toEqual({});
  });
  it("doesn't ask for the (read-only) email when editing", () => {
    expect(validateStaffForm({ ...formFromStaff(row), email: "" }, "edit")).toEqual({});
  });
});

describe("storesSummary", () => {
  const name = (id: number) => `Store ${id}`;
  it("explains global roles, all-store staff, assigned stores and the empty case", () => {
    expect(storesSummary({ role: "ADMIN", all_branches: false, branches: [] }, name)).toBe("All stores");
    expect(storesSummary({ role: "STORE_MANAGER", all_branches: true, branches: [1] }, name)).toBe("All stores");
    expect(storesSummary({ role: "STORE_MANAGER", all_branches: false, branches: [1, 2] }, name)).toBe("Store 1, Store 2");
    expect(storesSummary({ role: "STORE_MANAGER", all_branches: false, branches: [] }, name)).toBe("No stores assigned");
  });
});

describe("staffSignature", () => {
  it("changes when anything the form shows changes", () => {
    expect(staffSignature(row)).toBe(staffSignature({ ...row }));
    expect(staffSignature(row)).not.toBe(staffSignature({ ...row, is_active: false }));
    expect(staffSignature(row)).not.toBe(staffSignature({ ...row, branches: [1] }));
  });
});
