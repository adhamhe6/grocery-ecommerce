// Response shapes of the staff purchasing API (backend/apps/purchasing/admin_api.py). Money and quantities are decimal strings.

export type SupplierStatus = "ACTIVE" | "ON_HOLD" | "INACTIVE";

export const SUPPLIER_STATUSES: [SupplierStatus, string][] = [["ACTIVE", "Active"], ["ON_HOLD", "On hold"], ["INACTIVE", "Inactive"]];

export interface Supplier {
  id: number;
  code: string;
  name: string;
  contact_name: string;
  email: string;
  phone: string;
  address: string;
  status: SupplierStatus;
  lead_time_days: number;
  notes: string;
  product_count: number;
  is_demo: boolean;
}

export interface SupplierProductRow {
  product_id: number;
  sku: string;
  name: string;
  supplier_sku: string;
  unit_cost: string | null;
}

/** Percentages are strings with one decimal ("93.3") or null when there is nothing to measure. */
export interface SupplierPerformance {
  orders: number;
  receipts: number;
  fill_rate: string | null;
  rejection_rate: string | null;
  on_time_rate: string | null;
}

export type POStatus = "DRAFT" | "SUBMITTED" | "CONFIRMED" | "PARTIALLY_RECEIVED" | "RECEIVED" | "CANCELLED";

export const PO_STATUSES: [POStatus, string][] = [
  ["DRAFT", "Draft"], ["SUBMITTED", "Submitted"], ["CONFIRMED", "Confirmed by supplier"], ["PARTIALLY_RECEIVED", "Partially received"], ["RECEIVED", "Received"], ["CANCELLED", "Cancelled"],
];

export interface PurchaseOrderRow {
  id: number;
  number: string;
  supplier: string;
  supplier_id: number;
  branch: string;
  branch_id: number;
  status: POStatus;
  status_label: string;
  expected_date: string | null;
  submitted_at: string | null;
  created_at: string;
  total_cost: string;
  line_count: number;
}

export interface PurchaseOrderLine {
  id: number;
  product_id: number;
  sku: string;
  name: string;
  unit: string;
  tracks_batches: boolean;
  qty_ordered: string;
  unit_cost: string;
  qty_received: string;
  qty_rejected: string;
  outstanding: string;
}

export interface ReceiptLine { product: string; accepted: string; rejected: string; reject_reason: string; lot: string; expiry: string | null }
export interface Receipt { number: string; at: string; by: string; delivery_note: string; lines: ReceiptLine[] }

export interface PurchaseOrder extends PurchaseOrderRow {
  notes: string;
  is_demo: boolean;
  lines: PurchaseOrderLine[];
  receipts: Receipt[];
  /** Present on the response to POST …/receive/ only. */
  receipt?: { number: string; replayed: boolean };
}

export interface ReplenishmentSupplier { id: number; name: string; unit_cost: string | null; lead_time_days: number }
export interface ReplenishmentRow {
  product_id: number;
  sku: string;
  name: string;
  unit: string;
  available: string;
  threshold: string;
  on_order: string;
  avg_daily_sales: string | null;
  days_of_cover: string | null;
  suggested_qty: string;
  suppliers: ReplenishmentSupplier[];
}
