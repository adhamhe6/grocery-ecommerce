import { describe, expect, it } from "vitest";
import { buildReceivePayload, maxAccepted, overReceipt, receivedProgress, rowsFromLines, validateReceive, type ReceiveRow } from "@/components/admin/purchasing/receive-logic";
import type { PurchaseOrderLine } from "@/components/admin/purchasing/types";

const line = (over: Partial<PurchaseOrderLine> = {}): PurchaseOrderLine => ({
  id: 1, product_id: 10, sku: "YOG", name: "Yoghurt", unit: "ea", tracks_batches: true, qty_ordered: "40", unit_cost: "1.1000", qty_received: "0", qty_rejected: "0", outstanding: "40", ...over,
});
const row = (over: Partial<ReceiveRow> = {}): ReceiveRow => ({ ...rowsFromLines([line()])[0], ...over });

describe("over-receipt tolerance", () => {
  it("allows up to 10% over what is outstanding, exactly", () => {
    expect(maxAccepted("40")).toBe("44");
    expect(maxAccepted("10")).toBe("11");
    expect(maxAccepted("0.5")).toBe("0.55");
    expect(maxAccepted("0")).toBe("0");
    expect(maxAccepted("-3")).toBe("0");
  });
  it("reports how far a quantity runs past outstanding", () => {
    expect(overReceipt("40", "42")).toBe("2");
    expect(overReceipt("40", "40")).toBeNull();
    expect(overReceipt("40", "12")).toBeNull();
  });
});

describe("rowsFromLines", () => {
  it("only offers lines that still have something outstanding", () => {
    const rows = rowsFromLines([line({ id: 1 }), line({ id: 2, outstanding: "0", qty_received: "40" }), line({ id: 3, outstanding: "5" })]);
    expect(rows.map((r) => r.poLineId)).toEqual([1, 3]);
  });
});

describe("validateReceive", () => {
  it("skips rows with nothing entered and asks for at least one line", () => {
    const c = validateReceive([row(), row({ poLineId: 2 })]);
    expect(c.active).toEqual([]);
    expect(c.formError).toMatch(/at least one line/);
  });

  it("requires lot and expiry for batch-tracked products that are accepted", () => {
    const c = validateReceive([row({ accepted: "38" })]);
    expect(c.active).toEqual([0]);
    expect(c.errors["0.lot"]).toBeDefined();
    expect(c.errors["0.expiry"]).toBeDefined();
    const ok = validateReceive([row({ accepted: "38", lot: "Y-1", expiry: "2026-11-01" })]);
    expect(ok.errors).toEqual({});
  });

  it("does not require lot or expiry for products that aren't batch-tracked", () => {
    expect(validateReceive([row({ tracksBatches: false, accepted: "5" })]).errors).toEqual({});
  });

  it("does not require lot or expiry when only rejecting", () => {
    expect(validateReceive([row({ rejected: "2", rejectReason: "crushed" })]).errors).toEqual({});
  });

  it("requires a reason for rejected quantities", () => {
    const c = validateReceive([row({ tracksBatches: false, accepted: "5", rejected: "2" })]);
    expect(c.errors["0.rejectReason"]).toBeDefined();
  });

  it("accepts the 10% tolerance but not beyond it", () => {
    expect(validateReceive([row({ tracksBatches: false, accepted: "44" })]).errors).toEqual({});
    expect(validateReceive([row({ tracksBatches: false, accepted: "44.001" })]).errors["0.accepted"]).toMatch(/more than the 44/);
  });

  it("rejects malformed quantities", () => {
    expect(validateReceive([row({ accepted: "abc" })]).errors["0.accepted"]).toBeDefined();
    expect(validateReceive([row({ accepted: "-1" })]).errors["0.accepted"]).toBeDefined();
    expect(validateReceive([row({ accepted: "1.2345" })]).errors["0.accepted"]).toMatch(/3 decimal/);
  });
});

describe("buildReceivePayload", () => {
  it("sends only active rows, with the key, and batch details only where they apply", () => {
    const rows = [
      row({ poLineId: 7, accepted: "28.0", rejected: "2", rejectReason: " crushed ", lot: " L1 ", expiry: "2026-11-01", expiryKind: "USE_BY" }),
      row({ poLineId: 8 }), // nothing entered: skipped
      row({ poLineId: 9, tracksBatches: false, accepted: "5", lot: "ignored", expiry: "2026-01-01" }),
    ];
    const check = validateReceive(rows);
    expect(check.errors).toEqual({});
    const body = buildReceivePayload({ key: "abc-12345678", deliveryNote: " DN-1 ", notes: "", rows }, check.active);
    expect(body).toEqual({
      idempotency_key: "abc-12345678",
      delivery_note: "DN-1",
      notes: "",
      lines: [
        { po_line_id: 7, qty_accepted: "28", qty_rejected: "2", reject_reason: "crushed", lot_code: "L1", expiry_date: "2026-11-01", expiry_kind: "USE_BY" },
        { po_line_id: 9, qty_accepted: "5", qty_rejected: "0" },
      ],
    });
  });

  it("uses the same body (and key) when the same values are rebuilt for a retry", () => {
    const rows = [row({ accepted: "10", lot: "L", expiry: "2026-12-01" })];
    const a = buildReceivePayload({ key: "same-key-0001", deliveryNote: "", notes: "", rows }, [0]);
    const b = buildReceivePayload({ key: "same-key-0001", deliveryNote: "", notes: "", rows }, [0]);
    expect(a).toEqual(b);
  });
});

describe("receivedProgress", () => {
  it("sums units exactly and sizes the bar", () => {
    const p = receivedProgress([{ qty_ordered: "40", qty_received: "28" }, { qty_ordered: "20", qty_received: "0.5" }]);
    expect(p).toEqual({ ordered: "60", received: "28.5", percent: 48 });
  });
  it("is zero for an empty order", () => {
    expect(receivedProgress([]).percent).toBe(0);
  });
});
