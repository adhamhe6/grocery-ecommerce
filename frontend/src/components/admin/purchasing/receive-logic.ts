// Goods-receiving rules, mirrored from backend/apps/purchasing/services.py `receive_goods` so staff get an answer before
// the request is sent. The server stays the judge: whatever it says is shown verbatim.
import { validateQty } from "@/components/admin/inventory/stock-math";
import { addDec, cmpDec, isPositive, mulDec, subDec, trimDec } from "./decimal";
import type { PurchaseOrderLine } from "./types";

/** A supplier may ship up to 10% over what is outstanding (OVER_RECEIPT_TOLERANCE = 1.10 in the service). */
export const OVER_RECEIPT_TOLERANCE = "1.10";

export type ExpiryKindValue = "BEST_BEFORE" | "USE_BY";

export interface ReceiveRow {
  poLineId: number;
  name: string;
  sku: string;
  unit: string;
  tracksBatches: boolean;
  ordered: string;
  received: string;
  outstanding: string;
  unitCost: string;
  accepted: string;
  rejected: string;
  rejectReason: string;
  lot: string;
  expiry: string;
  expiryKind: ExpiryKindValue;
}

/** Largest accepted quantity the server takes for a line: outstanding × 1.10 (never below zero). */
export function maxAccepted(outstanding: string): string {
  const base = isPositive(outstanding) ? outstanding : "0";
  return mulDec(base, OVER_RECEIPT_TOLERANCE) ?? "0";
}

/** How far an accepted quantity runs past what is outstanding; null when it doesn't. */
export function overReceipt(outstanding: string, accepted: string): string | null {
  const diff = subDec(accepted, isPositive(outstanding) ? outstanding : "0");
  return diff !== null && isPositive(diff) ? diff : null;
}

/** Rows for the receive form: only lines that still have something outstanding. */
export function rowsFromLines(lines: PurchaseOrderLine[]): ReceiveRow[] {
  return lines
    .filter((l) => isPositive(l.outstanding))
    .map((l) => ({
      poLineId: l.id, name: l.name, sku: l.sku, unit: l.unit, tracksBatches: l.tracks_batches, ordered: l.qty_ordered, received: l.qty_received,
      outstanding: l.outstanding, unitCost: l.unit_cost, accepted: "", rejected: "", rejectReason: "", lot: "", expiry: "", expiryKind: "BEST_BEFORE" as const,
    }));
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface ReceiveCheck {
  /** Keyed `${rowIndex}.${field}` with field in accepted | rejected | rejectReason | lot | expiry. */
  errors: Record<string, string>;
  /** Rows that will be sent (a row with nothing entered is skipped, as the server does). */
  active: number[];
  formError?: string;
}

const hasQty = (v: string) => v.trim() !== "" && isPositive(v.trim());

export function validateReceive(rows: ReceiveRow[]): ReceiveCheck {
  const errors: Record<string, string> = {};
  const active: number[] = [];
  rows.forEach((r, i) => {
    const acc = r.accepted.trim(), rej = r.rejected.trim();
    const accErr = validateQty(acc, { required: false, allowZero: true, max: maxAccepted(r.outstanding), maxLabel: "that can be accepted (outstanding plus the 10% tolerance)" });
    const rejErr = validateQty(rej, { required: false, allowZero: true });
    if (accErr) errors[`${i}.accepted`] = accErr;
    if (rejErr) errors[`${i}.rejected`] = rejErr;
    if (accErr || rejErr) return;
    const accepting = hasQty(acc), rejecting = hasQty(rej);
    if (!accepting && !rejecting) return;
    active.push(i);
    if (rejecting && !r.rejectReason.trim()) errors[`${i}.rejectReason`] = "Say why it was rejected.";
    if (accepting && r.tracksBatches) {
      if (!r.lot.trim()) errors[`${i}.lot`] = "A lot code is required for batch-tracked products.";
      if (!r.expiry) errors[`${i}.expiry`] = "An expiry date is required for batch-tracked products.";
      else if (!ISO_DATE.test(r.expiry)) errors[`${i}.expiry`] = "Enter a valid date.";
    }
  });
  const formError = active.length === 0 && Object.keys(errors).length === 0 ? "Enter an accepted or rejected quantity on at least one line." : undefined;
  return { errors, active, formError };
}

export interface ReceiveFormValues { key: string; deliveryNote: string; notes: string; rows: ReceiveRow[] }

/** Request body for POST /purchase-orders/{id}/receive/. `idempotency_key` is generated once per receiving attempt. */
export function buildReceivePayload(v: ReceiveFormValues, active: number[]) {
  return {
    idempotency_key: v.key,
    delivery_note: v.deliveryNote.trim(),
    notes: v.notes.trim(),
    lines: active.map((i) => {
      const r = v.rows[i];
      const accepting = hasQty(r.accepted);
      const rejecting = hasQty(r.rejected);
      return {
        po_line_id: r.poLineId,
        qty_accepted: accepting ? trimDec(r.accepted.trim()) : "0",
        qty_rejected: rejecting ? trimDec(r.rejected.trim()) : "0",
        ...(rejecting ? { reject_reason: r.rejectReason.trim() } : {}),
        ...(r.tracksBatches && accepting ? { lot_code: r.lot.trim(), expiry_date: r.expiry, expiry_kind: r.expiryKind } : {}),
      };
    }),
  };
}

/** Units delivered so far across the whole order, for the “partially received” summary. */
export function receivedProgress(lines: Pick<PurchaseOrderLine, "qty_ordered" | "qty_received">[]): { ordered: string; received: string; percent: number } {
  let ordered = "0", received = "0";
  for (const l of lines) {
    ordered = sumTwo(ordered, l.qty_ordered);
    received = sumTwo(received, l.qty_received);
  }
  // The percentage is only used to size a bar, so a float is fine here.
  const percent = cmpDec(ordered, "0") === 1 ? Math.min(100, Math.round((Number(received) / Number(ordered)) * 100)) : 0;
  return { ordered, received, percent };
}

const sumTwo = (a: string, b: string) => addDec(a, b) ?? a;
