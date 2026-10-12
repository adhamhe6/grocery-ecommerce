"""Role → capability matrix. Enforced server-side by `apps.core.permissions`.

Capabilities are coarse, verb-based strings. Branch scoping is handled separately: roles listed in
`GLOBAL_ROLES` see every branch, all other staff roles only see branches they are assigned to.
"""

from __future__ import annotations

CUSTOMER = "CUSTOMER"
SUPER_ADMIN = "SUPER_ADMIN"
ADMIN = "ADMIN"
STORE_MANAGER = "STORE_MANAGER"
INVENTORY_MANAGER = "INVENTORY_MANAGER"
PURCHASING_MANAGER = "PURCHASING_MANAGER"
FULFILMENT_STAFF = "FULFILMENT_STAFF"
CUSTOMER_SUPPORT = "CUSTOMER_SUPPORT"
MARKETING_MANAGER = "MARKETING_MANAGER"

ROLE_CHOICES = [
    (CUSTOMER, "Customer"),
    (SUPER_ADMIN, "Super admin"),
    (ADMIN, "Admin"),
    (STORE_MANAGER, "Store manager"),
    (INVENTORY_MANAGER, "Inventory manager"),
    (PURCHASING_MANAGER, "Purchasing manager"),
    (FULFILMENT_STAFF, "Fulfilment staff"),
    (CUSTOMER_SUPPORT, "Customer support"),
    (MARKETING_MANAGER, "Marketing manager"),
]
STAFF_ROLES = {r for r, _ in ROLE_CHOICES} - {CUSTOMER}
GLOBAL_ROLES = {SUPER_ADMIN, ADMIN}

ALL_CAPABILITIES = {
    "catalog.read",
    "catalog.write",
    "catalog.availability",
    "catalog.merchandise",
    "inventory.read",
    "inventory.adjust",
    "inventory.waste",
    "inventory.transfer",
    "inventory.batches",
    "purchasing.read",
    "purchasing.write",
    "purchasing.receive",
    "orders.read",
    "orders.fulfil",
    "orders.manage",
    "orders.refund",
    "customers.read",
    "customers.manage",
    "support.manage",
    "promotions.manage",
    "content.manage",
    "finance.read",
    "finance.refund",
    "reports.read",
    "reports.export",
    "branches.manage",
    "slots.manage",
    "staff.manage",
    "settings.manage",
    "audit.read",
}

_ADMIN = ALL_CAPABILITIES

ROLE_CAPABILITIES: dict[str, set[str]] = {
    CUSTOMER: set(),
    SUPER_ADMIN: set(ALL_CAPABILITIES),
    ADMIN: set(_ADMIN),
    STORE_MANAGER: {
        "catalog.read",
        "catalog.availability",
        "inventory.read",
        "inventory.adjust",
        "inventory.waste",
        "inventory.transfer",
        "inventory.batches",
        "purchasing.read",
        "orders.read",
        "orders.fulfil",
        "orders.manage",
        "orders.refund",
        "customers.read",
        "support.manage",
        "finance.read",
        "reports.read",
        "reports.export",
        "slots.manage",
    },
    INVENTORY_MANAGER: {
        "catalog.read",
        "catalog.availability",
        "inventory.read",
        "inventory.adjust",
        "inventory.waste",
        "inventory.transfer",
        "inventory.batches",
        "purchasing.read",
        "reports.read",
    },
    PURCHASING_MANAGER: {
        "catalog.read",
        "inventory.read",
        "inventory.batches",
        "purchasing.read",
        "purchasing.write",
        "purchasing.receive",
        "reports.read",
    },
    FULFILMENT_STAFF: {"catalog.read", "inventory.read", "orders.read", "orders.fulfil"},
    CUSTOMER_SUPPORT: {
        "catalog.read",
        "orders.read",
        "orders.manage",
        "orders.refund",
        "customers.read",
        "customers.manage",
        "support.manage",
        "finance.read",
    },
    MARKETING_MANAGER: {
        "catalog.read",
        "catalog.merchandise",
        "promotions.manage",
        "content.manage",
        "reports.read",
    },
}


def capabilities_for(role: str) -> set[str]:
    return ROLE_CAPABILITIES.get(role, set())


def role_has(role: str, capability: str) -> bool:
    return capability in capabilities_for(role)
