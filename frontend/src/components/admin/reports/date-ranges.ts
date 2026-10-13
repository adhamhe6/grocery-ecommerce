// Date-range presets for reports. Everything works on plain "YYYY-MM-DD" strings so there is no browser-timezone drift:
// reports are cut at midnight in the STORE's time zone (see Period in backend/apps/reports/queries.py).

export type RangePreset = "today" | "yesterday" | "7d" | "30d" | "90d" | "mtd" | "last-month" | "ytd" | "custom";

export const RANGE_PRESETS: { key: RangePreset; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "90d", label: "Last 90 days" },
  { key: "mtd", label: "This month" },
  { key: "last-month", label: "Last month" },
  { key: "ytd", label: "Year to date" },
  { key: "custom", label: "Custom range" },
];

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(value: string): boolean {
  const m = ISO.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

const fmt = (dt: Date) => `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
const parse = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };

export function addDays(iso: string, days: number): string {
  const dt = parse(iso);
  dt.setUTCDate(dt.getUTCDate() + days);
  return fmt(dt);
}

/** Inclusive number of days between two ISO dates (from ≤ to). */
export function daysBetween(from: string, to: string): number {
  return Math.round((parse(to).getTime() - parse(from).getTime()) / 86_400_000) + 1;
}

/** Today's calendar date in the given IANA time zone (falls back to the browser's date for an unknown zone). */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const iso = `${get("year")}-${get("month")}-${get("day")}`;
    if (isIsoDate(iso)) return iso;
  } catch { /* unknown zone */ }
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** The [from, to] (inclusive) a preset stands for, given today's date in the store's zone. "custom" has no range of its own. */
export function presetRange(preset: Exclude<RangePreset, "custom">, today: string): { from: string; to: string } {
  switch (preset) {
    case "today": return { from: today, to: today };
    case "yesterday": { const y = addDays(today, -1); return { from: y, to: y }; }
    case "7d": return { from: addDays(today, -6), to: today };
    case "30d": return { from: addDays(today, -29), to: today };
    case "90d": return { from: addDays(today, -89), to: today };
    case "mtd": return { from: `${today.slice(0, 7)}-01`, to: today };
    case "last-month": {
      const firstThis = `${today.slice(0, 7)}-01`;
      const lastPrev = addDays(firstThis, -1);
      return { from: `${lastPrev.slice(0, 7)}-01`, to: lastPrev };
    }
    case "ytd": return { from: `${today.slice(0, 4)}-01-01`, to: today };
  }
}

export type RangeCheck = { ok: true } | { ok: false; message: string };
export function checkRange(from: string, to: string): RangeCheck {
  if (!isIsoDate(from) || !isIsoDate(to)) return { ok: false, message: "Choose both a start and an end date." };
  if (from > to) return { ok: false, message: "The start date is after the end date." };
  return { ok: true };
}

/** One entry per calendar day from..to, filling missing days with 0 — so a quiet day shows as zero, not as a gap. */
export function fillDays(points: { date: string; value: number }[], from: string, to: string, maxDays = 400): { date: string; value: number }[] {
  if (!isIsoDate(from) || !isIsoDate(to) || from > to || daysBetween(from, to) > maxDays) return points;
  const byDate = new Map(points.map((p) => [p.date, p.value]));
  const out: { date: string; value: number }[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push({ date: d, value: byDate.get(d) ?? 0 });
  return out;
}
