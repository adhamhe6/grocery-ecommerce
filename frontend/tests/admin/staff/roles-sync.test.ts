import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_CAPABILITIES, GLOBAL_ROLES, groupCapabilities, mayAssignRole, mayManage, PRIVILEGED_ROLES, ROLE_CAPABILITIES, STAFF_ROLES } from "@/components/admin/staff/roles";

// The role matrix in the staff screen is a reference copy. These tests compare it with apps/core/rbac.py and the staff
// guard rails in apps/accounts/admin_api.py (skipped when the backend folder isn't next to the frontend).
const RBAC = path.resolve(process.cwd(), "../backend/apps/core/rbac.py");
const STAFF_API = path.resolve(process.cwd(), "../backend/apps/accounts/admin_api.py");
const quoted = (text: string) => [...text.matchAll(/"([a-z_]+\.[a-z_]+)"/g)].map((m) => m[1]);

function parseRbac(src: string) {
  const all = quoted(src.match(/ALL_CAPABILITIES = \{([\s\S]*?)\n\}/)![1]);
  const block = src.match(/ROLE_CAPABILITIES: dict\[str, set\[str\]\] = \{([\s\S]*?)\n\}\n/)![1];
  const entries: Record<string, string> = {};
  let current = "";
  for (const line of block.split("\n")) {
    const m = /^ {4}([A-Z_]+): ?(.*)$/.exec(line);
    if (m) { current = m[1]; entries[current] = m[2]; } else if (current) entries[current] += `\n${line}`;
  }
  const roles: Record<string, string[]> = {};
  for (const [role, text] of Object.entries(entries)) roles[role] = /ALL_CAPABILITIES|_ADMIN/.test(text) ? [...all] : quoted(text);
  const choices = [...src.match(/ROLE_CHOICES = \[([\s\S]*?)\n\]/)![1].matchAll(/\(([A-Z_]+), "([^"]+)"\)/g)].map((m) => ({ value: m[1], label: m[2] }));
  const globals = [...src.match(/GLOBAL_ROLES = \{([^}]*)\}/)![1].matchAll(/[A-Z_]+/g)].map((m) => m[0]);
  return { all, roles, choices, globals };
}

describe.skipIf(!fs.existsSync(RBAC))("staff role reference matches backend/apps/core/rbac.py", () => {
  const rbac = parseRbac(fs.readFileSync(RBAC, "utf8"));

  it("lists the same capabilities", () => {
    expect([...ALL_CAPABILITIES].sort()).toEqual([...rbac.all].sort());
  });
  it("offers the same staff roles, labels and order (everything except customers)", () => {
    expect(STAFF_ROLES).toEqual(rbac.choices.filter((c) => c.value !== "CUSTOMER"));
  });
  it("gives every role exactly the same capabilities", () => {
    for (const { value } of STAFF_ROLES) expect([...(ROLE_CAPABILITIES[value] ?? [])].sort(), value).toEqual([...(rbac.roles[value] ?? [])].sort());
  });
  it("agrees on which roles see every store", () => {
    expect([...GLOBAL_ROLES].sort()).toEqual([...rbac.globals].sort());
  });
});

describe.skipIf(!fs.existsSync(STAFF_API))("privileged roles match the staff API's guard rails", () => {
  it("only a super admin touches ADMIN and SUPER_ADMIN accounts", () => {
    const src = fs.readFileSync(STAFF_API, "utf8");
    const names = [...src.match(/PRIVILEGED_ROLES = \{([^}]*)\}/)![1].matchAll(/rbac\.([A-Z_]+)/g)].map((m) => m[1]);
    expect([...PRIVILEGED_ROLES].sort()).toEqual([...names].sort());
  });
});

describe("role helpers", () => {
  it("who may manage or assign which role", () => {
    expect(mayManage("SUPER_ADMIN", "ADMIN")).toBe(true);
    expect(mayManage("ADMIN", "ADMIN")).toBe(false);
    expect(mayManage("ADMIN", "SUPER_ADMIN")).toBe(false);
    expect(mayManage("ADMIN", "STORE_MANAGER")).toBe(true);
    expect(mayAssignRole("ADMIN", "ADMIN")).toBe(false);
    expect(mayAssignRole("ADMIN", "CUSTOMER_SUPPORT")).toBe(true);
    expect(mayAssignRole("SUPER_ADMIN", "SUPER_ADMIN")).toBe(true);
  });
  it("groups capabilities by area in first-seen order", () => {
    expect(groupCapabilities(["orders.read", "orders.refund", "finance.read"])).toEqual([
      { area: "orders", label: "Orders", actions: ["read", "refund"] },
      { area: "finance", label: "Finance", actions: ["read"] },
    ]);
  });
});
