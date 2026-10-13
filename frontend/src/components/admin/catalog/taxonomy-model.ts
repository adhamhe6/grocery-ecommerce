// Pure helpers behind the taxonomy tabs (ordering plans, status labels, payload builders).
import { moveItem } from "./form-kit";

export interface Ordered { id: number; sort_order: number }

/**
 * Explicit up / down ordering on top of a numeric `sort_order` column. Items are numbered (n+1)*step in their new order and
 * only rows whose number changes are returned — so equal values (everything defaults to 100) are separated on the first move.
 */
export function planSortOrder(items: Ordered[], index: number, delta: -1 | 1, step = 10): { id: number; sort_order: number }[] {
  const moved = moveItem(items, index, delta);
  if (moved === items) return [];
  const byId = new Map(items.map((i) => [i.id, i.sort_order]));
  return moved.map((it, i) => ({ id: it.id, sort_order: (i + 1) * step })).filter((u) => byId.get(u.id) !== u.sort_order);
}

export type CollectionState = "Live" | "Scheduled" | "Ended" | "Off";
export function collectionState(c: { is_active: boolean; is_current: boolean; starts_on: string | null }, today: string): CollectionState {
  if (!c.is_active) return "Off";
  if (c.is_current) return "Live";
  return c.starts_on && c.starts_on > today ? "Scheduled" : "Ended";
}

/** An integer when the text is one; otherwise the text itself so the API can say what is wrong. Blank -> `blank`. */
export const intOrRaw = (s: string, blank: number | null = null): number | string | null => (s.trim() === "" ? blank : /^\d+$/.test(s.trim()) ? Number(s.trim()) : s.trim());

export interface CategoryForm { name: string; slug: string; parent: string; description: string; sortOrder: string; isActive: boolean; showOnHome: boolean }
export const emptyCategory = (parent = ""): CategoryForm => ({ name: "", slug: "", parent, description: "", sortOrder: "100", isActive: true, showOnHome: false });
export function categoryPayload(f: CategoryForm): Record<string, unknown> {
  const body: Record<string, unknown> = { name: f.name.trim(), parent: f.parent ? Number(f.parent) : null, description: f.description.trim(), sort_order: intOrRaw(f.sortOrder, 100), is_active: f.isActive, show_on_home: f.showOnHome };
  if (f.slug.trim()) body.slug = f.slug.trim();
  return body;
}

export interface BrandForm { name: string; slug: string; description: string; isActive: boolean }
export const emptyBrand = (): BrandForm => ({ name: "", slug: "", description: "", isActive: true });
export function brandPayload(f: BrandForm): Record<string, unknown> {
  const body: Record<string, unknown> = { name: f.name.trim(), description: f.description.trim(), is_active: f.isActive };
  if (f.slug.trim()) body.slug = f.slug.trim();
  return body;
}

export interface CollectionForm { name: string; slug: string; description: string; isActive: boolean; showOnHome: boolean; sortOrder: string; startsOn: string; endsOn: string }
export const emptyCollection = (): CollectionForm => ({ name: "", slug: "", description: "", isActive: true, showOnHome: false, sortOrder: "100", startsOn: "", endsOn: "" });
export function collectionPayload(f: CollectionForm): Record<string, unknown> {
  const body: Record<string, unknown> = { name: f.name.trim(), description: f.description.trim(), is_active: f.isActive, show_on_home: f.showOnHome, sort_order: intOrRaw(f.sortOrder, 100), starts_on: f.startsOn || null, ends_on: f.endsOn || null };
  if (f.slug.trim()) body.slug = f.slug.trim();
  return body;
}
