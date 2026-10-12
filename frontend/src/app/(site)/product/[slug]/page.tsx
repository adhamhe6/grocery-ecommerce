import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Leaf, Snowflake, Thermometer } from "lucide-react";
import { Gallery } from "@/components/product/gallery";
import { ProductRail } from "@/components/product/product-card";
import { Price } from "@/components/product/price";
import { PurchasePanel } from "@/components/product/purchase-panel";
import { Reviews, Stars } from "@/components/product/reviews";
import { Badge } from "@/components/ui/badge";
import { Breadcrumbs, Section } from "@/components/ui/section";
import { imgSrc } from "@/lib/format";
import { SITE_URL, selectedBranch, serverGet } from "@/lib/server";
import type { ProductDetailData } from "@/lib/types";

type Params = { slug: string };

async function load(slug: string) {
  const branch = await selectedBranch();
  return serverGet<ProductDetailData>(`/products/${slug}/`, { branch }, { revalidate: 30 });
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const p = await load(slug);
  const desc = p.short_description || p.description.slice(0, 160);
  return { title: p.name, description: desc, alternates: { canonical: `/product/${p.slug}` }, openGraph: { title: p.name, description: desc, images: p.image ? [imgSrc(p.image.urls, 1024)] : undefined, type: "website" } };
}

const NUTRIENTS: [keyof NonNullable<ProductDetailData["nutrition"]>["values"], string, string][] = [
  ["energy_kj", "Energy", "kJ"], ["energy_kcal", "", "kcal"], ["fat", "Fat", "g"], ["saturates", "of which saturates", "g"], ["carbohydrate", "Carbohydrate", "g"], ["sugars", "of which sugars", "g"], ["fibre", "Fibre", "g"], ["protein", "Protein", "g"], ["salt", "Salt", "g"],
];

function Fact({ label, value, unknown }: { label: string; value?: React.ReactNode; unknown?: boolean }) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-[11rem_1fr] sm:gap-4">
      <dt className="text-sm font-semibold text-ink">{label}</dt>
      <dd className={unknown || !value ? "text-sm italic text-ink-3" : "text-ink-2"}>{unknown || !value ? "Not provided" : value}</dd>
    </div>
  );
}

export default async function ProductPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const p = await load(slug);
  const unknown = new Set(p.unknowns);
  const crumbs = [{ name: "Home", href: "/" }, { name: "Shop", href: "/shop" }, ...p.breadcrumbs.map((b, i) => ({ name: b.name, href: i < p.breadcrumbs.length - 1 || true ? `/shop?category=${b.slug}` : undefined })), { name: p.name }];
  const ld = {
    "@context": "https://schema.org", "@type": "Product", name: p.name, sku: p.sku, description: p.short_description || p.description,
    image: p.images.map((i) => new URL(imgSrc(i.urls, 1024), SITE_URL).toString()),
    brand: p.brand ? { "@type": "Brand", name: p.brand.name } : undefined,
    offers: { "@type": "Offer", priceCurrency: "USD", price: p.price, url: `${SITE_URL}/product/${p.slug}`, availability: p.availability.can_order ? "https://schema.org/InStock" : "https://schema.org/OutOfStock" },
    // Only real, non-sample ratings are exposed to search engines.
    aggregateRating: p.rating && !p.rating.is_demo ? { "@type": "AggregateRating", ratingValue: p.rating.avg, reviewCount: p.rating.count } : undefined,
  };
  const claimsVerified = p.claims.filter((c) => c.evidence);
  const StorageIcon = p.storage_type === "FROZEN" ? Snowflake : p.storage_type === "CHILLED" ? Thermometer : Leaf;

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, "\\u003c") }} />
      <Breadcrumbs items={crumbs} />
      <div className="container-x grid gap-8 py-6 lg:grid-cols-[1.1fr_1fr] lg:gap-12">
        <Gallery images={p.images} name={p.name} />
        <div>
          <div className="flex flex-wrap items-center gap-2">
            {p.promotion && <Badge tone="accent">{p.promotion.label}</Badge>}
            {p.badges.includes("NEW") && <Badge tone="citrus">New</Badge>}
            <Badge tone="info"><StorageIcon className="size-3.5" aria-hidden /> {p.storage_type === "AMBIENT" ? "Ambient" : p.storage_type === "CHILLED" ? "Keep chilled" : "Keep frozen"}</Badge>
            {p.is_demo && <Badge tone="warn">Demo product</Badge>}
          </div>
          {p.brand && <p className="mt-3 text-sm font-medium uppercase tracking-wide text-ink-3"><Link href={`/shop?brand=${p.brand.slug}`} className="hover:underline">{p.brand.name}</Link></p>}
          <h1 className="mt-1 text-3xl sm:text-4xl">{p.name}</h1>
          <p className="mt-1 text-ink-3">{p.pack_label} · SKU {p.sku}</p>
          {p.rating && <a href="#reviews-h" className="mt-2 inline-flex items-center gap-2 text-sm text-ink-2 hover:underline"><Stars value={Number(p.rating.avg)} /> <span className="num">{Number(p.rating.avg).toFixed(1)} ({p.rating.count}){p.rating.is_demo && " · sample reviews"}</span></a>}
          <Price p={p} size="lg" className="mt-4" />
          {p.short_description && <p className="mt-4 text-lg text-ink-2">{p.short_description}</p>}
          <div className="mt-6"><PurchasePanel p={p} /></div>
          {claimsVerified.length > 0 && (
            <ul className="mt-5 flex flex-wrap gap-2" aria-label="Verified product claims">
              {claimsVerified.map((c) => <li key={c.kind}><Badge tone="ok" title={c.evidence}>{c.label}</Badge></li>)}
            </ul>
          )}
        </div>
      </div>

      <div className="container-x grid gap-10 py-8 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-10">
          {p.description && <section aria-labelledby="about-h"><h2 id="about-h" className="text-2xl">About this product</h2><div className="prose-body mt-3 max-w-none whitespace-pre-line text-ink-2">{p.description}</div></section>}

          <section aria-labelledby="facts-h">
            <h2 id="facts-h" className="text-2xl">Product information</h2>
            <p className="mt-1 text-sm text-ink-3">Anything we haven&apos;t been given by the producer is shown as &ldquo;Not provided&rdquo; rather than guessed.</p>
            <dl className="mt-3 divide-y divide-line border-y border-line">
              <Fact label="Origin" value={p.origin ? <>{p.origin.country}{p.origin.note && ` — ${p.origin.note}`}</> : null} unknown={unknown.has("origin")} />
              <Fact label="Ingredients" value={p.ingredients} unknown={unknown.has("ingredients")} />
              <Fact label="Storage" value={p.storage_instructions} unknown={unknown.has("storage")} />
              {p.packaging && <Fact label="Packaging" value={p.packaging} />}
              {p.manufacturer && <Fact label="Producer" value={p.manufacturer} />}
            </dl>
          </section>

          <section aria-labelledby="allergens-h">
            <h2 id="allergens-h" className="text-2xl">Allergens</h2>
            {unknown.has("allergens") || !p.allergens.confirmed ? (
              <div className="mt-3 flex gap-3 rounded-md border border-warn/30 bg-warn-soft p-4 text-sm"><AlertTriangle className="mt-0.5 size-5 shrink-0 text-warn" aria-hidden /><p><strong>Allergen information not confirmed.</strong> Please check the packaging before eating, especially if you have an allergy.</p></div>
            ) : (
              <div className="mt-3 space-y-2 text-ink-2">
                <p><strong className="text-ink">Contains:</strong> {p.allergens.contains.length ? p.allergens.contains.join(", ") : "none of the 14 major allergens"}</p>
                {p.allergens.may_contain.length > 0 && <p><strong className="text-ink">May contain:</strong> {p.allergens.may_contain.join(", ")}</p>}
                <p className="text-sm text-ink-3">Always check the packaging: recipes can change.</p>
              </div>
            )}
          </section>

          <section aria-labelledby="nutrition-h">
            <h2 id="nutrition-h" className="text-2xl">Nutrition</h2>
            {p.nutrition ? (
              <>
                <table className="mt-3 w-full max-w-md text-sm">
                  <caption className="mb-2 text-left text-ink-3">Typical values {p.nutrition.basis}{p.nutrition.is_demo && " · sample data"}</caption>
                  <tbody>
                    {NUTRIENTS.filter(([k]) => p.nutrition!.values[k] != null).map(([k, label, unit]) => (
                      <tr key={k} className="border-b border-line"><th scope="row" className="py-2 pr-4 text-left font-medium">{label || " "}</th><td className="num py-2 text-right">{p.nutrition!.values[k]} {unit}</td></tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-xs text-ink-3">Source: {p.nutrition.source}</p>
              </>
            ) : <p className="mt-3 text-sm italic text-ink-3">Not provided</p>}
          </section>

          <Reviews slug={p.slug} rating={p.rating} />
        </div>
        <aside aria-label="Delivery and freshness" className="h-fit space-y-4 rounded-lg border border-line bg-white p-5 text-sm text-ink-2">
          <h2 className="font-sans text-base font-bold text-ink">Freshness &amp; delivery</h2>
          <p>{p.is_perishable ? "Perishable: we only sell stock with enough shelf life left to be enjoyed after delivery." : "Shelf-stable: stored ambient."}</p>
          <p>Prices and availability are confirmed again when you check out. Delivery slots are held while you pay.</p>
          <Link href="/p/delivery" className="font-semibold text-primary underline-offset-4 hover:underline">Delivery &amp; substitution policy</Link>
        </aside>
      </div>

      {p.related.length > 0 && <Section title="You might also like"><ProductRail products={p.related} /></Section>}
    </>
  );
}
