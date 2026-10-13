// Promotions: kinds and their parameters (mirrors backend `PromotionKind` / `KIND_FIELDS`), payload builder,
// validation and the plain-language summary shown while editing.
import { formatSchedule } from "../catalog/datetime";
import type { Errors } from "../catalog/form-kit";

export type PromoKind = "PERCENT_OFF" | "AMOUNT_OFF" | "MULTIBUY";
export type PromoScope = "PRODUCTS" | "CATEGORIES" | "BRANDS";

export const PROMO_KINDS: { value: PromoKind; title: string; description: string }[] = [
  { value: "PERCENT_OFF", title: "Percent off", description: "Takes a percentage off the shelf price, for example 20% off." },
  { value: "AMOUNT_OFF", title: "Amount off per unit", description: "Takes a fixed amount off every unit, for example 50p off each." },
  { value: "MULTIBUY", title: "Multibuy (N for a fixed price)", description: "Buy a number of items for one price, for example 3 for 5.00. Extra items are charged at the normal price." },
];
export const PROMO_SCOPES: { value: PromoScope; title: string; description: string }[] = [
  { value: "PRODUCTS", title: "Selected products", description: "Only the products you pick." },
  { value: "CATEGORIES", title: "Categories", description: "Every product in the chosen categories (a department includes its categories)." },
  { value: "BRANDS", title: "Brands", description: "Every product of the chosen brands." },
];
/** Which parameters each kind uses — the form shows only these. */
export const KIND_PARAMS: Record<PromoKind, string[]> = { PERCENT_OFF: ["percent"], AMOUNT_OFF: ["amount_off"], MULTIBUY: ["multibuy_qty", "multibuy_price"] };

export interface PromotionRow {
  id: number; name: string; label: string; kind: PromoKind; scope: PromoScope; products: number[]; categories: number[]; brands: number[];
  percent: string | null; amount_off: string | null; multibuy_qty: number | null; multibuy_price: string | null; starts_at: string; ends_at: string | null;
  is_active: boolean; is_running: boolean; is_demo: boolean; warnings: string[]; created_at: string; updated_at: string;
}

export interface PromotionForm {
  name: string; label: string; kind: PromoKind; scope: PromoScope; products: number[]; categories: number[]; brands: number[];
  percent: string; amountOff: string; multibuyQty: string; multibuyPrice: string; startsAt: string | null; endsAt: string | null; isActive: boolean;
}

export const emptyPromotion = (): PromotionForm => ({
  name: "", label: "", kind: "PERCENT_OFF", scope: "PRODUCTS", products: [], categories: [], brands: [],
  percent: "", amountOff: "", multibuyQty: "", multibuyPrice: "", startsAt: null, endsAt: null, isActive: true,
});

export const promotionToForm = (p: PromotionRow): PromotionForm => ({
  name: p.name, label: p.label, kind: p.kind, scope: p.scope, products: p.products, categories: p.categories, brands: p.brands,
  percent: p.percent ?? "", amountOff: p.amount_off ?? "", multibuyQty: p.multibuy_qty == null ? "" : String(p.multibuy_qty), multibuyPrice: p.multibuy_price ?? "",
  startsAt: p.starts_at, endsAt: p.ends_at, isActive: p.is_active,
});

const t = (s: string) => s.trim();

/**
 * Body for POST / PATCH /promotions/. Only the chosen kind's parameters carry values (the others are cleared), and only the
 * chosen scope's targets are sent (the others are emptied) — the same rule the API enforces.
 */
export function promotionPayload(f: PromotionForm): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: t(f.name), label: t(f.label), kind: f.kind, scope: f.scope, is_active: f.isActive,
    percent: f.kind === "PERCENT_OFF" ? t(f.percent) || null : null,
    amount_off: f.kind === "AMOUNT_OFF" ? t(f.amountOff) || null : null,
    multibuy_qty: f.kind === "MULTIBUY" ? (t(f.multibuyQty) === "" ? null : /^\d+$/.test(t(f.multibuyQty)) ? Number(t(f.multibuyQty)) : t(f.multibuyQty)) : null,
    multibuy_price: f.kind === "MULTIBUY" ? t(f.multibuyPrice) || null : null,
    products: f.scope === "PRODUCTS" ? f.products : [],
    categories: f.scope === "CATEGORIES" ? f.categories : [],
    brands: f.scope === "BRANDS" ? f.brands : [],
    ends_at: f.endsAt,
  };
  if (f.startsAt) body.starts_at = f.startsAt; // blank = the server's default, "now"
  return body;
}

/** Obvious required fields only; the API stays the judge of everything else. */
export function validatePromotion(f: PromotionForm): Errors {
  const e: Errors = {};
  if (!t(f.name)) e.name = "Give the promotion a name your team will recognise.";
  if (!t(f.label)) e.label = "Enter the badge text shoppers will see, for example “20% off”.";
  if (f.kind === "PERCENT_OFF" && !t(f.percent)) e.percent = "Enter the percentage off (above 0, up to 100).";
  if (f.kind === "AMOUNT_OFF" && !t(f.amountOff)) e.amount_off = "Enter the amount taken off each unit.";
  if (f.kind === "MULTIBUY") {
    if (!t(f.multibuyQty)) e.multibuy_qty = "Enter how many items the deal covers (at least 2).";
    if (!t(f.multibuyPrice)) e.multibuy_price = "Enter the price for the whole group.";
  }
  const noun = { PRODUCTS: "product", CATEGORIES: "category", BRANDS: "brand" }[f.scope];
  const field = { PRODUCTS: "products", CATEGORIES: "categories", BRANDS: "brands" }[f.scope];
  if (f[field as "products"].length === 0) e[field] = `Choose at least one ${noun}.`;
  return e;
}

// ------------------------------------------------------------------------------------------------ plain-language summary
export interface SummaryCtx { money: (v: string | number) => string; timeZone: string; locale?: string }

/** "Gala apples, Pears and Plums" / "Fresh fruit, Veg and 2 more" / "3 products" (when names are unknown). */
export function describeTargets(scope: PromoScope | "ALL", names: string[], total: number): string {
  if (scope === "ALL") return "the whole basket";
  if (total === 0) return "(nothing chosen yet)";
  const noun = scope === "PRODUCTS" ? "product" : scope === "CATEGORIES" ? "categor" : "brand";
  if (names.length === 0) return noun === "categor" ? `${total} ${total === 1 ? "category" : "categories"}` : `${total} ${noun}${total === 1 ? "" : "s"}`;
  const shown = names.slice(0, 3);
  const rest = total - shown.length;
  const list = rest > 0 ? `${shown.join(", ")} and ${rest} more` : shown.length === 1 ? shown[0] : `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
  return scope === "BRANDS" ? `${list} products` : list;
}

export function scheduleText(startIso: string | null, endIso: string | null, ctx: SummaryCtx): string {
  if (startIso) return formatSchedule(startIso, endIso, ctx.timeZone, ctx.locale);
  if (endIso) return `from when it is saved until ${new Intl.DateTimeFormat(ctx.locale ?? "en-GB", { timeZone: ctx.timeZone, day: "numeric", month: "short", year: "numeric" }).format(new Date(endIso))}`;
  return "from when it is saved, no end date";
}

const num = (s: string) => (t(s) === "" ? null : s.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "")); // "20.00" -> "20"

/** e.g. "10% off Fresh fruit, 1–30 Nov 2026". Unfilled parameters show as "…" so the sentence never lies. */
export function summarisePromotion(f: Pick<PromotionForm, "kind" | "scope" | "percent" | "amountOff" | "multibuyQty" | "multibuyPrice" | "startsAt" | "endsAt">, targets: string, ctx: SummaryCtx): string {
  const when = scheduleText(f.startsAt, f.endsAt, ctx);
  const amount = (v: string) => (t(v) === "" || Number.isNaN(Number(v)) ? "…" : ctx.money(v));
  let offer: string;
  if (f.kind === "PERCENT_OFF") offer = `${num(f.percent) ?? "…"}% off ${targets}`;
  else if (f.kind === "AMOUNT_OFF") offer = `${amount(f.amountOff)} off each unit of ${targets}`;
  else offer = `${t(f.multibuyQty) || "…"} for ${amount(f.multibuyPrice)} on ${targets}`;
  return `${offer}, ${when}`;
}

/** A sensible badge text for the offer, offered as a one-click suggestion (never applied silently). */
export function suggestLabel(f: Pick<PromotionForm, "kind" | "percent" | "amountOff" | "multibuyQty" | "multibuyPrice">, money: (v: string | number) => string): string {
  if (f.kind === "PERCENT_OFF") return num(f.percent) ? `${num(f.percent)}% off` : "";
  if (f.kind === "AMOUNT_OFF") return t(f.amountOff) && !Number.isNaN(Number(f.amountOff)) ? `${money(f.amountOff)} off` : "";
  return t(f.multibuyQty) && t(f.multibuyPrice) && !Number.isNaN(Number(f.multibuyPrice)) ? `${t(f.multibuyQty)} for ${money(f.multibuyPrice)}` : "";
}

export type PromoState = "Running" | "Scheduled" | "Ended" | "Off";
export function promotionState(p: Pick<PromotionRow, "is_active" | "is_running" | "starts_at" | "ends_at">, now = new Date()): PromoState {
  if (!p.is_active) return "Off";
  if (p.is_running) return "Running";
  return new Date(p.starts_at) > now ? "Scheduled" : "Ended";
}
