// Product editor model: API shapes, form state, payload builders, validators and server-error mapping.
// Pure functions only — the components stay thin and this file carries the tests.
import type { Errors } from "./form-kit";

// ------------------------------------------------------------------------------------------------ reference data
export const PRODUCT_TYPES: [string, string][] = [
  ["LOOSE_PRODUCE", "Loose produce"], ["PACKAGED", "Packaged goods"], ["CHILLED", "Chilled"], ["FROZEN", "Frozen"], ["BAKERY", "Bakery"], ["HOUSEHOLD", "Household"], ["PREPARED", "Made to order"],
];
export const STORAGE_TYPES: [string, string][] = [["AMBIENT", "Ambient"], ["CHILLED", "Chilled"], ["FROZEN", "Frozen"]];
export const STOCK_MODES: [string, string][] = [["TRACKED", "Tracked stock"], ["MADE_TO_ORDER", "Made to order (no stock count)"]];
export const PRODUCT_STATUSES: [string, string][] = [["ACTIVE", "Active"], ["INACTIVE", "Inactive (hidden from the shop)"], ["ARCHIVED", "Archived"]];
export const CLAIM_KINDS: [string, string][] = [
  ["VEGAN", "Vegan"], ["VEGETARIAN", "Vegetarian"], ["GLUTEN_FREE", "Gluten-free"], ["LACTOSE_FREE", "Lactose-free"], ["SUGAR_FREE", "Sugar-free"],
  ["HALAL", "Halal"], ["KOSHER", "Kosher"], ["ORGANIC", "Organic"], ["FAIRTRADE", "Fairtrade"], ["LOCALLY_GROWN", "Locally grown"],
];
export const NUTRIENTS = [
  { key: "energy_kcal", label: "Energy", unit: "kcal" }, { key: "energy_kj", label: "Energy", unit: "kJ" }, { key: "fat", label: "Fat", unit: "g" },
  { key: "saturates", label: "of which saturates", unit: "g" }, { key: "carbohydrate", label: "Carbohydrate", unit: "g" }, { key: "sugars", label: "of which sugars", unit: "g" },
  { key: "fibre", label: "Fibre", unit: "g" }, { key: "protein", label: "Protein", unit: "g" }, { key: "salt", label: "Salt", unit: "g" },
] as const;
export type NutrientKey = (typeof NUTRIENTS)[number]["key"];
export const NUTRITION_BASES = ["per 100 g", "per 100 ml"];
/** Page gaps the products API reports in `missing` (and accepts in `?missing=`). */
export const MISSING_LABELS: Record<string, string> = {
  image: "Photo", description: "Description", origin: "Origin", nutrition: "Nutrition", ingredients: "Ingredients", allergens: "Allergens not confirmed", storage: "Storage instructions",
};
export const MAX_IMAGES = 8;

// ------------------------------------------------------------------------------------------------ API shapes
export interface ProductRow {
  id: number; sku: string; slug: string; name: string; short_description: string; description: string;
  category: number; category_name: string; brand: number | null; brand_name: string | null; barcode: string | null;
  product_type: string; storage_type: string; sale_unit: number; sale_unit_code: string; price: string; unit_price: { amount: string; per: string } | null; tax_rate: string;
  qty_min: string; qty_step: string; qty_max: string | null; net_content: string | null; net_content_unit: number | null; is_variable_weight: boolean;
  stock_mode: string; tracks_batches: boolean; is_perishable: boolean; sell_buffer_days: number;
  status: string; is_available: boolean; is_featured: boolean;
  origin_country: string; origin_note: string; storage_instructions: string; ingredients: string; packaging: string; manufacturer: string;
  allergen_info_complete: boolean; popularity: number; rating_avg: string | null; rating_count: number; is_demo: boolean; missing: string[]; created_at: string; updated_at: string;
}
export interface ProductImageRow { id: number; alt_text: string; sort_order: number; urls: Record<string, string>; created_at: string }
export interface ClaimRow { kind: string; verified: boolean; evidence: string; verified_by: string | null; verified_at: string | null }
export interface AllergenRow { allergen: string; name: string; level: "CONTAINS" | "MAY_CONTAIN" }
export interface NutritionRow { basis: string; source: string; is_demo: boolean; energy_kcal: string | null; energy_kj: string | null; fat: string | null; saturates: string | null; carbohydrate: string | null; sugars: string | null; fibre: string | null; protein: string | null; salt: string | null }
export interface ProductDetail extends ProductRow { images: ProductImageRow[]; claims: ClaimRow[]; allergens: AllergenRow[]; nutrition: NutritionRow | null }
export interface UnitRow { id: number; code: string; name: string; symbol: string; kind: "COUNT" | "WEIGHT" | "VOLUME"; allows_fraction: boolean }
export interface AllergenLookup { id: number; code: string; name: string }
export interface CategoryRow { id: number; parent: number | null; name: string; slug: string; description: string; image: Record<string, string>; sort_order: number; is_active: boolean; show_on_home: boolean; product_count: number; active_product_count: number; children_count: number }
export interface BrandRow { id: number; name: string; slug: string; description: string; is_active: boolean; is_demo: boolean; product_count: number }

// ------------------------------------------------------------------------------------------------ form state
export interface CoreForm {
  name: string; sku: string; slug: string; shortDescription: string; description: string; category: string; brand: string; barcode: string;
  productType: string; storageType: string; saleUnit: string; price: string; taxRate: string;
  qtyMin: string; qtyStep: string; qtyMax: string; netContent: string; netContentUnit: string; isVariableWeight: boolean;
  stockMode: string; tracksBatches: boolean; isPerishable: boolean; sellBufferDays: string;
  status: string; isAvailable: boolean; isFeatured: boolean;
  originCountry: string; originNote: string; storageInstructions: string; ingredients: string; packaging: string; manufacturer: string;
}
export type ClaimStatus = "none" | "claimed" | "verified";
export interface ClaimState { status: ClaimStatus; evidence: string; verifiedBy: string | null; verifiedAt: string | null }
export interface AllergensForm { levels: Record<string, "" | "CONTAINS" | "MAY_CONTAIN">; confirmed: boolean }
export interface NutritionForm { enabled: boolean; basis: string; source: string; values: Record<NutrientKey, string>; isDemo: boolean }
export interface ProductForm { core: CoreForm; claims: Record<string, ClaimState>; allergens: AllergensForm; nutrition: NutritionForm }
export type SectionKey = keyof ProductForm;
export const SECTION_KEYS: SectionKey[] = ["core", "claims", "allergens", "nutrition"];

const blankValues = () => Object.fromEntries(NUTRIENTS.map((n) => [n.key, ""])) as Record<NutrientKey, string>;
const blankClaims = () => Object.fromEntries(CLAIM_KINDS.map(([k]) => [k, { status: "none", evidence: "", verifiedBy: null, verifiedAt: null } as ClaimState]));

/** A new product. It starts inactive so nothing half-finished reaches the shop; every other default is the API's own. */
export function emptyProductForm(): ProductForm {
  return {
    core: {
      name: "", sku: "", slug: "", shortDescription: "", description: "", category: "", brand: "", barcode: "",
      productType: "PACKAGED", storageType: "AMBIENT", saleUnit: "", price: "", taxRate: "0",
      qtyMin: "1", qtyStep: "1", qtyMax: "", netContent: "", netContentUnit: "", isVariableWeight: false,
      stockMode: "TRACKED", tracksBatches: false, isPerishable: false, sellBufferDays: "1",
      status: "INACTIVE", isAvailable: true, isFeatured: false,
      originCountry: "", originNote: "", storageInstructions: "", ingredients: "", packaging: "", manufacturer: "",
    },
    claims: blankClaims(),
    allergens: { levels: {}, confirmed: false },
    nutrition: { enabled: false, basis: "", source: "", values: blankValues(), isDemo: false },
  };
}

/** Claim state from the API rows (kinds not listed are "not claimed"). */
export function claimsFromRows(rows: ClaimRow[]): Record<string, ClaimState> {
  const claims = blankClaims() as Record<string, ClaimState>;
  for (const c of rows ?? []) claims[c.kind] = { status: c.verified ? "verified" : "claimed", evidence: c.evidence ?? "", verifiedBy: c.verified_by, verifiedAt: c.verified_at };
  return claims;
}

export function productToForm(p: ProductDetail): ProductForm {
  const claims = claimsFromRows(p.claims);
  const levels: AllergensForm["levels"] = {};
  for (const a of p.allergens ?? []) levels[a.allergen] = a.level;
  const n = p.nutrition;
  const values = blankValues();
  if (n) for (const { key } of NUTRIENTS) values[key] = n[key] ?? "";
  return {
    core: {
      name: p.name, sku: p.sku, slug: p.slug, shortDescription: p.short_description, description: p.description, category: String(p.category), brand: p.brand == null ? "" : String(p.brand), barcode: p.barcode ?? "",
      productType: p.product_type, storageType: p.storage_type, saleUnit: String(p.sale_unit), price: p.price, taxRate: p.tax_rate,
      qtyMin: p.qty_min, qtyStep: p.qty_step, qtyMax: p.qty_max ?? "", netContent: p.net_content ?? "", netContentUnit: p.net_content_unit == null ? "" : String(p.net_content_unit), isVariableWeight: p.is_variable_weight,
      stockMode: p.stock_mode, tracksBatches: p.tracks_batches, isPerishable: p.is_perishable, sellBufferDays: String(p.sell_buffer_days),
      status: p.status, isAvailable: p.is_available, isFeatured: p.is_featured,
      originCountry: p.origin_country, originNote: p.origin_note, storageInstructions: p.storage_instructions, ingredients: p.ingredients, packaging: p.packaging, manufacturer: p.manufacturer,
    },
    claims,
    allergens: { levels, confirmed: p.allergen_info_complete },
    nutrition: { enabled: !!n, basis: n?.basis ?? "", source: n?.source ?? "", values, isDemo: !!n?.is_demo },
  };
}

// ------------------------------------------------------------------------------------------------ payload builders
const t = (s: string) => s.trim();
const asInt = (s: string): number | string => (/^\d+$/.test(t(s)) ? Number(t(s)) : t(s)); // non-numeric text goes through so the API explains it

/** Body for POST / PATCH /products/. Blank optional values become null (never ""), and no blank slug is sent. */
export function buildCorePayload(c: CoreForm): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: t(c.name), sku: t(c.sku), short_description: t(c.shortDescription), description: c.description.trim(),
    category: asInt(c.category), brand: t(c.brand) ? asInt(c.brand) : null, barcode: t(c.barcode) || null,
    product_type: c.productType, storage_type: c.storageType, sale_unit: asInt(c.saleUnit), price: t(c.price), tax_rate: t(c.taxRate) || "0",
    qty_min: t(c.qtyMin), qty_step: t(c.qtyStep), qty_max: t(c.qtyMax) || null,
    net_content: t(c.netContent) || null, net_content_unit: t(c.netContentUnit) ? asInt(c.netContentUnit) : null, is_variable_weight: c.isVariableWeight,
    stock_mode: c.stockMode, tracks_batches: c.tracksBatches, is_perishable: c.isPerishable, sell_buffer_days: asInt(c.sellBufferDays),
    status: c.status, is_available: c.isAvailable, is_featured: c.isFeatured,
    origin_country: t(c.originCountry), origin_note: t(c.originNote), storage_instructions: t(c.storageInstructions), ingredients: c.ingredients.trim(), packaging: t(c.packaging), manufacturer: t(c.manufacturer),
  };
  if (t(c.slug)) body.slug = t(c.slug);
  return body;
}

/** Only the keys whose value differs from `base` — a PATCH should not overwrite fields someone else changed meanwhile. */
export function diffPayload(base: Record<string, unknown>, next: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(next)) if (JSON.stringify(base[k]) !== JSON.stringify(v)) out[k] = v;
  return out;
}

/** Full claims list for PUT /products/:id/claims/ (a claim not listed is removed). */
export function buildClaimsPayload(claims: Record<string, ClaimState>): { kind: string; verified: boolean; evidence: string }[] {
  return CLAIM_KINDS.filter(([k]) => claims[k] && claims[k].status !== "none").map(([k]) => ({ kind: k, verified: claims[k].status === "verified", evidence: t(claims[k].evidence) }));
}

/** Body for PUT /products/:id/allergens/. `codes` is the allergen lookup order so the payload is stable. */
export function buildAllergensPayload(a: AllergensForm, codes: string[]): { allergens: { allergen: string; level: string }[]; allergen_info_complete: boolean } {
  return { allergens: codes.filter((c) => a.levels[c]).map((c) => ({ allergen: c, level: a.levels[c] })), allergen_info_complete: a.confirmed };
}

/** Body for PUT /products/:id/nutrition/. Blank nutrients are sent as null — unknown, never zero. */
export function buildNutritionPayload(n: NutritionForm): Record<string, unknown> {
  const body: Record<string, unknown> = { basis: t(n.basis), source: t(n.source) };
  for (const { key } of NUTRIENTS) body[key] = t(n.values[key]) === "" ? null : t(n.values[key]);
  return body;
}

// ------------------------------------------------------------------------------------------------ dirty tracking
const norm = (s: SectionKey, f: ProductForm): unknown => {
  if (s === "core") return Object.fromEntries(Object.entries(f.core).map(([k, v]) => [k, typeof v === "string" ? v.trim() : v]));
  if (s === "claims") return CLAIM_KINDS.map(([k]) => { const c = f.claims[k]; return c.status === "none" ? null : [k, c.status, t(c.evidence)]; });
  if (s === "allergens") return { levels: Object.entries(f.allergens.levels).filter(([, v]) => v).sort(([a], [b]) => a.localeCompare(b)), confirmed: f.allergens.confirmed };
  const n = f.nutrition;
  return n.enabled ? { basis: t(n.basis), source: t(n.source), values: NUTRIENTS.map(({ key }) => t(n.values[key])) } : null;
};
export const sectionDirty = (s: SectionKey, form: ProductForm, base: ProductForm) => JSON.stringify(norm(s, form)) !== JSON.stringify(norm(s, base));
export const dirtySections = (form: ProductForm, base: ProductForm): SectionKey[] => SECTION_KEYS.filter((s) => sectionDirty(s, form, base));

// ------------------------------------------------------------------------------------------------ validation (obvious required fields only)
/** Error-summary labels: the same words as the form's own labels, so the link and the field read alike. */
export const FIELD_LABELS: Record<string, string> = {
  "core.name": "Name", "core.sku": "SKU", "core.slug": "Web address (slug)", "core.shortDescription": "Short description", "core.description": "Description", "core.category": "Category", "core.brand": "Brand", "core.barcode": "Barcode",
  "core.productType": "Product type", "core.storageType": "Kept", "core.saleUnit": "Sale unit", "core.price": "Price", "core.taxRate": "Tax rate (%)",
  "core.qtyMin": "Minimum quantity", "core.qtyStep": "Quantity step", "core.qtyMax": "Maximum quantity", "core.netContent": "Net content", "core.netContentUnit": "Net content unit", "core.isVariableWeight": "Variable weight",
  "core.stockMode": "Stock mode", "core.tracksBatches": "Track batches", "core.isPerishable": "Perishable", "core.sellBufferDays": "Stop selling before expiry (days)", "core.status": "Status", "core.isAvailable": "Available to order", "core.isFeatured": "Featured",
  "core.originCountry": "Country of origin", "core.originNote": "Origin note", "core.storageInstructions": "Storage instructions", "core.packaging": "Packaging", "core.manufacturer": "Producer / manufacturer", "core.ingredients": "Ingredients",
  allergens: "Allergens", "allergens.confirmed": "Allergen confirmation", claims: "Dietary claims", "nutrition.basis": "Nutrition basis", "nutrition.source": "Nutrition source",
  ...Object.fromEntries(NUTRIENTS.map((n) => [`nutrition.${n.key}`, `${n.label} (${n.unit})`])),
};
export function validateProductForm(f: ProductForm): Errors {
  const e: Errors = {};
  if (!t(f.core.name)) e["core.name"] = "Enter the product name.";
  if (!t(f.core.sku)) e["core.sku"] = "Enter a SKU.";
  if (!t(f.core.category)) e["core.category"] = "Choose a category.";
  if (!t(f.core.saleUnit)) e["core.saleUnit"] = "Choose how the product is sold.";
  if (!t(f.core.price)) e["core.price"] = "Enter the price per sale unit.";
  for (const [kind, c] of Object.entries(f.claims)) if (c.status === "verified" && !t(c.evidence)) e[`claims.${kind}.evidence`] = "Evidence is required to verify a claim (certificate number, label review, supplier statement…).";
  if (f.nutrition.enabled) {
    if (!t(f.nutrition.basis)) e["nutrition.basis"] = "Say what the values are per (for example per 100 g).";
    if (!t(f.nutrition.source)) e["nutrition.source"] = "Say where these values come from (label, supplier datasheet, lab report…).";
  }
  return e;
}

// ------------------------------------------------------------------------------------------------ server error mapping
const CORE_API_TO_FORM: Record<string, keyof CoreForm> = {
  name: "name", sku: "sku", slug: "slug", short_description: "shortDescription", description: "description", category: "category", brand: "brand", barcode: "barcode",
  product_type: "productType", storage_type: "storageType", sale_unit: "saleUnit", price: "price", tax_rate: "taxRate",
  qty_min: "qtyMin", qty_step: "qtyStep", qty_max: "qtyMax", net_content: "netContent", net_content_unit: "netContentUnit", is_variable_weight: "isVariableWeight",
  stock_mode: "stockMode", tracks_batches: "tracksBatches", is_perishable: "isPerishable", sell_buffer_days: "sellBufferDays", status: "status", is_available: "isAvailable", is_featured: "isFeatured",
  origin_country: "originCountry", origin_note: "originNote", storage_instructions: "storageInstructions", ingredients: "ingredients", packaging: "packaging", manufacturer: "manufacturer",
};
export interface Mapped { fields: Errors; rest: Errors }

/** API `fieldErrors` (dotted keys) -> form field names (`core.shortDescription`). Unknown keys are returned in `rest`. */
export function mapCoreErrors(fe: Errors): Mapped {
  const fields: Errors = {};
  const rest: Errors = {};
  for (const [k, v] of Object.entries(fe)) {
    const to = CORE_API_TO_FORM[k];
    if (to) fields[`core.${to}`] = v;
    else rest[k] = v;
  }
  return { fields, rest };
}

/** The claims endpoint answers with a list: `0.evidence` is the first claim sent, so `kinds` (send order) names it. */
export function mapClaimErrors(fe: Errors, kinds: string[]): Mapped {
  const fields: Errors = {};
  const rest: Errors = {};
  for (const [k, v] of Object.entries(fe)) {
    const m = /^(?:claims\.)?(\d+)\.(\w+)$/.exec(k);
    if (m && kinds[Number(m[1])]) fields[`claims.${kinds[Number(m[1])]}.${m[2]}`] = v;
    else rest[k] = v;
  }
  return { fields, rest };
}

/** `allergens.2.allergen` -> `allergens.<code of the third allergen sent>`. */
export function mapAllergenErrors(fe: Errors, codes: string[]): Mapped {
  const fields: Errors = {};
  const rest: Errors = {};
  for (const [k, v] of Object.entries(fe)) {
    const m = /^allergens\.(\d+)\.(\w+)$/.exec(k);
    if (m && codes[Number(m[1])]) fields[`allergens.${codes[Number(m[1])]}`] = v;
    else if (k === "allergens") fields["allergens"] = v;
    else if (k === "allergen_info_complete") fields["allergens.confirmed"] = v;
    else rest[k] = v;
  }
  return { fields, rest };
}

export function mapNutritionErrors(fe: Errors): Mapped {
  const fields: Errors = {};
  const rest: Errors = {};
  const known = new Set<string>(["basis", "source", ...NUTRIENTS.map((n) => n.key)]);
  for (const [k, v] of Object.entries(fe)) {
    if (known.has(k)) fields[`nutrition.${k}`] = v;
    else rest[k] = v;
  }
  return { fields, rest };
}

/** A readable label for an error key (`core.shortDescription` -> "Short description"). */
export function labelFor(key: string): string {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  const parts = key.split(".");
  if (parts[0] === "allergens" && parts.length === 2) return "Allergens";
  const kindLabel = key.startsWith("claims.") ? CLAIM_KINDS.find(([k]) => k === parts[1])?.[1] : undefined;
  const last = parts[parts.length - 1].replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ");
  const text = last.charAt(0).toUpperCase() + last.slice(1).toLowerCase();
  return kindLabel ? `${kindLabel} ${last.toLowerCase()}` : text;
}

/** DOM id for a form field name — `core.sku` -> `pf-core-sku`. */
export const fieldId = (name: string) => `pf-${name.replace(/[^a-zA-Z0-9]+/g, "-")}`;

// ------------------------------------------------------------------------------------------------ lookups
export interface Lookups { categories: CategoryRow[]; brands: BrandRow[]; units: UnitRow[]; allergens: AllergenLookup[] }

export interface OptionGroup { label: string; options: [string, string][] }

/**
 * Category choices grouped by department (the tree is two levels). A department with sub-categories is offered
 * through them; one without sub-categories — or the one the product already sits in — is selectable itself.
 */
export function categoryGroups(categories: CategoryRow[], current?: string): OptionGroup[] {
  const departments = categories.filter((c) => c.parent == null).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  const groups: OptionGroup[] = [];
  for (const d of departments) {
    const kids = categories.filter((c) => c.parent === d.id).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
    const options: [string, string][] = kids.map((k) => [String(k.id), k.name + (k.is_active ? "" : " (inactive)")]);
    if (kids.length === 0 || String(d.id) === current) options.unshift([String(d.id), kids.length ? `${d.name} (department itself)` : d.name + (d.is_active ? "" : " (inactive)")]);
    groups.push({ label: d.name, options });
  }
  return groups;
}

/** Flat "Department › Category" label for a category id (used in summaries). */
export function categoryPath(categories: CategoryRow[], id: number | string | null | undefined): string {
  const c = categories.find((x) => x.id === Number(id));
  if (!c) return "";
  const parent = c.parent != null ? categories.find((x) => x.id === c.parent) : null;
  return parent ? `${parent.name} › ${c.name}` : c.name;
}
