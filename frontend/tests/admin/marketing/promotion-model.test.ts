import { describe, expect, it } from "vitest";
import {
  describeTargets, emptyPromotion, promotionPayload, promotionState, promotionToForm, scheduleText, summarisePromotion, suggestLabel, validatePromotion, type PromotionRow,
} from "@/components/admin/marketing/promotion-model";

const money = (v: string | number) => `$${Number(v).toFixed(2)}`;
const ctx = { money, timeZone: "UTC", locale: "en-GB" };
const range = { startsAt: "2026-11-01T00:00:00Z", endsAt: "2026-11-30T00:00:00Z" };

describe("describeTargets", () => {
  it("names up to three targets", () => {
    expect(describeTargets("CATEGORIES", ["Fresh fruit"], 1)).toBe("Fresh fruit");
    expect(describeTargets("PRODUCTS", ["Apples", "Pears"], 2)).toBe("Apples and Pears");
    expect(describeTargets("PRODUCTS", ["A", "B", "C"], 3)).toBe("A, B and C");
  });
  it("counts the rest", () => expect(describeTargets("CATEGORIES", ["A", "B", "C", "D"], 6)).toBe("A, B, C and 3 more"));
  it("falls back to counts when names are not known, and says when nothing is chosen", () => {
    expect(describeTargets("PRODUCTS", [], 5)).toBe("5 products");
    expect(describeTargets("PRODUCTS", [], 1)).toBe("1 product");
    expect(describeTargets("CATEGORIES", [], 2)).toBe("2 categories");
    expect(describeTargets("BRANDS", [], 0)).toBe("(nothing chosen yet)");
    expect(describeTargets("ALL", [], 0)).toBe("the whole basket");
  });
  it("calls brand targets products of that brand", () => expect(describeTargets("BRANDS", ["Green Valley"], 1)).toBe("Green Valley products"));
});

describe("summarisePromotion", () => {
  it("percent off", () => {
    const f = { ...emptyPromotion(), percent: "10.00", ...range };
    expect(summarisePromotion(f, "Fresh fruit", ctx)).toBe("10% off Fresh fruit, 1–30 Nov 2026");
  });
  it("keeps real decimals in a percentage", () => expect(summarisePromotion({ ...emptyPromotion(), percent: "12.50", ...range }, "Veg", ctx)).toContain("12.5% off Veg"));
  it("amount off each unit", () => {
    const f = { ...emptyPromotion(), kind: "AMOUNT_OFF" as const, amountOff: "0.5", ...range };
    expect(summarisePromotion(f, "Gala apples", ctx)).toBe("$0.50 off each unit of Gala apples, 1–30 Nov 2026");
  });
  it("multibuy", () => {
    const f = { ...emptyPromotion(), kind: "MULTIBUY" as const, multibuyQty: "3", multibuyPrice: "5", startsAt: "2026-11-01T00:00:00Z", endsAt: null };
    expect(summarisePromotion(f, "Yoghurts", ctx)).toBe("3 for $5.00 on Yoghurts, from 1 Nov 2026, no end date");
  });
  it("shows an ellipsis for anything not filled in yet, rather than a made-up number", () => {
    expect(summarisePromotion({ ...emptyPromotion(), startsAt: null, endsAt: null }, "(nothing chosen yet)", ctx)).toBe("…% off (nothing chosen yet), from when it is saved, no end date");
    expect(summarisePromotion({ ...emptyPromotion(), kind: "MULTIBUY", startsAt: null, endsAt: null }, "X", ctx)).toBe("… for … on X, from when it is saved, no end date");
  });
  it("describes an unscheduled start with an end date", () => expect(scheduleText(null, "2026-12-24T12:00:00Z", ctx)).toBe("from when it is saved until 24 Dec 2026"));
});

describe("suggestLabel", () => {
  it("offers a badge that matches the offer, and nothing while it is incomplete", () => {
    expect(suggestLabel({ ...emptyPromotion(), percent: "20.00" }, money)).toBe("20% off");
    expect(suggestLabel({ ...emptyPromotion(), kind: "AMOUNT_OFF", amountOff: "0.5" }, money)).toBe("$0.50 off");
    expect(suggestLabel({ ...emptyPromotion(), kind: "MULTIBUY", multibuyQty: "3", multibuyPrice: "5" }, money)).toBe("3 for $5.00");
    expect(suggestLabel(emptyPromotion(), money)).toBe("");
  });
});

describe("promotionPayload", () => {
  it("clears the parameters and targets that belong to other kinds and scopes", () => {
    const f = { ...emptyPromotion(), name: " Apple week ", label: "20% off", percent: "20", amountOff: "1", multibuyQty: "3", multibuyPrice: "5", products: [1, 2], categories: [9], brands: [4] };
    expect(promotionPayload(f)).toEqual({
      name: "Apple week", label: "20% off", kind: "PERCENT_OFF", scope: "PRODUCTS", is_active: true, percent: "20", amount_off: null, multibuy_qty: null, multibuy_price: null,
      products: [1, 2], categories: [], brands: [], ends_at: null,
    });
  });
  it("sends only the multibuy parameters for a multibuy and omits an unset start", () => {
    const body = promotionPayload({ ...emptyPromotion(), name: "3 for 5", label: "3 for $5", kind: "MULTIBUY", multibuyQty: "3", multibuyPrice: "5.00", scope: "BRANDS", brands: [4], percent: "99" });
    expect(body).toMatchObject({ percent: null, amount_off: null, multibuy_qty: 3, multibuy_price: "5.00", products: [], brands: [4] });
    expect(body).not.toHaveProperty("starts_at");
    expect(promotionPayload({ ...emptyPromotion(), startsAt: "2026-11-01T00:00:00Z" })).toHaveProperty("starts_at", "2026-11-01T00:00:00Z");
  });
  it("round-trips a saved promotion", () => {
    const row = { id: 1, name: "N", label: "L", kind: "AMOUNT_OFF", scope: "CATEGORIES", products: [], categories: [3], brands: [], percent: null, amount_off: "0.50", multibuy_qty: null, multibuy_price: null, starts_at: "2026-11-01T00:00:00Z", ends_at: null, is_active: false } as unknown as PromotionRow;
    const f = promotionToForm(row);
    expect(f).toMatchObject({ kind: "AMOUNT_OFF", amountOff: "0.50", categories: [3], isActive: false });
    expect(promotionPayload(f)).toMatchObject({ amount_off: "0.50", categories: [3], is_active: false, percent: null });
  });
});

describe("validatePromotion", () => {
  it("asks only for what the chosen kind and scope need", () => {
    expect(Object.keys(validatePromotion(emptyPromotion())).sort()).toEqual(["label", "name", "percent", "products"]);
    const multi = { ...emptyPromotion(), kind: "MULTIBUY" as const, scope: "BRANDS" as const };
    expect(Object.keys(validatePromotion(multi)).sort()).toEqual(["brands", "label", "multibuy_price", "multibuy_qty", "name"]);
    expect(validatePromotion({ ...emptyPromotion(), name: "n", label: "l", percent: "10", products: [1] })).toEqual({});
  });
});

describe("promotionState", () => {
  const now = new Date("2026-11-10T00:00:00Z");
  const p = { is_active: true, is_running: false, starts_at: "2026-11-01T00:00:00Z", ends_at: null as string | null };
  it("labels the lifecycle", () => {
    expect(promotionState({ ...p, is_active: false }, now)).toBe("Off");
    expect(promotionState({ ...p, is_running: true }, now)).toBe("Running");
    expect(promotionState({ ...p, starts_at: "2026-12-01T00:00:00Z" }, now)).toBe("Scheduled");
    expect(promotionState({ ...p, ends_at: "2026-11-05T00:00:00Z" }, now)).toBe("Ended");
  });
});
