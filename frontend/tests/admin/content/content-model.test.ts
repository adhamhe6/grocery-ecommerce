import { describe, expect, it } from "vitest";
import {
  articlePayload, articleState, articleToForm, bannerPayload, bannerState, emptyArticle, emptyBanner, emptyFaq, emptyPage, faqPayload, pagePayload, validateArticle, validateBanner, validateFaq, validatePage,
  type ArticleRow,
} from "@/components/admin/content/content-model";

describe("banners", () => {
  it("builds the body; an unset start is omitted so the server uses now", () => {
    const body = bannerPayload({ ...emptyBanner(), title: " Autumn sale ", ctaLabel: "Shop", ctaLink: " /offers " });
    expect(body).toMatchObject({ placement: "HERO", title: "Autumn sale", cta_label: "Shop", cta_link: "/offers", ends_at: null, sort_order: 100, is_active: true });
    expect(body).not.toHaveProperty("starts_at");
    expect(bannerPayload({ ...emptyBanner(), title: "x", startsAt: "2026-11-01T00:00:00Z" })).toHaveProperty("starts_at");
  });
  it("needs a headline", () => {
    expect(validateBanner(emptyBanner())).toHaveProperty("title");
    expect(validateBanner({ ...emptyBanner(), title: "Hi" })).toEqual({});
  });
  it("labels the lifecycle", () => {
    const now = new Date("2026-11-10T00:00:00Z");
    expect(bannerState({ is_active: false, is_live: false, starts_at: "2026-11-01T00:00:00Z" }, now)).toBe("Off");
    expect(bannerState({ is_active: true, is_live: true, starts_at: "2026-11-01T00:00:00Z" }, now)).toBe("Live");
    expect(bannerState({ is_active: true, is_live: false, starts_at: "2026-12-01T00:00:00Z" }, now)).toBe("Scheduled");
    expect(bannerState({ is_active: true, is_live: false, starts_at: "2026-11-01T00:00:00Z" }, now)).toBe("Ended");
  });
});

describe("pages", () => {
  it("starts unpublished and sends a slug only when typed", () => {
    expect(emptyPage().isPublished).toBe(false);
    const body = pagePayload({ ...emptyPage(), title: " Returns ", body: "# Returns\n\nText" });
    expect(body).toEqual({ title: "Returns", summary: "", body: "# Returns\n\nText", is_published: false, is_template: false });
    expect(pagePayload({ ...emptyPage(), title: "R", body: "b", slug: " returns " })).toHaveProperty("slug", "returns");
  });
  it("needs a title and text, and keeps the body exactly as typed", () => {
    expect(Object.keys(validatePage(emptyPage())).sort()).toEqual(["body", "title"]);
    expect(pagePayload({ ...emptyPage(), title: "t", body: "  indented\n" }).body).toBe("  indented\n");
  });
});

describe("articles", () => {
  it("builds numbers as integers and omits an unset publish date", () => {
    const body = articlePayload({ ...emptyArticle(), title: "Pasta", summary: "Quick", body: "## Method", products: [3, 4], servings: "4", totalMinutes: "20" });
    expect(body).toMatchObject({ kind: "RECIPE", products: [3, 4], servings: 4, total_minutes: 20, is_published: false });
    expect(body).not.toHaveProperty("published_at");
    expect(articlePayload({ ...emptyArticle(), servings: "", totalMinutes: "" })).toMatchObject({ servings: null, total_minutes: null });
  });
  it("needs title, summary and text", () => expect(Object.keys(validateArticle(emptyArticle())).sort()).toEqual(["body", "summary", "title"]));
  it("round-trips and labels the lifecycle", () => {
    const row = { id: 1, kind: "GUIDE", slug: "s", title: "T", summary: "S", body: "B", image: {}, products: [1], servings: null, total_minutes: 15, published_at: "2026-11-01T00:00:00Z", is_published: true, is_live: false } as unknown as ArticleRow;
    expect(articleToForm(row)).toMatchObject({ kind: "GUIDE", servings: "", totalMinutes: "15", publishedAt: "2026-11-01T00:00:00Z" });
    const now = new Date("2026-10-01T00:00:00Z");
    expect(articleState({ is_published: false, is_live: false, published_at: row.published_at }, now)).toBe("Not published");
    expect(articleState({ is_published: true, is_live: true, published_at: row.published_at }, now)).toBe("Live");
    expect(articleState({ is_published: true, is_live: false, published_at: row.published_at }, now)).toBe("Scheduled");
  });
});

describe("FAQs", () => {
  it("defaults the topic and needs a question and answer", () => {
    expect(faqPayload({ ...emptyFaq(), topic: " ", question: " Do you deliver? ", answer: "Yes." })).toEqual({ topic: "General", question: "Do you deliver?", answer: "Yes.", sort_order: 100, is_published: false });
    expect(Object.keys(validateFaq(emptyFaq())).sort()).toEqual(["answer", "question"]);
  });
});
