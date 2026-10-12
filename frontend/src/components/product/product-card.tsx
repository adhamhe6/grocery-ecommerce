"use client";

import { Heart, Scale } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { imgSrc, imgSrcSet } from "@/lib/format";
import { useCompare, useFavorites } from "@/lib/hooks";
import type { ProductCardData } from "@/lib/types";
import { AddToCart } from "./add-to-cart";
import { Price } from "./price";

export function ProductImage({ image, className, sizes = "(min-width:1024px) 240px, 45vw", priority }: { image: ProductCardData["image"]; className?: string; sizes?: string; priority?: boolean }) {
  if (!image) return <div className={cn("tile-bg flex aspect-square w-full items-center justify-center text-ink-3", className)}><span className="text-sm">No image yet</span></div>;
  return (
    <img
      src={imgSrc(image.urls, 640)} srcSet={imgSrcSet(image.urls)} sizes={sizes} alt={image.alt} width={640} height={640}
      loading={priority ? "eager" : "lazy"} fetchPriority={priority ? "high" : "auto"} decoding="async"
      className={cn("tile-bg aspect-square w-full object-contain", className)}
    />
  );
}

const BADGE: Record<string, { label: string; tone: "accent" | "citrus" | "info" | "neutral" } | undefined> = {
  NEW: { label: "New", tone: "citrus" }, FROZEN: { label: "Frozen", tone: "info" }, CHILLED: { label: "Chilled", tone: "info" },
};

export function ProductCard({ p, priority }: { p: ProductCardData; priority?: boolean }) {
  const fav = useFavorites();
  const compare = useCompare();
  const toast = useToast();
  const low = p.availability.status === "LOW_STOCK";
  const badges = p.badges.map((b) => BADGE[b]).filter(Boolean).slice(0, 2);
  return (
    <article className="group relative flex h-full flex-col" aria-labelledby={`p-${p.id}`}>
      <div className="relative overflow-hidden rounded-lg border border-line bg-white">
        <Link href={`/product/${p.slug}`} tabIndex={-1} aria-hidden>
          <ProductImage image={p.image} priority={priority} className="transition-transform duration-300 group-hover:scale-[1.03]" />
        </Link>
        <div className="pointer-events-none absolute left-2 top-2 flex flex-col items-start gap-1">
          {p.promotion && <Badge tone="accent">{p.promotion.label}</Badge>}
          {badges.map((b) => b && <Badge key={b.label} tone={b.tone}>{b.label}</Badge>)}
        </div>
        <button
          type="button"
          className="absolute right-2 top-2 flex size-9 items-center justify-center rounded-full bg-white/90 text-ink-2 shadow-sm transition-colors hover:text-accent"
          aria-pressed={fav.isFavorite(p.id)} aria-label={fav.isFavorite(p.id) ? `Remove ${p.name} from favourites` : `Save ${p.name} to favourites`}
          onClick={() => (fav.signedIn ? fav.toggle(p.id) : toast.info("Sign in to save favourites", "Your saved items follow you across devices."))}
        >
          <Heart className={cn("size-[1.15rem]", fav.isFavorite(p.id) && "fill-accent text-accent")} aria-hidden />
        </button>
      </div>
      <div className="flex flex-1 flex-col pt-3">
        <p className="min-h-4 text-xs font-medium uppercase tracking-wide text-ink-3">{p.brand?.name}</p>
        <h3 id={`p-${p.id}`} className="font-sans text-[0.97rem] font-semibold leading-snug text-ink">
          <Link href={`/product/${p.slug}`} className="line-clamp-2 hover:underline after:absolute after:inset-x-0 after:top-0 after:h-[calc(100%-4.5rem)] after:content-['']">{p.name}</Link>
        </h3>
        <p className="mt-0.5 text-sm text-ink-3">{p.pack_label}</p>
        <Price p={p} className="mt-2" />
        {low && <p className="mt-1 text-sm font-medium text-warn">Only a few left</p>}
        <div className="relative z-10 mt-auto pt-3">
          <AddToCart p={p} />
          <button
            type="button"
            className={cn("mt-2 flex items-center gap-1.5 text-sm font-medium text-ink-2 hover:text-primary", compare.has(p.id) && "text-primary")}
            aria-pressed={compare.has(p.id)} onClick={() => compare.toggle(p.id)}
          >
            <Scale className="size-4" aria-hidden /> {compare.has(p.id) ? "In comparison" : "Compare"}
          </button>
        </div>
      </div>
    </article>
  );
}

export function ProductGrid({ products, className }: { products: ProductCardData[]; className?: string }) {
  return (
    <ul className={cn("grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5", className)}>
      {products.map((p, i) => <li key={p.id}><ProductCard p={p} priority={i < 4} /></li>)}
    </ul>
  );
}

export function ProductRail({ products }: { products: ProductCardData[] }) {
  return (
    <ul className="scroll-snap-x -mx-4 px-4 sm:mx-0 sm:px-0">
      {products.map((p) => <li key={p.id} className="w-[11.5rem] sm:w-[13.5rem]"><ProductCard p={p} /></li>)}
    </ul>
  );
}
