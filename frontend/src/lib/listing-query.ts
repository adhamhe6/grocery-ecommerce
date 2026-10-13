// Pure helpers shared by /shop, /offers, /new and /collections/[slug]: turn the page's query string into a safe API
// query, and turn category data into the department links shown in the filter sidebar.

import type { CategoryNode, Facets } from "./types";

export type SP = Record<string, string | string[] | undefined>;

export const SORTS = ["relevance", "price_asc", "price_desc", "newest", "popular", "name", "offers"] as const;

export interface ListingOptions {
  /** API filters that define the page itself (e.g. `{ on_offer: "true" }`); they always win over the query string. */
  fixed?: Record<string, string>;
  /** Sort used when the visitor has not chosen one. */
  defaultSort?: string;
  /** Only /shop takes a free-text query. */
  allowSearch?: boolean;
  branch?: number;
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
const SLUG = /^[A-Za-z0-9_-]+$/;
const DECIMAL = /^\d{1,8}(\.\d{1,2})?$/;

/** Reads only the filters the product API accepts, dropping malformed values instead of forwarding them (the API would answer 400). */
export function listingQuery(sp: SP, { fixed = {}, defaultSort, allowSearch = false, branch }: ListingOptions = {}) {
  const sort = one(sp.sort);
  const category = one(sp.category);
  const brands = ([] as string[]).concat(sp.brand ?? []).flatMap((b) => b.split(",")).map((b) => b.trim()).filter((b) => SLUG.test(b));
  const flag = (k: string) => (one(sp[k]) === "true" ? "true" : undefined);
  const decimal = (k: string) => {
    const v = one(sp[k]);
    return v && DECIMAL.test(v) ? v : undefined;
  };
  const page = one(sp.page);
  const q = allowSearch ? one(sp.q)?.slice(0, 500) : undefined;
  return {
    q,
    category: category && SLUG.test(category) ? category : undefined,
    brand: brands.length ? brands : undefined,
    sort: sort && (SORTS as readonly string[]).includes(sort) ? sort : defaultSort,
    page: page && /^[1-9]\d{0,5}$/.test(page) ? page : undefined,
    in_stock: flag("in_stock"),
    on_offer: flag("on_offer"),
    is_new: flag("is_new"),
    price_min: decimal("price_min"),
    price_max: decimal("price_max"),
    branch: branch ? String(branch) : undefined,
    facets: "true",
    ...fixed,
  } as Record<string, string | string[] | undefined>;
}

/** True when the visitor has narrowed the listing beyond the page's own fixed context. */
export function hasActiveFilters(query: Record<string, string | string[] | undefined>, fixed: Record<string, string> = {}): boolean {
  return ["q", "category", "brand", "in_stock", "on_offer", "is_new", "price_min", "price_max"].some((k) => !(k in fixed) && !!query[k]);
}

// ------------------------------------------------------------------------------------------------ departments
export interface DepartmentLink {
  slug: string;
  name: string;
  count: number;
  children: { slug: string; name: string; count: number }[];
}

/** The catalogue-wide department tree (counts are for the whole catalogue). */
export function treeDepartments(tree: CategoryNode[]): DepartmentLink[] {
  return tree.map((d) => ({ slug: d.slug, name: d.name, count: d.count, children: (d.children ?? []).map((c) => ({ slug: c.slug, name: c.name, count: c.count })) }));
}

/**
 * Department links whose counts describe *this* listing (e.g. only the products on offer), built from the API's
 * facets. Departments and categories with no matching product are left out, so a link never leads to an empty page.
 */
export function scopedDepartments(tree: CategoryNode[], facets: Facets | undefined): DepartmentLink[] {
  if (!facets) return [];
  const out: DepartmentLink[] = [];
  for (const d of tree) {
    const children = facets.categories.filter((c) => c.parent === d.slug).map((c) => ({ slug: c.slug, name: c.name, count: c.count }));
    const own = facets.categories.find((c) => c.slug === d.slug && c.parent === null)?.count ?? 0;
    const count = own + children.reduce((sum, c) => sum + c.count, 0);
    if (count > 0) out.push({ slug: d.slug, name: d.name, count, children });
  }
  return out;
}
