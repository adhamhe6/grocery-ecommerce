import { describe, expect, it } from "vitest";
import { blankLine, createPayload, editPayload, lineAmount, totalOf, validateLines, type LineDraft } from "@/components/admin/purchasing/po-logic";

const product = { id: 5, sku: "RICE", name: "Rice", tracks_batches: false };
const line = (over: Partial<LineDraft> = {}): LineDraft => ({ ...blankLine(), product, qty: "20", unitCost: "1.10", ...over });

describe("validateLines", () => {
  it("needs at least one line", () => {
    expect(validateLines([]).formError).toBeDefined();
  });
  it("flags incomplete lines by index and field", () => {
    const { errors } = validateLines([line(), line({ product: null, qty: "0", unitCost: "" })]);
    expect(Object.keys(errors).sort()).toEqual(["1.cost", "1.product", "1.qty"]);
  });
  it("passes complete lines", () => {
    expect(validateLines([line()]).errors).toEqual({});
  });
});

describe("totals", () => {
  it("computes line and order totals from decimal strings", () => {
    expect(lineAmount(line())).toBe("22.00");
    expect(totalOf([line(), line({ product: { ...product, id: 6 }, qty: "20", unitCost: "1.90" })])).toBe("60.00");
    expect(lineAmount(line({ qty: "" }))).toBeNull();
  });
});

describe("payloads", () => {
  it("creates with decimal strings, and omits an empty expected date so the supplier lead time applies", () => {
    const body = createPayload({ supplierId: 3, branchId: 1, expectedDate: "", notes: " hi ", lines: [line({ qty: " 20 ", unitCost: "1.10" })] });
    expect(body).toEqual({ supplier_id: 3, branch_id: 1, notes: "hi", lines: [{ product_id: 5, qty_ordered: "20", unit_cost: "1.10" }] });
    expect(createPayload({ supplierId: 3, branchId: 1, expectedDate: "2026-11-01", notes: "", lines: [line()] })).toHaveProperty("expected_date", "2026-11-01");
  });
  it("edits only date, notes and lines (supplier and store are fixed after creation)", () => {
    const body = editPayload({ expectedDate: "", notes: "x", lines: [line()] });
    expect(body).toEqual({ expected_date: null, notes: "x", lines: [{ product_id: 5, qty_ordered: "20", unit_cost: "1.10" }] });
    expect(body).not.toHaveProperty("supplier_id");
  });
});

import { costInputText } from "@/components/admin/purchasing/po-logic";
describe("costInputText", () => {
  it("shows catalogue costs the way staff would type them", () => {
    expect(costInputText("1.0500")).toBe("1.05");
    expect(costInputText("2")).toBe("2.00");
    expect(costInputText("1.0550")).toBe("1.055");
    expect(costInputText("0.9")).toBe("0.90");
  });
});
