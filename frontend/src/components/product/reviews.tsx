"use client";

import { useQuery } from "@tanstack/react-query";
import { Star } from "lucide-react";
import { Skeleton } from "@/components/ui/states";
import { Badge } from "@/components/ui/badge";
import { apiGet } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { Paginated } from "@/lib/types";

interface ReviewRow { id: number; rating: number; title: string; body: string; author: string; verified_purchase: boolean; is_demo: boolean; created_at: string }

export function Stars({ value, className }: { value: number; className?: string }) {
  return (
    <span className={className} role="img" aria-label={`${value.toFixed(1)} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => <Star key={n} className={`inline size-4 ${n <= Math.round(value) ? "fill-citrus text-citrus" : "text-line-strong"}`} aria-hidden />)}
    </span>
  );
}

export function Reviews({ slug, rating }: { slug: string; rating: { avg: string; count: number; is_demo: boolean } | null }) {
  const q = useQuery({ queryKey: ["reviews", slug], queryFn: () => apiGet<Paginated<ReviewRow>>(`/products/${slug}/reviews/`) });
  return (
    <section aria-labelledby="reviews-h" className="scroll-mt-24">
      <h2 id="reviews-h" className="text-2xl">Customer reviews</h2>
      {rating && <p className="mt-2 flex items-center gap-2 text-ink-2"><Stars value={Number(rating.avg)} /> <span className="num">{Number(rating.avg).toFixed(1)} from {rating.count} {rating.count === 1 ? "review" : "reviews"}</span>{rating.is_demo && <Badge tone="warn">Sample reviews</Badge>}</p>}
      {q.isLoading && <Skeleton className="mt-4 h-24 w-full" />}
      {q.data && q.data.results.length === 0 && <p className="mt-3 text-ink-2">No reviews yet. Reviews can be written for products from orders you&apos;ve received.</p>}
      <ul className="mt-4 divide-y divide-line">
        {q.data?.results.map((r) => (
          <li key={r.id} className="py-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1"><Stars value={r.rating} /><span className="font-semibold">{r.title}</span></div>
            <p className="mt-1 text-ink-2">{r.body}</p>
            <p className="mt-1 text-xs text-ink-3">{r.author} · {formatDate(r.created_at)} {r.verified_purchase && "· Verified purchase"} {r.is_demo && "· Sample review"}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
