// Expiry buckets, mirroring the server's own thresholds (BatchViewSet._row / ExpiryView in backend/apps/inventory/admin_api.py):
//   days < 0 → expired · 0–1 → today or tomorrow · 2–3 → within 3 days · 4–7 → within 7 days · more → later.
// Batches with nothing left on hand have no expiry risk at all.
import type { BatchRow, ExpiryGroupKey } from "./types";

export type ExpiryBucket = ExpiryGroupKey | "later" | "none";

export const EXPIRY_BUCKETS: { key: ExpiryGroupKey; label: string; short: string; hint: string }[] = [
  { key: "expired", label: "Expired, still on hand", short: "Expired", hint: "Past its date but not yet written off" },
  { key: "today_tomorrow", label: "Expires today or tomorrow", short: "≤ 1 day", hint: "0–1 days left" },
  { key: "within_3", label: "Expires in 2–3 days", short: "2–3 days", hint: "2–3 days left" },
  { key: "within_7", label: "Expires in 4–7 days", short: "4–7 days", hint: "4–7 days left" },
];

/** Which expiry bucket a batch falls in. `daysToExpiry` is today's date subtracted from the expiry date (negative = past). */
export function expiryBucket(daysToExpiry: number | null | undefined, qtyRemaining: string | number = 1): ExpiryBucket {
  if (daysToExpiry === null || daysToExpiry === undefined || !(Number(qtyRemaining) > 0)) return "none";
  if (daysToExpiry < 0) return "expired";
  if (daysToExpiry <= 1) return "today_tomorrow";
  if (daysToExpiry <= 3) return "within_3";
  if (daysToExpiry <= 7) return "within_7";
  return "later";
}

export const bucketLabel = (b: ExpiryBucket): string =>
  b === "later" ? "More than 7 days" : b === "none" ? "Nothing on hand" : (EXPIRY_BUCKETS.find((x) => x.key === b)?.short ?? b);

/** "3 days left", "expires tomorrow", "expired 2 days ago". */
export function daysLabel(days: number | null | undefined): string {
  if (days === null || days === undefined) return "No expiry date";
  if (days < -1) return `Expired ${-days} days ago`;
  if (days === -1) return "Expired yesterday";
  if (days === 0) return "Expires today";
  if (days === 1) return "Expires tomorrow";
  return `${days} days left`;
}

/** An expired batch that still has stock and can therefore be written off. */
export const isWriteOffCandidate = (b: Pick<BatchRow, "qty_remaining" | "days_to_expiry" | "status">): boolean =>
  Number(b.qty_remaining) > 0 && (b.status === "EXPIRED" || (b.days_to_expiry !== null && b.days_to_expiry < 0));

export type BatchAction = "quarantine" | "release" | "fail" | "pass";

/** Which status actions make sense for a batch (the server is the final judge: expired/depleted batches can't be released). */
export function batchActions(b: Pick<BatchRow, "status" | "quality_status">): BatchAction[] {
  const out: BatchAction[] = [];
  if (b.status === "ACTIVE") out.push("quarantine");
  if (b.status === "QUARANTINED") out.push("release");
  if (b.quality_status !== "FAILED") out.push("fail");
  if (b.quality_status !== "PASSED") out.push("pass");
  return out;
}

/** The request body for POST /inventory/batches/{id}/status/. */
export function batchActionPayload(action: BatchAction, note: string): { status?: string; quality_status?: string; note?: string } {
  const body: { status?: string; quality_status?: string; note?: string } = {};
  if (action === "quarantine") body.status = "QUARANTINED";
  if (action === "release") body.status = "ACTIVE";
  if (action === "fail") body.quality_status = "FAILED";
  if (action === "pass") body.quality_status = "PASSED";
  if (note.trim()) body.note = note.trim();
  return body;
}
