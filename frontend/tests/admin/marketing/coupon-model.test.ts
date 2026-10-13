import { describe, expect, it } from "vitest";
import { couponPayload, couponState, couponToForm, emptyCoupon, summariseCoupon, validateCoupon, type CouponRow } from "@/components/admin/marketing/coupon-model";

const money = (v: string | number) => `$${Number(v).toFixed(2)}`;
const ctx = { money, timeZone: "UTC", locale: "en-GB" };

describe("couponPayload", () => {
  it("upper-cases the code and keeps decimals as strings", () => {
    const body = couponPayload({ ...emptyCoupon(), code: " welcome10 ", value: "10", minOrderValue: "30.00", maxDiscount: "5" });
    expect(body).toMatchObject({ code: "WELCOME10", kind: "PERCENT", value: "10", max_discount: "5", min_order_value: "30.00", scope: "ALL", per_customer_limit: 1, usage_limit: null, exclude_discounted_items: true });
  });
  it("sends unlimited limits as null and a blank minimum spend as zero", () => {
    const body = couponPayload({ ...emptyCoupon(), code: "X", value: "5", kind: "FIXED", perCustomerLimit: "", usageLimit: "" });
    expect(body).toMatchObject({ per_customer_limit: null, usage_limit: null, min_order_value: "0", max_discount: null });
  });
  it("free delivery: zero value, whole basket, no targets or exclusions", () => {
    const body = couponPayload({ ...emptyCoupon(), code: "SHIPFREE", kind: "FREE_DELIVERY", value: "9", maxDiscount: "3", scope: "PRODUCTS", products: [1], excludedProducts: [2] });
    expect(body).toMatchObject({ value: "0", max_discount: null, scope: "ALL", products: [], categories: [], excluded_products: [] });
  });
  it("sends only the chosen scope's targets", () => {
    const body = couponPayload({ ...emptyCoupon(), code: "FRUIT", value: "10", scope: "CATEGORIES", categories: [3], products: [9], excludedProducts: [5] });
    expect(body).toMatchObject({ categories: [3], products: [], excluded_products: [5] });
  });
  it("round-trips a saved coupon without turning a zero minimum into text", () => {
    const row = { id: 1, code: "A", description: "", kind: "PERCENT", value: "10.00", max_discount: null, min_order_value: "0.00", starts_at: "2026-11-01T00:00:00Z", ends_at: null, usage_limit: 100, per_customer_limit: null, first_order_only: true, scope: "ALL", categories: [], products: [], excluded_products: [], exclude_discounted_items: true, used_count: 3, is_redeemed: true, is_active: true } as unknown as CouponRow;
    const f = couponToForm(row);
    expect(f).toMatchObject({ minOrderValue: "", usageLimit: "100", perCustomerLimit: "", firstOrderOnly: true });
    expect(couponPayload(f)).toMatchObject({ usage_limit: 100, per_customer_limit: null, min_order_value: "0", first_order_only: true });
  });
});

describe("validateCoupon", () => {
  it("needs a code, and a value unless it is free delivery", () => {
    expect(Object.keys(validateCoupon(emptyCoupon())).sort()).toEqual(["code", "value"]);
    expect(validateCoupon({ ...emptyCoupon(), code: "SHIP", kind: "FREE_DELIVERY" })).toEqual({});
  });
  it("needs targets when the scope is narrowed", () => {
    expect(validateCoupon({ ...emptyCoupon(), code: "A", value: "5", scope: "CATEGORIES" })).toHaveProperty("categories");
    expect(validateCoupon({ ...emptyCoupon(), code: "A", value: "5", scope: "PRODUCTS" })).toHaveProperty("products");
  });
});

describe("summariseCoupon", () => {
  it("reads like a sentence", () => {
    const f = { ...emptyCoupon(), code: "WELCOME10", value: "10.00", maxDiscount: "5", minOrderValue: "30", firstOrderOnly: true, startsAt: "2026-11-01T00:00:00Z", endsAt: "2026-11-30T00:00:00Z" };
    expect(summariseCoupon(f, "", ctx)).toBe("10% off (up to $5.00) on the whole basket, orders of $30.00 or more, first order only, once per customer, 1–30 Nov 2026");
  });
  it("covers fixed amounts, scoped targets, free delivery and limits", () => {
    expect(summariseCoupon({ ...emptyCoupon(), kind: "FIXED", value: "5", scope: "CATEGORIES", perCustomerLimit: "", usageLimit: "50", startsAt: null }, "Fresh fruit", ctx)).toBe("$5.00 off on Fresh fruit, unlimited uses per customer, 50 uses in total, from when it is saved, no end date");
    expect(summariseCoupon({ ...emptyCoupon(), kind: "FREE_DELIVERY", perCustomerLimit: "3", startsAt: null }, "", ctx)).toBe("Free delivery, 3 uses per customer, from when it is saved, no end date");
  });
});

describe("couponState", () => {
  const now = new Date("2026-11-10T00:00:00Z");
  const c = { is_active: true, starts_at: "2026-11-01T00:00:00Z", ends_at: null as string | null, usage_limit: null as number | null, used_count: 0 };
  it("labels the lifecycle", () => {
    expect(couponState({ ...c, is_active: false }, now)).toBe("Off");
    expect(couponState(c, now)).toBe("Live");
    expect(couponState({ ...c, starts_at: "2026-12-01T00:00:00Z" }, now)).toBe("Scheduled");
    expect(couponState({ ...c, ends_at: "2026-11-09T00:00:00Z" }, now)).toBe("Expired");
    expect(couponState({ ...c, usage_limit: 10, used_count: 10 }, now)).toBe("Used up");
  });
});
