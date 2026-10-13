import { describe, expect, it } from "vitest";
import { addDays, allClosed, closureRangeError, copyDay, expandDates, hoursFromApi, hoursPayload, sameHours, validateHours, type HourRow } from "@/components/admin/delivery/hours";

const open = (weekday: number, opens = "08:00", closes = "20:00"): HourRow => ({ weekday, closed: false, opens, closes });
const closed = (weekday: number): HourRow => ({ weekday, closed: true, opens: "", closes: "" });
const week = (over: Partial<Record<number, HourRow>> = {}): HourRow[] => Array.from({ length: 7 }, (_, d) => over[d] ?? (d === 6 ? closed(6) : open(d)));

describe("hoursFromApi", () => {
  it("always returns seven rows, Monday first, and treats missing days as closed", () => {
    const rows = hoursFromApi([{ weekday: 0, opens: "06:00:00", closes: "23:00:00", is_closed: false }]);
    expect(rows).toHaveLength(7);
    expect(rows[0]).toEqual({ weekday: 0, closed: false, opens: "06:00", closes: "23:00" });
    expect(rows.slice(1).every((r) => r.closed)).toBe(true);
    expect(rows.map((r) => r.weekday)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
  it("copes with nothing saved yet", () => {
    expect(allClosed(hoursFromApi(undefined))).toBe(true);
  });
  it("keeps API closed days closed", () => {
    expect(hoursFromApi([{ weekday: 6, opens: null, closes: null, is_closed: true }])[6].closed).toBe(true);
  });
});

describe("validateHours", () => {
  it("accepts a normal week", () => {
    expect(validateHours(week())).toEqual({});
  });
  it("requires opening before closing on open days", () => {
    const e = validateHours(week({ 2: open(2, "20:00", "08:00"), 3: open(3, "09:00", "09:00") }));
    expect(e[2].row).toMatch(/before closing/);
    expect(e[3].row).toMatch(/before closing/);
  });
  it("requires both times on open days", () => {
    const e = validateHours(week({ 1: open(1, "", "") }));
    expect(e[1].opens).toBeDefined();
    expect(e[1].closes).toBeDefined();
  });
  it("rejects malformed times", () => {
    expect(validateHours(week({ 0: open(0, "8am", "20:00") }))[0].opens).toBeDefined();
    expect(validateHours(week({ 0: open(0, "08:00", "24:30") }))[0].closes).toBeDefined();
  });
  it("ignores times on closed days", () => {
    expect(validateHours(week({ 4: { weekday: 4, closed: true, opens: "22:00", closes: "01:00" } }))).toEqual({});
  });
});

describe("hoursPayload", () => {
  it("sends seven rows; closed days carry no times", () => {
    const body = hoursPayload(week());
    expect(body).toHaveLength(7);
    expect(body[0]).toEqual({ weekday: 0, opens: "08:00", closes: "20:00", is_closed: false });
    expect(body[6]).toEqual({ weekday: 6, opens: null, closes: null, is_closed: true });
  });
  it("detects changes", () => {
    expect(sameHours(week(), week())).toBe(true);
    expect(sameHours(week(), week({ 0: open(0, "07:00") }))).toBe(false);
    expect(sameHours(week({ 6: { weekday: 6, closed: true, opens: "x", closes: "y" } }), week())).toBe(true); // times on closed days don't matter
  });
  it("copies one day onto others", () => {
    const rows = copyDay(week({ 0: open(0, "06:30", "22:00") }), 0, [1, 2, 6]);
    expect(rows[1]).toMatchObject({ closed: false, opens: "06:30", closes: "22:00" });
    expect(rows[6].closed).toBe(false);
    expect(rows[3].opens).toBe("08:00");
  });
});

describe("closure ranges", () => {
  it("expands a single date and an inclusive range", () => {
    expect(expandDates("2026-12-24", "")).toEqual(["2026-12-24"]);
    expect(expandDates("2026-12-24", "2026-12-24")).toEqual(["2026-12-24"]);
    expect(expandDates("2026-12-30", "2027-01-02")).toEqual(["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
  });
  it("crosses month and leap-day boundaries correctly", () => {
    expect(expandDates("2028-02-28", "2028-03-01")).toEqual(["2028-02-28", "2028-02-29", "2028-03-01"]);
  });
  it("is not thrown off by daylight-saving changes", () => {
    expect(expandDates("2026-03-28", "2026-03-30")).toEqual(["2026-03-28", "2026-03-29", "2026-03-30"]);
    expect(expandDates("2026-10-24", "2026-10-26")).toEqual(["2026-10-24", "2026-10-25", "2026-10-26"]);
  });
  it("refuses backwards, malformed and over-long ranges", () => {
    expect(expandDates("2026-12-25", "2026-12-24")).toBeNull();
    expect(expandDates("tomorrow", "")).toBeNull();
    expect(expandDates("2026-01-01", "2026-03-01")).toBeNull();
    expect(expandDates("2026-01-01", "2026-01-31")).toHaveLength(31);
  });
  it("explains what is wrong", () => {
    expect(closureRangeError("", "")).toMatch(/first day/);
    expect(closureRangeError("2026-12-25", "2026-12-24")).toMatch(/before the first/);
    expect(closureRangeError("2026-01-01", "2026-06-01")).toMatch(/31 days/);
    expect(closureRangeError("2026-12-25", "")).toBeNull();
  });
  it("adds days", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});
