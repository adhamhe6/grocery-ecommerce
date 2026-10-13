// Content (banners, pages, articles, FAQs): API shapes, form state, payload builders and validators.
import type { Errors } from "../catalog/form-kit";
import { intOrRaw } from "../catalog/taxonomy-model";

const t = (s: string) => s.trim();

// ------------------------------------------------------------------------------------------------ banners
export const PLACEMENTS: [string, string][] = [["HERO", "Home hero"], ["STRIP", "Announcement strip"], ["PROMO", "Home promo tile"]];
export interface BannerRow {
  id: number; placement: string; title: string; subtitle: string; image: Record<string, string>; cta_label: string; cta_link: string;
  starts_at: string; ends_at: string | null; sort_order: number; is_active: boolean; is_live: boolean; created_at: string; updated_at: string;
}
export interface BannerForm { placement: string; title: string; subtitle: string; ctaLabel: string; ctaLink: string; startsAt: string | null; endsAt: string | null; sortOrder: string; isActive: boolean }
export const emptyBanner = (): BannerForm => ({ placement: "HERO", title: "", subtitle: "", ctaLabel: "", ctaLink: "", startsAt: null, endsAt: null, sortOrder: "100", isActive: true });
export const bannerToForm = (b: BannerRow): BannerForm => ({ placement: b.placement, title: b.title, subtitle: b.subtitle, ctaLabel: b.cta_label, ctaLink: b.cta_link, startsAt: b.starts_at, endsAt: b.ends_at, sortOrder: String(b.sort_order), isActive: b.is_active });
export function bannerPayload(f: BannerForm): Record<string, unknown> {
  const body: Record<string, unknown> = { placement: f.placement, title: t(f.title), subtitle: t(f.subtitle), cta_label: t(f.ctaLabel), cta_link: t(f.ctaLink), ends_at: f.endsAt, sort_order: intOrRaw(f.sortOrder, 100), is_active: f.isActive };
  if (f.startsAt) body.starts_at = f.startsAt;
  return body;
}
export const validateBanner = (f: BannerForm): Errors => (t(f.title) ? {} : { title: "Enter the headline shoppers will see." });

export type BannerState = "Live" | "Scheduled" | "Ended" | "Off";
export function bannerState(b: Pick<BannerRow, "is_active" | "is_live" | "starts_at">, now = new Date()): BannerState {
  if (!b.is_active) return "Off";
  if (b.is_live) return "Live";
  return new Date(b.starts_at) > now ? "Scheduled" : "Ended";
}

// ------------------------------------------------------------------------------------------------ pages
export interface PageRow { id: number; slug: string; title: string; summary: string; body: string; is_published: boolean; is_template: boolean; created_at: string; updated_at: string }
export interface PageForm { title: string; slug: string; summary: string; body: string; isPublished: boolean; isTemplate: boolean }
export const emptyPage = (): PageForm => ({ title: "", slug: "", summary: "", body: "", isPublished: false, isTemplate: false });
export const pageToForm = (p: PageRow): PageForm => ({ title: p.title, slug: p.slug, summary: p.summary, body: p.body, isPublished: p.is_published, isTemplate: p.is_template });
export function pagePayload(f: PageForm): Record<string, unknown> {
  const body: Record<string, unknown> = { title: t(f.title), summary: t(f.summary), body: f.body, is_published: f.isPublished, is_template: f.isTemplate };
  if (t(f.slug)) body.slug = t(f.slug);
  return body;
}
export function validatePage(f: PageForm): Errors {
  const e: Errors = {};
  if (!t(f.title)) e.title = "Enter a title.";
  if (!t(f.body)) e.body = "Write the page text.";
  return e;
}

// ------------------------------------------------------------------------------------------------ articles & recipes
export const ARTICLE_KINDS: [string, string][] = [["RECIPE", "Recipe"], ["GUIDE", "Grocery guide"]];
export interface ArticleRow {
  id: number; kind: "RECIPE" | "GUIDE"; slug: string; title: string; summary: string; body: string; image: Record<string, string>; products: number[]; servings: number | null; total_minutes: number | null;
  published_at: string; is_published: boolean; is_live: boolean; created_at: string; updated_at: string;
}
export interface ArticleForm { kind: string; title: string; slug: string; summary: string; body: string; products: number[]; servings: string; totalMinutes: string; publishedAt: string | null; isPublished: boolean }
export const emptyArticle = (): ArticleForm => ({ kind: "RECIPE", title: "", slug: "", summary: "", body: "", products: [], servings: "", totalMinutes: "", publishedAt: null, isPublished: false });
export const articleToForm = (a: ArticleRow): ArticleForm => ({
  kind: a.kind, title: a.title, slug: a.slug, summary: a.summary, body: a.body, products: a.products, servings: a.servings == null ? "" : String(a.servings),
  totalMinutes: a.total_minutes == null ? "" : String(a.total_minutes), publishedAt: a.published_at, isPublished: a.is_published,
});
export function articlePayload(f: ArticleForm): Record<string, unknown> {
  const body: Record<string, unknown> = {
    kind: f.kind, title: t(f.title), summary: t(f.summary), body: f.body, products: f.products,
    servings: intOrRaw(f.servings), total_minutes: intOrRaw(f.totalMinutes), is_published: f.isPublished,
  };
  if (t(f.slug)) body.slug = t(f.slug);
  if (f.publishedAt) body.published_at = f.publishedAt;
  return body;
}
export function validateArticle(f: ArticleForm): Errors {
  const e: Errors = {};
  if (!t(f.title)) e.title = "Enter a title.";
  if (!t(f.summary)) e.summary = "Write a one or two line summary for cards and search results.";
  if (!t(f.body)) e.body = "Write the article text.";
  return e;
}
export type ArticleState = "Live" | "Scheduled" | "Not published";
export function articleState(a: Pick<ArticleRow, "is_published" | "is_live" | "published_at">, now = new Date()): ArticleState {
  if (!a.is_published) return "Not published";
  if (a.is_live) return "Live";
  return new Date(a.published_at) > now ? "Scheduled" : "Live";
}

// ------------------------------------------------------------------------------------------------ FAQs
export interface FaqRow { id: number; question: string; answer: string; topic: string; sort_order: number; is_published: boolean }
export interface FaqForm { topic: string; question: string; answer: string; sortOrder: string; isPublished: boolean }
export const emptyFaq = (topic = "General"): FaqForm => ({ topic, question: "", answer: "", sortOrder: "100", isPublished: false });
export const faqToForm = (f: FaqRow): FaqForm => ({ topic: f.topic, question: f.question, answer: f.answer, sortOrder: String(f.sort_order), isPublished: f.is_published });
export const faqPayload = (f: FaqForm): Record<string, unknown> => ({ topic: t(f.topic) || "General", question: t(f.question), answer: f.answer, sort_order: intOrRaw(f.sortOrder, 100), is_published: f.isPublished });
export function validateFaq(f: FaqForm): Errors {
  const e: Errors = {};
  if (!t(f.question)) e.question = "Enter the question.";
  if (!t(f.answer)) e.answer = "Write the answer.";
  return e;
}
