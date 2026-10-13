import { describe, expect, it } from "vitest";
import { buildAuditDiff, displayValue, stableStringify, truncate } from "@/components/admin/audit/audit-diff";

describe("buildAuditDiff", () => {
  it("marks changed, added and removed fields and lists changes before unchanged fields", () => {
    const diff = buildAuditDiff({ name: "Old", price: "1.00", gone: "x", same: 1 }, { name: "New", price: "1.00", fresh: true, same: 1 });
    expect(diff.mode).toBe("changed");
    expect(diff.rows.map((r) => [r.key, r.status])).toEqual([
      ["fresh", "added"], ["gone", "removed"], ["name", "changed"], ["price", "unchanged"], ["same", "unchanged"],
    ]);
    expect(diff.changedCount).toBe(3);
    expect(diff.unchangedCount).toBe(2);
  });
  it("keeps before and after values on each row", () => {
    const row = buildAuditDiff({ stock: 5 }, { stock: 9 }).rows[0];
    expect(row).toMatchObject({ key: "stock", before: 5, after: 9, status: "changed" });
  });
  it("treats a missing key and an explicit null differently", () => {
    const diff = buildAuditDiff({ a: null }, { b: null });
    expect(diff.rows.map((r) => [r.key, r.status])).toEqual([["a", "removed"], ["b", "added"]]);
  });
  it("sees equal nested values as unchanged regardless of key order", () => {
    const diff = buildAuditDiff({ opts: { b: 1, a: [1, 2] } }, { opts: { a: [1, 2], b: 1 } });
    expect(diff.rows[0].status).toBe("unchanged");
    expect(buildAuditDiff({ opts: [1, 2] }, { opts: [2, 1] }).rows[0].status).toBe("changed");
  });
  it("creation shows only the after values, deletion only the before values", () => {
    const created = buildAuditDiff(null, { id: 1, name: "X" });
    expect(created.mode).toBe("created");
    expect(created.rows.every((r) => r.status === "added")).toBe(true);
    const deleted = buildAuditDiff({ id: 1 }, undefined);
    expect(deleted.mode).toBe("deleted");
    expect(deleted.rows.every((r) => r.status === "removed")).toBe(true);
  });
  it("handles entries that recorded no snapshots", () => {
    expect(buildAuditDiff(null, null)).toEqual({ mode: "none", rows: [], changedCount: 0, unchangedCount: 0 });
  });
  it("copes with snapshots that aren't objects", () => {
    const diff = buildAuditDiff([1], [1, 2]);
    expect(diff.rows).toHaveLength(1);
    expect(diff.rows[0]).toMatchObject({ key: "(value)", status: "changed" });
  });
  it("treats 0, false and the empty string as real values", () => {
    const diff = buildAuditDiff({ a: 0, b: false, c: "" }, { a: 0, b: true, c: "" });
    expect(diff.rows.map((r) => [r.key, r.status])).toEqual([["b", "changed"], ["a", "unchanged"], ["c", "unchanged"]]);
  });
});

describe("displayValue / truncate", () => {
  it("spells out empty values so they are never invisible", () => {
    expect(displayValue(null)).toBe("null");
    expect(displayValue("")).toBe("(empty)");
    expect(displayValue(undefined)).toBe("");
    expect(displayValue(false)).toBe("false");
    expect(displayValue(0)).toBe("0");
    expect(displayValue({ a: [1, 2] })).toBe('{"a":[1,2]}');
  });
  it("truncates only long text and says so", () => {
    expect(truncate("short")).toEqual({ text: "short", truncated: false });
    const long = "x".repeat(300);
    const cut = truncate(long, 100);
    expect(cut.truncated).toBe(true);
    expect(cut.text.length).toBeLessThanOrEqual(101);
    expect(cut.text.endsWith("…")).toBe(true);
  });
  it("stableStringify is order-independent for objects only", () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });
});
