import type { Metadata } from "next";
import { ProductBrowser } from "@/components/product/browser";
import { Breadcrumbs, PageHeader } from "@/components/ui/section";
import { loadListing, listingMetadata } from "@/lib/listing";
import { hasActiveFilters, scopedDepartments, type SP } from "@/lib/listing-query";

const FIXED = { is_new: "true" };

export async function generateMetadata({ searchParams }: { searchParams: Promise<SP> }): Promise<Metadata> {
  return listingMetadata(await searchParams, { title: "New in", description: "Recently added products, newest first.", path: "/new", fixed: FIXED });
}

export default async function NewInPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { data, tree, query } = await loadListing(sp, { fixed: FIXED, defaultSort: "newest" });
  return (
    <>
      <Breadcrumbs items={[{ name: "Home", href: "/" }, { name: "New in" }]} />
      <PageHeader title="New in" intro="Recently added products, newest first." />
      <ProductBrowser
        basePath="/new" sp={sp} data={data} departments={scopedDepartments(tree, data.facets)} sort={(query.sort as string | undefined) ?? "newest"}
        toggles={[["in_stock", "In stock now"], ["on_offer", "On offer"]]} filtered={hasActiveFilters(query, FIXED)}
        emptyTitle="Nothing new yet" emptyBody="No products have been added recently. Browse everything in the shop instead."
      />
    </>
  );
}
