"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { AdminPage, DataTable, FilterBar, FilterSelect, Pager, SearchField, StatusBadge, useDebouncedValue, type Column } from "@/components/admin/kit";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { adminRequest, useAdmin, useAdminAction, useAdminList } from "@/lib/admin";
import { formatDate } from "@/lib/format";
import { useMoney } from "@/lib/hooks";
import { Switch } from "./form-kit";
import { MISSING_LABELS, type BrandRow, type CategoryRow, type ProductRow } from "./product-model";

const STATUS_FILTERS: [string, string][] = [["ACTIVE,INACTIVE", "Active and inactive"], ["ACTIVE", "Active"], ["INACTIVE", "Inactive"], ["ARCHIVED", "Archived"]];
const ATTENTION: [string, string][] = [
  ["any", "Any gap in the product page"], ["image", "No photo"], ["description", "No description"], ["origin", "No origin"], ["nutrition", "No nutrition panel"],
  ["ingredients", "No ingredients"], ["allergens", "Allergens not confirmed"], ["storage", "No storage instructions"], ["complete", "Complete pages only"],
];

/** Flat, indented category options: each department, then its categories. */
export function categoryFilterOptions(categories: CategoryRow[]): [string, string][] {
  const out: [string, string][] = [];
  for (const d of categories.filter((c) => c.parent == null)) {
    out.push([String(d.id), categories.some((c) => c.parent === d.id) ? `${d.name} (whole department)` : d.name]);
    for (const c of categories.filter((x) => x.parent === d.id)) out.push([String(c.id), `${d.name} › ${c.name}`]);
  }
  return out;
}

/** Query params for the list endpoint from the filter state — one place so tests and the page agree. */
export function productListParams(f: { search: string; status: string; category: string; brand: string; available: string; attention: string; ordering: string; page: number }) {
  return {
    search: f.search.trim() || undefined,
    status: f.status || undefined,
    category: f.category || undefined,
    brand: f.brand || undefined,
    available: f.available || undefined,
    incomplete: f.attention === "any" ? true : f.attention === "complete" ? "false" : undefined,
    missing: f.attention && f.attention !== "any" && f.attention !== "complete" ? f.attention : undefined,
    ordering: f.ordering,
    page: f.page,
    page_size: 25,
  };
}

export function ProductList() {
  const money = useMoney();
  const { can } = useAdmin();
  const canToggle = can("catalog.availability");
  const canFeature = can("catalog.merchandise");
  const [search, setSearch] = React.useState("");
  const debounced = useDebouncedValue(search);
  const [filters, setFilters] = React.useState({ status: "ACTIVE,INACTIVE", category: "", brand: "", available: "", attention: "" });
  const [ordering, setOrdering] = React.useState("name");
  const [page, setPage] = React.useState(1);
  const set = (k: keyof typeof filters) => (v: string) => { setFilters((f) => ({ ...f, [k]: v })); setPage(1); };
  React.useEffect(() => setPage(1), [debounced]);

  const categories = useAdminList<CategoryRow>("/categories/");
  const brands = useAdminList<BrandRow>("/brands/");
  const params = productListParams({ search: debounced, ...filters, ordering, page });
  const list = useAdminList<ProductRow>("/products/", params);
  const filtered = !!(debounced || filters.category || filters.brand || filters.available || filters.attention || filters.status !== "ACTIVE,INACTIVE");

  const toggle = useAdminAction(({ id, value }: { id: number; value: boolean }) => adminRequest("PATCH", `/products/${id}/availability/`, { is_available: value }), {
    invalidate: ["/products"], success: "Availability updated",
  });
  const pendingId = toggle.isPending ? toggle.variables?.id : undefined;
  const feature = useAdminAction(({ id, value }: { id: number; value: boolean }) => adminRequest("PATCH", `/products/${id}/merchandising/`, { is_featured: value }), { invalidate: ["/products"], success: "Featured setting updated" });
  const featuringId = feature.isPending ? feature.variables?.id : undefined;

  const columns: Column<ProductRow>[] = [
    {
      key: "name", header: "Product", sort: "name",
      cell: (p) => (
        <div className="min-w-0">
          <Link href={`/admin/products/${p.id}`} className="font-semibold text-primary underline-offset-4 hover:underline">{p.name}</Link>
          <p className="num text-xs text-ink-3">{p.sku}{p.is_featured && <Badge className="ml-2" tone="citrus">Featured</Badge>}{p.is_demo && <Badge className="ml-2" tone="neutral">Demo</Badge>}</p>
        </div>
      ),
    },
    { key: "category", header: "Category", hideBelow: "md", cell: (p) => <span className="text-ink-2">{p.category_name}</span> },
    { key: "brand", header: "Brand", hideBelow: "lg", cell: (p) => <span className="text-ink-2">{p.brand_name ?? <span className="text-ink-3">None</span>}</span> },
    { key: "price", header: "Price", sort: "price", align: "right", cell: (p) => <span>{money(p.price)}<span className="text-ink-3"> / {p.sale_unit_code}</span></span> },
    { key: "status", header: "Status", sort: "status", cell: (p) => <StatusBadge status={p.status} /> },
    {
      key: "available", header: "Available",
      cell: (p) => canToggle
        ? <Switch checked={p.is_available} busy={pendingId === p.id} label={`${p.name} available to order`} onChange={(v) => toggle.mutate({ id: p.id, value: v })} />
        : <Badge tone={p.is_available ? "ok" : "neutral"}>{p.is_available ? "Yes" : "Hidden"}</Badge>,
    },
    ...(canFeature ? [{ key: "featured", header: "Featured", hideBelow: "md" as const, cell: (p: ProductRow) => <Switch checked={p.is_featured} busy={featuringId === p.id} label={`${p.name} featured`} onChange={(v) => feature.mutate({ id: p.id, value: v })} /> }] : []),
    {
      key: "gaps", header: "Product page", hideBelow: "lg",
      cell: (p) => p.missing.length === 0 ? <Badge tone="ok">Complete</Badge> : (
        <span title={p.missing.map((m) => MISSING_LABELS[m] ?? m).join(", ")}>
          <Badge tone="warn">{p.missing.length} {p.missing.length === 1 ? "gap" : "gaps"}</Badge>
          <span className="mt-0.5 block max-w-52 truncate text-xs text-ink-3">{p.missing.map((m) => MISSING_LABELS[m] ?? m).join(", ")}</span>
        </span>
      ),
    },
    { key: "updated", header: "Updated", sort: "updated_at", hideBelow: "lg", cell: (p) => <span className="whitespace-nowrap text-ink-3">{formatDate(p.updated_at, "en-US", { day: "numeric", month: "short", year: "numeric" })}</span> },
  ];

  return (
    <AdminPage title="Products" description="Every product in the catalogue. Open one to edit its details, trust information and pictures."
      actions={can("catalog.write") ? <ButtonLink href="/admin/products/new" size="sm"><Plus className="size-4" aria-hidden /> New product</ButtonLink> : undefined}>
      <FilterBar>
        <SearchField value={search} onChange={setSearch} placeholder="Search name, SKU or barcode…" label="Search products" />
        <FilterSelect label="Status" value={filters.status} onChange={set("status")} options={STATUS_FILTERS} allLabel="All, including archived" />
        <FilterSelect label="Category" value={filters.category} onChange={set("category")} options={categoryFilterOptions(categories.rows)} />
        <FilterSelect label="Brand" value={filters.brand} onChange={set("brand")} options={brands.rows.map((b) => [String(b.id), b.name])} />
        <FilterSelect label="Availability" value={filters.available} onChange={set("available")} options={[["true", "Available"], ["false", "Hidden"]]} />
        <FilterSelect label="Needs attention" value={filters.attention} onChange={set("attention")} options={ATTENTION} allLabel="Any" />
        {filtered && <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setFilters({ status: "ACTIVE,INACTIVE", category: "", brand: "", available: "", attention: "" }); setPage(1); }}>Clear filters</Button>}
      </FilterBar>
      <DataTable<ProductRow>
        caption="Products" columns={columns} rows={list.rows} loading={list.isLoading} error={list.error} onRetry={() => list.refetch()} ordering={ordering} onOrdering={(o) => { setOrdering(o); setPage(1); }}
        empty={filtered
          ? <EmptyState title="No products match these filters">Try a different search, or clear the filters.</EmptyState>
          : <EmptyState title="No products yet" action={can("catalog.write") ? <ButtonLink href="/admin/products/new">Add the first product</ButtonLink> : undefined}>Products you add appear here.</EmptyState>}
      />
      <Pager page={list.page} totalPages={list.totalPages} count={list.count} onPage={setPage} label="products" />
      <p className="sr-only" role="status" aria-live="polite">{list.isFetching ? "Loading products" : `${list.count} products`}</p>
    </AdminPage>
  );
}
