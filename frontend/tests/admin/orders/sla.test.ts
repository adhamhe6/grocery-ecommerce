import { describe, expect, it } from "vitest";
import { formatDuration, slaFor } from "@/components/admin/orders/sla";

const NOW = Date.parse("2026-10-12T10:00:00Z");
const at = (minutesFromNow: number) => new Date(NOW + minutesFromNow * 60_000).toISOString();
const order = (status: string, startIn: number, lengthMin = 120) => ({ status, slot_starts_at: at(startIn), slot_ends_at: at(startIn + lengthMin) });

describe("formatDuration", () => {
  it("reads naturally at every scale", () => {
    expect(formatDuration(0)).toBe("0 min");
    expect(formatDuration(45)).toBe("45 min");
    expect(formatDuration(60)).toBe("1 h");
    expect(formatDuration(190)).toBe("3 h 10 min");
    expect(formatDuration(24 * 60)).toBe("1 d");
    expect(formatDuration(24 * 60 + 150)).toBe("1 d 2 h");
    expect(formatDuration(-5)).toBe("0 min");
  });
});

describe("slaFor", () => {
  it("before packing, urgency is measured against the slot start", () => {
    expect(slaFor(order("CONFIRMED", 180), NOW)).toMatchObject({ level: "ok", label: "Starts in 3 h", minutes: 180 });
    expect(slaFor(order("PICKING", 60), NOW)).toMatchObject({ level: "soon" }); // exactly the threshold counts as due soon
    expect(slaFor(order("PICKING", 61), NOW).level).toBe("ok");
    expect(slaFor(order("PICKING", 20), NOW)).toMatchObject({ level: "soon", label: "Starts in 20 min" });
    expect(slaFor(order("PACKING", 0), NOW).level).toBe("late");
    expect(slaFor(order("CONFIRMED", -25), NOW)).toMatchObject({ level: "late", label: "Slot started 25 min ago", minutes: -25 });
  });

  it("once packed, urgency is measured against the slot end", () => {
    expect(slaFor(order("READY_FOR_DISPATCH", -30, 120), NOW)).toMatchObject({ level: "ok", label: "Slot ends in 1 h 30 min" });
    expect(slaFor(order("OUT_FOR_DELIVERY", -100, 120), NOW)).toMatchObject({ level: "soon", label: "Slot ends in 20 min" });
    expect(slaFor(order("OUT_FOR_DELIVERY", -150, 120), NOW)).toMatchObject({ level: "late", label: "Slot ended 30 min ago" });
    expect(slaFor(order("READY_FOR_PICKUP", -10, 120), NOW).level).toBe("ok");
    expect(slaFor(order("READY_FOR_PICKUP", -10, 60), NOW).level).toBe("soon"); // 50 minutes left
  });

  it("never colours finished or slot-less orders", () => {
    expect(slaFor(order("COMPLETED", -500), NOW)).toMatchObject({ level: "none", label: "" });
    expect(slaFor(order("CANCELLED", -500), NOW).level).toBe("none");
    expect(slaFor({ status: "CONFIRMED", slot_starts_at: null, slot_ends_at: null }, NOW)).toMatchObject({ level: "none", label: "No slot", minutes: null });
  });

  it("agrees with the API's own is_late flag (slot started and still confirmed/picking)", () => {
    for (const status of ["CONFIRMED", "PICKING"]) {
      expect(slaFor(order(status, -1), NOW).level).toBe("late");
      expect(slaFor(order(status, 5), NOW).level).not.toBe("late");
    }
  });

  it("always carries words, so the state is readable without colour", () => {
    for (const startIn of [-30, 10, 500]) expect(slaFor(order("CONFIRMED", startIn), NOW).label).toMatch(/\d+ (min|h|d)/);
  });
});
