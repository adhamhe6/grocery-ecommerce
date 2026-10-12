"use client";

import { Info } from "lucide-react";
import { Alert, Spinner } from "@/components/ui/states";
import { ApiError } from "@/lib/api";
import { formatDate, formatTimeRange } from "@/lib/format";
import { useMoney, useStore } from "@/lib/hooks";
import type { CartData, QuoteData } from "@/lib/types";

export function QuoteSummary({ cart, quote, loading, quoteError, ready, fulfilment }: { cart: CartData; quote: QuoteData | null; loading: boolean; quoteError: unknown; ready: boolean; fulfilment: "DELIVERY" | "PICKUP" }) {
  const money = useMoney();
  const store = useStore();
  const q = quote;
  return (
    <section aria-labelledby="sum-h" className="rounded-lg border border-line bg-white p-5 shadow-card">
      <h2 id="sum-h" className="text-xl">Order summary</h2>
      <ul className="mt-3 max-h-56 divide-y divide-line overflow-y-auto text-sm">
        {(q?.lines ?? cart.lines.map((l) => ({ product_id: l.product.id, name: l.product.name, quantity: l.quantity, unit: l.product.sale_unit.symbol, line_total: l.line_total, is_estimate: l.is_estimate }))).map((l) => (
          <li key={l.product_id} className="flex justify-between gap-3 py-2"><span className="min-w-0"><span className="block truncate text-ink">{l.name}</span><span className="num text-ink-3">{Number(l.quantity)} {l.unit}</span></span><span className="num shrink-0 text-ink">{l.is_estimate && "≈ "}{money(l.line_total)}</span></li>
        ))}
      </ul>
      <dl className="num mt-4 space-y-2 border-t border-line pt-4 text-[0.95rem]">
        <div className="flex justify-between"><dt className="text-ink-2">Subtotal</dt><dd>{money(q?.subtotal ?? cart.totals.subtotal)}</dd></div>
        {Number(q?.promo_savings ?? cart.totals.promo_savings) > 0 && <div className="flex justify-between text-ok"><dt>Offers applied</dt><dd>You save {money(q?.promo_savings ?? cart.totals.promo_savings)}</dd></div>}
        {q?.coupon && <div className="flex justify-between text-ok"><dt>Code {q.coupon.code}</dt><dd>−{money(q.coupon.discount)}</dd></div>}
        {!q?.coupon && Number(cart.totals.coupon_discount) > 0 && <div className="flex justify-between text-ok"><dt>Promo code</dt><dd>−{money(cart.totals.coupon_discount)}</dd></div>}
        <div className="flex justify-between"><dt className="text-ink-2">{fulfilment === "DELIVERY" ? "Delivery" : "Collection"}</dt><dd>{q ? (q.free_delivery && Number(q.delivery_fee_before_free) > 0 ? <><s className="mr-1 text-ink-3">{money(q.delivery_fee_before_free)}</s>Free</> : Number(q.delivery_fee) > 0 ? money(q.delivery_fee) : "Free") : "—"}</dd></div>
        {q?.tax_included && Number(q.tax_included) > 0 && <div className="flex justify-between text-ink-3"><dt>Includes {store.tax_label}</dt><dd>{money(q.tax_included)}</dd></div>}
        {q?.tax_added && Number(q.tax_added) > 0 && <div className="flex justify-between"><dt className="text-ink-2">{store.tax_label}</dt><dd>{money(q.tax_added)}</dd></div>}
        <div className="flex items-baseline justify-between border-t border-line pt-3 text-lg font-semibold text-ink"><dt>{q?.has_weighed_items ? "Estimated total" : "Total"}</dt><dd aria-live="polite">{loading ? <Spinner className="inline" /> : q ? money(q.total) : money(cart.totals.estimated_total)}</dd></div>
      </dl>
      {q?.slot && <p className="mt-3 text-sm text-ink-2"><strong className="text-ink">{formatDate(q.slot.date)}</strong>, <span className="num">{formatTimeRange(q.slot.start, q.slot.end)}</span></p>}
      {q?.has_weighed_items && (
        <div className="mt-4 flex gap-2.5 rounded-md bg-citrus-soft p-3 text-sm text-ink-2">
          <Info className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
          <p>Some items are sold by weight. Your card is authorised for up to <strong className="num text-ink">{money(q.max_charge)}</strong> (the estimate plus a {q.weight_policy.tolerance_percent}% allowance, {money(q.weight_buffer)}). We charge the exact picked weight — never more than that maximum — and release the rest.</p>
        </div>
      )}
      {!ready && !q && <p className="mt-4 text-sm text-ink-3">Delivery fee and the final total appear once you&apos;ve entered your details and chosen a slot.</p>}
      {quoteError ? <Alert tone="bad" title="We couldn't price this order" className="mt-4">{quoteError instanceof ApiError ? quoteError.message : "Please try again."}</Alert> : null}
    </section>
  );
}
