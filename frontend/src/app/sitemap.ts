import type { MetadataRoute } from "next";
import { buildSitemap } from "@/lib/seo";
import { SITE_URL, serverGet } from "@/lib/server";
import type { SitemapData } from "@/lib/types";

// Built per request from the live catalogue (upstream data is cached for an hour); never prerendered at build time.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  try {
    const data = await serverGet<SitemapData>("/seo/sitemap/", undefined, { revalidate: 3600, tags: ["sitemap"] });
    return buildSitemap(data, SITE_URL);
  } catch {
    return []; // API unavailable: an empty sitemap is better than a failing one
  }
}
