// Shapes returned by backend/apps/payments/admin_api.py (money = decimal strings, never floats).

export interface PaymentRow {
  id: number;
  order: string; // order number
  branch: string;
  provider: string; // demo | stripe | cod
  method: string; // CARD | COD
  state: string;
  state_label: string;
  amount: string; // authorised / requested amount (what may be charged at most)
  captured: string;
  refunded: string;
  currency: string;
  reference: string; // provider reference (blank for cash on delivery until collected)
  attempt: number;
  failure_code: string;
  failure_message: string;
  created_at: string;
  captured_at: string | null;
  is_demo: boolean;
}

export interface PaymentEventBrief { at: string; type: string; event_id: string; outcome: string; error: string }
export interface PaymentRefundBrief { id: number; amount: string; status: string; method: string; reason: string; reference: string; created_at: string }
export interface PaymentDetail extends PaymentRow { events: PaymentEventBrief[]; refunds: PaymentRefundBrief[] }

export interface RefundRow {
  id: number;
  order: string;
  amount: string;
  status: string; // PENDING | SUCCEEDED | FAILED
  method: string; // PROVIDER | MANUAL
  reason: string;
  reference: string;
  failure: string;
  requested_by: string;
  created_at: string;
  completed_at: string | null;
}

export interface ProviderEventRow {
  id: number;
  at: string;
  provider: string;
  type: string;
  event_id: string;
  outcome: string; // APPLIED | DUPLICATE | IGNORED | ERROR
  error: string;
  order: string | null;
}

export interface Reconciliation {
  date: string;
  by_provider: { id?: undefined; provider: string; method: string; payments: number; captured: string }[];
  captured_total: string;
  refunded_total: string;
  net: string;
  discrepancies: { id?: undefined; type: string; order: string; detail: string }[];
  ok: boolean;
}

/** Response of POST /orders/{number}/refund/ — the full order plus the refund outcome (we only need the latter). */
export interface RefundResponse { refund_result: { id: number; status: string; message: string } }

// Labels follow apps/payments/models.py (PaymentState, Provider, EventOutcome, RefundStatus, RefundMethod).
export const PAYMENT_STATES: [string, string][] = [
  ["REQUIRES_ACTION", "Waiting for customer"],
  ["AUTHORIZED", "Authorised"],
  ["CAPTURED", "Captured"],
  ["PENDING_COLLECTION", "Pending collection"],
  ["FAILED", "Failed"],
  ["CANCELLED", "Cancelled by customer"],
  ["VOIDED", "Authorisation released"],
  ["PARTIALLY_REFUNDED", "Partially refunded"],
  ["REFUNDED", "Refunded"],
];

export const PROVIDERS: [string, string][] = [
  ["demo", "Demo sandbox"],
  ["stripe", "Stripe"],
  ["cod", "Pay on delivery/pickup"],
];
export const providerLabel = (p: string) => PROVIDERS.find(([v]) => v === p)?.[1] ?? p;

export const EVENT_OUTCOMES: [string, string][] = [
  ["APPLIED", "Applied"],
  ["DUPLICATE", "Duplicate (ignored)"],
  ["IGNORED", "Ignored"],
  ["ERROR", "Error"],
];

export const REFUND_STATUSES: [string, string][] = [
  ["PENDING", "Pending"],
  ["SUCCEEDED", "Succeeded"],
  ["FAILED", "Failed"],
];
export const refundMethodLabel = (m: string) => (m === "MANUAL" ? "Manual" : m === "PROVIDER" ? "Via provider" : m);

export const DISCREPANCY_INFO: Record<string, { label: string; scope: "day" | "open"; help: string }> = {
  CAPTURE_MISMATCH: { label: "Captured amount differs from order total", scope: "day", help: "A payment captured on this day doesn't equal the order's final total." },
  COMPLETED_WITHOUT_CAPTURE: { label: "Completed without a captured payment", scope: "day", help: "An order completed on this day has no captured or collected payment." },
  REFUND_PENDING: { label: "Refund still pending", scope: "open", help: "Not limited to this day: every refund that is still unconfirmed." },
  STALE_AUTHORISATION: { label: "Card authorisation still open", scope: "open", help: "Not limited to this day: an authorisation is still held on a completed, cancelled or payment-failed order." },
};

/** Everything the finance page keeps in the URL: active tab plus each tab's filters and page. */
export const FINANCE_URL_DEFAULTS = {
  tab: "payments",
  q: "", state: "", provider: "", from: "", to: "", page: "1", // payments
  rstatus: "", rpage: "1", // refunds
  outcome: "", eq: "", epage: "1", // provider events
  rdate: "", // reconciliation
};
export type FinanceUrl = typeof FINANCE_URL_DEFAULTS;
