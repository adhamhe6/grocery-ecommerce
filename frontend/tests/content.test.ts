import { describe, expect, it } from "vitest";
import { PAGE_ALIASES, formatDuration, groupFaqs, isoDuration, pageNumber, parseKind, resolvePageAlias } from "@/lib/content";
import type { FaqRow } from "@/lib/types";

describe("parseKind", () => {
  it("accepts recipe/guide spellings in any case and ignores the rest", () => {
    expect(parseKind("recipe")).toBe("RECIPE");
    expect(parseKind("RECIPES")).toBe("RECIPE");
    expect(parseKind(" Guide ")).toBe("GUIDE");
    expect(parseKind(["guides", "recipe"])).toBe("GUIDE");
    for (const v of [undefined, "", "all", "article", "RECIPE; DROP TABLE"]) expect(parseKind(v)).toBeUndefined();
  });
});

describe("durations", () => {
  it("formats for people and for schema.org", () => {
    expect(formatDuration(35)).toBe("35 min");
    expect(formatDuration(60)).toBe("1 h");
    expect(formatDuration(110)).toBe("1 h 50 min");
    expect(isoDuration(35)).toBe("PT35M");
    expect(isoDuration(60)).toBe("PT1H");
    expect(isoDuration(110)).toBe("PT1H50M");
    expect(isoDuration(0)).toBe("PT0M");
  });
});

describe("pageNumber", () => {
  it("only passes plain positive integers", () => {
    expect(pageNumber("2")).toBe("2");
    for (const v of ["0", "-1", "1.5", "abc", "", "1e3", undefined]) expect(pageNumber(v)).toBeUndefined();
  });
});

describe("groupFaqs", () => {
  const row = (id: number, topic: string): FaqRow => ({ id, topic, question: `Q${id}`, answer: `A${id}` });

  it("groups by topic in the API's order with unique anchors", () => {
    const groups = groupFaqs([row(1, "Delivery"), row(2, "Delivery"), row(3, "Weighed items"), row(4, "Weighed-items"), row(5, "About this store")]);
    expect(groups.map((g) => [g.topic, g.rows.map((r) => r.id)])).toEqual([["Delivery", [1, 2]], ["Weighed items", [3]], ["Weighed-items", [4]], ["About this store", [5]]]);
    expect(groups.map((g) => g.id)).toEqual(["faq-delivery", "faq-weighed-items", "faq-weighed-items-2", "faq-about-this-store"]);
    expect(new Set(groups.map((g) => g.id)).size).toBe(groups.length);
  });

  it("copes with blank and symbol-only topics", () => {
    const groups = groupFaqs([row(1, ""), row(2, "???")]);
    expect(groups.map((g) => g.topic)).toEqual(["General", "???"]);
    expect(groups.map((g) => g.id)).toEqual(["faq-general", "faq-topic"]);
  });

  it("returns no groups for no rows", () => {
    expect(groupFaqs([])).toEqual([]);
  });
});

describe("page aliases", () => {
  const pages = ["about", "delivery-policy", "refund-and-cancellation", "privacy"];

  it("forwards the short names the site links to onto the real pages", () => {
    expect(resolvePageAlias("delivery", pages)).toBe("delivery-policy");
    expect(resolvePageAlias("returns", pages)).toBe("refund-and-cancellation");
    expect(PAGE_ALIASES).toMatchObject({ delivery: "delivery-policy", returns: "refund-and-cancellation" });
  });

  it("never hides a real page, and never forwards to a page that does not exist", () => {
    expect(resolvePageAlias("delivery", [...pages, "delivery"])).toBeNull();
    expect(resolvePageAlias("delivery", ["about"])).toBeNull();
    expect(resolvePageAlias("accessibility", pages)).toBeNull();
    expect(resolvePageAlias("about", pages)).toBeNull();
  });
});
