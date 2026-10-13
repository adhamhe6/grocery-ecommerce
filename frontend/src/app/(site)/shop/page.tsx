import type { Metadata } from "next";
import { ProductBrowser } from "@/components/product/browser";
import { Breadcrumbs, PageHeader } from "@/components/ui/section";
import { loadListing } from "@/lib/listing";
import { treeDepartments, type SP } from "@/lib/listing-query";

export async function generateMetadata({ searchParams }: { searchParams: Promise<SP> }): Promise<Metadata> {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  // `robots` is left out entirely (not set to undefined) so the root layout's demo-store noindex still applies
  return { title: q ? `Search: ${q}` : "Shop all products", ...(q || sp.page ? { robots: { index: false, follow: true } } : {}) };
}

export default async function ShopPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { data, tree, query } = await loadListing(sp, { allowSearch: true });
  const q = query.q as string | undefined;
  const activeCat = query.category as string | undefined;
  const dept = tree.find((d) => d.slug === activeCat || d.children?.some((c) => c.slug === activeCat));
  const sub = dept?.children?.find((c) => c.slug === activeCat);
  const title = q ? `Results for “${q}”` : sub?.name ?? dept?.name ?? "All products";

  return (
    <>
      <Breadcrumbs items={[{ name: "Home", href: "/" }, { name: "Shop", href: dept || q ? "/shop" : undefined }, ...(dept ? [{ name: dept.name, href: sub ? `/shop?category=${dept.slug}` : undefined }] : []), ...(sub ? [{ name: sub.name }] : [])]} />
      <PageHeader title={title} intro={sub?.description || dept?.description || undefined} />
      <ProductBrowser basePath="/shop" sp={sp} data={data} departments={treeDepartments(tree)} sort={(query.sort as string | undefined) ?? "relevance"} filtered />
    </>
  );
}
