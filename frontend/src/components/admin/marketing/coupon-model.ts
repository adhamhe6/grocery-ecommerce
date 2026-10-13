// Coupons: form <-> API payload, validation, state and the plain-language summary.
import type { Errors } from "../catalog/form-kit";
import { describeTargets, scheduleText, type SummaryCtx } from "./promotion-model";

export type CouponKind = "PERCENT" | "FIXED" | "FREE_DELIVERY";
export type CouponScope = "ALL" | "CATEGORIES" | "PRODUCTS";

export const COUPON_KINDS: { value: CouponKind; title: string; description: string }[] = [
  { value: "PERCENT", title: "Percent off", description: "A percentage of the eligible items, optionally capped." },
  { value: "FIXED", title: "Fixed amount off", description: "A set amount taken off the order (never more than the eligible items cost)." },
  { value: "FREE_DELIVERY", title: "Free delivery", description: "Waives the delivery fee. Doesn't apply to store pickup." },
];
export const COUPON_SCOPES: { value: CouponScope; title: string; description: string }[] = [
  { value: "ALL", title: "Whole basket", description: "Every item in the basket is eligible." },
  { value: "CATEGORIES", title: "Selected categories", description: "Only items in the chosen categories (a department includes its categories)." },
  { value: "PRODUCTS", title: "Selected products", description: "Only the products you pick." },
];

export interface CouponRow {
  id: number; code: string; description: string; kind: CouponKind; value: string; max_discount: string | null; min_order_value: string; starts_at: string; ends_at: string | null;
  usage_limit: number | null; per_customer_limit: number | null; first_order_only: boolean; scope: CouponScope; categories: number[]; products: number[]; excluded_products: number[];
  exclude_discounted_items: boolean; used_count: number; is_redeemed: boolean; is_active: boolean; is_demo: boolean; created_at: string; updated_at: string;
}

export interface CouponForm {
  code: string; description: string; kind: CouponKind; value: string; maxDiscount: string; minOrderValue: string; startsAt: string | null; endsAt: string | null;
  usageLimit: string; perCustomerLimit: string; firstOrderOnly: boolean; scope: CouponScope; categories: number[]; products: number[]; excludedProducts: number[];
  excludeDiscountedItems: boolean; isActive: boolean;
}

export const emptyCoupon = (): CouponForm => ({
  code: "", description: "", kind: "PERCENT", value: "", maxDiscount: "", minOrderValue: "", startsAt: null, endsAt: null,
  usageLimit: "", perCustomerLimit: "1", firstOrderOnly: false, scope: "ALL", categories: [], products: [], excludedProducts: [], excludeDiscountedItems: true, isActive: true,
});

export const couponToForm = (c: CouponRow): CouponForm => ({
  code: c.code, description: c.description, kind: c.kind, value: c.kind === "FREE_DELIVERY" ? "" : c.value, maxDiscount: c.max_discount ?? "", minOrderValue: Number(c.min_order_value) > 0 ? c.min_order_value : "",
  startsAt: c.starts_at, endsAt: c.ends_at, usageLimit: c.usage_limit == null ? "" : String(c.usage_limit), perCustomerLimit: c.per_customer_limit == null ? "" : String(c.per_customer_limit),
  firstOrderOnly: c.first_order_only, scope: c.scope, categories: c.categories, products: c.products, excludedProducts: c.excluded_products, excludeDiscountedItems: c.exclude_discounted_items, isActive: c.is_active,
});

const t = (s: string) => s.trim();
const intOrRaw = (s: string): number | string | null => (t(s) === "" ? null : /^\d+$/.test(t(s)) ? Number(t(s)) : t(s));

/** Body for POST / PATCH /coupons/. Free delivery sends a zero value and the whole basket; caps only exist for percent coupons. */
export function couponPayload(f: CouponForm): Record<string, unknown> {
  const free = f.kind === "FREE_DELIVERY";
  const scope: CouponScope = free ? "ALL" : f.scope;
  const body: Record<string, unknown> = {
    code: t(f.code).toUpperCase(), description: t(f.description), kind: f.kind,
    value: free ? "0" : t(f.value),
    max_discount: f.kind === "PERCENT" ? t(f.maxDiscount) || null : null,
    min_order_value: t(f.minOrderValue) || "0",
    usage_limit: intOrRaw(f.usageLimit), per_customer_limit: intOrRaw(f.perCustomerLimit),
    first_order_only: f.firstOrderOnly, scope,
    categories: scope === "CATEGORIES" ? f.categories : [],
    products: scope === "PRODUCTS" ? f.products : [],
    excluded_products: free ? [] : f.excludedProducts,
    exclude_discounted_items: f.excludeDiscountedItems, is_active: f.isActive, ends_at: f.endsAt,
  };
  if (f.startsAt) body.starts_at = f.startsAt;
  return body;
}

export function validateCoupon(f: CouponForm): Errors {
  const e: Errors = {};
  if (!t(f.code)) e.code = "Enter the code customers will type, for example WELCOME10.";
  if (f.kind !== "FREE_DELIVERY" && !t(f.value)) e.value = f.kind === "PERCENT" ? "Enter the percentage off (above 0, up to 100)." : "Enter the amount off.";
  if (f.scope === "CATEGORIES" && f.kind !== "FREE_DELIVERY" && f.categories.length === 0) e.categories = "Choose at least one category.";
  if (f.scope === "PRODUCTS" && f.kind !== "FREE_DELIVERY" && f.products.length === 0) e.products = "Choose at least one product.";
  return e;
}

/** "10% off (up to $5.00) orders over $30, first order only, once per customer, 1–30 Nov 2026" */
export function summariseCoupon(f: CouponForm, targets: string, ctx: SummaryCtx): string {
  const money = (v: string) => (t(v) === "" || Number.isNaN(Number(v)) ? "…" : ctx.money(v));
  const pct = t(f.value) === "" ? "…" : f.value.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  const scope = f.kind === "FREE_DELIVERY" ? "" : f.scope === "ALL" ? " on the whole basket" : ` on ${targets}`;
  let offer = f.kind === "FREE_DELIVERY" ? "Free delivery" : f.kind === "PERCENT" ? `${pct}% off${t(f.maxDiscount) ? ` (up to ${money(f.maxDiscount)})` : ""}` : `${money(f.value)} off`;
  offer += scope;
  const parts = [offer];
  if (Number(f.minOrderValue) > 0) parts.push(`orders of ${money(f.minOrderValue)} or more`);
  if (f.firstOrderOnly) parts.push("first order only");
  const per = intOrRaw(f.perCustomerLimit);
  parts.push(per == null ? "unlimited uses per customer" : per === 1 ? "once per customer" : `${per} uses per customer`);
  const total = intOrRaw(f.usageLimit);
  if (total != null) parts.push(`${total} uses in total`);
  parts.push(scheduleText(f.startsAt, f.endsAt, ctx));
  return parts.join(", ");
}

export type CouponState = "Live" | "Scheduled" | "Expired" | "Used up" | "Off";
export function couponState(c: Pick<CouponRow, "is_active" | "starts_at" | "ends_at" | "usage_limit" | "used_count">, now = new Date()): CouponState {
  if (!c.is_active) return "Off";
  if (c.ends_at && new Date(c.ends_at) <= now) return "Expired";
  if (new Date(c.starts_at) > now) return "Scheduled";
  if (c.usage_limit != null && c.used_count >= c.usage_limit) return "Used up";
  return "Live";
}

export { describeTargets };
