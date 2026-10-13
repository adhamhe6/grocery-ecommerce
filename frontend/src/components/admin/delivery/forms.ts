// Validation and request bodies for the store, zone and slot-template forms.
import { decimalPlaces, isDecimal, isNegative } from "@/components/admin/purchasing/decimal";
import { toHHMM } from "./hours";
import type { SlotKind } from "./types";

/** Money fields are stored with two decimal places and can't be negative. */
export function validateMoney(value: string, opts: { required?: boolean } = {}): string | null {
  const t = value.trim();
  if (!t) return opts.required ? "Enter an amount (0 is fine)." : null;
  if (!isDecimal(t) || t.startsWith("+")) return "Enter an amount like 3.50.";
  if (isNegative(t)) return "The amount can't be negative.";
  if (decimalPlaces(t) > 2) return "Use at most two decimal places.";
  return null;
}

export function validateWholeNumber(value: string, opts: { min?: number; max?: number; label?: string } = {}): string | null {
  const t = value.trim();
  const label = opts.label ?? "number";
  if (!/^\d{1,9}$/.test(t)) return `Enter a whole ${label}.`;
  const n = Number(t);
  if (opts.min !== undefined && n < opts.min) return `Must be at least ${opts.min}.`;
  if (opts.max !== undefined && n > opts.max) return `Must be at most ${opts.max}.`;
  return null;
}

/** Blank means “the store’s own timezone”; anything else must be a real IANA name or slot generation breaks. */
export function validateTimeZone(value: string): string | null {
  const t = value.trim();
  if (!t) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: t });
    return null;
  } catch {
    return "That isn't a known timezone. Use a name like Europe/London, or leave it blank.";
  }
}

/** “RW3, rw4\nRW5” → ["RW3", "rw4", "RW5"]; the server upper-cases, de-duplicates and strips spaces. */
export const splitList = (text: string): string[] => text.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);

export const slugify = (s: string, max = 80): string => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max).replace(/-+$/g, "");

export interface ZoneForm { branch: number | null; name: string; postcodes: string; areas: string; fee: string; freeOver: string; minOrder: string; priority: string; active: boolean }

export function zoneErrors(f: ZoneForm, creating: boolean): Record<string, string> {
  const e: Record<string, string> = {};
  if (!f.branch) e.branch = "Choose the store this zone belongs to.";
  if (!f.name.trim()) e.name = "Give the zone a name.";
  if (creating && splitList(f.postcodes).length === 0 && splitList(f.areas).length === 0) e.postcodes = "Add at least one postcode prefix or area so the zone covers somewhere.";
  const fee = validateMoney(f.fee, { required: true }); if (fee) e.fee = fee;
  const free = validateMoney(f.freeOver); if (free) e.freeOver = free;
  const min = validateMoney(f.minOrder, { required: true }); if (min) e.minOrder = min;
  const pr = validateWholeNumber(f.priority, { min: 0, max: 32767, label: "priority" }); if (pr) e.priority = pr;
  return e;
}

export function zonePayload(f: ZoneForm) {
  return {
    branch: f.branch,
    name: f.name.trim(),
    postcode_prefixes: splitList(f.postcodes),
    areas: splitList(f.areas),
    delivery_fee: f.fee.trim(),
    free_delivery_threshold: f.freeOver.trim() ? f.freeOver.trim() : null,
    min_order_value: f.minOrder.trim(),
    priority: Number(f.priority),
    is_active: f.active,
  };
}

export interface TemplateForm { branch: number | null; kind: SlotKind; zone: number | null; weekday: number; start: string; end: string; capacity: string; fee: string; active: boolean }

export function templateErrors(f: TemplateForm): Record<string, string> {
  const e: Record<string, string> = {};
  if (!f.branch) e.branch = "Choose a store.";
  if (f.kind === "DELIVERY" && !f.zone) e.zone = "Delivery slots belong to a delivery zone.";
  if (!f.start) e.start = "Set a start time.";
  if (!f.end) e.end = "Set an end time.";
  if (f.start && f.end && f.start >= f.end) e.end = "The slot must start before it ends.";
  const cap = validateWholeNumber(f.capacity, { min: 1, max: 100000, label: "capacity" }); if (cap) e.capacity = cap;
  const fee = validateMoney(f.fee); if (fee) e.fee = fee;
  return e;
}

export function templatePayload(f: TemplateForm) {
  return {
    branch: f.branch,
    kind: f.kind,
    zone: f.kind === "DELIVERY" ? f.zone : null,
    weekday: f.weekday,
    start_time: f.start,
    end_time: f.end,
    capacity: Number(f.capacity),
    fee: f.fee.trim() ? f.fee.trim() : null,
    is_active: f.active,
  };
}

export const timeInput = toHHMM;
