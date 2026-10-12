import type { Metadata } from "next";
import { ProductBrowser } from "@/components/product/browser";
import { Breadcrumbs, PageHeader } from "@/components/ui/section";
import { loadListing, listingMetadata } from "@/lib/listing";
import { hasActiveFilters, scopedDepartments, type SP } from "@/lib/listing-query";

const FIXED = { on_offer: "true" };

export async function generateMetadata({ searchParams }: { searchParams: Promise<SP> }): Promise<Metadata> {
  return listingMetadata(await searchParams, { title: "Offers", description: "Everything with a price promotion running right now.", path: "/offers", fixed: FIXED });
}

export default async function OffersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { data, tree, query } = await loadListing(sp, { fixed: FIXED });
  return (
    <>
      <Breadcrumbs items={[{ name: "Home", href: "/" }, { name: "Offers" }]} />
      <PageHeader title="Offers" intro="Everything with a price promotion running right now. Each product shows its offer next to the usual price." />
      <ProductBrowser
        basePath="/offers" sp={sp} data={data} departments={scopedDepartments(tree, data.facets)} sort={(query.sort as string | undefined) ?? "relevance"}
        toggles={[["in_stock", "In stock now"], ["is_new", "New in"]]} filtered={hasActiveFilters(query, FIXED)}
        emptyTitle="No offers right now" emptyBody="There are no price promotions running at the moment. Check back soon, or browse everything in the shop."
      />
    </>
  );
}
