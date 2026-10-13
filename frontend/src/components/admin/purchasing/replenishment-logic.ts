// Turning replenishment suggestions into draft purchase orders: which supplier is the default for a product, what is
// valid to order, and how selected rows group into one PO per supplier.
import { validateQty } from "@/components/admin/inventory/stock-math";
import { cmpDec, decimalPlaces, isDecimal, isNegative, orderTotal } from "./decimal";
import type { ReplenishmentSupplier } from "./types";

/**
 * The API has no “preferred supplier” flag, so the default is rule-based and shown to staff as such: the supplier with the
 * lowest listed unit cost; a shorter lead time breaks ties (and decides when no cost is listed); then the name.
 */
export function defaultSupplier(suppliers: ReplenishmentSupplier[]): ReplenishmentSupplier | null {
  if (!suppliers.length) return null;
  return [...suppliers].sort((a, b) => {
    const ac = a.unit_cost, bc = b.unit_cost;
    if (ac !== null && bc !== null) {
      const c = cmpDec(ac, bc);
      if (c) return c;
    } else if (ac !== null) return -1;
    else if (bc !== null) return 1;
    return a.lead_time_days - b.lead_time_days || a.name.localeCompare(b.name);
  })[0];
}

export interface PlanRow {
  productId: number;
  name: string;
  sku: string;
  supplierId: number | null;
  qty: string;
  unitCost: string;
  selected: boolean;
}

export interface PlanRowProblems { supplier?: string; qty?: string; cost?: string }

/** Unit costs are stored with four decimal places (PurchaseOrderLine.unit_cost). */
export function validateUnitCost(value: string): string | null {
  const t = value.trim();
  if (!t) return "Enter the unit cost.";
  if (!isDecimal(t) || isNegative(t)) return "Enter a cost like 1.25.";
  if (decimalPlaces(t) > 4) return "Use at most 4 decimal places.";
  return null;
}

export function planRowProblems(r: PlanRow): PlanRowProblems {
  const p: PlanRowProblems = {};
  if (r.supplierId === null) p.supplier = "Choose a supplier.";
  const q = validateQty(r.qty);
  if (q) p.qty = q;
  const c = validateUnitCost(r.unitCost);
  if (c) p.cost = c;
  return p;
}

export interface PlanLine { product_id: number; qty_ordered: string; unit_cost: string }
export interface PlanGroup { supplierId: number; lines: PlanLine[]; productNames: string[]; total: string }

/** Selected, valid rows grouped into one draft PO per supplier. Rows with problems are reported, not silently dropped. */
export function groupBySupplier(rows: PlanRow[]): { groups: PlanGroup[]; problems: Map<number, PlanRowProblems> } {
  const problems = new Map<number, PlanRowProblems>();
  const bySupplier = new Map<number, PlanGroup>();
  for (const r of rows) {
    if (!r.selected) continue;
    const p = planRowProblems(r);
    if (p.supplier || p.qty || p.cost) { problems.set(r.productId, p); continue; }
    const g = bySupplier.get(r.supplierId!) ?? { supplierId: r.supplierId!, lines: [], productNames: [], total: "0.00" };
    g.lines.push({ product_id: r.productId, qty_ordered: r.qty.trim(), unit_cost: r.unitCost.trim() });
    g.productNames.push(r.name);
    bySupplier.set(r.supplierId!, g);
  }
  const groups = [...bySupplier.values()].map((g) => ({ ...g, total: orderTotal(g.lines.map((l) => ({ qty: l.qty_ordered, unitCost: l.unit_cost }))) }));
  return { groups, problems };
}
