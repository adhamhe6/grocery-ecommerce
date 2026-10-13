// A reference copy of the role -> capability matrix in backend/apps/core/rbac.py.
//
// The API does not serve this matrix: /me/permissions/ only reports the signed-in person's own capabilities, and the
// staff endpoint takes a role name. So the dashboard carries a copy to show "what can this role do?" while choosing a
// role. It is display-only (the server decides what anyone can actually do) and tests/admin/staff/roles-sync.test.ts
// compares it with rbac.py so it cannot silently drift.

export interface RoleInfo { value: string; label: string }

/** Staff roles as accepted by POST/PATCH /staff/ (rbac.ROLE_CHOICES without CUSTOMER), in the same order. */
export const STAFF_ROLES: RoleInfo[] = [
  { value: "SUPER_ADMIN", label: "Super admin" },
  { value: "ADMIN", label: "Admin" },
  { value: "STORE_MANAGER", label: "Store manager" },
  { value: "INVENTORY_MANAGER", label: "Inventory manager" },
  { value: "PURCHASING_MANAGER", label: "Purchasing manager" },
  { value: "FULFILMENT_STAFF", label: "Fulfilment staff" },
  { value: "CUSTOMER_SUPPORT", label: "Customer support" },
  { value: "MARKETING_MANAGER", label: "Marketing manager" },
];

/** Roles that see every store regardless of assignments (rbac.GLOBAL_ROLES). */
export const GLOBAL_ROLES = ["SUPER_ADMIN", "ADMIN"];
/** Only a super admin may create or change these accounts (StaffViewSet.enforce_rules). */
export const PRIVILEGED_ROLES = ["SUPER_ADMIN", "ADMIN"];

export const ALL_CAPABILITIES = [
  "catalog.read", "catalog.write", "catalog.availability", "catalog.merchandise",
  "inventory.read", "inventory.adjust", "inventory.waste", "inventory.transfer", "inventory.batches",
  "purchasing.read", "purchasing.write", "purchasing.receive",
  "orders.read", "orders.fulfil", "orders.manage", "orders.refund",
  "customers.read", "customers.manage", "support.manage",
  "promotions.manage", "content.manage",
  "finance.read", "finance.refund", "reports.read", "reports.export",
  "branches.manage", "slots.manage", "staff.manage", "settings.manage", "audit.read",
];

export const ROLE_CAPABILITIES: Record<string, string[]> = {
  SUPER_ADMIN: ALL_CAPABILITIES,
  ADMIN: ALL_CAPABILITIES,
  STORE_MANAGER: [
    "catalog.read", "catalog.availability", "inventory.read", "inventory.adjust", "inventory.waste", "inventory.transfer", "inventory.batches",
    "purchasing.read", "orders.read", "orders.fulfil", "orders.manage", "orders.refund", "customers.read", "support.manage",
    "finance.read", "reports.read", "reports.export", "slots.manage",
  ],
  INVENTORY_MANAGER: ["catalog.read", "catalog.availability", "inventory.read", "inventory.adjust", "inventory.waste", "inventory.transfer", "inventory.batches", "purchasing.read", "reports.read"],
  PURCHASING_MANAGER: ["catalog.read", "inventory.read", "inventory.batches", "purchasing.read", "purchasing.write", "purchasing.receive", "reports.read"],
  FULFILMENT_STAFF: ["catalog.read", "inventory.read", "orders.read", "orders.fulfil"],
  CUSTOMER_SUPPORT: ["catalog.read", "orders.read", "orders.manage", "orders.refund", "customers.read", "customers.manage", "support.manage", "finance.read"],
  MARKETING_MANAGER: ["catalog.read", "catalog.merchandise", "promotions.manage", "content.manage", "reports.read"],
};

const AREA_LABELS: Record<string, string> = {
  catalog: "Catalogue", inventory: "Inventory", purchasing: "Purchasing", orders: "Orders", customers: "Customers", support: "Support cases",
  promotions: "Promotions", content: "Content", finance: "Finance", reports: "Reports", branches: "Stores", slots: "Delivery slots",
  staff: "Staff", settings: "Settings", audit: "Audit log",
};

export interface CapabilityGroup { area: string; label: string; actions: string[] }

/** "orders.read", "orders.refund" -> { label: "Orders", actions: ["read", "refund"] }, in the order areas first appear. */
export function groupCapabilities(caps: string[]): CapabilityGroup[] {
  const groups = new Map<string, CapabilityGroup>();
  for (const cap of caps) {
    const [area, action = ""] = cap.split(".");
    if (!groups.has(area)) groups.set(area, { area, label: AREA_LABELS[area] ?? area, actions: [] });
    groups.get(area)!.actions.push(action);
  }
  return [...groups.values()];
}

export const roleLabel = (role: string) => STAFF_ROLES.find((r) => r.value === role)?.label ?? role;
export const isGlobalRole = (role: string) => GLOBAL_ROLES.includes(role);

/** Mirrors StaffViewSet.enforce_rules for the "who may touch whom" part, so the UI can explain instead of letting the server refuse. */
export function mayManage(actorRole: string, targetRole: string): boolean {
  return actorRole === "SUPER_ADMIN" || !PRIVILEGED_ROLES.includes(targetRole);
}
export function mayAssignRole(actorRole: string, newRole: string): boolean {
  return actorRole === "SUPER_ADMIN" || !PRIVILEGED_ROLES.includes(newRole);
}
