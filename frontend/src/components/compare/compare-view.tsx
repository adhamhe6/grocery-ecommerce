"use client";

import { Scale, X } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { AddToCart } from "@/components/product/add-to-cart";
import { ProductImage } from "@/components/product/product-card";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Alert, EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { useComparison, useCompareDetails } from "@/lib/account-hooks";
import { cn } from "@/lib/cn";
import { buildCompareRows, type Cell } from "@/lib/compare";
import { pluralise } from "@/lib/format";
import { MAX_COMPARE, useCompare, useMoney } from "@/lib/hooks";

function CellView({ cell }: { cell: Cell }) {
  switch (cell.kind) {
    case "value":
      return (
        <div>
          {cell.tone ? <Badge tone={cell.tone}>{cell.text}</Badge> : <span className="break-words font-medium text-ink">{cell.text}</span>}
          {cell.badge && <Badge tone="ok" className="ml-2">{cell.badge}</Badge>}
          {cell.note && <p className="mt-0.5 break-words text-xs text-ink-3">{cell.note}</p>}
        </div>
      );
    case "unknown":
      return (
        <div>
          <span className="italic text-ink-3">Not provided</span>
          {cell.note && <p className="mt-0.5 text-xs text-ink-3">{cell.note}</p>}
        </div>
      );
    case "loading":
      return (
        <div>
          <Skeleton className="h-5 w-24" />
          <span className="sr-only">Loading</span>
        </div>
      );
    case "error":
      return <p className="text-xs font-medium text-warn">{cell.note}</p>;
  }
}

function TableSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading the comparison">
      <Skeleton className="h-64 w-full" />
      {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-10 w-full" />)}
    </div>
  );
}

export function CompareView() {
  const compare = useCompare();
  const money = useMoney();
  // The shortlist lives in this browser; on the server and during hydration it is empty, so wait one tick before judging it.
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => setReady(true), []);

  const q = useComparison(compare.ids, ready);
  const settled = q.data && !q.isPlaceholderData ? q.data : null;
  const shown = (q.data?.products ?? []).filter((p) => compare.ids.includes(p.card.id)); // a removed product disappears at once
  const details = useCompareDetails(shown.map((p) => p.card.slug));

  // Shortlisted products that are no longer on sale never come back from the API; drop them (one per pass, since
  // useCompare's remove() works from the list it last rendered with) and say so.
  const missing = settled ? compare.ids.filter((id) => !settled.products.some((p) => p.card.id === id)) : [];
  const missingKey = missing.join(",");
  const removeRef = React.useRef(compare.remove);
  React.useEffect(() => { removeRef.current = compare.remove; });
  const [dropped, setDropped] = React.useState(0);
  React.useEffect(() => {
    if (!missingKey) return;
    removeRef.current(Number(missingKey.split(",")[0]));
    setDropped((n) => n + 1);
  }, [missingKey]);

  const built = q.data ? buildCompareRows({ ...q.data, products: shown }, details, money) : null;
  const waiting = !ready || (compare.ids.length > 0 && q.isPending);

  return (
    <div className="container-x py-8 sm:py-10">
      <h1 className="text-3xl sm:text-4xl">Compare products</h1>
      <p className="mt-1 max-w-2xl text-ink-2">Facts side by side for up to {MAX_COMPARE} products. Anything we haven&apos;t been given is marked &ldquo;Not provided&rdquo;, never guessed.</p>

      <div className="mt-6 space-y-4">
        <div aria-live="polite" className="empty:hidden">
          {dropped > 0 && <Alert tone="info">{dropped === 1 ? "A product was" : `${dropped} products were`} removed from your comparison because {dropped === 1 ? "it isn't" : "they aren't"} available any more.</Alert>}
        </div>

        {waiting && <TableSkeleton />}
        {ready && q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} title="We couldn't load your comparison" />}

        {ready && compare.ids.length === 0 && (
          <EmptyState icon={<Scale className="size-6" aria-hidden />} title="Nothing to compare yet" action={<ButtonLink href="/shop">Browse the shop</ButtonLink>}>
            Choose <strong>Compare</strong> under any product to add it here. You can compare up to {MAX_COMPARE} at a time.
          </EmptyState>
        )}

        {built && shown.length > 0 && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="num text-sm text-ink-2" role="status">{pluralise(shown.length, "product")} of {MAX_COMPARE} possible</p>
              <div className="flex flex-wrap items-center gap-2">
                {compare.ids.length < MAX_COMPARE && <ButtonLink href="/shop" variant="secondary" size="sm">Add more products</ButtonLink>}
                <Button variant="ghost" size="sm" onClick={() => compare.clear()}>Clear comparison</Button>
              </div>
            </div>

            {shown.length === 1 && <Alert tone="info">Add at least one more product to see how they compare. <Link href="/shop" className="font-semibold underline">Browse the shop</Link></Alert>}
            {[...(q.data?.warnings ?? []), ...built.notices].map((w) => <Alert key={w} tone="warn">{w}</Alert>)}

            <div
              role="region"
              aria-label="Product comparison table. Scroll sideways to see every product."
              tabIndex={0}
              className={cn("overflow-x-auto rounded-lg border border-line bg-white transition-opacity", q.isPlaceholderData && "opacity-70")}
            >
              <table className="w-full min-w-max border-separate border-spacing-0 text-left text-sm">
                <caption className="sr-only">Comparison of {pluralise(shown.length, "product")}</caption>
                <thead>
                  {/* Three header rows keep each column header down to the product's name; photos and buttons live in their own rows. */}
                  <tr>
                    <td className="sticky left-0 z-10 w-28 min-w-28 border-r border-line bg-white p-3 sm:w-40 sm:min-w-40" />
                    {shown.map((p) => (
                      <td key={p.card.id} className="w-52 min-w-52 p-3 pb-0 align-top sm:w-56 sm:min-w-56">
                        <div className="relative">
                          <Link href={`/product/${p.card.slug}`} tabIndex={-1} aria-hidden><ProductImage image={p.card.image} className="rounded-md border border-line" sizes="224px" /></Link>
                          <Button type="button" size="icon-sm" variant="secondary" className="absolute right-1.5 top-1.5 bg-white/90" aria-label={`Remove ${p.card.name} from comparison`} onClick={() => compare.remove(p.card.id)}>
                            <X className="size-4" aria-hidden />
                          </Button>
                        </div>
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <th scope="col" className="sticky left-0 z-10 border-r border-line bg-white p-3 text-left text-sm font-semibold text-ink">Product</th>
                    {shown.map((p) => (
                      <th key={p.card.id} scope="col" className="p-3 pt-2 text-left align-top font-normal">
                        {p.brand && <span className="block text-xs font-medium uppercase tracking-wide text-ink-3">{p.brand}</span>}
                        <Link href={`/product/${p.card.slug}`} className="line-clamp-3 text-[0.95rem] font-semibold leading-snug text-ink hover:underline">{p.card.name}</Link>
                      </th>
                    ))}
                  </tr>
                  <tr>
                    <td className="sticky left-0 z-10 border-r border-line bg-white p-3" />
                    {shown.map((p) => <td key={p.card.id} className="p-3 pt-0 align-top"><AddToCart p={p.card} /></td>)}
                  </tr>
                </thead>
                <tbody>
                  {built.rows.map((row) => (
                    <tr key={row.key}>
                      <th scope="row" className="sticky left-0 z-10 border-r border-t border-line bg-white p-3 text-left align-top text-sm font-semibold text-ink">
                        {row.group && <span className="mb-0.5 block text-[0.7rem] font-semibold uppercase tracking-wider text-ink-3">{row.group}</span>}
                        {row.label}
                      </th>
                      {row.cells.map((cell, i) => (
                        <td key={shown[i].card.id} className="border-t border-line p-3 align-top"><CellView cell={cell} /></td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-sm text-ink-3">Availability is shown for our default store and can differ at the store you&apos;ve chosen. Prices and stock are checked again when you check out.</p>
          </>
        )}
      </div>
    </div>
  );
}
