// schema.org JSON-LD builders. Every field is derived from real API data; a field with no source is left out.

import { isoDuration } from "./content";
import { imgSrc } from "./format";
import { markdownToPlain, parseMarkdown, sectionListItems } from "./markdown";
import type { ArticleDetail, FaqRow } from "./types";

/** JSON for an inline <script type="application/ld+json">: `<`, `>`, `&` and line separators are escaped so the data can never close the tag. */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

const absolute = (url: string, siteUrl: string) => new URL(url, siteUrl).toString();

/** FAQPage from the published FAQ rows; null when there is nothing to describe. */
export function faqJsonLd(rows: FaqRow[]): Record<string, unknown> | null {
  const mainEntity = rows
    .map((r) => ({ q: r.question.trim(), a: markdownToPlain(r.answer) }))
    .filter((r) => r.q && r.a)
    .map((r) => ({ "@type": "Question", name: r.q, acceptedAnswer: { "@type": "Answer", text: r.a } }));
  return mainEntity.length ? { "@context": "https://schema.org", "@type": "FAQPage", mainEntity } : null;
}

const INGREDIENTS = /^ingredients?$/i;
const METHOD = /^(method|instructions?|directions?|steps?|preparation)$/i;

/**
 * Recipe markup for RECIPE articles only. Ingredients and steps are read from the article's own "Ingredients" and
 * "Method" lists; yield and time come from `servings` / `total_minutes`. Nothing is invented (no author, ratings,
 * nutrition or video) — and any field the article does not carry is omitted.
 */
export function recipeJsonLd(article: ArticleDetail, siteUrl: string): Record<string, unknown> | null {
  if (article.kind !== "RECIPE") return null;
  const blocks = parseMarkdown(article.body);
  const ingredients = sectionListItems(blocks, INGREDIENTS);
  const steps = sectionListItems(blocks, METHOD);
  const image = article.image ? imgSrc(article.image, 1024) : "";
  const base = siteUrl.replace(/\/+$/, "");
  return {
    "@context": "https://schema.org",
    "@type": "Recipe",
    name: article.title,
    description: article.summary || undefined,
    image: image ? [absolute(image, siteUrl)] : undefined,
    datePublished: article.published_at || undefined,
    recipeYield: article.servings ? `${article.servings} ${article.servings === 1 ? "serving" : "servings"}` : undefined,
    totalTime: article.total_minutes ? isoDuration(article.total_minutes) : undefined,
    recipeIngredient: ingredients ?? undefined,
    recipeInstructions: steps?.map((text) => ({ "@type": "HowToStep", text })),
    mainEntityOfPage: `${base}/guides/${encodeURIComponent(article.slug)}`,
  };
}
