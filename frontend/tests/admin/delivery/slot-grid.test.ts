import { describe, expect, it } from "vitest";
import { bookedPercent, buildGrid, cellKey, fillLevel, needsCloseWarning, windowKey, type SlotRow } from "@/components/admin/delivery/slot-grid";

let id = 0;
const slot = (over: Partial<SlotRow> = {}): SlotRow => ({
  id: ++id, branch: 1, zone: 1, kind: "DELIVERY", date: "2026-10-14", start_time: "09:00:00", end_time: "11:00:00", capacity: 5, booked: 0, remaining: 5, fee: "3.00", is_open: true, ...over,
});
const zones: Record<number, string> = { 1: "Inner", 2: "Outer" };
const zoneName = (z: number | null) => (z ? zones[z] ?? "" : "");

describe("buildGrid", () => {
  it("makes one column per day starting at `from`", () => {
    const g = buildGrid([], "2026-10-12", 7);
    expect(g.days).toEqual(["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"]);
    expect(g.rows).toEqual([]);
  });

  it("makes one row per distinct window, earliest first", () => {
    const g = buildGrid([
      slot({ start_time: "13:00:00", end_time: "15:00:00" }),
      slot({ start_time: "09:00:00", end_time: "11:00:00" }),
      slot({ start_time: "09:00:00", end_time: "10:00:00", date: "2026-10-15" }),
      slot({ start_time: "09:00:00", end_time: "11:00:00", date: "2026-10-15" }),
    ], "2026-10-12", 7);
    expect(g.rows.map((r) => r.key)).toEqual(["09:00-10:00", "09:00-11:00", "13:00-15:00"]);
  });

  it("puts slots in the right cell and keeps several per cell (zones, kinds)", () => {
    const a = slot({ zone: 2, kind: "DELIVERY" });
    const b = slot({ zone: 1, kind: "DELIVERY" });
    const c = slot({ zone: null, kind: "PICKUP" });
    const g = buildGrid([a, b, c], "2026-10-12", 7, zoneName);
    const cell = g.cells.get(cellKey("2026-10-14", windowKey(a)))!;
    expect(cell.map((s) => s.id)).toEqual([b.id, a.id, c.id]); // delivery by zone name (Inner, Outer), then pickup
  });

  it("drops slots outside the visible days", () => {
    const g = buildGrid([slot({ date: "2026-11-30" }), slot({ date: "2026-10-11" })], "2026-10-12", 7);
    expect(g.rows).toEqual([]);
    expect(g.cells.size).toBe(0);
  });
});

describe("capacity bars", () => {
  it("computes percent and fill level", () => {
    expect(bookedPercent({ booked: 3, capacity: 5 })).toBe(60);
    expect(bookedPercent({ booked: 9, capacity: 5 })).toBe(100);
    expect(bookedPercent({ booked: 0, capacity: 0 })).toBe(0);
    expect(fillLevel({ booked: 0, capacity: 5 })).toBe("empty");
    expect(fillLevel({ booked: 2, capacity: 5 })).toBe("some");
    expect(fillLevel({ booked: 4, capacity: 5 })).toBe("nearly");
    expect(fillLevel({ booked: 5, capacity: 5 })).toBe("full");
  });
});

describe("closing a slot", () => {
  it("warns only when closing a slot that has bookings", () => {
    expect(needsCloseWarning({ is_open: true, booked: 2 })).toBe(true);
    expect(needsCloseWarning({ is_open: true, booked: 0 })).toBe(false);
    expect(needsCloseWarning({ is_open: false, booked: 2 })).toBe(false); // reopening needs no warning
  });
});
