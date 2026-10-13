import { describe, expect, it } from "vitest";
import { formatSchedule, isoToLocalInput, localInputToIso } from "@/components/admin/catalog/datetime";

describe("store-time conversion", () => {
  it("reads an instant as wall time in the store's zone", () => {
    expect(isoToLocalInput("2026-10-31T14:00:00Z", "America/New_York")).toBe("2026-10-31T10:00"); // EDT until 1 Nov 2026 06:00 UTC
    expect(isoToLocalInput("2026-11-01T14:00:00Z", "America/New_York")).toBe("2026-11-01T09:00"); // EST afterwards
    expect(isoToLocalInput(null, "UTC")).toBe("");
    expect(isoToLocalInput("nonsense", "UTC")).toBe("");
  });
  it("turns wall time in the store's zone into the right instant, across DST", () => {
    expect(localInputToIso("2026-07-01T09:00", "America/New_York")).toBe("2026-07-01T13:00:00Z");
    expect(localInputToIso("2026-12-01T09:00", "America/New_York")).toBe("2026-12-01T14:00:00Z");
    expect(localInputToIso("2026-11-01T09:00", "Europe/London")).toBe("2026-11-01T09:00:00Z");
    expect(localInputToIso("2026-06-01T09:00", "Europe/London")).toBe("2026-06-01T08:00:00Z");
  });
  it("round-trips and rejects blanks", () => {
    const iso = localInputToIso("2026-03-15T18:30", "Asia/Dubai")!;
    expect(isoToLocalInput(iso, "Asia/Dubai")).toBe("2026-03-15T18:30");
    expect(localInputToIso("", "UTC")).toBeNull();
    expect(localInputToIso("2026-13", "UTC")).toBeNull();
  });
});

describe("formatSchedule", () => {
  const tz = "UTC";
  it("compacts a range inside one month", () => {
    expect(formatSchedule("2026-11-01T00:00:00Z", "2026-11-30T00:00:00Z", tz, "en-GB")).toBe("1–30 Nov 2026");
  });
  it("spans months and says when there is no end", () => {
    expect(formatSchedule("2026-11-20T00:00:00Z", "2026-12-03T00:00:00Z", tz, "en-GB")).toBe("20 Nov – 3 Dec 2026");
    expect(formatSchedule("2026-11-01T00:00:00Z", null, tz, "en-GB")).toBe("from 1 Nov 2026, no end date");
    expect(formatSchedule(null, null, tz)).toBe("");
  });
  it("uses the store's time zone for the day boundary", () => {
    expect(formatSchedule("2026-11-01T02:00:00Z", "2026-11-05T02:00:00Z", "America/New_York", "en-GB")).toBe("31 Oct – 4 Nov 2026");
  });
});
