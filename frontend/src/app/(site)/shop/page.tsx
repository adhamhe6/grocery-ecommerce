import type { Metadata } from "next";
import Link from "next/link";
import { ResultsGrid, Pagination, withParams } from "@/components/product/listing";
import { Breadcrumbs, PageHeader } from "@/components/ui/section";
import { SortSelect } from "@/components/product/sort-select";
import { cn } from "@/lib/cn";
import { selectedBranch, serverGet } from "@/lib/server";
import type { CategoryNode, ProductListResponse } from "@/lib/types";

type SP = Record<string, string | string[] | undefined>;

export async function generateMetadata({ searchParams }: { searchParams: Promise<SP> }): Promise<Metadata> {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  return { title: q ? `Search: ${q}` : "Shop all products", robots: q || sp.page ? { index: false, follow: true } : undefined };
}

const FILTERS: [string, string][] = [["in_stock", "In stock now"], ["on_offer", "On offer"], ["is_new", "New in"]];

export default async function ShopPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const branch = await selectedBranch();
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const query: Record<string, string | string[] | undefined> = {
    q: str("q"), category: str("category"), brand: sp.brand, sort: str("sort"), page: str("page"), in_stock: str("in_stock"), on_offer: str("on_offer"), is_new: str("is_new"),
    price_min: str("price_min"), price_max: str("price_max"), branch: branch ? String(branch) : undefined, facets: "true",
  };
  const [data, tree] = await Promise.all([
    serverGet<ProductListResponse>("/products/", query as never, { revalidate: 20 }),
    serverGet<CategoryNode[]>("/categories/", undefined, { revalidate: 120, tags: ["categories"] }),
  ]);
  const activeCat = str("category");
  const dept = tree.find((d) => d.slug === activeCat || d.children?.some((c) => c.slug === activeCat));
  const sub = dept?.children?.find((c) => c.slug === activeCat);
  const title = str("q") ? `Results for “${str("q")}”` : sub?.name ?? dept?.name ?? "All products";
  const brands = data.facets?.brands ?? [];
  const activeBrands = ([] as string[]).concat(sp.brand ?? []).flatMap((b) => b.split(","));

  return (
    <>
      <Breadcrumbs items={[{ name: "Home", href: "/" }, { name: "Shop", href: dept || str("q") ? "/shop" : undefined }, ...(dept ? [{ name: dept.name, href: sub ? `/shop?category=${dept.slug}` : undefined }] : []), ...(sub ? [{ name: sub.name }] : [])]} />
      <PageHeader title={title} intro={sub?.description || dept?.description || undefined} />
      <div className="container-x grid gap-8 py-8 lg:grid-cols-[15.5rem_1fr]">
        <aside aria-label="Filters" className="space-y-7 text-sm">
          <details className="group lg:open" open>
            <summary className="cursor-pointer list-none font-sans text-sm font-bold uppercase tracking-wider text-ink lg:cursor-default">Departments</summary>
            <ul className="mt-3 space-y-1">
              <li><Link href={withParams("/shop", sp, { category: null })} className={cn("block rounded px-2 py-1.5 hover:bg-paper-2", !activeCat && "bg-primary-soft font-semibold")}>All products</Link></li>
              {tree.map((d) => (
                <li key={d.id}>
                  <Link href={withParams("/shop", sp, { category: d.slug })} aria-current={activeCat === d.slug ? "page" : undefined} className={cn("flex justify-between rounded px-2 py-1.5 hover:bg-paper-2", activeCat === d.slug && "bg-primary-soft font-semibold")}>{d.name}<span className="num text-ink-3">{d.count}</span></Link>
                  {dept?.id === d.id && !!d.children?.length && (
                    <ul className="ml-3 mt-1 space-y-0.5 border-l border-line pl-2">
                      {d.children.map((c) => <li key={c.id}><Link href={withParams("/shop", sp, { category: c.slug })} aria-current={activeCat === c.slug ? "page" : undefined} className={cn("flex justify-between rounded px-2 py-1 hover:bg-paper-2", activeCat === c.slug && "bg-primary-soft font-semibold")}>{c.name}<span className="num text-ink-3">{c.count}</span></Link></li>)}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </details>
          <div>
            <h2 className="font-sans text-sm font-bold uppercase tracking-wider text-ink">Show</h2>
            <ul className="mt-3 space-y-1">
              {FILTERS.map(([k, label]) => {
                const on = str(k) === "true";
                return <li key={k}><Link href={withParams("/shop", sp, { [k]: on ? null : "true" })} role="checkbox" aria-checked={on} className={cn("flex items-center gap-2 rounded px-2 py-1.5 hover:bg-paper-2", on && "bg-primary-soft font-semibold")}><span className={cn("flex size-4 items-center justify-center rounded border", on ? "border-primary bg-primary text-white" : "border-line-strong bg-white")} aria-hidden>{on && "✓"}</span>{label}</Link></li>;
              })}
            </ul>
          </div>
          {brands.length > 0 && (
            <div>
              <h2 className="font-sans text-sm font-bold uppercase tracking-wider text-ink">Brand</h2>
              <ul className="mt-3 max-h-64 space-y-1 overflow-y-auto pr-1">
                {brands.map((b) => {
                  const on = activeBrands.includes(b.slug);
                  const next = on ? activeBrands.filter((x) => x !== b.slug) : [...activeBrands, b.slug];
                  return <li key={b.slug}><Link href={withParams("/shop", sp, { brand: next.length ? next.join(",") : null })} role="checkbox" aria-checked={on} className={cn("flex items-center justify-between gap-2 rounded px-2 py-1.5 hover:bg-paper-2", on && "bg-primary-soft font-semibold")}><span className="flex items-center gap-2"><span className={cn("flex size-4 items-center justify-center rounded border", on ? "border-primary bg-primary text-white" : "border-line-strong bg-white")} aria-hidden>{on && "✓"}</span>{b.name}</span><span className="num text-ink-3">{b.count}</span></Link></li>;
                })}
              </ul>
            </div>
          )}
        </aside>

        <div>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <p className="num text-sm text-ink-2" role="status">{data.count} {data.count === 1 ? "product" : "products"}</p>
            <SortSelect current={str("sort") ?? (str("q") ? "relevance" : "relevance")} hasQuery={!!str("q")} />
          </div>
          <ResultsGrid data={data} clearHref="/shop" />
          <Pagination data={data} base="/shop" params={sp} />
        </div>
      </div>
    </>
  );
}
