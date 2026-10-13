import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import * as React from "react";
import { vi } from "vitest";
import type { OrderDetail, StaffItem } from "@/components/admin/orders/types";
import { ToastProvider } from "@/components/ui/toast";
import { AdminProvider, type AdminPermissions } from "@/lib/admin";
import { StoreProvider } from "@/lib/hooks";
import type { StoreConfig } from "@/lib/types";

export { apiError, mockApi } from "../../account/helpers";

export const store = { name: "Orchard Row", currency: "USD", locale: "en-US", timezone: "UTC" } as StoreConfig;

export const MANAGER_CAPS = ["orders.read", "orders.fulfil", "orders.manage", "orders.refund", "customers.read", "support.manage"];
export const PICKER_CAPS = ["orders.read", "orders.fulfil"];

export function perms(capabilities: string[]): AdminPermissions {
  return { id: 7, email: "staff@example.com", full_name: "Sam Staff", role: "STORE_MANAGER", role_label: "Store manager", capabilities, branch_scope: { global: true, branch_ids: null, branches: [{ id: 1, code: "MAIN", name: "Main store" }] } };
}

export function renderAdmin(ui: React.ReactElement, caps: string[] = MANAGER_CAPS) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 }, mutations: { retry: false } } });
  const spy = vi.spyOn(client, "invalidateQueries");
  const view = render(
    <StoreProvider store={store}>
      <QueryClientProvider client={client}>
        <ToastProvider><AdminProvider perms={perms(caps)}>{ui}</AdminProvider></ToastProvider>
      </QueryClientProvider>
    </StoreProvider>,
  );
  return { client, invalidated: spy, ...view };
}

export function item(over: Partial<StaffItem> = {}): StaffItem {
  return {
    id: 11, product_id: 5, name: "Cheddar", sku: "CH-1", image: null, unit: "kg", storage: "CHILLED", category: "Cheese", ordered_qty: "1.5", picked_qty: null, unit_price: "12.00",
    line_total_estimated: "18.00", line_total_final: null, status: "PENDING", is_variable_weight: true, is_substitute: false, substitute_for: null, substitution_pref: "INHERIT", picker_note: "", lots: [],
    tolerance: { min: "1.35", max: "1.65" }, ...over,
  };
}

export function order(over: Partial<OrderDetail> = {}): OrderDetail {
  return {
    number: "OR-1", status: "CONFIRMED", status_label: "Confirmed", payment_status: "PENDING_COLLECTION", payment_method: "COD", fulfilment_type: "DELIVERY", placed_at: "2026-10-12T09:00:00Z",
    slot_starts_at: "2026-10-12T14:00:00Z", slot_ends_at: "2026-10-12T16:00:00Z", customer: "Sam Shopper", is_guest: false, branch: "Main store", branch_id: 1, total: "14.00", final_total: null,
    item_count: 1, assigned_to: null, awaiting_customer: false, is_late: false, substitution_policy: "ALLOW",
    contact: { name: "Sam Shopper", email: "sam@example.com", phone: "+1 555 0101" },
    address: { recipient: "Sam", phone: "", line1: "1 Elm St", line2: "", city: "Springfield", area: "", postal_code: "12345", instructions: "" },
    customer_note: "", currency: "USD", items: [item()], substitutions: [],
    totals: { subtotal: "12.00", promo_savings: "0.00", coupon_code: "", coupon_discount: "0.00", delivery_fee: "2.00", tax_total: "0.00", total: "14.00", max_charge: "15.00", final_total: null },
    policy: { weight_tolerance_percent: "10.00", substitution_price_cap: true }, history: [], payments: [], refunds: [], cases: [], allowed_transitions: ["CANCELLED", "PICKING"], ...over,
  };
}

export function capturedOrder(over: Partial<OrderDetail> = {}): OrderDetail {
  return order({
    status: "COMPLETED", status_label: "Completed", payment_status: "PAID", payment_method: "CARD", allowed_transitions: [],
    payments: [{ id: 1, provider: "demo", method: "CARD", state: "CAPTURED", amount: "20.00", captured: "20.00", refunded: "0.00", attempt: 1, reference: "demo_1", failure: "", is_demo: true }],
    ...over,
  });
}
