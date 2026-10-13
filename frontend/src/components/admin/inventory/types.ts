// Response shapes of the staff inventory API (backend/apps/inventory/admin_api.py). Quantities are decimal strings.

export type StockStatus = "OK" | "LOW" | "OUT";

export interface StockRow {
  id: number;
  product_id: number;
  sku: string;
  name: string;
  unit: string;
  category: string;
  branch_id: number;
  branch: string;
  tracks_batches: boolean;
  on_hand: string;
  reserved: string;
  available: string;
  low_stock_threshold: string;
  reorder_quantity: string;
  status: StockStatus;
  last_movement_at: string | null;
}

export type MovementKind = "RECEIPT" | "SALE" | "ADJUSTMENT" | "WASTE" | "TRANSFER_OUT" | "TRANSFER_IN" | "RETURN";

export interface MovementRow {
  id: number;
  at: string;
  kind: MovementKind;
  kind_label: string;
  product_id: number;
  sku: string;
  name: string;
  branch: string;
  qty_delta: string;
  on_hand_after: string;
  lot: string;
  reason: string;
  note: string;
  by: string;
  ref: string;
}

export type BatchStatus = "ACTIVE" | "QUARANTINED" | "EXPIRED" | "DEPLETED";
export type QualityStatus = "PENDING" | "PASSED" | "FAILED";
export type ExpiryKind = "BEST_BEFORE" | "USE_BY";

export interface BatchRow {
  id: number;
  product_id: number;
  sku: string;
  name: string;
  unit: string;
  branch: string;
  branch_id: number;
  lot_code: string;
  supplier: string | null;
  received_on: string;
  expiry_date: string | null;
  expiry_kind: ExpiryKind;
  sellable_until: string | null;
  days_to_expiry: number | null;
  qty_received: string;
  qty_remaining: string;
  qty_reserved: string;
  unit_cost: string | null;
  value: string | null;
  status: BatchStatus;
  quality_status: QualityStatus;
  is_demo: boolean;
  risk: "EXPIRED" | "TODAY_TOMORROW" | "SOON" | "WATCH" | "OK" | "NONE";
  can_sell: boolean;
}

export type ExpiryGroupKey = "expired" | "today_tomorrow" | "within_3" | "within_7";

export interface ExpiryData {
  today: string;
  groups: Record<ExpiryGroupKey, BatchRow[]>;
  totals: Record<ExpiryGroupKey, { batches: number; value: string }>;
}

export const WASTE_REASONS: [string, string][] = [
  ["EXPIRED", "Expired"],
  ["DAMAGED", "Damaged"],
  ["SPOILED", "Spoiled"],
  ["QUALITY", "Failed quality check"],
  ["OTHER", "Other"],
];

export const MOVEMENT_KINDS: [MovementKind, string][] = [
  ["RECEIPT", "Goods received"],
  ["SALE", "Sold (picked)"],
  ["ADJUSTMENT", "Adjustment"],
  ["WASTE", "Waste / spoilage"],
  ["TRANSFER_OUT", "Transfer out"],
  ["TRANSFER_IN", "Transfer in"],
  ["RETURN", "Returned to stock"],
];
