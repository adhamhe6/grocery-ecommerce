// Pure row builder for the side-by-side comparison table.
//
// Inputs are exactly what the API gives us: `GET /compare/?ids=` (price, pack, origin country, storage, claims, a few
// nutrition values) and, for the details that endpoint doesn't carry (allergens, full nutrition, storage instructions,
// origin note), `GET /products/<slug>/`. Anything the API doesn't give us becomes an explicit "unknown" cell — never a
// blank, a zero or a guess.

import type { CompareProduct, CompareResponse } from "./account-types";
import { formatQty } from "./format";
import type { ProductCardData, ProductDetailData } from "./types";

export type DetailState = { status: "loading" } | { status: "error" } | { status: "ok"; data: ProductDetailData };

export type Tone = "ok" | "warn" | "bad" | "neutral";

export type Cell =
  | { kind: "value"; text: string; note?: string; badge?: string; tone?: Tone }
  | { kind: "unknown"; note?: string }
  | { kind: "loading" }
  | { kind: "error"; note: string };

export interface CompareRow {
  key: string;
  label: string;
  /** Small caption above the label, used to group the nutrition rows. */
  group?: string;
  cells: Cell[];
}

export interface BuiltComparison {
  rows: CompareRow[];
  /** Cross-product caveats that only exist once we've seen all the data. */
  notices: string[];
}

export type MoneyFormatter = (value: string | number | null | undefined) => string;

const value = (text: string, extra: Omit<Extract<Cell, { kind: "value" }>, "kind" | "text"> = {}): Cell => ({ kind: "value", text, ...extra });
const unknown = (note?: string): Cell => ({ kind: "unknown", note });
const LOADING: Cell = { kind: "loading" };

const AVAILABILITY: Record<ProductCardData["availability"]["status"], { text: string; tone: Tone }> = {
  IN_STOCK: { text: "In stock", tone: "ok" },
  LOW_STOCK: { text: "Low stock", tone: "warn" },
  OUT_OF_STOCK: { text: "Out of stock", tone: "bad" },
  UNAVAILABLE: { text: "Unavailable", tone: "bad" },
};

const NUTRIENTS = [
  { key: "energy_kcal", label: "Energy", unit: "kcal", core: true },
  { key: "fat", label: "Fat", unit: "g", core: false },
  { key: "saturates", label: "of which saturates", unit: "g", core: false },
  { key: "carbohydrate", label: "Carbohydrate", unit: "g", core: false },
  { key: "sugars", label: "of which sugars", unit: "g", core: true },
  { key: "fibre", label: "Fibre", unit: "g", core: false },
  { key: "protein", label: "Protein", unit: "g", core: true },
  { key: "salt", label: "Salt", unit: "g", core: false },
] as const;

type NutrientKey = (typeof NUTRIENTS)[number]["key"];
const CORE_FROM_COMPARE: readonly string[] = ["energy_kcal", "sugars", "protein"];

const present = (v: string | null | undefined): v is string => v !== null && v !== undefined && v !== "";

function nutrientCell(p: CompareProduct, d: DetailState | undefined, key: NutrientKey, unit: string): Cell {
  const quick = p.nutrition_per_100;
  if (quick === null) return unknown(); // the comparison endpoint says there is no nutrition record at all
  if (d?.status === "ok") {
    const v = d.data.nutrition?.values[key];
    if (present(v)) return value(formatQty(v, unit));
  }
  // The comparison endpoint already carries energy, sugars and protein, so show those while details load (or if they fail).
  const fromCompare = CORE_FROM_COMPARE.includes(key) ? quick[key as "energy_kcal" | "sugars" | "protein"] : undefined;
  if (present(fromCompare)) return value(formatQty(fromCompare, unit));
  return d?.status === "loading" ? LOADING : unknown();
}

export function buildCompareRows(data: CompareResponse, details: Record<string, DetailState | undefined>, money: MoneyFormatter): BuiltComparison {
  const products = data.products;
  const detailOf = (p: CompareProduct) => details[p.card.slug];
  const anyLoading = products.some((p) => detailOf(p)?.status === "loading");
  const rows: CompareRow[] = [];
  const row = (key: string, label: string, cells: Cell[], group?: string) => rows.push({ key, label, cells, group });

  row("price", "Price", products.map((p) => {
    const c = p.card;
    const per = c.sale_unit.kind === "COUNT" ? "" : ` / ${c.sale_unit.symbol}`;
    const notes: string[] = [];
    if (Number(c.price) < Number(c.base_price)) notes.push(`Was ${money(c.base_price)}`);
    if (c.promotion) notes.push(c.promotion.label);
    if (c.is_variable_weight) notes.push("Priced by weight");
    return value(`${money(c.price)}${per}`, { note: notes.join(" · ") || undefined });
  }));

  row("unit-price", "Unit price", products.map((p) => {
    const up = p.card.unit_price;
    if (!up) return unknown();
    return value(`${money(up.amount)} / ${up.per}`, { badge: data.best_value_id === p.card.id ? "Best value" : undefined });
  }));

  row("pack", "Pack size", products.map((p) => {
    const label = p.card.pack_label?.trim() ?? "";
    if (!label && !p.size) return unknown();
    if (label && p.size && !label.includes(p.size)) return value(`${label} · ${p.size}`);
    return value(label || p.size!);
  }));

  row("brand", "Brand", products.map((p) => (p.brand ? value(p.brand) : unknown())));

  row("origin", "Origin", products.map((p) => {
    const d = detailOf(p);
    const ok = d?.status === "ok" ? d.data.origin : null;
    const country = ok?.country || p.origin || "";
    const note = ok?.note || "";
    if (country) return value(country, { note: note || undefined });
    if (note) return value(note);
    return !p.origin && d?.status === "loading" ? LOADING : unknown();
  }));

  row("allergens", "Allergens", products.map((p) => {
    const d = detailOf(p);
    if (!d || d.status === "loading") return LOADING;
    if (d.status === "error") return { kind: "error", note: "Couldn't load allergen details. See the product page." } satisfies Cell;
    const a = d.data.allergens;
    if (!a.confirmed) return unknown("Not confirmed. Check the packaging before eating.");
    const contains = a.contains.length ? `Contains ${a.contains.join(", ")}` : "Contains none of the 14 major allergens";
    return value(contains, { note: a.may_contain.length ? `May contain ${a.may_contain.join(", ")}` : undefined });
  }));

  const bases = products.map((p) => p.nutrition_per_100?.basis || null);
  row("nutrition-basis", "Values given", bases.map((b) => (b ? value(b) : unknown())), "Nutrition");

  for (const n of NUTRIENTS) {
    const cells = products.map((p) => nutrientCell(p, detailOf(p), n.key, n.unit));
    // Extended nutrients only earn a row once at least one product has a value (or while we may still learn one).
    if (n.core || anyLoading || cells.some((c) => c.kind === "value")) row(`nutrition-${n.key}`, n.label, cells, "Nutrition");
  }

  row("storage", "Storage", products.map((p) => (p.storage ? value(p.storage) : unknown())));
  row("storage-instructions", "Storage instructions", products.map((p) => {
    const d = detailOf(p);
    if (!d || d.status === "loading") return LOADING;
    if (d.status === "error") return { kind: "error", note: "Couldn't load storage details. See the product page." } satisfies Cell;
    return d.data.storage_instructions ? value(d.data.storage_instructions) : unknown();
  }));

  row("claims", "Verified claims", products.map((p) => (p.claims.length ? value(p.claims.join(", ")) : value("None verified"))));

  row("availability", "Availability", products.map((p) => {
    const a = AVAILABILITY[p.card.availability.status];
    return a ? value(a.text, { tone: a.tone }) : unknown();
  }));

  const notices: string[] = [];
  const distinct = [...new Set(bases.filter(present))];
  if (distinct.length > 1) notices.push(`Nutrition values are given on different bases (${distinct.join(", ")}), so compare them with care.`);

  return { rows, notices };
}
