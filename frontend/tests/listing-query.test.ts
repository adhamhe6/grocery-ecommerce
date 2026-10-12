import { describe, expect, it } from "vitest";
import { hasActiveFilters, listingQuery, scopedDepartments, treeDepartments } from "@/lib/listing-query";
import type { CategoryNode, Facets } from "@/lib/types";

describe("listingQuery", () => {
  it("passes valid filters through", () => {
    const q = listingQuery({ category: "berries", brand: "a,b", sort: "price_asc", page: "3", in_stock: "true", price_min: "2.50", price_max: "10" }, { branch: 7 });
    expect(q).toMatchObject({ category: "berries", brand: ["a", "b"], sort: "price_asc", page: "3", in_stock: "true", price_min: "2.50", price_max: "10", branch: "7", facets: "true" });
  });

  it("drops malformed values the API would reject, instead of forwarding them", () => {
    const q = listingQuery({ category: "bad slug!", brand: ["ok", "no way", "x;y"], sort: "bogus", page: "0", in_stock: "yes", price_min: "-1", price_max: "1e9", q: "ignored" });
    expect(q.category).toBeUndefined();
    expect(q.brand).toEqual(["ok"]);
    expect(q.sort).toBeUndefined();
    expect(q.page).toBeUndefined();
    expect(q.in_stock).toBeUndefined();
    expect(q.price_min).toBeUndefined();
    expect(q.price_max).toBeUndefined();
    expect(q.q).toBeUndefined(); // search is only for /shop
  });

  it("takes the first of a repeated parameter and trims it", () => {
    expect(listingQuery({ sort: ["newest", "name"], category: " produce " }).sort).toBe("newest");
    expect(listingQuery({ category: " produce " }).category).toBe("produce");
  });

  it("applies the page's default sort only when the visitor has not chosen one", () => {
    expect(listingQuery({}, { defaultSort: "newest" }).sort).toBe("newest");
    expect(listingQuery({ sort: "name" }, { defaultSort: "newest" }).sort).toBe("name");
    expect(listingQuery({ sort: "bogus" }, { defaultSort: "newest" }).sort).toBe("newest");
  });

  it("lets the page's fixed context win over the query string", () => {
    expect(listingQuery({ on_offer: "false", is_new: "true" }, { fixed: { on_offer: "true" } })).toMatchObject({ on_offer: "true", is_new: "true" });
    expect(listingQuery({}, { fixed: { collection: "weeknight-dinners" } }).collection).toBe("weeknight-dinners");
  });

  it("allows a trimmed, length-capped search only when asked", () => {
    expect(listingQuery({ q: "  apples " }, { allowSearch: true }).q).toBe("apples");
    expect(listingQuery({ q: "x".repeat(900) }, { allowSearch: true }).q).toHaveLength(500);
  });
});

describe("hasActiveFilters", () => {
  it("ignores the filters the page itself fixes", () => {
    const fixed = { on_offer: "true" };
    expect(hasActiveFilters(listingQuery({}, { fixed }), fixed)).toBe(false);
    expect(hasActiveFilters(listingQuery({ in_stock: "true" }, { fixed }), fixed)).toBe(true);
    expect(hasActiveFilters(listingQuery({ brand: "acme" }, { fixed }), fixed)).toBe(true);
    expect(hasActiveFilters(listingQuery({ sort: "name", page: "2" }, { fixed }), fixed)).toBe(false);
  });
});

describe("departments", () => {
  const tree: CategoryNode[] = [
    { id: 1, name: "Produce", slug: "produce", description: "", image: {}, count: 40, children: [
      { id: 11, name: "Berries", slug: "berries", description: "", image: {}, count: 6 },
      { id: 12, name: "Apples", slug: "apples", description: "", image: {}, count: 9 },
    ] },
    { id: 2, name: "Bakery", slug: "bakery", description: "", image: {}, count: 12 },
    { id: 3, name: "Dairy", slug: "dairy", description: "", image: {}, count: 20, children: [] },
  ];

  it("maps the catalogue tree", () => {
    expect(treeDepartments(tree)).toEqual([
      { slug: "produce", name: "Produce", count: 40, children: [{ slug: "berries", name: "Berries", count: 6 }, { slug: "apples", name: "Apples", count: 9 }] },
      { slug: "bakery", name: "Bakery", count: 12, children: [] },
      { slug: "dairy", name: "Dairy", count: 20, children: [] },
    ]);
  });

  it("counts only what the current listing contains, and leaves empty departments out", () => {
    const facets: Facets = {
      brands: [], price: { min: "0.00", max: "0.00" },
      categories: [{ slug: "berries", name: "Berries", parent: "produce", count: 3 }, { slug: "bakery", name: "Bakery", parent: null, count: 2 }],
    };
    expect(scopedDepartments(tree, facets)).toEqual([
      { slug: "produce", name: "Produce", count: 3, children: [{ slug: "berries", name: "Berries", count: 3 }] },
      { slug: "bakery", name: "Bakery", count: 2, children: [] },
    ]);
    expect(scopedDepartments(tree, undefined)).toEqual([]);
  });
});
