// Date-time inputs for schedules (promotions, coupons, banners, articles).
//
// `<input type="datetime-local">` has no time zone, but the API stores instants. Staff think in the *store's* clock, so we
// convert between "wall time in the store's time zone" and ISO instants explicitly instead of trusting the browser's zone.

const pad = (n: number) => String(n).padStart(2, "0");

interface Parts { y: number; mo: number; d: number; h: number; mi: number; s: number }

const formatters = new Map<string, Intl.DateTimeFormat>();
function partsIn(date: Date, timeZone: string): Parts {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    formatters.set(timeZone, f);
  }
  const got: Record<string, number> = {};
  for (const p of f.formatToParts(date)) if (p.type !== "literal") got[p.type] = Number(p.value);
  return { y: got.year, mo: got.month, d: got.day, h: got.hour === 24 ? 0 : got.hour, mi: got.minute, s: got.second };
}

/** Offset (ms) of `timeZone` from UTC at the given instant. */
function offsetAt(ms: number, timeZone: string): number {
  const p = partsIn(new Date(ms), timeZone);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}

/** ISO instant -> "YYYY-MM-DDTHH:mm" wall time in `timeZone` (empty string for null/invalid). */
export function isoToLocalInput(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const p = partsIn(date, timeZone);
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}`;
}

/** "YYYY-MM-DDTHH:mm" wall time in `timeZone` -> ISO instant (UTC), or null when blank/invalid. */
export function localInputToIso(local: string | null | undefined, timeZone: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local ?? "");
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  let utc = wall - offsetAt(wall, timeZone);
  utc = wall - offsetAt(utc, timeZone); // second pass settles the offset across a DST change
  const out = new Date(utc);
  return Number.isNaN(out.getTime()) ? null : out.toISOString().replace(".000Z", "Z"); // same shape the API returns, so an unchanged value compares equal
}

/**
 * "1–30 Nov 2026" (en-GB), "from 1 Nov 2026, no end date", always in the store's time zone and the store's locale.
 * Returns "" when there is no start.
 */
export function formatSchedule(startIso: string | null | undefined, endIso: string | null | undefined, timeZone: string, locale = "en-GB"): string {
  if (!startIso) return "";
  const s = new Date(startIso);
  if (Number.isNaN(s.getTime())) return "";
  const f = new Intl.DateTimeFormat(locale, { timeZone, day: "numeric", month: "short", year: "numeric" });
  const e = endIso ? new Date(endIso) : null;
  if (!e || Number.isNaN(e.getTime())) return `from ${f.format(s)}, no end date`;
  return f.formatRange(s, e).replace(/[\u2009\u202f\u00a0]/g, " "); // Intl uses thin spaces around the dash; plain spaces read (and test) better
}
