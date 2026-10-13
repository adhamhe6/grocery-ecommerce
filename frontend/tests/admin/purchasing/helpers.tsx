import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import * as React from "react";
import { ToastProvider } from "@/components/ui/toast";
import { AdminProvider, type AdminPermissions } from "@/lib/admin";
import { StoreProvider } from "@/lib/hooks";
import type { StoreConfig } from "@/lib/types";
import type { PurchaseOrder, PurchaseOrderLine } from "@/components/admin/purchasing/types";

export { apiError, mockApi } from "../../account/helpers";

export const store = { name: "Orchard Row", currency: "USD", locale: "en-US", timezone: "UTC" } as StoreConfig;
export const ALL_CAPS = [
  "inventory.read", "inventory.adjust", "inventory.waste", "inventory.transfer", "inventory.batches",
  "purchasing.read", "purchasing.write", "purchasing.receive", "branches.manage", "slots.manage", "catalog.read",
];

export function perms(capabilities: string[] = ALL_CAPS): AdminPermissions {
  return {
    id: 7, email: "staff@example.com", full_name: "Sam Staff", role: "ADMIN", role_label: "Admin", capabilities,
    branch_scope: { global: true, branch_ids: null, branches: [{ id: 1, code: "main", name: "Main store" }, { id: 2, code: "north", name: "North store" }] },
  };
}

export function renderAdmin(ui: React.ReactElement, caps: string[] = ALL_CAPS) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 }, mutations: { retry: false } } });
  const view = render(
    <StoreProvider store={store}>
      <QueryClientProvider client={client}>
        <ToastProvider><AdminProvider perms={perms(caps)}>{ui}</AdminProvider></ToastProvider>
      </QueryClientProvider>
    </StoreProvider>,
  );
  return { client, ...view };
}

export const list = <T,>(results: T[]) => ({ count: results.length, page: 1, page_size: 25, total_pages: 1, next: null, previous: null, results });

export const poLine = (over: Partial<PurchaseOrderLine> = {}): PurchaseOrderLine => ({
  id: 1, product_id: 10, sku: "YOG", name: "Yoghurt", unit: "ea", tracks_batches: true, qty_ordered: "40", unit_cost: "1.1000", qty_received: "0", qty_rejected: "0", outstanding: "40", ...over,
});

export const purchaseOrder = (over: Partial<PurchaseOrder> = {}): PurchaseOrder => ({
  id: 9, number: "PO-261012-ABCD", supplier: "Millbrook Dairy", supplier_id: 3, branch: "Main store", branch_id: 1, status: "SUBMITTED", status_label: "Submitted",
  expected_date: "2026-10-20", submitted_at: "2026-10-12T09:00:00Z", created_at: "2026-10-12T08:00:00Z", total_cost: "66.00", line_count: 2, notes: "", is_demo: false, receipts: [],
  lines: [poLine(), poLine({ id: 2, product_id: 11, sku: "RICE", name: "Rice 1kg", tracks_batches: false, qty_ordered: "20", outstanding: "20", unit_cost: "1.1000" })], ...over,
});
