import type { Metadata } from "next";
import { JsonLd } from "@/components/content/json-ld";
import { ArticleMeta } from "@/components/content/article-card";
import { RichText } from "@/components/content/rich-text";
import { ProductGrid } from "@/components/product/product-card";
import { Breadcrumbs, Section } from "@/components/ui/section";
import { kindLabel } from "@/lib/content";
import { formatDate, imgSrc, imgSrcSet } from "@/lib/format";
import { recipeJsonLd } from "@/lib/jsonld";
import { SITE_URL, getStore, serverGet } from "@/lib/server";
import type { ArticleDetail } from "@/lib/types";

type Params = { slug: string };

const load = (slug: string) => serverGet<ArticleDetail>(`/articles/${encodeURIComponent(slug)}/`, undefined, { revalidate: 60, tags: ["articles"] });

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const a = await load(slug);
  return {
    title: a.title,
    description: a.summary,
    alternates: { canonical: `/guides/${a.slug}` },
    openGraph: { title: a.title, description: a.summary, type: "article", publishedTime: a.published_at, images: a.image ? [imgSrc(a.image, 1024)] : undefined },
  };
}

export default async function ArticlePage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const [a, store] = await Promise.all([load(slug), getStore()]);
  const isRecipe = a.kind === "RECIPE";
  const published = formatDate(a.published_at, store.locale, { day: "numeric", month: "long", year: "numeric", timeZone: store.timezone });

  return (
    <>
      <JsonLd data={recipeJsonLd(a, SITE_URL)} />
      <Breadcrumbs items={[{ name: "Home", href: "/" }, { name: "Recipes & guides", href: "/guides" }, { name: a.title }]} />
      <article>
        <header className="container-x grid gap-6 pb-2 pt-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-center lg:gap-10">
          <div>
            <p className="eyebrow mb-2">{kindLabel(a.kind)}</p>
            <h1 className="text-3xl sm:text-4xl lg:text-[2.6rem]">{a.title}</h1>
            <p className="mt-3 text-lg text-ink-2">{a.summary}</p>
            <div className="mt-4 space-y-2">
              <ArticleMeta article={a} />
              <p className="text-sm text-ink-3">Published <time dateTime={a.published_at}>{published}</time></p>
            </div>
          </div>
          {a.image && (
            <img
              src={imgSrc(a.image, 1024)} srcSet={imgSrcSet(a.image)} sizes="(min-width:1024px) 40rem, 100vw" alt="" width={1024} height={640}
              fetchPriority="high" decoding="async" className="tile-bg aspect-[16/10] w-full rounded-lg border border-line object-cover"
            />
          )}
        </header>

        <div className="container-x py-8">
          <RichText source={a.body} className="max-w-[44rem] text-[1.05rem]" />
        </div>
      </article>

      {a.products.length > 0 && (
        <Section title={isRecipe ? "Shop this recipe" : "Shop the products in this guide"} eyebrow="Products">
          <p className="-mt-3 mb-5 max-w-2xl text-sm text-ink-3">These are the products linked to this {isRecipe ? "recipe" : "guide"}. Pack sizes may differ from the amounts it lists, and availability is checked again when you check out.</p>
          <ProductGrid products={a.products} />
        </Section>
      )}
    </>
  );
}
