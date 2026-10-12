// Pure builders for sitemap.xml and robots.txt (the route files in src/app only fetch data and call these).

import type { MetadataRoute } from "next";
import type { SitemapData } from "./types";

/** Public, indexable storefront pages that exist regardless of catalogue content. */
export const STATIC_ROUTES = ["/", "/shop", "/offers", "/new", "/guides", "/faq", "/stores", "/contact"] as const;

/** Per-customer, transactional or utility paths that must never be crawled. */
export const PRIVATE_PATHS = [
  "/api/",
  "/admin",
  "/account",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/cart",
  "/checkout",
  "/orders",
  "/pay",
  "/compare",
  "/track",
  "/newsletter/",
] as const;

/** The sitemap protocol allows at most 50,000 URLs per file. */
export const MAX_SITEMAP_URLS = 50_000;

type Row = { slug?: unknown; updated_at?: unknown };

function lastModified(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/**
 * Static routes first, then the data that changes least to most often. Everything is an absolute URL on `siteUrl`.
 * Malformed rows are skipped and duplicate URLs collapse into one.
 */
export function buildSitemap(data: Partial<SitemapData> | null | undefined, siteUrl: string): MetadataRoute.Sitemap {
  const base = siteUrl.replace(/\/+$/, "");
  const seen = new Set<string>();
  const entries: MetadataRoute.Sitemap = [];
  const add = (path: string, modified?: string) => {
    const url = path === "/" ? `${base}/` : `${base}${path}`;
    if (seen.has(url) || entries.length >= MAX_SITEMAP_URLS) return;
    seen.add(url);
    entries.push(modified ? { url, lastModified: modified } : { url });
  };
  const addRows = (rows: Row[] | undefined, path: (slug: string) => string) => {
    for (const row of Array.isArray(rows) ? rows : []) {
      if (typeof row?.slug !== "string" || !row.slug) continue;
      add(path(encodeURIComponent(row.slug)), lastModified(row.updated_at));
    }
  };

  for (const route of STATIC_ROUTES) add(route);
  addRows(data?.collections, (s) => `/collections/${s}`);
  addRows(data?.pages, (s) => `/p/${s}`);
  addRows(data?.articles, (s) => `/guides/${s}`);
  addRows(data?.categories, (s) => `/shop?category=${s}`);
  addRows(data?.products, (s) => `/product/${s}`);
  return entries;
}

/**
 * A demonstration catalogue must not be indexed, so in demo mode everything is disallowed (and no sitemap is advertised).
 * Otherwise the storefront is open and only private/transactional paths are blocked.
 */
export function buildRobots({ demoMode, siteUrl }: { demoMode: boolean; siteUrl: string }): MetadataRoute.Robots {
  if (demoMode) return { rules: [{ userAgent: "*", disallow: "/" }] };
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: [...PRIVATE_PATHS] }],
    sitemap: `${siteUrl.replace(/\/+$/, "")}/sitemap.xml`,
  };
}
