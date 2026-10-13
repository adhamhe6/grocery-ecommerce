// Pure rules: which actions an order offers, how far picking has got, who may substitute what, and what a refund
// outcome means. Mirrors backend/apps/orders/workflow.py (TRANSITIONS) and fulfilment.py; the server stays the authority.
import { compareDecimal, parseMoney, fmtMoney } from "./decimal";
import type { FulfilmentTypeValue, ItemStatusValue, PaymentRow, RefundRow, StaffItem, SubstitutionPolicyValue } from "./types";

// ------------------------------------------------------------------------------------------------ vocabularies
export const ORDER_STATUS_OPTIONS: [string, string][] = [
  ["PENDING_PAYMENT", "Awaiting payment"], ["CONFIRMED", "Confirmed"], ["PICKING", "Being picked"], ["PACKING", "Being packed"],
  ["READY_FOR_PICKUP", "Ready for pickup"], ["READY_FOR_DISPATCH", "Ready for dispatch"], ["OUT_FOR_DELIVERY", "Out for delivery"],
  ["COMPLETED", "Completed"], ["CANCELLED", "Cancelled"], ["PAYMENT_FAILED", "Payment failed"],
];

/** "Open" = accepted but not completed. Same list the dashboard's "Open orders" figure counts (reports/queries.py OPEN). */
export const OPEN_STATUSES = ["CONFIRMED", "PICKING", "PACKING", "READY_FOR_PICKUP", "READY_FOR_DISPATCH", "OUT_FOR_DELIVERY"] as const;

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  UNPAID: "Unpaid", AUTHORIZED: "Authorised", PENDING_COLLECTION: "To pay on delivery/pickup", PAID: "Paid",
  PARTIALLY_REFUNDED: "Partially refunded", REFUNDED: "Refunded", FAILED: "Failed", VOIDED: "Authorisation released",
};
export const PAYMENT_STATUS_OPTIONS: [string, string][] = Object.entries(PAYMENT_STATUS_LABELS);

export const POLICY_LABELS: Record<SubstitutionPolicyValue, string> = {
  ALLOW: "Substitute with a suitable alternative",
  CONTACT: "Contact the customer before substituting",
  NONE: "Don't substitute — refund unavailable items",
};
export const POLICY_SHORT: Record<SubstitutionPolicyValue, string> = { ALLOW: "Allows substitutes", CONTACT: "Contact me first", NONE: "No substitutes" };

export const ITEM_STATUS_LABELS: Record<ItemStatusValue, string> = {
  PENDING: "To pick", PROPOSED: "Substitute awaiting approval", PICKED: "Picked", SHORT: "Short-picked", UNAVAILABLE: "Unavailable", SUBSTITUTED: "Substituted", REMOVED: "Removed (not charged)",
};

export const PROVIDER_LABELS: Record<string, string> = { demo: "Demo sandbox", stripe: "Stripe", cod: "Pay on delivery/pickup" };

// ------------------------------------------------------------------------------------------------ order actions
export type OrderActionKey = "start-picking" | "finish-picking" | "reopen-picking" | "finish-packing" | "dispatch" | "complete" | "cancel";

export interface OrderAction {
  key: OrderActionKey;
  label: string;
  /** Capability the API requires for this endpoint (backend OrderAdminViewSet.capability_map). */
  capability: "orders.fulfil" | "orders.manage";
  /** POST path below /orders/{number}/ */
  endpoint: string;
  variant: "primary" | "secondary" | "danger";
  confirm?: { title: string; description: string; confirmLabel: string };
}

/** `from->to` transition → endpoint. Transitions with no entry (payment-driven ones, "back to dispatch") have no staff endpoint. */
const TRANSITION_ACTION: Record<string, OrderActionKey> = {
  "CONFIRMED->PICKING": "start-picking",
  "PICKING->PACKING": "finish-picking",
  "PACKING->PICKING": "reopen-picking",
  "PACKING->READY_FOR_PICKUP": "finish-packing",
  "PACKING->READY_FOR_DISPATCH": "finish-packing",
  "READY_FOR_DISPATCH->OUT_FOR_DELIVERY": "dispatch",
  "READY_FOR_PICKUP->COMPLETED": "complete",
  "OUT_FOR_DELIVERY->COMPLETED": "complete",
};
const CANCEL_FROM = new Set(["PENDING_PAYMENT", "CONFIRMED", "PICKING", "PACKING", "READY_FOR_PICKUP", "READY_FOR_DISPATCH", "OUT_FOR_DELIVERY"]);

export function actionDefinition(key: OrderActionKey, fulfilment: FulfilmentTypeValue): OrderAction {
  const pickup = fulfilment === "PICKUP";
  switch (key) {
    case "start-picking":
      return { key, label: "Start picking", capability: "orders.fulfil", endpoint: "start-picking/", variant: "primary" };
    case "finish-picking":
      return { key, label: "Finish picking", capability: "orders.fulfil", endpoint: "finish-picking/", variant: "primary",
        confirm: { title: "Finish picking?", description: "This locks in the picked quantities and works out the final total. If nothing was picked, the order is cancelled instead.", confirmLabel: "Finish picking" } };
    case "reopen-picking":
      return { key, label: "Reopen picking", capability: "orders.fulfil", endpoint: "reopen-picking/", variant: "secondary",
        confirm: { title: "Reopen picking?", description: "Moves the order back to picking so quantities can be corrected. Only possible before the payment is captured.", confirmLabel: "Reopen picking" } };
    case "finish-packing":
      return { key, label: pickup ? "Packed — ready for pickup" : "Packed — ready for dispatch", capability: "orders.fulfil", endpoint: "finish-packing/", variant: "primary",
        confirm: { title: "Finish packing?", description: `Captures the card payment for the final total (cash-on-delivery orders are collected at handover), tells the customer the order is ready${pickup ? " to collect" : " and will go out for delivery"}.`, confirmLabel: "Finish packing" } };
    case "dispatch":
      return { key, label: "Dispatch — out for delivery", capability: "orders.fulfil", endpoint: "dispatch/", variant: "primary",
        confirm: { title: "Send this order out for delivery?", description: "The customer is told their order has left the store.", confirmLabel: "Dispatch" } };
    case "complete":
      return { key, label: pickup ? "Hand over to customer" : "Mark delivered", capability: "orders.fulfil", endpoint: "complete/", variant: "primary",
        confirm: { title: pickup ? "Hand over this order?" : "Mark this order as delivered?", description: "The order is completed and can no longer be changed or cancelled.", confirmLabel: pickup ? "Hand over" : "Mark delivered" } };
    case "cancel":
      return { key, label: "Cancel order", capability: "orders.manage", endpoint: "cancel/", variant: "danger" };
  }
}

export interface ActionableOrder {
  status: string;
  fulfilment_type: FulfilmentTypeValue;
  /** `allowed_transitions` from the order detail (workflow.allowed_next). */
  allowed_transitions: string[];
  payments?: Pick<PaymentRow, "state">[];
}

/**
 * The buttons an order offers right now: only transitions the API says are allowed, only those that have an endpoint,
 * only those the signed-in role may call. Forward steps first, cancel last.
 */
export function availableActions(order: ActionableOrder, can: (...caps: string[]) => boolean): OrderAction[] {
  const keys = new Set<OrderActionKey>();
  for (const to of order.allowed_transitions) {
    const key = to === "CANCELLED" && CANCEL_FROM.has(order.status) ? "cancel" : TRANSITION_ACTION[`${order.status}->${to}`];
    if (key) keys.add(key);
  }
  // The server refuses to reopen picking once money has been captured, so don't offer a button that can only fail.
  if (keys.has("reopen-picking") && order.payments?.some((p) => p.state === "CAPTURED")) keys.delete("reopen-picking");
  const rank: Record<OrderActionKey, number> = { "start-picking": 0, "finish-picking": 0, "finish-packing": 0, dispatch: 0, complete: 0, "reopen-picking": 1, cancel: 2 };
  return [...keys]
    .map((k) => actionDefinition(k, order.fulfilment_type))
    .filter((a) => can(a.capability))
    .sort((a, b) => rank[a.key] - rank[b.key]);
}

// ------------------------------------------------------------------------------------------------ picking progress
export interface PickProgress {
  /** Lines the picker has to deal with (everything except removed / replaced / awaiting-approval lines). */
  total: number;
  /** Lines finished: picked or short-picked. */
  done: number;
  /** Item ids the server will refuse to finish picking over (pending, unavailable, awaiting approval). */
  openIds: number[];
  /** The subset of `openIds` the picker can act on: not waiting for a customer's answer. */
  todoIds: number[];
  awaitingCustomer: boolean;
  anyDelivered: boolean;
  percent: number;
}

export function pickProgress(items: Pick<StaffItem, "id" | "status" | "substitute_for">[]): PickProgress {
  const countable = items.filter((i) => !["REMOVED", "SUBSTITUTED", "PROPOSED"].includes(i.status));
  const done = countable.filter((i) => i.status === "PICKED" || i.status === "SHORT").length;
  const open = items.filter((i) => ["PENDING", "PROPOSED", "UNAVAILABLE"].includes(i.status));
  // A proposed replacement, and the unavailable line it is meant to replace, are both waiting on the customer.
  const waiting = new Set<number>();
  for (const i of items) if (i.status === "PROPOSED") { waiting.add(i.id); if (i.substitute_for) waiting.add(i.substitute_for); }
  return {
    total: countable.length,
    done,
    openIds: open.map((i) => i.id),
    todoIds: open.filter((i) => !waiting.has(i.id)).map((i) => i.id),
    awaitingCustomer: items.some((i) => i.status === "PROPOSED"),
    anyDelivered: done > 0,
    percent: countable.length ? Math.round((done / countable.length) * 100) : 100,
  };
}

/** What the server will do for an unavailable line (fulfilment.effective_policy). */
export function effectivePolicy(orderPolicy: SubstitutionPolicyValue, itemPref: StaffItem["substitution_pref"]): SubstitutionPolicyValue {
  if (itemPref === "NONE") return "NONE";
  if (itemPref === "ALLOW") return orderPolicy === "NONE" ? "ALLOW" : orderPolicy;
  return orderPolicy;
}

/** Group sequentially by storage zone then category, keeping the order the API sorted them in. */
export interface PickZone { storage: StaffItem["storage"]; categories: { name: string; items: StaffItem[] }[] }
export function groupByZone(items: StaffItem[]): PickZone[] {
  const zones: PickZone[] = [];
  for (const item of items) {
    let zone = zones.find((z) => z.storage === item.storage);
    if (!zone) zones.push((zone = { storage: item.storage, categories: [] }));
    let cat = zone.categories.find((c) => c.name === item.category);
    if (!cat) zone.categories.push((cat = { name: item.category, items: [] }));
    cat.items.push(item);
  }
  const rank = { AMBIENT: 0, CHILLED: 1, FROZEN: 2 } as const;
  return zones.sort((a, b) => rank[a.storage] - rank[b.storage]);
}

export const STORAGE_LABELS: Record<StaffItem["storage"], string> = { AMBIENT: "Ambient", CHILLED: "Chilled", FROZEN: "Frozen" };

// ------------------------------------------------------------------------------------------------ refunds
/**
 * What can still be refunded on the order, derived from the payments panel: the newest collected payment's captured
 * amount, less what was already refunded and what is waiting to be paid out (the server's own formula). null = nothing
 * has been collected yet. The server remains the authority and rejects anything above the real figure.
 */
export function refundableAmount(payments: Pick<PaymentRow, "state" | "captured" | "refunded" | "attempt">[], refunds: Pick<RefundRow, "status" | "amount">[]): string | null {
  const eligible = payments.filter((p) => p.state === "CAPTURED" || p.state === "PARTIALLY_REFUNDED");
  if (!eligible.length) return null;
  const payment = eligible.reduce((best, p) => (p.attempt > best.attempt ? p : best), eligible[0]);
  const captured = parseMoney(payment.captured);
  const refunded = parseMoney(payment.refunded);
  if (captured === null || refunded === null) return null;
  let pending = 0n;
  for (const r of refunds) if (r.status === "PENDING") pending += parseMoney(r.amount) ?? 0n;
  const left = captured - refunded - pending;
  return fmtMoney(left < 0n ? 0n : left);
}

export function sumCaptured(payments: Pick<PaymentRow, "captured">[]): string {
  return fmtMoney(payments.reduce((acc, p) => acc + (parseMoney(p.captured) ?? 0n), 0n));
}
export function sumRefunded(refunds: Pick<RefundRow, "status" | "amount">[], status: RefundRow["status"]): string {
  return fmtMoney(refunds.filter((r) => r.status === status).reduce((acc, r) => acc + (parseMoney(r.amount) ?? 0n), 0n));
}

export interface RefundOutcome { tone: "ok" | "warn" | "bad"; title: string; body: string }

/** Plain-language outcome of a refund request. Never claims money moved unless the refund SUCCEEDED. */
export function describeRefund(r: { status: string; method?: string; failure?: string }, amountLabel: string): RefundOutcome {
  if (r.status === "SUCCEEDED") return { tone: "ok", title: `Refund of ${amountLabel} issued`, body: "The money has been returned to the customer." };
  if (r.status === "FAILED") return { tone: "bad", title: "The refund was rejected", body: r.failure || "The payment provider rejected the refund. Nothing was paid back." };
  if (r.method === "MANUAL")
    return { tone: "warn", title: `Manual refund of ${amountLabel} recorded — not paid out yet`, body: "Hand over the cash or store credit, then use “Record payout” on the refund to enter the receipt reference and complete it." };
  if (r.failure) return { tone: "warn", title: "Refund requested but not issued", body: `${r.failure}. Nothing has been paid back yet; the refund stays pending until the payment provider confirms it, and the amount is held back from further refunds meanwhile.` };
  return { tone: "warn", title: `Refund of ${amountLabel} is pending`, body: "The payment provider has not confirmed it yet. Check back shortly." };
}

/** Is the amount a valid positive money string no larger than what is refundable? Returns an error message or null. */
export function validateRefundAmount(raw: string, refundable: string | null, format: (v: string) => string = (v) => v): string | null {
  if (!raw.trim()) return "Enter the amount to refund.";
  const v = parseMoney(raw.trim());
  if (v === null) return "Enter an amount like 12.50 (at most 2 decimals).";
  if (v <= 0n) return "The amount must be greater than zero.";
  if (refundable !== null && compareDecimal(raw.trim(), refundable) === 1) return `At most ${format(refundable)} can still be refunded.`;
  return null;
}
