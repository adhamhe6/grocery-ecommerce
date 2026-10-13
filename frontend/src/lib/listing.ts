import "server-only";
import type { Metadata } from "next";
import { hasActiveFilters, listingQuery, type ListingOptions, type SP } from "./listing-query";
import { selectedBranch, serverGet } from "./server";
import type { CategoryNode, ProductListResponse } from "./types";

/** Fetches one page of products (with facets) and the department tree, for the shopper's selected store. */
export async function loadListing(sp: SP, options: Omit<ListingOptions, "branch"> = {}) {
  const branch = await selectedBranch();
  const query = listingQuery(sp, { ...options, branch });
  const [data, tree] = await Promise.all([
    serverGet<ProductListResponse>("/products/", query, { revalidate: 20 }),
    serverGet<CategoryNode[]>("/categories/", undefined, { revalidate: 120, tags: ["categories"] }),
  ]);
  return { data, tree, query };
}

/** Metadata for a listing page: one canonical URL, and filtered / paginated variants kept out of the index. */
export function listingMetadata(sp: SP, { title, description, path, fixed }: { title: string; description?: string; path: string; fixed?: Record<string, string> }): Metadata {
  const query = listingQuery(sp, { fixed, allowSearch: path === "/shop" });
  // `query.sort` is only set when the visitor chose a valid one (no default is passed here)
  const variant = hasActiveFilters(query, fixed) || !!query.page || !!query.sort;
  // `robots` is left out entirely (not set to undefined) so the root layout's demo-store noindex still applies
  return { title, ...(description ? { description } : {}), alternates: { canonical: path }, ...(variant ? { robots: { index: false, follow: true } } : {}) };
}
