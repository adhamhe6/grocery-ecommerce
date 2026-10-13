import { describe, expect, it } from "vitest";
import { addDays, checkRange, daysBetween, fillDays, isIsoDate, presetRange, todayIn } from "@/components/admin/reports/date-ranges";

describe("date maths on ISO strings", () => {
  it("adds days across month and year boundaries and leap days", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("counts days inclusively", () => {
    expect(daysBetween("2026-03-01", "2026-03-01")).toBe(1);
    expect(daysBetween("2026-03-01", "2026-03-30")).toBe(30);
  });
  it("validates real calendar dates", () => {
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("yesterday")).toBe(false);
  });
});

describe("presetRange", () => {
  const today = "2026-10-12";
  it("matches the API's own defaults and the usual meanings", () => {
    expect(presetRange("today", today)).toEqual({ from: "2026-10-12", to: "2026-10-12" });
    expect(presetRange("yesterday", today)).toEqual({ from: "2026-10-11", to: "2026-10-11" });
    expect(presetRange("7d", today)).toEqual({ from: "2026-10-06", to: "2026-10-12" });
    expect(presetRange("30d", today)).toEqual({ from: "2026-09-13", to: "2026-10-12" }); // 30 days, like the API default
    expect(presetRange("90d", today)).toEqual({ from: "2026-07-15", to: "2026-10-12" });
    expect(presetRange("mtd", today)).toEqual({ from: "2026-10-01", to: "2026-10-12" });
    expect(presetRange("ytd", today)).toEqual({ from: "2026-01-01", to: "2026-10-12" });
  });
  it("last month is the whole previous calendar month, including across a year boundary", () => {
    expect(presetRange("last-month", today)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(presetRange("last-month", "2027-01-15")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
    expect(presetRange("last-month", "2028-03-05")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });
});

describe("todayIn", () => {
  it("uses the store's time zone for 'today', not UTC", () => {
    const instant = new Date("2026-10-12T23:30:00Z");
    expect(todayIn("UTC", instant)).toBe("2026-10-12");
    expect(todayIn("Pacific/Auckland", instant)).toBe("2026-10-13"); // already tomorrow there
    expect(todayIn("America/Los_Angeles", instant)).toBe("2026-10-12");
  });
  it("falls back to a valid date for an unknown zone", () => {
    expect(isIsoDate(todayIn("Not/AZone"))).toBe(true);
  });
});

describe("checkRange", () => {
  it("accepts ordered valid dates and explains the rest", () => {
    expect(checkRange("2026-03-01", "2026-03-31")).toEqual({ ok: true });
    expect(checkRange("2026-03-31", "2026-03-01")).toMatchObject({ ok: false, message: expect.stringContaining("after") });
    expect(checkRange("", "2026-03-01")).toMatchObject({ ok: false });
  });
});

describe("fillDays", () => {
  it("fills quiet days with zero so the chart doesn't skip them", () => {
    const out = fillDays([{ date: "2026-03-01", value: 5 }, { date: "2026-03-03", value: 7 }], "2026-03-01", "2026-03-04");
    expect(out).toEqual([
      { date: "2026-03-01", value: 5 }, { date: "2026-03-02", value: 0 }, { date: "2026-03-03", value: 7 }, { date: "2026-03-04", value: 0 },
    ]);
  });
  it("leaves the points alone for an invalid or huge range", () => {
    const pts = [{ date: "2026-03-01", value: 5 }];
    expect(fillDays(pts, "2026-03-05", "2026-03-01")).toBe(pts);
    expect(fillDays(pts, "2020-01-01", "2026-03-01")).toBe(pts);
  });
});
