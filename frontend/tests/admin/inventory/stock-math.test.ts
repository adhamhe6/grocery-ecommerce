import { describe, expect, it } from "vitest";
import { adjustPayload, batchFree, previewAdjust, signed, transferPayload, validateQty, wastePayload } from "@/components/admin/inventory/stock-math";

describe("validateQty", () => {
  it("requires a positive number by default", () => {
    expect(validateQty("")).toMatch(/Enter a quantity/);
    expect(validateQty("0")).toMatch(/greater than zero/);
    expect(validateQty("-2")).toBeDefined();
    expect(validateQty("abc")).toBeDefined();
    expect(validateQty("2")).toBeNull();
    expect(validateQty("0.5")).toBeNull();
  });
  it("limits to three decimal places", () => {
    expect(validateQty("1.234")).toBeNull();
    expect(validateQty("1.2345")).toMatch(/3 decimal/);
  });
  it("enforces an inclusive maximum, compared exactly", () => {
    expect(validateQty("10", { max: "10" })).toBeNull();
    expect(validateQty("10.001", { max: "10" })).toMatch(/more than the 10/);
    expect(validateQty("0.3", { max: "0.30" })).toBeNull();
  });
  it("allows zero and blank when asked", () => {
    expect(validateQty("0", { allowZero: true })).toBeNull();
    expect(validateQty("", { required: false })).toBeNull();
  });
});

describe("previewAdjust", () => {
  it("shows the resulting count for a counted quantity", () => {
    const p = previewAdjust("20", "5", "target", "18");
    expect(p).toMatchObject({ valid: true, result: "18", change: "-2", belowReserved: false, noChange: false });
  });
  it("shows the resulting count for a signed change, without float drift", () => {
    expect(previewAdjust("0.3", "0", "delta", "0.1")).toMatchObject({ valid: true, result: "0.4", change: "0.1" });
    expect(previewAdjust("20", "0", "delta", "-2.5")).toMatchObject({ result: "17.5", change: "-2.5" });
  });
  it("warns when the result falls below what is reserved", () => {
    expect(previewAdjust("20", "15", "target", "10").belowReserved).toBe(true);
    expect(previewAdjust("20", "15", "target", "15").belowReserved).toBe(false);
  });
  it("refuses to go below zero", () => {
    const p = previewAdjust("3", "0", "delta", "-5");
    expect(p.valid).toBe(false);
    expect(p.error).toMatch(/below zero/);
  });
  it("detects a count that matches the system", () => {
    expect(previewAdjust("12", "0", "target", "12.000").noChange).toBe(true);
  });
  it("rejects bad input", () => {
    expect(previewAdjust("5", "0", "target", "-1").valid).toBe(false);
    expect(previewAdjust("5", "0", "delta", "x").valid).toBe(false);
    expect(previewAdjust("5", "0", "delta", "1.2345").valid).toBe(false);
    expect(previewAdjust("5", "0", "delta", "").valid).toBe(false);
  });
  it("formats signed changes", () => {
    expect(signed("3")).toBe("+3");
    expect(signed("-2")).toBe("-2");
    expect(signed("0")).toBe("0");
    expect(signed("1.500")).toBe("+1.5");
  });
});

describe("request bodies", () => {
  it("adjust sends either target or delta, plus the reason", () => {
    expect(adjustPayload({ productId: 1, branchId: 2, mode: "target", value: " 18 ", reason: " stock take ", note: "" })).toEqual({ product_id: 1, branch_id: 2, target: "18", reason: "stock take" });
    expect(adjustPayload({ productId: 1, branchId: 2, batchId: 9, mode: "delta", value: "-2", reason: "r", note: "n" })).toEqual({ product_id: 1, branch_id: 2, batch_id: 9, delta: "-2", reason: "r", note: "n" });
  });
  it("waste sends reason_code", () => {
    expect(wastePayload({ productId: 1, branchId: 2, batchId: 3, quantity: "10", reason: "EXPIRED", note: "" })).toEqual({ product_id: 1, branch_id: 2, batch_id: 3, quantity: "10", reason_code: "EXPIRED" });
  });
  it("transfer names both stores", () => {
    expect(transferPayload({ productId: 1, fromBranchId: 2, toBranchId: 3, quantity: "5", note: "" })).toEqual({ product_id: 1, from_branch_id: 2, to_branch_id: 3, quantity: "5" });
  });
  it("computes the unreserved part of a batch", () => {
    expect(batchFree({ qty_remaining: "10", qty_reserved: "2.5" })).toBe("7.5");
  });
});
