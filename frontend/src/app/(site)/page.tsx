import { Clock, Scale, ShieldCheck, Truck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { ProductRail } from "@/components/product/product-card";
import { Section } from "@/components/ui/section";
import { selectedBranch, serverGet } from "@/lib/server";
import type { HomeData } from "@/lib/types";

export const metadata: Metadata = { title: { absolute: "Orchard Row — Fresh, honestly labelled." } };

const PROMISES = [
  { icon: Scale, title: "Weighed fairly", body: "Loose produce is priced by weight. You're charged for what we actually pick, never more than the maximum shown at checkout." },
  { icon: ShieldCheck, title: "You decide on substitutes", body: "Allow, ask first, or never. A substitute never costs you more than the item you chose." },
  { icon: Clock, title: "Slots that hold", body: "Pick a delivery window and it's yours: we reserve it as you check out, so it can't be double-booked." },
  { icon: Truck, title: "Delivery or collection", body: "Delivered to your door in the zones we serve, or ready to collect at one of our stores." },
];

export default async function HomePage() {
  const branch = await selectedBranch();
  const home = await serverGet<HomeData>("/home/", { branch }, { revalidate: 30 });
  const hero = home.banners.find((b) => b.placement === "HERO");
  const promos = home.banners.filter((b) => b.placement === "PROMO").slice(0, 3);
  return (
    <>
      {hero && (
        <section aria-label="Featured" className="border-b border-line bg-primary-soft">
          <div className="container-x grid items-center gap-6 py-8 md:grid-cols-[1.05fr_1fr] md:py-12">
            <div>
              <p className="eyebrow mb-3">{hero.subtitle ? "This week" : "Orchard Row"}</p>
              <h1 className="text-4xl sm:text-5xl lg:text-[3.4rem]">{hero.title}</h1>
              {hero.subtitle && <p className="mt-4 max-w-lg text-lg text-ink-2">{hero.subtitle}</p>}
              {hero.cta_label && <ButtonLink href={hero.cta_link || "/shop"} size="lg" className="mt-7">{hero.cta_label}</ButtonLink>}
            </div>
            {hero.image && (
              <div className="overflow-hidden rounded-lg border border-line bg-white shadow-card">
                <img src={hero.image} alt="" width={1200} height={800} fetchPriority="high" decoding="async" className="aspect-[3/2] w-full object-cover" />
              </div>
            )}
          </div>
        </section>
      )}

      <Section title="Shop by department" eyebrow="Browse">
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {home.departments.map((d) => (
            <li key={d.id}>
              <Link href={`/shop?category=${d.slug}`} className="group flex h-full flex-col overflow-hidden rounded-lg border border-line bg-white transition-shadow hover:shadow-card">
                {d.image && Object.keys(d.image).length > 0 && (
                  <img src={d.image["640"] ?? d.image["320"] ?? d.image.original} alt="" width={320} height={240} loading="lazy" className="tile-bg aspect-[4/3] w-full object-cover transition-transform duration-300 group-hover:scale-105" />
                )}
                <span className="block px-3 py-3 font-semibold leading-tight text-ink">{d.name}<span className="num mt-0.5 block text-xs font-normal text-ink-3">{d.count} products</span></span>
              </Link>
            </li>
          ))}
        </ul>
      </Section>

      {home.offers.length > 0 && (
        <Section title="This week's offers" eyebrow="Save" href="/offers"><ProductRail products={home.offers} /></Section>
      )}

      {promos.length > 0 && (
        <section className="container-x grid gap-4 py-6 md:grid-cols-3" aria-label="Promotions">
          {promos.map((b) => (
            <Link key={b.id} href={b.cta_link || "/shop"} className="group relative flex min-h-48 flex-col justify-end overflow-hidden rounded-lg border border-line bg-primary text-white">
              {b.image && <img src={b.image} alt="" loading="lazy" className="absolute inset-0 size-full object-cover opacity-70 transition-transform duration-500 group-hover:scale-105" />}
              <span className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" aria-hidden />
              <span className="relative p-5"><span className="block font-display text-2xl font-semibold">{b.title}</span>{b.subtitle && <span className="mt-1 block text-sm text-white/85">{b.subtitle}</span>}{b.cta_label && <span className="mt-3 inline-block text-sm font-semibold underline underline-offset-4">{b.cta_label}</span>}</span>
            </Link>
          ))}
        </section>
      )}

      {home.bestsellers.length > 0 && <Section title="Customer favourites" eyebrow="Popular" href="/shop?sort=popular"><ProductRail products={home.bestsellers} /></Section>}

      <section className="my-6 border-y border-line bg-paper-2" aria-label="How we shop for you">
        <div className="container-x py-10">
          <h2 className="mb-6 text-2xl sm:text-3xl">How we shop for you</h2>
          <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {PROMISES.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex gap-3">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-white text-primary shadow-sm"><Icon className="size-5" aria-hidden /></span>
                <div><h3 className="font-sans text-base font-bold text-ink">{title}</h3><p className="mt-1 text-sm text-ink-2">{body}</p></div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {home.collections.map((c) => (
        <Section key={c.slug} title={c.name} href={`/collections/${c.slug}`} hrefLabel="View collection">
          {c.description && <p className="-mt-3 mb-5 max-w-2xl text-ink-2">{c.description}</p>}
          <ProductRail products={c.products} />
        </Section>
      ))}

      {home.new_arrivals.length > 0 && <Section title="New in" eyebrow="Just arrived" href="/new"><ProductRail products={home.new_arrivals} /></Section>}

      {home.guides.length > 0 && (
        <Section title="Recipes & guides" eyebrow="Cook" href="/guides">
          <ul className="grid gap-5 md:grid-cols-3">
            {home.guides.slice(0, 3).map((a) => (
              <li key={a.slug}>
                <Link href={`/guides/${a.slug}`} className="group block overflow-hidden rounded-lg border border-line bg-white">
                  {a.image && <img src={a.image} alt="" width={640} height={420} loading="lazy" className="aspect-[16/10] w-full object-cover transition-transform duration-300 group-hover:scale-105" />}
                  <div className="p-4"><p className="eyebrow">{a.kind === "RECIPE" ? "Recipe" : "Guide"}</p><h3 className="mt-1 text-lg">{a.title}</h3><p className="mt-1 line-clamp-2 text-sm text-ink-2">{a.summary}</p></div>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}
