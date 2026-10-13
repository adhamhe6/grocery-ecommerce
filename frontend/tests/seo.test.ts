import { describe, expect, it } from "vitest";
import { MAX_SITEMAP_URLS, PRIVATE_PATHS, STATIC_ROUTES, buildRobots, buildSitemap } from "@/lib/seo";
import type { SitemapData } from "@/lib/types";

const SITE = "https://shop.example";
const data: SitemapData = {
  products: [{ slug: "vine-tomatoes", updated_at: "2026-10-01T10:00:00Z" }, { slug: "olive-oil", updated_at: "2026-10-02T10:00:00Z" }],
  categories: [{ slug: "produce", updated_at: "2026-09-30T08:00:00Z" }],
  collections: [{ slug: "weeknight-dinners", updated_at: "2026-09-29T08:00:00Z" }],
  pages: [{ slug: "delivery-policy", updated_at: "2026-09-28T08:00:00Z" }],
  articles: [{ slug: "choosing-ripe-avocados", updated_at: "2026-09-27T08:00:00Z" }],
};
const urls = (entries: { url: string }[]) => entries.map((e) => e.url);

describe("buildSitemap", () => {
  it("lists static routes and every kind of content as absolute URLs", () => {
    const entries = buildSitemap(data, SITE);
    expect(urls(entries)).toEqual(expect.arrayContaining([
      "https://shop.example/", "https://shop.example/shop", "https://shop.example/offers", "https://shop.example/new", "https://shop.example/guides", "https://shop.example/faq", "https://shop.example/stores", "https://shop.example/contact",
      "https://shop.example/product/vine-tomatoes", "https://shop.example/product/olive-oil",
      "https://shop.example/shop?category=produce", "https://shop.example/collections/weeknight-dinners",
      "https://shop.example/p/delivery-policy", "https://shop.example/guides/choosing-ripe-avocados",
    ]));
    expect(entries).toHaveLength(STATIC_ROUTES.length + 6);
    for (const e of entries) expect(e.url).toMatch(/^https:\/\/shop\.example(\/|$)/);
  });

  it("carries the API's last-modified time as an ISO string, only where known", () => {
    const entries = buildSitemap(data, SITE);
    expect(entries.find((e) => e.url.endsWith("/product/olive-oil"))?.lastModified).toBe("2026-10-02T10:00:00.000Z");
    expect(entries.find((e) => e.url.endsWith("/faq"))).not.toHaveProperty("lastModified");
    const odd = buildSitemap({ products: [{ slug: "x", updated_at: "not a date" }] }, SITE);
    expect(odd.find((e) => e.url.endsWith("/product/x"))).not.toHaveProperty("lastModified");
  });

  it("tolerates a trailing slash on the site URL and URL-encodes slugs", () => {
    const entries = buildSitemap({ products: [{ slug: "crème brûlée", updated_at: "2026-10-01T00:00:00Z" }] }, "https://shop.example///");
    expect(urls(entries)).toContain("https://shop.example/product/cr%C3%A8me%20br%C3%BBl%C3%A9e");
    expect(urls(entries)).toContain("https://shop.example/");
  });

  it("skips malformed rows and de-duplicates", () => {
    const entries = buildSitemap({ products: [{ slug: "a", updated_at: "" }, { slug: "a", updated_at: "" }, { slug: "", updated_at: "" }, {} as never, null as never], pages: undefined }, SITE);
    expect(urls(entries).filter((u) => u.endsWith("/product/a"))).toHaveLength(1);
    expect(urls(entries).some((u) => u.endsWith("/product/"))).toBe(false);
  });

  it("still returns the static routes for missing data, and never exceeds the protocol limit", () => {
    expect(buildSitemap(null, SITE)).toHaveLength(STATIC_ROUTES.length);
    expect(buildSitemap({}, SITE)).toHaveLength(STATIC_ROUTES.length);
    const many = { products: Array.from({ length: MAX_SITEMAP_URLS + 500 }, (_, i) => ({ slug: `p-${i}`, updated_at: "2026-10-01T00:00:00Z" })) };
    expect(buildSitemap(many, SITE)).toHaveLength(MAX_SITEMAP_URLS);
  });

  it("never lists private or transactional paths", () => {
    const all = urls(buildSitemap(data, SITE)).map((u) => new URL(u).pathname);
    for (const path of all) for (const blocked of PRIVATE_PATHS) expect(path.startsWith(blocked), `${path} vs ${blocked}`).toBe(false);
  });
});

describe("buildRobots", () => {
  it("blocks everything for a demonstration catalogue, with no sitemap to advertise", () => {
    expect(buildRobots({ demoMode: true, siteUrl: SITE })).toEqual({ rules: [{ userAgent: "*", disallow: "/" }] });
  });

  it("opens the storefront and blocks private paths, linking the sitemap", () => {
    const robots = buildRobots({ demoMode: false, siteUrl: `${SITE}/` });
    expect(robots.sitemap).toBe("https://shop.example/sitemap.xml");
    const rule = (Array.isArray(robots.rules) ? robots.rules[0] : robots.rules) as { userAgent: string; allow: string; disallow: string[] };
    expect(rule.userAgent).toBe("*");
    expect(rule.allow).toBe("/");
    for (const p of ["/api/", "/admin", "/account", "/checkout", "/cart", "/orders", "/pay", "/login"]) expect(rule.disallow).toContain(p);
    for (const p of ["/shop", "/product", "/offers", "/guides", "/faq"]) expect(rule.disallow.some((d) => p.startsWith(d))).toBe(false);
  });
});
