// Weekly opening hours and closure dates: pure helpers behind the store screens.
// The API's rules (HoursSerializer in backend/apps/stores/admin_api.py): each weekday at most once; an open day needs an
// opening time strictly before its closing time. Weekday 0 = Monday. A weekday with no row is treated as closed.

export const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

export interface HourRow { weekday: number; closed: boolean; opens: string; closes: string }
export interface ApiHours { weekday: number; opens: string | null; closes: string | null; is_closed: boolean }

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
/** "08:00:00" → "08:00" (what <input type="time"> wants). */
export const toHHMM = (t: string | null | undefined): string => (t ? t.slice(0, 5) : "");

/** Seven rows, Monday to Sunday, filled from whatever the API returned. */
export function hoursFromApi(api: ApiHours[] | undefined): HourRow[] {
  return WEEKDAY_NAMES.map((_, weekday) => {
    const found = api?.find((h) => h.weekday === weekday);
    if (!found || found.is_closed) return { weekday, closed: true, opens: toHHMM(found?.opens), closes: toHHMM(found?.closes) };
    return { weekday, closed: false, opens: toHHMM(found.opens), closes: toHHMM(found.closes) };
  });
}

export interface HourErrors { opens?: string; closes?: string; row?: string }

/** Errors keyed by weekday. Closed days are always valid. */
export function validateHours(rows: HourRow[]): Record<number, HourErrors> {
  const errors: Record<number, HourErrors> = {};
  for (const r of rows) {
    if (r.closed) continue;
    const e: HourErrors = {};
    if (!r.opens) e.opens = "Set an opening time.";
    else if (!HHMM.test(r.opens)) e.opens = "Use a time like 08:00.";
    if (!r.closes) e.closes = "Set a closing time.";
    else if (!HHMM.test(r.closes)) e.closes = "Use a time like 20:00.";
    if (!e.opens && !e.closes && r.opens >= r.closes) e.row = "Opening time must be before closing time.";
    if (e.opens || e.closes || e.row) errors[r.weekday] = e;
  }
  return errors;
}

/** Request body for the `hours` field of PATCH /branches/{id}/ — it replaces the whole week. */
export function hoursPayload(rows: HourRow[]): { weekday: number; opens: string | null; closes: string | null; is_closed: boolean }[] {
  return rows.map((r) => (r.closed ? { weekday: r.weekday, opens: null, closes: null, is_closed: true } : { weekday: r.weekday, opens: r.opens, closes: r.closes, is_closed: false }));
}

export const sameHours = (a: HourRow[], b: HourRow[]): boolean =>
  a.length === b.length && a.every((r, i) => r.closed === b[i].closed && (r.closed || (r.opens === b[i].opens && r.closes === b[i].closes)));

export const allClosed = (rows: HourRow[]): boolean => rows.every((r) => r.closed);

/** Copy one day's hours onto the other days (the “same every day” shortcut). */
export function copyDay(rows: HourRow[], from: number, to: number[]): HourRow[] {
  const src = rows.find((r) => r.weekday === from);
  if (!src) return rows;
  return rows.map((r) => (to.includes(r.weekday) ? { ...r, closed: src.closed, opens: src.opens, closes: src.closes } : r));
}

// ------------------------------------------------------------------------------------------------ closures
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const toUtc = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return Date.UTC(y, m - 1, d); };
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const MAX_CLOSURE_DAYS = 31;

/** The API closes one date per request, so a range is expanded to its dates (inclusive). Null when the range is invalid. */
export function expandDates(from: string, to: string): string[] | null {
  if (!ISO.test(from)) return null;
  const end = to || from;
  if (!ISO.test(end)) return null;
  const a = toUtc(from), b = toUtc(end);
  if (b < a) return null;
  const n = Math.round((b - a) / 86_400_000) + 1;
  if (n > MAX_CLOSURE_DAYS) return null;
  return Array.from({ length: n }, (_, i) => fromUtc(a + i * 86_400_000));
}

export function closureRangeError(from: string, to: string): string | null {
  if (!from) return "Choose the first day of the closure.";
  if (!ISO.test(from)) return "Enter a valid date.";
  if (to && !ISO.test(to)) return "Enter a valid date.";
  if (to && to < from) return "The last day is before the first day.";
  if (expandDates(from, to) === null) return `A closure can cover at most ${MAX_CLOSURE_DAYS} days at a time.`;
  return null;
}

export const addDays = (iso: string, n: number): string => fromUtc(toUtc(iso) + n * 86_400_000);
