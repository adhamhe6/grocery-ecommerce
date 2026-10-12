import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { cn } from "@/lib/cn";
import type { DepartmentLink, SP } from "@/lib/listing-query";
import type { ProductListResponse } from "@/lib/types";
import { Pagination, ResultsGrid, withParams } from "./listing";
import { SortSelect } from "./sort-select";

export const DEFAULT_TOGGLES: [string, string][] = [["in_stock", "In stock now"], ["on_offer", "On offer"], ["is_new", "New in"]];

interface ProductBrowserProps {
  /** Path the filter links stay on, e.g. "/shop" or "/offers". */
  basePath: string;
  sp: SP;
  data: ProductListResponse;
  departments: DepartmentLink[];
  /** "Show" checkboxes. A page whose context already fixes a filter (e.g. /offers → on offer) leaves that one out. */
  toggles?: [string, string][];
  /** The sort the results are currently in (the visitor's choice, or the page default). */
  sort: string;
  /** True when the visitor has narrowed the page beyond its own context — decides which empty state to show. */
  filtered: boolean;
  /** When set, shown instead of the grid if the page has no products at all and nothing is filtered. Otherwise the standard "nothing matches" state is used. */
  emptyTitle?: string;
  emptyBody?: React.ReactNode;
}

const Box = ({ on }: { on: boolean }) => (
  <span className={cn("flex size-4 shrink-0 items-center justify-center rounded border", on ? "border-primary bg-primary text-white" : "border-line-strong bg-white")} aria-hidden>{on && "✓"}</span>
);

/**
 * Filter sidebar + sorted, paginated results. Filters are plain links, so the listing works without JavaScript.
 * Shared by /shop and the fixed-context listings (/offers, /new, /collections/[slug]).
 */
export function ProductBrowser({ basePath, sp, data, departments, toggles = DEFAULT_TOGGLES, sort, filtered, emptyTitle, emptyBody }: ProductBrowserProps) {
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const activeCat = str("category");
  const dept = departments.find((d) => d.slug === activeCat || d.children.some((c) => c.slug === activeCat));
  const brands = data.facets?.brands ?? [];
  const activeBrands = ([] as string[]).concat(sp.brand ?? []).flatMap((b) => b.split(","));
  const nothingHere = data.count === 0 && !filtered && !!emptyTitle;

  return (
    <div className="container-x grid gap-8 py-8 lg:grid-cols-[15.5rem_1fr]">
      <aside aria-label="Filters" className="space-y-7 text-sm">
        {departments.length > 0 && (
          <details className="group lg:open" open>
            <summary className="cursor-pointer list-none font-sans text-sm font-bold uppercase tracking-wider text-ink lg:cursor-default">Departments</summary>
            <ul className="mt-3 space-y-1">
              <li><Link href={withParams(basePath, sp, { category: null })} className={cn("block rounded px-2 py-1.5 hover:bg-paper-2", !activeCat && "bg-primary-soft font-semibold")}>All products</Link></li>
              {departments.map((d) => (
                <li key={d.slug}>
                  <Link href={withParams(basePath, sp, { category: d.slug })} aria-current={activeCat === d.slug ? "page" : undefined} className={cn("flex justify-between rounded px-2 py-1.5 hover:bg-paper-2", activeCat === d.slug && "bg-primary-soft font-semibold")}>{d.name}<span className="num text-ink-3">{d.count}</span></Link>
                  {dept?.slug === d.slug && d.children.length > 0 && (
                    <ul className="ml-3 mt-1 space-y-0.5 border-l border-line pl-2">
                      {d.children.map((c) => <li key={c.slug}><Link href={withParams(basePath, sp, { category: c.slug })} aria-current={activeCat === c.slug ? "page" : undefined} className={cn("flex justify-between rounded px-2 py-1 hover:bg-paper-2", activeCat === c.slug && "bg-primary-soft font-semibold")}>{c.name}<span className="num text-ink-3">{c.count}</span></Link></li>)}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}
        {toggles.length > 0 && (
          <div>
            <h2 className="font-sans text-sm font-bold uppercase tracking-wider text-ink">Show</h2>
            <ul className="mt-3 space-y-1">
              {toggles.map(([k, label]) => {
                const on = str(k) === "true";
                return <li key={k}><Link href={withParams(basePath, sp, { [k]: on ? null : "true" })} role="checkbox" aria-checked={on} className={cn("flex items-center gap-2 rounded px-2 py-1.5 hover:bg-paper-2", on && "bg-primary-soft font-semibold")}><Box on={on} />{label}</Link></li>;
              })}
            </ul>
          </div>
        )}
        {brands.length > 0 && (
          <div>
            <h2 className="font-sans text-sm font-bold uppercase tracking-wider text-ink">Brand</h2>
            <ul className="mt-3 max-h-64 space-y-1 overflow-y-auto pr-1">
              {brands.map((b) => {
                const on = activeBrands.includes(b.slug);
                const next = on ? activeBrands.filter((x) => x !== b.slug) : [...activeBrands, b.slug];
                return <li key={b.slug}><Link href={withParams(basePath, sp, { brand: next.length ? next.join(",") : null })} role="checkbox" aria-checked={on} className={cn("flex items-center justify-between gap-2 rounded px-2 py-1.5 hover:bg-paper-2", on && "bg-primary-soft font-semibold")}><span className="flex items-center gap-2"><Box on={on} />{b.name}</span><span className="num text-ink-3">{b.count}</span></Link></li>;
              })}
            </ul>
          </div>
        )}
      </aside>

      <div>
        {nothingHere ? (
          <EmptyState title={emptyTitle} action={<ButtonLink href="/shop" variant="secondary">Browse the shop</ButtonLink>}>{emptyBody}</EmptyState>
        ) : (
          <>
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <p className="num text-sm text-ink-2" role="status">{data.count} {data.count === 1 ? "product" : "products"}</p>
              <SortSelect current={sort} />
            </div>
            <ResultsGrid data={data} clearHref={basePath} />
            <Pagination data={data} base={basePath} params={sp} />
          </>
        )}
      </div>
    </div>
  );
}
