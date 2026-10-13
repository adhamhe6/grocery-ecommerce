import { describe, expect, it } from "vitest";
import {
  draftSignature, fromCents, isManualRefund, refundableCents, refundPayload, toCents, validateRefundAmount, validateRefundReason,
} from "@/components/admin/finance/refund-logic";

describe("toCents / fromCents", () => {
  it("parses plain decimals exactly", () => {
    expect(toCents("12.34")).toBe(1234);
    expect(toCents("12.3")).toBe(1230);
    expect(toCents("12")).toBe(1200);
    expect(toCents("0.07")).toBe(7);
    expect(toCents("19.99")).toBe(1999);
    expect(toCents("1.10")).toBe(110); // the classic float trap (1.1 * 100 = 110.00000000000001)
  });
  it("accepts trailing zeros beyond 2 dp but never drops real digits", () => {
    expect(toCents("5.500")).toBe(550);
    expect(toCents("5.505")).toBeNull();
  });
  it("rejects anything that is not a non-negative decimal", () => {
    for (const bad of ["", " ", "abc", "-1", "1,5", "1e3", "--", null, undefined]) expect(toCents(bad as never)).toBeNull();
  });
  it("round-trips to a 2 dp string", () => {
    expect(fromCents(1234)).toBe("12.34");
    expect(fromCents(5)).toBe("0.05");
    expect(fromCents(0)).toBe("0.00");
    expect(fromCents(100000)).toBe("1000.00");
  });
});

describe("refundableCents", () => {
  it("is captured minus refunded minus pending refunds", () => {
    expect(refundableCents({ captured: "20.00", refunded: "5.00" }, [{ amount: "3.00", status: "PENDING" }])).toBe(1200);
  });
  it("ignores failed and succeeded refunds in the list (succeeded ones are already inside `refunded`)", () => {
    const refunds = [{ amount: "5.00", status: "SUCCEEDED" }, { amount: "4.00", status: "FAILED" }];
    expect(refundableCents({ captured: "20.00", refunded: "5.00" }, refunds)).toBe(1500);
  });
  it("never goes negative", () => {
    expect(refundableCents({ captured: "10.00", refunded: "10.00" }, [{ amount: "1.00", status: "PENDING" }])).toBe(0);
  });
});

describe("validateRefundAmount", () => {
  const fmt = (s: string) => `$${s}`;
  it("accepts an amount up to and including what is refundable and normalises it", () => {
    expect(validateRefundAmount("12", "12.00", fmt)).toEqual({ ok: true, amount: "12.00" });
    expect(validateRefundAmount(" 2.5 ", "12.00", fmt)).toEqual({ ok: true, amount: "2.50" });
    expect(validateRefundAmount("0.01", "12.00", fmt)).toEqual({ ok: true, amount: "0.01" });
  });
  it("requires an amount", () => {
    expect(validateRefundAmount("  ", "12.00")).toEqual({ ok: false, message: "Enter the amount to refund." });
  });
  it("rejects zero and non-numbers", () => {
    expect(validateRefundAmount("0", "12.00")).toMatchObject({ ok: false, message: "The refund must be more than zero." });
    expect(validateRefundAmount("0.00", "12.00")).toMatchObject({ ok: false });
    expect(validateRefundAmount("-3", "12.00")).toMatchObject({ ok: false });
    expect(validateRefundAmount("twelve", "12.00")).toMatchObject({ ok: false });
    expect(validateRefundAmount("1,50", "12.00")).toMatchObject({ ok: false });
  });
  it("rejects more than 2 decimal places instead of rounding", () => {
    expect(validateRefundAmount("1.005", "12.00")).toEqual({ ok: false, message: "Use at most 2 decimal places." });
  });
  it("rejects more than what can still be refunded and says how much that is", () => {
    expect(validateRefundAmount("12.01", "12.00", fmt)).toEqual({ ok: false, message: "At most $12.00 can still be refunded on this payment." });
  });
  it("explains when nothing is left", () => {
    expect(validateRefundAmount("1", "0.00")).toEqual({ ok: false, message: "There is nothing left to refund on this payment." });
  });
});

describe("validateRefundReason", () => {
  it("requires a reason and caps it at the API's 300 characters", () => {
    expect(validateRefundReason("   ")).toMatch(/Say why/);
    expect(validateRefundReason("Damaged on delivery")).toBeNull();
    expect(validateRefundReason("x".repeat(300))).toBeNull();
    expect(validateRefundReason("x".repeat(301))).toMatch(/300/);
  });
});

describe("request body and idempotency", () => {
  const draft = { amount: "2.50", reason: "  leaking bottle ", manual: false };
  it("matches POST /orders/{number}/refund/ (amount, reason, manual, idempotency_key)", () => {
    expect(refundPayload(draft, "key-12345678")).toEqual({ amount: "2.50", reason: "leaking bottle", manual: false, idempotency_key: "key-12345678" });
  });
  it("the same draft has the same signature, a changed draft does not", () => {
    expect(draftSignature(draft)).toBe(draftSignature({ ...draft, reason: "leaking bottle" }));
    expect(draftSignature(draft)).not.toBe(draftSignature({ ...draft, amount: "2.60" }));
    expect(draftSignature(draft)).not.toBe(draftSignature({ ...draft, manual: true }));
  });
  it("cash on delivery is always refunded manually, as the server does", () => {
    expect(isManualRefund("cod", false)).toBe(true);
    expect(isManualRefund("demo", false)).toBe(false);
    expect(isManualRefund("stripe", true)).toBe(true);
  });
});
