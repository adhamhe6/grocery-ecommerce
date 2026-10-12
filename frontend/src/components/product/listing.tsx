import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ProductGrid } from "./product-card";
import { EmptyState } from "@/components/ui/states";
import { ButtonLink } from "@/components/ui/button";
import type { ProductListResponse } from "@/lib/types";
import { cn } from "@/lib/cn";

/** Rebuilds the current query string with overrides — filters are plain links, so they work without JavaScript. */
export function withParams(base: string, current: Record<string, string | string[] | undefined>, overrides: Record<string, string | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(current)) {
    if (v === undefined || k in overrides) continue;
    (Array.isArray(v) ? v : [v]).forEach((x) => p.append(k, x));
  }
  for (const [k, v] of Object.entries(overrides)) if (v) p.set(k, v);
  p.delete("page");
  if ("page" in overrides && overrides.page) p.set("page", overrides.page);
  const s = p.toString();
  return s ? `${base}?${s}` : base;
}

export function Pagination({ data, base, params }: { data: Pick<ProductListResponse, "page" | "total_pages">; base: string; params: Record<string, string | string[] | undefined> }) {
  if (data.total_pages <= 1) return null;
  const pages = Array.from({ length: data.total_pages }, (_, i) => i + 1).filter((n) => n === 1 || n === data.total_pages || Math.abs(n - data.page) <= 1);
  const link = "flex size-10 items-center justify-center rounded-md border text-sm font-semibold";
  return (
    <nav aria-label="Pagination" className="mt-10 flex flex-wrap items-center justify-center gap-1.5">
      {data.page > 1 && <Link rel="prev" className={cn(link, "border-line-strong bg-white hover:bg-paper-2")} href={withParams(base, params, { page: String(data.page - 1) })} aria-label="Previous page"><ChevronLeft className="size-4" aria-hidden /></Link>}
      {pages.map((n, i) => (
        <span key={n} className="contents">
          {i > 0 && n - pages[i - 1] > 1 && <span className="px-1 text-ink-3" aria-hidden>…</span>}
          <Link href={withParams(base, params, { page: String(n) })} aria-current={n === data.page ? "page" : undefined} className={cn(link, "num", n === data.page ? "border-primary bg-primary text-primary-fg" : "border-line-strong bg-white hover:bg-paper-2")}>{n}</Link>
        </span>
      ))}
      {data.page < data.total_pages && <Link rel="next" className={cn(link, "border-line-strong bg-white hover:bg-paper-2")} href={withParams(base, params, { page: String(data.page + 1) })} aria-label="Next page"><ChevronRight className="size-4" aria-hidden /></Link>}
    </nav>
  );
}

export function ResultsGrid({ data, emptyTitle = "Nothing matches yet", clearHref }: { data: ProductListResponse; emptyTitle?: string; clearHref?: string }) {
  if (data.results.length === 0) {
    return <EmptyState title={emptyTitle} action={clearHref ? <ButtonLink href={clearHref} variant="secondary">Clear filters</ButtonLink> : undefined}>Try fewer filters or a different spelling.</EmptyState>;
  }
  return <ProductGrid products={data.results} className="xl:grid-cols-4" />;
}
