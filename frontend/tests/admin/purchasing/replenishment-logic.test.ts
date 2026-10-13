import { describe, expect, it } from "vitest";
import { defaultSupplier, groupBySupplier, planRowProblems, validateUnitCost, type PlanRow } from "@/components/admin/purchasing/replenishment-logic";
import type { ReplenishmentSupplier } from "@/components/admin/purchasing/types";

const sup = (id: number, name: string, unit_cost: string | null, lead_time_days = 2): ReplenishmentSupplier => ({ id, name, unit_cost, lead_time_days });
const row = (over: Partial<PlanRow> = {}): PlanRow => ({ productId: 1, name: "Rice", sku: "RICE", supplierId: 1, qty: "10", unitCost: "1.50", selected: true, ...over });

describe("defaultSupplier", () => {
  it("is null when nobody supplies the product", () => {
    expect(defaultSupplier([])).toBeNull();
  });
  it("prefers the lowest listed cost, compared numerically", () => {
    expect(defaultSupplier([sup(1, "A", "10.00"), sup(2, "B", "9.50"), sup(3, "C", "9.60")])?.id).toBe(2);
  });
  it("prefers a supplier with a cost over one without", () => {
    expect(defaultSupplier([sup(1, "A", null, 1), sup(2, "B", "50.00", 9)])?.id).toBe(2);
  });
  it("breaks cost ties by lead time, then name", () => {
    expect(defaultSupplier([sup(1, "A", "2.00", 5), sup(2, "B", "2.00", 1)])?.id).toBe(2);
    expect(defaultSupplier([sup(1, "Zed", "2.00", 1), sup(2, "Alpha", "2.00", 1)])?.id).toBe(2);
  });
  it("falls back to lead time when no cost is listed", () => {
    expect(defaultSupplier([sup(1, "A", null, 4), sup(2, "B", null, 1)])?.id).toBe(2);
  });
  it("does not mutate its input", () => {
    const input = [sup(1, "A", "3"), sup(2, "B", "1")];
    defaultSupplier(input);
    expect(input.map((s) => s.id)).toEqual([1, 2]);
  });
});

describe("validation", () => {
  it("needs a cost, a positive quantity and a supplier", () => {
    expect(planRowProblems(row())).toEqual({});
    expect(planRowProblems(row({ supplierId: null })).supplier).toBeDefined();
    expect(planRowProblems(row({ qty: "0" })).qty).toBeDefined();
    expect(planRowProblems(row({ qty: "" })).qty).toBeDefined();
    expect(planRowProblems(row({ unitCost: "" })).cost).toBeDefined();
  });
  it("accepts a zero cost but not a negative or over-precise one", () => {
    expect(validateUnitCost("0")).toBeNull();
    expect(validateUnitCost("1.2345")).toBeNull();
    expect(validateUnitCost("1.23456")).toMatch(/4 decimal/);
    expect(validateUnitCost("-1")).not.toBeNull();
    expect(validateUnitCost("abc")).not.toBeNull();
  });
});

describe("groupBySupplier", () => {
  const rows: PlanRow[] = [
    row({ productId: 1, name: "Rice", supplierId: 1, qty: "10", unitCost: "1.50" }),
    row({ productId: 2, name: "Milk", supplierId: 2, qty: "24", unitCost: "0.85" }),
    row({ productId: 3, name: "Beans", supplierId: 1, qty: "6", unitCost: "0.99" }),
    row({ productId: 4, name: "Unselected", supplierId: 1, selected: false }),
  ];

  it("makes one draft PO per supplier with only the selected rows", () => {
    const { groups, problems } = groupBySupplier(rows);
    expect(problems.size).toBe(0);
    expect(groups.map((g) => g.supplierId)).toEqual([1, 2]);
    expect(groups[0].lines).toEqual([
      { product_id: 1, qty_ordered: "10", unit_cost: "1.50" },
      { product_id: 3, qty_ordered: "6", unit_cost: "0.99" },
    ]);
    expect(groups[0].productNames).toEqual(["Rice", "Beans"]);
  });

  it("totals each PO exactly", () => {
    const { groups } = groupBySupplier(rows);
    expect(groups[0].total).toBe("20.94"); // 10 x 1.50 + 6 x 0.99
    expect(groups[1].total).toBe("20.40"); // 24 x 0.85
  });

  it("reports invalid selected rows instead of dropping them silently", () => {
    const { groups, problems } = groupBySupplier([...rows, row({ productId: 9, name: "No cost", supplierId: 2, unitCost: "" }), row({ productId: 8, name: "No supplier", supplierId: null })]);
    expect(groups.flatMap((g) => g.lines.map((l) => l.product_id)).sort()).toEqual([1, 2, 3]);
    expect([...problems.keys()].sort()).toEqual([8, 9]);
    expect(problems.get(9)?.cost).toBeDefined();
    expect(problems.get(8)?.supplier).toBeDefined();
  });

  it("returns no groups when nothing is selected", () => {
    expect(groupBySupplier(rows.map((r) => ({ ...r, selected: false }))).groups).toEqual([]);
  });
});
