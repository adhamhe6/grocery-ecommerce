import { describe, expect, it } from "vitest";
import { batchActionPayload, batchActions, bucketLabel, daysLabel, expiryBucket, isWriteOffCandidate } from "@/components/admin/inventory/expiry";

describe("expiryBucket (mirrors the server's risk thresholds)", () => {
  it.each([
    [-30, "expired"], [-1, "expired"],
    [0, "today_tomorrow"], [1, "today_tomorrow"],
    [2, "within_3"], [3, "within_3"],
    [4, "within_7"], [7, "within_7"],
    [8, "later"], [400, "later"],
  ])("%i days → %s", (days, bucket) => {
    expect(expiryBucket(days, "5")).toBe(bucket);
  });

  it("has no bucket without an expiry date or without stock", () => {
    expect(expiryBucket(null, "5")).toBe("none");
    expect(expiryBucket(undefined, "5")).toBe("none");
    expect(expiryBucket(-3, "0")).toBe("none");
    expect(expiryBucket(2, "0")).toBe("none");
  });

  it("labels buckets for display", () => {
    expect(bucketLabel("expired")).toBe("Expired");
    expect(bucketLabel("today_tomorrow")).toBe("≤ 1 day");
    expect(bucketLabel("within_3")).toBe("2–3 days");
    expect(bucketLabel("within_7")).toBe("4–7 days");
    expect(bucketLabel("later")).toBe("More than 7 days");
  });
});

describe("daysLabel", () => {
  it("reads naturally", () => {
    expect(daysLabel(null)).toBe("No expiry date");
    expect(daysLabel(-5)).toBe("Expired 5 days ago");
    expect(daysLabel(-1)).toBe("Expired yesterday");
    expect(daysLabel(0)).toBe("Expires today");
    expect(daysLabel(1)).toBe("Expires tomorrow");
    expect(daysLabel(6)).toBe("6 days left");
  });
});

describe("write-off shortcut", () => {
  it("is offered for expired batches that still have stock", () => {
    expect(isWriteOffCandidate({ qty_remaining: "10", days_to_expiry: -2, status: "EXPIRED" })).toBe(true);
    // The nightly job may not have flipped the status yet; the date is what matters.
    expect(isWriteOffCandidate({ qty_remaining: "10", days_to_expiry: -1, status: "ACTIVE" })).toBe(true);
  });
  it("is not offered for in-date or empty batches", () => {
    expect(isWriteOffCandidate({ qty_remaining: "10", days_to_expiry: 0, status: "ACTIVE" })).toBe(false);
    expect(isWriteOffCandidate({ qty_remaining: "0", days_to_expiry: -4, status: "EXPIRED" })).toBe(false);
  });
});

describe("batch status actions", () => {
  it("offers sensible actions per state", () => {
    expect(batchActions({ status: "ACTIVE", quality_status: "PASSED" })).toEqual(["quarantine", "fail"]);
    expect(batchActions({ status: "QUARANTINED", quality_status: "PASSED" })).toEqual(["release", "fail"]);
    expect(batchActions({ status: "ACTIVE", quality_status: "PENDING" })).toEqual(["quarantine", "fail", "pass"]);
    expect(batchActions({ status: "ACTIVE", quality_status: "FAILED" })).toEqual(["quarantine", "pass"]);
  });
  it("never offers release for expired or used-up batches (the server refuses it)", () => {
    expect(batchActions({ status: "EXPIRED", quality_status: "PASSED" })).not.toContain("release");
    expect(batchActions({ status: "DEPLETED", quality_status: "PASSED" })).not.toContain("release");
  });
  it("builds the request body for each action", () => {
    expect(batchActionPayload("quarantine", " recall ")).toEqual({ status: "QUARANTINED", note: "recall" });
    expect(batchActionPayload("release", "")).toEqual({ status: "ACTIVE" });
    expect(batchActionPayload("fail", "")).toEqual({ quality_status: "FAILED" });
    expect(batchActionPayload("pass", "ok")).toEqual({ quality_status: "PASSED", note: "ok" });
  });
});
