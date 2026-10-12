import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductBrowser } from "@/components/product/browser";
import { Breadcrumbs, PageHeader } from "@/components/ui/section";
import { loadListing, listingMetadata } from "@/lib/listing";
import { hasActiveFilters, scopedDepartments, type SP } from "@/lib/listing-query";
import { serverGet } from "@/lib/server";
import type { CollectionLink } from "@/lib/types";

type Params = { slug: string };

/** The collection's heading comes from the public collections list, which only contains collections that are live today. */
async function loadCollection(slug: string): Promise<CollectionLink> {
  const all = await serverGet<CollectionLink[]>("/collections/", undefined, { revalidate: 60, tags: ["collections"] });
  const found = all.find((c) => c.slug === slug);
  if (!found) notFound();
  return found;
}

export async function generateMetadata({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<SP> }): Promise<Metadata> {
  const { slug } = await params;
  const collection = await loadCollection(slug);
  return listingMetadata(await searchParams, { title: collection.name, description: collection.description || undefined, path: `/collections/${collection.slug}`, fixed: { collection: collection.slug } });
}

export default async function CollectionPage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<SP> }) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const collection = await loadCollection(slug);
  const fixed = { collection: collection.slug };
  const { data, tree, query } = await loadListing(sp, { fixed });
  return (
    <>
      <Breadcrumbs items={[{ name: "Home", href: "/" }, { name: collection.name }]} />
      <PageHeader title={collection.name} eyebrow="Collection" intro={collection.description || undefined} />
      <ProductBrowser
        basePath={`/collections/${collection.slug}`} sp={sp} data={data} departments={scopedDepartments(tree, data.facets)} sort={(query.sort as string | undefined) ?? "relevance"}
        filtered={hasActiveFilters(query, fixed)}
        emptyTitle="Nothing in this collection right now" emptyBody="None of this collection's products are available at the moment."
      />
    </>
  );
}
