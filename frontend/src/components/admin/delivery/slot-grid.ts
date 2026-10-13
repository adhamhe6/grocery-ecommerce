// Lays generated delivery slots out as a calendar: one column per day, one row per time window.
import { addDays } from "./hours";

export interface SlotRow {
  id: number;
  branch: number;
  zone: number | null;
  kind: "DELIVERY" | "PICKUP";
  date: string;
  start_time: string;
  end_time: string;
  capacity: number;
  booked: number;
  remaining: number;
  fee: string;
  is_open: boolean;
}

export interface GridRow { key: string; start: string; end: string }
export interface Grid { days: string[]; rows: GridRow[]; cells: Map<string, SlotRow[]> }

export const cellKey = (date: string, rowKey: string) => `${date}|${rowKey}`;
const hhmm = (t: string) => t.slice(0, 5);
export const windowKey = (s: Pick<SlotRow, "start_time" | "end_time">) => `${hhmm(s.start_time)}-${hhmm(s.end_time)}`;

/**
 * `days` consecutive dates from `from`, a row per distinct start–end window (earliest first), and the slots in each cell
 * ordered delivery-then-pickup, then by zone. Slots outside the date range are ignored.
 */
export function buildGrid(slots: SlotRow[], from: string, days: number, zoneName: (id: number | null) => string = () => ""): Grid {
  const dates = Array.from({ length: days }, (_, i) => addDays(from, i));
  const inRange = new Set(dates);
  const rowsByKey = new Map<string, GridRow>();
  const cells = new Map<string, SlotRow[]>();
  for (const s of slots) {
    if (!inRange.has(s.date)) continue;
    const key = windowKey(s);
    if (!rowsByKey.has(key)) rowsByKey.set(key, { key, start: hhmm(s.start_time), end: hhmm(s.end_time) });
    const ck = cellKey(s.date, key);
    cells.set(ck, [...(cells.get(ck) ?? []), s]);
  }
  for (const [k, list] of cells) {
    cells.set(k, [...list].sort((a, b) => a.kind.localeCompare(b.kind) || zoneName(a.zone).localeCompare(zoneName(b.zone)) || a.id - b.id));
  }
  const rows = [...rowsByKey.values()].sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
  return { days: dates, rows, cells };
}

/** 0–100, for the booked/capacity bar. */
export const bookedPercent = (s: Pick<SlotRow, "booked" | "capacity">): number => (s.capacity > 0 ? Math.min(100, Math.round((s.booked / s.capacity) * 100)) : 0);

export type Fill = "empty" | "some" | "nearly" | "full";
export function fillLevel(s: Pick<SlotRow, "booked" | "capacity">): Fill {
  if (s.booked <= 0) return "empty";
  if (s.booked >= s.capacity) return "full";
  return bookedPercent(s) >= 80 ? "nearly" : "some";
}

/** Closing a slot only stops new bookings; customers who already booked keep their slot and need handling by hand. */
export const needsCloseWarning = (s: Pick<SlotRow, "booked" | "is_open">): boolean => s.is_open && s.booked > 0;
