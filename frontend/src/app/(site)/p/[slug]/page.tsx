import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { RichText } from "@/components/content/rich-text";
import { Badge } from "@/components/ui/badge";
import { Breadcrumbs, PageHeader } from "@/components/ui/section";
import { PAGE_ALIASES, resolvePageAlias } from "@/lib/content";
import { formatDate } from "@/lib/format";
import { getStore, serverGet } from "@/lib/server";
import type { CmsPage, CmsPageSummary } from "@/lib/types";

type Params = { slug: string };

const listPages = () => serverGet<CmsPageSummary[]>("/pages/", undefined, { revalidate: 120, tags: ["pages"] });

/** Loads a published page. A missing page is a 404 — except the short names older links use (/p/delivery), which forward to the real page. */
async function load(slug: string): Promise<CmsPage> {
  if (slug in PAGE_ALIASES) {
    const target = resolvePageAlias(slug, (await listPages()).map((p) => p.slug));
    if (target) redirect(`/p/${target}`);
  }
  return serverGet<CmsPage>(`/pages/${encodeURIComponent(slug)}/`, undefined, { revalidate: 120, tags: ["pages"] });
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const page = await load(slug);
  return { title: page.title, ...(page.summary ? { description: page.summary } : {}), alternates: { canonical: `/p/${page.slug}` } };
}

export default async function CmsPageView({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const [page, store] = await Promise.all([load(slug), getStore()]);
  // Other pages are only a convenience: if the list can't be loaded the page still renders.
  const others = await listPages().then((all) => all.filter((p) => p.slug !== page.slug), () => [] as CmsPageSummary[]);

  return (
    <>
      <Breadcrumbs items={[{ name: "Home", href: "/" }, { name: page.title }]} />
      <PageHeader title={page.title} intro={page.summary || undefined}>
        {page.is_template && (
          <p className="mt-3">
            <Badge tone="warn">Template wording</Badge>
            <span className="ml-2 text-sm text-ink-2">The business has not yet reviewed this text.</span>
          </p>
        )}
      </PageHeader>
      <div className="container-x grid gap-10 py-8 lg:grid-cols-[minmax(0,44rem)_1fr] lg:gap-16">
        <article>
          <RichText source={page.body} className="text-[1.05rem]" />
          <p className="mt-10 border-t border-line pt-4 text-sm text-ink-3">Last updated <time dateTime={page.updated_at}>{formatDate(page.updated_at, store.locale, { day: "numeric", month: "long", year: "numeric", timeZone: store.timezone })}</time></p>
        </article>
        {others.length > 0 && (
          <nav aria-label="More information" className="lg:sticky lg:top-24 lg:self-start">
            <h2 className="font-sans text-sm font-bold uppercase tracking-wider text-ink">More information</h2>
            <ul className="mt-3 space-y-1 text-sm">
              {others.map((p) => <li key={p.slug}><Link href={`/p/${p.slug}`} className="block rounded px-2 py-1.5 text-ink-2 hover:bg-paper-2 hover:text-primary">{p.title}</Link></li>)}
            </ul>
          </nav>
        )}
      </div>
    </>
  );
}
