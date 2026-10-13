import type { MetadataRoute } from "next";
import { buildRobots } from "@/lib/seo";
import { SITE_URL, getStore } from "@/lib/server";

export const dynamic = "force-dynamic";

export default async function robots(): Promise<MetadataRoute.Robots> {
  // Fail closed: if the store settings can't be read we can't tell whether this is a demonstration catalogue,
  // and a demo catalogue must never be indexed. Crawlers re-fetch robots.txt, so this self-heals.
  let demoMode = true;
  try {
    demoMode = (await getStore()).demo_mode;
  } catch {}
  return buildRobots({ demoMode, siteUrl: SITE_URL });
}
