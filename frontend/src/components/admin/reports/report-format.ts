// Pure helpers that turn the report API's `{columns, rows, summary}` into display text. No React in here so they are easy to test.
import { CHARTS, SUMMARY_SPECS, type ChartSpec } from "./report-meta";

/** Column kinds sent by backend/apps/reports/queries.py (`_col(key, label, kind)`), under the key `type`. */
export type ColumnKind = "text" | "date" | "int" | "money" | "qty" | "pct";
const humanise = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
const KINDS: ColumnKind[] = ["text", "date", "int", "money", "qty", "pct"];

export interface ReportColumn { key: string; label: string; type?: string; kind?: string }
export type ReportRow = { id?: undefined; [key: string]: unknown };

/** The API calls it `type`; the original brief called it `kind`. Both are read; anything unknown is plain text. */
export function columnKind(col: Pick<ReportColumn, "type" | "kind">): ColumnKind {
  const raw = (col.type ?? col.kind ?? "text").toLowerCase();
  return (KINDS as string[]).includes(raw) ? (raw as ColumnKind) : "text";
}
export const isNumericKind = (k: ColumnKind) => k === "int" || k === "money" || k === "qty" || k === "pct";

export interface CellFormat {
  /** Formats a decimal string/number as money in the store's currency. */
  money: (v: string | number) => string;
  locale: string;
}

const EMPTY = "—";
const isEmpty = (v: unknown) => v === null || v === undefined || v === "";
const toNumber = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v);
  return null;
};

/** Text for one cell. Blank values (the API uses "" for "no data") show as an em dash. */
export function formatCell(kind: ColumnKind, value: unknown, f: CellFormat): string {
  if (isEmpty(value)) return EMPTY;
  const n = toNumber(value);
  switch (kind) {
    case "money": return n === null ? String(value) : f.money(typeof value === "number" ? value : String(value));
    case "int": return n === null ? String(value) : new Intl.NumberFormat(f.locale, { maximumFractionDigits: 0 }).format(n);
    case "qty": return n === null ? String(value) : new Intl.NumberFormat(f.locale, { maximumFractionDigits: 3 }).format(n);
    case "pct": return n === null ? String(value) : `${new Intl.NumberFormat(f.locale, { maximumFractionDigits: 1 }).format(n)}%`;
    case "date": {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
      if (!m) return String(value);
      return new Intl.DateTimeFormat(f.locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])));
    }
    default: return String(value);
  }
}

/** Ascending comparison for client-side sorting; blank values always sort last regardless of direction handled by caller. */
export function compareCells(kind: ColumnKind, a: unknown, b: unknown): number {
  const ea = isEmpty(a), eb = isEmpty(b);
  if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1;
  if (isNumericKind(kind)) {
    const na = toNumber(a), nb = toNumber(b);
    if (na !== null && nb !== null) return na - nb;
  }
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

export function sortRows<T extends Record<string, unknown>>(rows: T[], col: ReportColumn | undefined, desc: boolean): T[] {
  if (!col) return rows;
  const kind = columnKind(col);
  const sorted = [...rows].sort((x, y) => {
    const ea = isEmpty(x[col.key]), eb = isEmpty(y[col.key]);
    if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1; // blanks last in both directions
    const c = compareCells(kind, x[col.key], y[col.key]);
    return desc ? -c : c;
  });
  return sorted;
}

// ---------------------------------------------------------------------------------------------------- summary
export interface SummaryItem { key: string; label: string; text: string; primary: boolean; hint?: string }
export interface DistributionItem { key: string; label: string; entries: { label: string; value: number }[] }

/** Splits the API's free-form `summary` into display items using the per-report specs (unknown keys are shown as plain text). */
export function summaryItems(reportKey: string, summary: Record<string, unknown> | undefined, f: CellFormat): { items: SummaryItem[]; distributions: DistributionItem[] } {
  const specs = SUMMARY_SPECS[reportKey] ?? {};
  const items: SummaryItem[] = [];
  const distributions: DistributionItem[] = [];
  for (const [key, value] of Object.entries(summary ?? {})) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const entries = Object.entries(value as Record<string, unknown>)
        .map(([k, v]) => ({ label: k === "5" ? "5 or more orders" : `${k} ${k === "1" ? "order" : "orders"}`, value: Number(v) || 0, order: Number(k) }))
        .sort((a, b) => a.order - b.order)
        .map(({ label, value: v }) => ({ label, value: v }));
      distributions.push({ key, label: key === "orders_per_customer_distribution" ? "Customers by number of orders in the period" : humanise(key), entries });
      continue;
    }
    const spec = specs[key];
    items.push({
      key,
      label: spec?.label ?? humanise(key),
      text: formatCell(spec?.kind ?? "text", value, f),
      primary: !!spec?.primary,
      hint: spec?.hint,
    });
  }
  // keep the spec order (so headline figures come first and in a stable order)
  const order = Object.keys(specs);
  items.sort((a, b) => (order.indexOf(a.key) === -1 ? 999 : order.indexOf(a.key)) - (order.indexOf(b.key) === -1 ? 999 : order.indexOf(b.key)));
  return { items, distributions };
}

// ---------------------------------------------------------------------------------------------------- charts
export type ChartData =
  | { type: "trend"; title: string; points: { date: string; value: number }[]; yKind: ColumnKind }
  | { type: "ranked"; title: string; points: { label: string; value: number }[]; yKind: ColumnKind };

/** Builds the chart series for a report from its rows, or null when there is nothing meaningful to draw. */
export function buildChart(reportKey: string, rows: Record<string, unknown>[], spec: ChartSpec | undefined = CHARTS[reportKey]): ChartData | null {
  if (!spec || rows.length === 0) return null;
  if (spec.type === "trend") {
    const points = rows
      .map((r) => ({ date: String(r[spec.x] ?? ""), value: toNumber(r[spec.y]) }))
      .filter((p): p is { date: string; value: number } => !!p.date && p.value !== null)
      .sort((a, b) => a.date.localeCompare(b.date));
    return points.length ? { type: "trend", title: spec.title, points, yKind: spec.yKind } : null;
  }
  const seen = new Map<string, number>();
  const points = rows
    .map((r) => ({ label: spec.label.map((k) => String(r[k] ?? "")).filter(Boolean).join(" · ") || "—", value: toNumber(r[spec.y]) }))
    .filter((p): p is { label: string; value: number } => p.value !== null && p.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, spec.limit)
    .map((p) => {
      const n = (seen.get(p.label) ?? 0) + 1;
      seen.set(p.label, n);
      return n === 1 ? p : { ...p, label: `${p.label} (${n})` }; // RankedBars keys by label, so labels must be unique
    });
  return points.length ? { type: "ranked", title: spec.title, points, yKind: spec.yKind } : null;
}
