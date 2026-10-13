// Shapes returned by the staff orders / cases / customers API (see backend/apps/orders/admin_api.py,
// admin_cases.py and backend/apps/accounts/admin_api.py). Money = decimal strings (2 dp), quantities = decimal strings (<= 3 dp).

export type OrderStatusValue =
  | "PENDING_PAYMENT" | "CONFIRMED" | "PICKING" | "PACKING" | "READY_FOR_PICKUP" | "READY_FOR_DISPATCH"
  | "OUT_FOR_DELIVERY" | "COMPLETED" | "CANCELLED" | "PAYMENT_FAILED";
export type FulfilmentTypeValue = "DELIVERY" | "PICKUP";
export type SubstitutionPolicyValue = "ALLOW" | "CONTACT" | "NONE";
export type ItemStatusValue = "PENDING" | "PROPOSED" | "PICKED" | "SHORT" | "UNAVAILABLE" | "SUBSTITUTED" | "REMOVED";
export type StorageType = "AMBIENT" | "CHILLED" | "FROZEN";

export interface OrderRow {
  /** Orders are keyed by `number`; this optional field only lets the row type satisfy the shared DataTable's constraint. */
  id?: undefined;
  number: string;
  status: OrderStatusValue;
  status_label: string;
  payment_status: string;
  payment_method: "CARD" | "COD";
  fulfilment_type: FulfilmentTypeValue;
  placed_at: string;
  slot_starts_at: string | null;
  slot_ends_at: string | null;
  customer: string;
  is_guest: boolean;
  branch: string;
  branch_id: number;
  total: string;
  final_total: string | null;
  item_count: number | null;
  assigned_to: string | null;
  awaiting_customer: boolean;
  is_late: boolean;
  substitution_policy: SubstitutionPolicyValue;
}

export interface QueueRow extends OrderRow { lines: number; lines_done: number }
export interface QueueGroup { slot_starts_at: string | null; slot_ends_at: string | null; orders: QueueRow[] }
export interface QueueResponse { counts: Record<string, number>; groups: QueueGroup[] }

export interface Lot { lot: string; expiry: string | null; qty: string; state: string }

export interface StaffItem {
  id: number;
  product_id: number;
  name: string;
  sku: string;
  image: string | null;
  unit: string;
  storage: StorageType;
  category: string;
  ordered_qty: string;
  picked_qty: string | null;
  unit_price: string;
  line_total_estimated: string;
  line_total_final: string | null;
  status: ItemStatusValue;
  is_variable_weight: boolean;
  is_substitute: boolean;
  substitute_for: number | null;
  substitution_pref: "INHERIT" | "ALLOW" | "NONE";
  picker_note: string;
  lots: Lot[];
  tolerance: { min: string; max: string } | null;
}

export interface SubstitutionRow {
  id: number;
  item_id: number;
  original: string;
  substitute: string;
  status: "AWAITING_CUSTOMER" | "APPROVED" | "REJECTED" | "AUTO_APPROVED";
  policy: SubstitutionPolicyValue;
  charged_unit_price: string;
  list_unit_price: string;
  price_difference: string;
  reason: string;
}

export interface HistoryEntry { at: string; from: string; to: string; by: string; note: string; public_note: string }

export interface PaymentRow {
  id: number;
  provider: "demo" | "stripe" | "cod" | string;
  method: string;
  state: string;
  amount: string;
  captured: string;
  refunded: string;
  attempt: number;
  reference: string;
  failure: string;
  is_demo: boolean;
}

export interface RefundRow {
  id: number;
  amount: string;
  status: "PENDING" | "SUCCEEDED" | "FAILED";
  method: "PROVIDER" | "MANUAL";
  reason: string;
  reference: string;
  failure: string;
  created_at: string;
  completed_at: string | null;
}

export interface OrderTotals {
  subtotal: string;
  promo_savings: string;
  coupon_code: string;
  coupon_discount: string;
  delivery_fee: string;
  tax_total: string;
  total: string;
  max_charge: string;
  final_total: string | null;
}

export interface OrderDetail extends OrderRow {
  contact: { name: string; email: string; phone: string };
  address: { recipient: string; phone: string; line1: string; line2: string; city: string; area: string; postal_code: string; instructions: string } | null;
  customer_note: string;
  currency: string;
  items: StaffItem[];
  substitutions: SubstitutionRow[];
  totals: OrderTotals;
  policy: { weight_tolerance_percent: string; substitution_price_cap: boolean };
  history: HistoryEntry[];
  payments: PaymentRow[];
  refunds: RefundRow[];
  cases: { id: number; kind: string; status: string; created_at: string }[];
  allowed_transitions: string[];
  /** Only present on the response to POST …/refund/. */
  refund_result?: { id: number; status: string; message: string };
}

export interface SubstituteCandidate { product_id: number; name: string; brand: string; price: string; unit: string }
export interface SubstituteResponse { policy: SubstitutionPolicyValue; candidates: SubstituteCandidate[] }

// ------------------------------------------------------------------------------------------------ support cases
export type CaseStatusValue = "OPEN" | "IN_REVIEW" | "RESOLVED" | "REJECTED";
export type CaseResolutionValue = "NONE" | "REFUND" | "REPLACEMENT" | "GOODWILL";

export interface CaseRefund { id: number; amount: string; status: string; method: string; completed: boolean; message: string; created_at: string }

export interface SupportCase {
  id: number;
  order_number: string;
  order_status: string;
  payment_method: "CARD" | "COD";
  branch: { id: number; name: string };
  customer: { id: number | null; name: string };
  order_item: { id: number; name: string } | null;
  kind: string;
  kind_label: string;
  description: string;
  status: CaseStatusValue;
  resolution: CaseResolutionValue;
  refund_amount: string;
  refund_status: string | null;
  refunds: CaseRefund[];
  /** Detail only: what can still be refunded on the order (null = nothing collected). */
  refundable: string | null;
  staff_notes: string;
  handled_by: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

// ------------------------------------------------------------------------------------------------ customers
export interface CustomerRow {
  id: number;
  email: string;
  full_name: string;
  phone: string;
  is_active: boolean;
  marketing_opt_in: boolean;
  joined_at: string;
  orders_count: number;
  last_order_at: string | null;
  lifetime_spend: string;
}

export interface CustomerDetail extends CustomerRow {
  notify_order_emails: boolean;
  addresses: { id: number; label: string; recipient_name: string; phone: string; line1: string; line2: string; city: string; area: string; postal_code: string; instructions: string; is_default: boolean }[];
  orders: { number: string; status: OrderStatusValue; total: string; final_total: string | null; placed_at: string; branch: string; fulfilment_type: FulfilmentTypeValue }[];
  cases: { id: number; order_number: string; kind: string; status: CaseStatusValue; resolution: CaseResolutionValue; refund_amount: string; created_at: string; resolved_at: string | null }[];
}
