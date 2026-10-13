// Purchase order form rules: line validation and the request bodies for create / edit.
import { validateQty } from "@/components/admin/inventory/stock-math";
import type { ProductOption } from "@/components/admin/inventory/form-kit";
import { decimalPlaces, lineTotal, orderTotal, toFixedDec, trimDec } from "./decimal";
import { validateUnitCost } from "./replenishment-logic";

export interface LineDraft {
  key: string;
  product: ProductOption | null;
  qty: string;
  unitCost: string;
}

let counter = 0;
export const blankLine = (): LineDraft => ({ key: `l${++counter}`, product: null, qty: "", unitCost: "" });

/** Errors keyed `${index}.product | qty | cost`. A PO needs at least one line and every line must be complete. */
export function validateLines(lines: LineDraft[]): { errors: Record<string, string>; formError?: string } {
  const errors: Record<string, string> = {};
  lines.forEach((l, i) => {
    if (!l.product) errors[`${i}.product`] = "Choose a product.";
    const q = validateQty(l.qty);
    if (q) errors[`${i}.qty`] = q;
    const c = validateUnitCost(l.unitCost);
    if (c) errors[`${i}.cost`] = c;
  });
  return { errors, formError: lines.length === 0 ? "Add at least one product to the order." : undefined };
}

export const totalOf = (lines: LineDraft[]): string => orderTotal(lines.map((l) => ({ qty: l.qty.trim(), unitCost: l.unitCost.trim() })));
export const lineAmount = (l: LineDraft): string | null => lineTotal(l.qty.trim(), l.unitCost.trim());

export interface PoFormValues { supplierId: number | null; branchId: number | null; expectedDate: string; notes: string; lines: LineDraft[] }

const linesBody = (lines: LineDraft[]) => lines.map((l) => ({ product_id: l.product!.id, qty_ordered: l.qty.trim(), unit_cost: l.unitCost.trim() }));

/** POST /purchase-orders/ — the server defaults the expected date from the supplier's lead time when it is omitted. */
export function createPayload(v: PoFormValues) {
  return {
    supplier_id: v.supplierId,
    branch_id: v.branchId,
    ...(v.expectedDate ? { expected_date: v.expectedDate } : {}),
    notes: v.notes.trim(),
    lines: linesBody(v.lines),
  };
}

/** PATCH /purchase-orders/{id}/ on a draft — supplier and store can't be changed after creation. */
export function editPayload(v: Pick<PoFormValues, "expectedDate" | "notes" | "lines">) {
  return { expected_date: v.expectedDate || null, notes: v.notes.trim(), lines: linesBody(v.lines) };
}

/** A catalogue cost (“1.0500”) as it should appear in a cost field: at least cents, no needless zeros (“1.05”). */
export function costInputText(cost: string): string {
  const t = trimDec(cost);
  return decimalPlaces(t) < 2 ? (toFixedDec(t, 2) ?? t) : t;
}
