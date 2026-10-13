// Pure helpers for the content pages (guides, FAQ, CMS pages). No server-only imports so they can be unit-tested.

import type { ArticleListItem, FaqRow } from "./types";

export type ArticleKind = ArticleListItem["kind"];

/** `?kind=` accepts recipe(s) / guide(s) in any case; anything else means "all". */
export function parseKind(value: string | string[] | undefined): ArticleKind | undefined {
  const v = (Array.isArray(value) ? value[0] : value)?.trim().toLowerCase();
  if (v === "recipe" || v === "recipes") return "RECIPE";
  if (v === "guide" || v === "guides") return "GUIDE";
  return undefined;
}

export const kindLabel = (kind: ArticleKind) => (kind === "RECIPE" ? "Recipe" : "Guide");

/** "35 min", "1 h 50 min", "2 h". */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** ISO 8601 duration for schema.org (`PT1H50M`). */
export function isoDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `PT${h ? `${h}H` : ""}${m || !h ? `${m}M` : ""}`;
}

export function pageNumber(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return v && /^[1-9]\d{0,5}$/.test(v) ? v : undefined;
}

// ------------------------------------------------------------------------------------------------ FAQ
export interface FaqGroup {
  topic: string;
  id: string;
  rows: FaqRow[];
}

const topicSlug = (topic: string) =>
  topic
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "topic";

/** Groups rows by topic, keeping the API's order, with a unique anchor id per topic. */
export function groupFaqs(rows: FaqRow[]): FaqGroup[] {
  const groups = new Map<string, FaqGroup>();
  const used = new Set<string>();
  for (const row of rows) {
    const topic = row.topic.trim() || "General";
    let group = groups.get(topic);
    if (!group) {
      const base = `faq-${topicSlug(topic)}`;
      let id = base;
      for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
      used.add(id);
      group = { topic, id, rows: [] };
      groups.set(topic, group);
    }
    group.rows.push(row);
  }
  return [...groups.values()];
}

// ------------------------------------------------------------------------------------------------ CMS page aliases
/**
 * Older links (footer, product page) use short names. Each alias only redirects when the page itself does not exist
 * and the target page does, so the redirect never hides a real page.
 */
export const PAGE_ALIASES: Record<string, string> = { delivery: "delivery-policy", returns: "refund-and-cancellation" };

export function resolvePageAlias(slug: string, available: readonly string[]): string | null {
  const target = PAGE_ALIASES[slug];
  return target && !available.includes(slug) && available.includes(target) ? target : null;
}
