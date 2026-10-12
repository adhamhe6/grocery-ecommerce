import type { Metadata } from "next";
import Link from "next/link";
import { ArticleCard } from "@/components/content/article-card";
import { Pagination } from "@/components/product/listing";
import { EmptyState } from "@/components/ui/states";
import { Breadcrumbs, PageHeader } from "@/components/ui/section";
import { cn } from "@/lib/cn";
import { pageNumber, parseKind, type ArticleKind } from "@/lib/content";
import { serverGet } from "@/lib/server";
import type { ArticleListItem, Paginated } from "@/lib/types";

type SP = Record<string, string | string[] | undefined>;

const TABS: { label: string; kind?: ArticleKind; href: string }[] = [
  { label: "All", href: "/guides" },
  { label: "Recipes", kind: "RECIPE", href: "/guides?kind=recipe" },
  { label: "Guides", kind: "GUIDE", href: "/guides?kind=guide" },
];

const TITLES: Record<string, string> = { RECIPE: "Recipes", GUIDE: "Grocery guides", ALL: "Recipes & guides" };

export async function generateMetadata({ searchParams }: { searchParams: Promise<SP> }): Promise<Metadata> {
  const sp = await searchParams;
  const kind = parseKind(sp.kind);
  return {
    title: TITLES[kind ?? "ALL"],
    description: "Recipes and practical grocery guides.",
    alternates: { canonical: kind ? `/guides?kind=${kind.toLowerCase()}` : "/guides" },
    // `robots` is left out entirely when not needed so the root layout's demo-store noindex still applies
    ...(pageNumber(sp.page) ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function GuidesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const kind = parseKind(sp.kind);
  const data = await serverGet<Paginated<ArticleListItem>>("/articles/", { kind, page: pageNumber(sp.page) }, { revalidate: 60, tags: ["articles"] });
  const title = TITLES[kind ?? "ALL"];
  // Keep only the filter in pagination links; a malformed ?kind= falls back to "All".
  const params: SP = kind ? { kind: kind.toLowerCase() } : {};

  return (
    <>
      <Breadcrumbs items={[{ name: "Home", href: "/" }, { name: title }]} />
      <PageHeader title={title} intro="Cooking ideas and practical grocery guides. Where an article links products, you can add them to your basket from its page." />
      <div className="container-x py-6">
        <nav aria-label="Filter by type" className="flex gap-1 overflow-x-auto border-b border-line">
          {TABS.map((t) => {
            const active = t.kind === kind;
            return (
              <Link
                key={t.label} href={t.href} aria-current={active ? "page" : undefined}
                className={cn("-mb-px whitespace-nowrap border-b-2 px-4 py-3 text-[0.95rem] font-semibold transition-colors", active ? "border-accent text-primary" : "border-transparent text-ink-2 hover:text-primary")}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>

        <div className="py-8">
          {data.results.length === 0 ? (
            <EmptyState title={kind === "RECIPE" ? "No recipes yet" : kind === "GUIDE" ? "No guides yet" : "Nothing published yet"}>Check back soon.</EmptyState>
          ) : (
            <>
              <p className="num mb-5 text-sm text-ink-2" role="status">{data.count} {data.count === 1 ? "article" : "articles"}</p>
              <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {data.results.map((a, i) => <li key={a.slug}><ArticleCard article={a} priority={i < 3} /></li>)}
              </ul>
              <Pagination data={data} base="/guides" params={params} />
            </>
          )}
        </div>
      </div>
    </>
  );
}
