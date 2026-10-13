"use client";

import { Package, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import * as React from "react";
import { Pagination } from "@/components/product/listing";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Alert, EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { cn } from "@/lib/cn";
import { ApiError } from "@/lib/api";
import { useOrders } from "@/lib/account-hooks";
import { formatDateTime, formatMoney, formatQty, pluralise } from "@/lib/format";
import { useCartActions, useStore } from "@/lib/hooks";
import type { CartData, OrderSummary } from "@/lib/types";

type Tone = "neutral" | "ok" | "warn" | "bad" | "info";

const STATUS_TONE: Record<string, Tone> = {
  PENDING_PAYMENT: "warn",
  CONFIRMED: "info",
  PICKING: "info",
  PACKING: "info",
  READY_FOR_PICKUP: "ok",
  READY_FOR_DISPATCH: "info",
  OUT_FOR_DELIVERY: "info",
  COMPLETED: "ok",
  CANCELLED: "neutral",
  PAYMENT_FAILED: "bad",
};
const FINISHED = new Set(["COMPLETED", "CANCELLED", "PAYMENT_FAILED"]);

const FULFILMENT: Record<string, string> = { DELIVERY: "Home delivery", PICKUP: "Store pickup" };
// Labels follow the API's OrderPaymentStatus choices.
const PAYMENT: Record<string, string> = {
  UNPAID: "Unpaid",
  AUTHORIZED: "Authorised",
  PENDING_COLLECTION: "To pay on delivery or pickup",
  PAID: "Paid",
  PARTIALLY_REFUNDED: "Partially refunded",
  REFUNDED: "Refunded",
  FAILED: "Payment failed",
  VOIDED: "Authorisation released",
};

type ReorderSummary = NonNullable<CartData["reorder"]>;

/** Says exactly what the reorder did: what went in, what was trimmed and what was left out (and why). */
export function ReorderResult({ number, result, onDismiss }: { number: string; result: ReorderSummary; onDismiss: () => void }) {
  const total = result.added.length + result.skipped.length;
  const clean = result.skipped.length === 0 && result.adjusted.length === 0;
  const title =
    result.added.length === 0
      ? `Nothing from order ${number} could be added`
      : clean
        ? `Added all ${pluralise(result.added.length, "item")} from order ${number} to your basket`
        : `Added ${result.added.length} of ${pluralise(total, "item")} from order ${number}`;
  return (
    <Alert tone={result.added.length === 0 ? "warn" : clean ? "ok" : "warn"} title={title} className="items-start">
      <div className="mt-2 space-y-3 text-ink-2">
        {result.added.length > 0 && (
          <div>
            <p className="font-semibold text-ink">In your basket</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {result.added.map((a) => <li key={a.name}>{a.name} <span className="num">× {formatQty(a.quantity)}</span></li>)}
            </ul>
          </div>
        )}
        {result.adjusted.length > 0 && (
          <div>
            <p className="font-semibold text-ink">Added in a smaller amount</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {result.adjusted.map((a) => <li key={a.name}>{a.name}: you ordered <span className="num">{formatQty(a.requested)}</span>, we added <span className="num">{formatQty(a.added)}</span>. {a.reason}.</li>)}
            </ul>
          </div>
        )}
        {result.skipped.length > 0 && (
          <div>
            <p className="font-semibold text-ink">Not added</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {result.skipped.map((s) => <li key={s.name}>{s.name}: {s.reason}</li>)}
            </ul>
          </div>
        )}
        {result.added.length > 0 && <p className="text-sm text-ink-3">Prices and stock are today&apos;s, so they may differ from your original order. Amounts are added to anything already in your basket.</p>}
        <div className="flex flex-wrap gap-2 pt-1">
          {result.added.length > 0 && <ButtonLink href="/cart" size="sm">View basket</ButtonLink>}
          <Button size="sm" variant="secondary" onClick={onDismiss}>Dismiss</Button>
        </div>
      </div>
    </Alert>
  );
}

function OrderRow({ order, locale, onReorder, reordering, busy }: { order: OrderSummary; locale: string; onReorder: () => void; reordering: boolean; busy: boolean }) {
  const active = !FINISHED.has(order.status);
  const slot = active && order.slot_starts_at ? `${order.fulfilment_type === "DELIVERY" ? "Delivery" : "Pickup"} window starts ${formatDateTime(order.slot_starts_at, locale)}` : null;
  const facts = [
    FULFILMENT[order.fulfilment_type] ?? order.fulfilment_type,
    order.item_count != null ? pluralise(order.item_count, "item") : null,
    PAYMENT[order.payment_status] ? `Payment: ${PAYMENT[order.payment_status].toLowerCase()}` : null,
  ].filter(Boolean);
  return (
    <li className="rounded-lg border border-line bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-sans text-base font-bold text-ink">
              <Link href={`/orders/${order.number}`} className="hover:underline">Order <span className="num">{order.number}</span></Link>
            </h2>
            <Badge tone={STATUS_TONE[order.status] ?? "neutral"}>{order.status_label}</Badge>
          </div>
          <p className="text-sm text-ink-2">Placed {formatDateTime(order.placed_at, locale)}</p>
          <p className="text-sm text-ink-2">{facts.join(" · ")}</p>
          {slot && <p className="text-sm font-medium text-ink">{slot}</p>}
        </div>
        <div className="flex flex-col items-start gap-3 sm:items-end">
          <p className="num text-lg font-semibold text-ink"><span className="sr-only">Total </span>{formatMoney(order.total, order.currency, locale)}</p>
          <div className="flex flex-wrap gap-2">
            <ButtonLink href={`/orders/${order.number}`} variant="secondary" size="sm" aria-label={`View order ${order.number}`}>View order</ButtonLink>
            <Button size="sm" variant="secondary" onClick={onReorder} loading={reordering} disabled={busy && !reordering} aria-label={`Reorder ${order.number}`}>
              {!reordering && <RotateCcw className="size-4" aria-hidden />} Reorder
            </Button>
          </div>
        </div>
      </div>
    </li>
  );
}

export function OrdersView() {
  const store = useStore();
  const sp = useSearchParams();
  const page = Math.max(1, Number.parseInt(sp.get("page") ?? "1", 10) || 1);
  const q = useOrders(page);
  const { reorder } = useCartActions();
  const [result, setResult] = React.useState<{ number: string; data: ReorderSummary } | null>(null);

  const doReorder = (number: string) => {
    setResult(null);
    reorder.mutate(number, {
      onSuccess: (cart) => setResult({ number, data: cart.reorder ?? { added: [], adjusted: [], skipped: [] } }),
    });
  };

  const data = q.data;
  const pastLastPage = q.error instanceof ApiError && q.error.status === 404 && page > 1;

  return (
    <div>
      <h1 className="text-3xl sm:text-4xl">Your orders</h1>
      <p className="mt-1 text-ink-2">Track an order, or add everything from a past order to your basket again.</p>

      <div aria-live="polite" className="mt-5 empty:hidden">
        {result && <ReorderResult number={result.number} result={result.data} onDismiss={() => setResult(null)} />}
      </div>

      <div className="mt-6">
        {q.isLoading && (
          <ul className="space-y-3" aria-busy="true" aria-label="Loading your orders">
            {Array.from({ length: 3 }, (_, i) => <li key={i}><Skeleton className="h-32 w-full" /></li>)}
          </ul>
        )}
        {pastLastPage && (
          <EmptyState icon={<Package className="size-6" aria-hidden />} title="That page doesn't exist" action={<ButtonLink href="/account/orders" variant="secondary">Back to your latest orders</ButtonLink>}>
            You may have fewer orders than you did a moment ago.
          </EmptyState>
        )}
        {q.isError && !pastLastPage && <ErrorState error={q.error} onRetry={() => q.refetch()} title="We couldn't load your orders" />}
        {data && data.count === 0 && (
          <EmptyState icon={<Package className="size-6" aria-hidden />} title="No orders yet" action={<ButtonLink href="/shop">Start shopping</ButtonLink>}>
            When you place an order, it will show up here so you can track it or order the same things again.
          </EmptyState>
        )}
        {data && data.count > 0 && (
          <>
            <p className="num mb-3 text-sm text-ink-2" role="status">
              {pluralise(data.count, "order")}{data.total_pages > 1 && <> · page {data.page} of {data.total_pages}</>}
            </p>
            <ul className={cn("space-y-3 transition-opacity", q.isPlaceholderData && "opacity-60")} aria-busy={q.isPlaceholderData || undefined}>
              {data.results.map((o) => (
                <OrderRow
                  key={o.number}
                  order={o}
                  locale={store.locale}
                  onReorder={() => doReorder(o.number)}
                  reordering={reorder.isPending && reorder.variables === o.number}
                  busy={reorder.isPending}
                />
              ))}
            </ul>
            <Pagination data={{ page: data.page, total_pages: data.total_pages }} base="/account/orders" params={{}} />
          </>
        )}
      </div>
    </div>
  );
}
