// Pure helpers for the stock dialogs: quantity validation, adjustment preview and request bodies.
import { addDec, cmpDec, decimalPlaces, isDecimal, isNegative, subDec, trimDec } from "@/components/admin/purchasing/decimal";

/** The server stores quantities with at most 3 decimal places. */
export const QTY_PLACES = 3;

/**
 * Validate a quantity typed by staff. Returns an error message, or null when it is fine.
 * `max` is inclusive; `label` names what the maximum is ("available", "left in this batch"…).
 */
export function validateQty(value: string, opts: { required?: boolean; allowZero?: boolean; max?: string; maxLabel?: string } = {}): string | null {
  const text = value.trim();
  if (!text) return opts.required === false ? null : "Enter a quantity.";
  if (!isDecimal(text) || text.startsWith("-") || text.startsWith("+")) return "Enter a number, for example 2 or 0.5.";
  if (decimalPlaces(text) > QTY_PLACES) return `Use at most ${QTY_PLACES} decimal places.`;
  if (!opts.allowZero && (cmpDec(text, "0") ?? 0) <= 0) return "The quantity must be greater than zero.";
  if (opts.max !== undefined && cmpDec(text, opts.max) === 1) return `That is more than the ${trimDec(opts.max)} ${opts.maxLabel ?? "allowed"}.`;
  return null;
}

export type AdjustMode = "target" | "delta";

export interface AdjustPreview {
  valid: boolean;
  error?: string;
  /** Quantity on hand after the adjustment. */
  result?: string;
  /** Signed change (+3, -2). */
  change?: string;
  /** The result would fall below what is reserved for customer orders (the server refuses this). */
  belowReserved?: boolean;
  noChange?: boolean;
}

/** What the count will be after the adjustment, computed exactly. `current` is on hand (or the batch's remaining quantity). */
export function previewAdjust(current: string, reserved: string, mode: AdjustMode, input: string): AdjustPreview {
  const text = input.trim();
  if (!text) return { valid: false };
  if (!isDecimal(text)) return { valid: false, error: "Enter a number, for example 12 or -2.5." };
  if (decimalPlaces(text) > QTY_PLACES) return { valid: false, error: `Use at most ${QTY_PLACES} decimal places.` };
  if (mode === "target" && isNegative(text)) return { valid: false, error: "A counted quantity can't be negative." };
  const result = mode === "target" ? trimDec(text) : addDec(current, text);
  const change = mode === "target" ? subDec(text, current) : trimDec(text);
  if (result === null || change === null) return { valid: false };
  if (isNegative(result)) return { valid: false, error: `That would take stock below zero (${trimDec(current)} on hand).`, result, change };
  return { valid: true, result, change, belowReserved: cmpDec(result, reserved) === -1, noChange: cmpDec(change, "0") === 0 };
}

export const signed = (value: string): string => {
  const t = trimDec(value);
  return t.startsWith("-") || t === "0" ? t : `+${t}`;
};

export interface AdjustInput {
  productId: number;
  branchId: number;
  batchId?: number | null;
  mode: AdjustMode;
  value: string;
  reason: string;
  note: string;
}

export function adjustPayload(i: AdjustInput) {
  return {
    product_id: i.productId,
    branch_id: i.branchId,
    ...(i.batchId ? { batch_id: i.batchId } : {}),
    ...(i.mode === "target" ? { target: i.value.trim() } : { delta: i.value.trim() }),
    reason: i.reason.trim(),
    ...(i.note.trim() ? { note: i.note.trim() } : {}),
  };
}

export interface WasteInput { productId: number; branchId: number; batchId?: number | null; quantity: string; reason: string; note: string }
export function wastePayload(i: WasteInput) {
  return {
    product_id: i.productId,
    branch_id: i.branchId,
    ...(i.batchId ? { batch_id: i.batchId } : {}),
    quantity: i.quantity.trim(),
    reason_code: i.reason,
    ...(i.note.trim() ? { note: i.note.trim() } : {}),
  };
}

export interface TransferInput { productId: number; fromBranchId: number; toBranchId: number; batchId?: number | null; quantity: string; note: string }
export function transferPayload(i: TransferInput) {
  return {
    product_id: i.productId,
    from_branch_id: i.fromBranchId,
    to_branch_id: i.toBranchId,
    ...(i.batchId ? { batch_id: i.batchId } : {}),
    quantity: i.quantity.trim(),
    ...(i.note.trim() ? { note: i.note.trim() } : {}),
  };
}

/** Unreserved quantity in a batch (the most that can be transferred out of it). */
export const batchFree = (b: { qty_remaining: string; qty_reserved: string }): string => subDec(b.qty_remaining, b.qty_reserved) ?? "0";
