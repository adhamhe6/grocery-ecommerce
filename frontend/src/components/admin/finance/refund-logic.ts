// Refund maths and validation. All money is handled as integer cents parsed from the API's decimal strings, so no
// floating-point rounding can ever change an amount we send back.

/** "12.5" -> 1250. Returns null for anything that isn't a plain non-negative decimal with at most 2 significant decimals. */
export function toCents(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  const m = /^(\d+)(?:\.(\d*))?$/.exec(text);
  if (!m) return null;
  const decimals = m[2] ?? "";
  if (decimals.length > 2 && /[1-9]/.test(decimals.slice(2))) return null; // "1.239" would silently lose money
  const cents = Number(`${m[1]}${decimals.slice(0, 2).padEnd(2, "0")}`);
  return Number.isSafeInteger(cents) ? cents : null;
}

export function fromCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export const REFUNDABLE_STATES = ["CAPTURED", "PARTIALLY_REFUNDED"];

/**
 * What can still be refunded on a payment, in cents — the same formula the server uses:
 * captured − refunded (completed) − refunds that are still pending. Failed refunds don't reserve anything.
 */
export function refundableCents(payment: { captured: string; refunded: string }, refunds: { amount: string; status: string }[]): number {
  const captured = toCents(payment.captured) ?? 0;
  const refunded = toCents(payment.refunded) ?? 0;
  const pending = refunds.filter((r) => r.status === "PENDING").reduce((sum, r) => sum + (toCents(r.amount) ?? 0), 0);
  return Math.max(0, captured - refunded - pending);
}

export type RefundCheck = { ok: true; amount: string } | { ok: false; message: string };

/** Validates what the person typed against what can still be refunded. `fmt` formats a decimal string for messages. */
export function validateRefundAmount(input: string, refundable: string, fmt: (s: string) => string = (s) => s): RefundCheck {
  const text = input.trim();
  if (!text) return { ok: false, message: "Enter the amount to refund." };
  if (!/^\d+(\.\d+)?$/.test(text)) return { ok: false, message: "Enter an amount such as 12.50 (digits and a decimal point only)." };
  const cents = toCents(text);
  if (cents === null) return { ok: false, message: "Use at most 2 decimal places." };
  if (cents <= 0) return { ok: false, message: "The refund must be more than zero." };
  const max = toCents(refundable) ?? 0;
  if (max <= 0) return { ok: false, message: "There is nothing left to refund on this payment." };
  if (cents > max) return { ok: false, message: `At most ${fmt(fromCents(max))} can still be refunded on this payment.` };
  return { ok: true, amount: fromCents(cents) };
}

export function validateRefundReason(reason: string): string | null {
  const text = reason.trim();
  if (!text) return "Say why this refund is being made — it is recorded on the order and in the audit log.";
  if (text.length > 300) return "Keep the reason to 300 characters or fewer.";
  return null;
}

export interface RefundDraft { amount: string; reason: string; manual: boolean }

/** The request body for POST /orders/{number}/refund/. `idempotency_key` must be at least 8 characters. */
export function refundPayload(draft: { amount: string; reason: string; manual: boolean }, idempotencyKey: string) {
  return { amount: draft.amount, reason: draft.reason.trim(), manual: draft.manual, idempotency_key: idempotencyKey };
}

/** Same signature = same request = same idempotency key, so a retry or double click can never refund twice. */
export const draftSignature = (d: RefundDraft) => `${d.amount.trim()}|${d.reason.trim()}|${d.manual ? "manual" : "provider"}`;

/** Whether the server will treat the refund as manual: it always does for cash on delivery. */
export const isManualRefund = (provider: string, chosenManual: boolean) => chosenManual || provider === "cod";
