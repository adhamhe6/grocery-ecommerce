// How urgent is an order, judged from its delivery/pickup slot. Pure so it can be tested with a fixed "now".
export type SlaLevel = "ok" | "soon" | "late" | "none";

export interface Sla {
  level: SlaLevel;
  /** Short text, always shown next to the icon/colour so the state is never colour-only. */
  label: string;
  /** Minutes until the relevant deadline (negative = already passed); null when the order has no slot. */
  minutes: number | null;
}

export function formatDuration(totalMinutes: number): string {
  const m = Math.max(0, Math.round(totalMinutes));
  if (m < 60) return `${m} min`;
  if (m < 60 * 24) {
    const h = Math.floor(m / 60);
    const rest = m % 60;
    return rest ? `${h} h ${rest} min` : `${h} h`;
  }
  const d = Math.floor(m / (60 * 24));
  const h = Math.floor((m % (60 * 24)) / 60);
  return h ? `${d} d ${h} h` : `${d} d`;
}

const PRE_PACK = new Set(["CONFIRMED", "PICKING", "PACKING"]);

/**
 * - Not yet packed: the deadline is the slot start. Within `soonMinutes` of it the order is "due soon", after it "late".
 * - Packed / out for delivery: the deadline is the slot end; past it the order is "late".
 */
export function slaFor(order: { status: string; slot_starts_at: string | null; slot_ends_at: string | null }, now: number, soonMinutes = 60): Sla {
  const start = order.slot_starts_at ? Date.parse(order.slot_starts_at) : NaN;
  const end = order.slot_ends_at ? Date.parse(order.slot_ends_at) : NaN;
  if (Number.isNaN(start)) return { level: "none", label: "No slot", minutes: null };
  if (PRE_PACK.has(order.status)) {
    const mins = Math.round((start - now) / 60_000);
    if (mins <= 0) return { level: "late", label: `Slot started ${formatDuration(-mins)} ago`, minutes: mins };
    if (mins <= soonMinutes) return { level: "soon", label: `Starts in ${formatDuration(mins)}`, minutes: mins };
    return { level: "ok", label: `Starts in ${formatDuration(mins)}`, minutes: mins };
  }
  if (["READY_FOR_PICKUP", "READY_FOR_DISPATCH", "OUT_FOR_DELIVERY"].includes(order.status)) {
    if (Number.isNaN(end)) return { level: "ok", label: "Packed", minutes: null };
    const mins = Math.round((end - now) / 60_000);
    if (mins < 0) return { level: "late", label: `Slot ended ${formatDuration(-mins)} ago`, minutes: mins };
    return { level: mins <= soonMinutes ? "soon" : "ok", label: `Slot ends in ${formatDuration(mins)}`, minutes: mins };
  }
  return { level: "none", label: "", minutes: null };
}
