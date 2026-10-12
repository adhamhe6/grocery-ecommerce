"use client";

import { ArrowRight, ShoppingBasket, Tag, X } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { ProductImage } from "@/components/product/product-card";
import { QuantityStepper } from "@/components/product/quantity";
import { Alert, EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { Button, ButtonLink } from "@/components/ui/button";
import { ChoiceGroup, Input, Select } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { formatQty } from "@/lib/format";
import { ApiError } from "@/lib/api";
import { useCart, useCartActions, useMoney, useStore } from "@/lib/hooks";
import type { CartData, CartLine, SubstitutionPolicy } from "@/lib/types";

export const POLICY_OPTIONS: { value: SubstitutionPolicy; title: string; description: string }[] = [
  { value: "ALLOW", title: "Substitute for me", description: "If something runs out, our picker chooses the closest match. You never pay more than the price of the original." },
  { value: "CONTACT", title: "Ask me first", description: "We'll message you with a suggestion and wait for your answer before picking it." },
  { value: "NONE", title: "No substitutions", description: "If something is unavailable we simply leave it out and refund it." },
];

export function CouponBox({ cart }: { cart: CartData }) {
  const { applyCoupon, removeCoupon } = useCartActions();
  const money = useMoney();
  const [code, setCode] = React.useState("");
  const err = applyCoupon.error instanceof ApiError ? applyCoupon.error.message : applyCoupon.error ? "That code couldn't be applied." : null;
  if (cart.coupon) {
    return (
      <div className="rounded-md border border-line-strong bg-white p-3.5" aria-live="polite">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 font-semibold text-ink"><Tag className="size-4 text-accent" aria-hidden /> <span className="num">{cart.coupon.code}</span></p>
            {cart.coupon.valid ? <p className="text-sm text-ok">{cart.coupon.description}{cart.coupon.discount && Number(cart.coupon.discount) > 0 ? ` — saves ${money(cart.coupon.discount)}` : ""}{cart.coupon.free_delivery ? " — free delivery" : ""}</p> : <p className="text-sm text-bad">{cart.coupon.message}</p>}
          </div>
          <Button variant="ghost" size="sm" onClick={() => removeCoupon.mutate()} aria-label={`Remove code ${cart.coupon.code}`}>Remove</Button>
        </div>
      </div>
    );
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (code.trim()) applyCoupon.mutate(code.trim(), { onSuccess: () => setCode("") }); }}>
      <label htmlFor="coupon" className="block text-sm font-semibold text-ink">Promo code</label>
      <div className="mt-1.5 flex gap-2">
        <Input id="coupon" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Enter code" autoComplete="off" autoCapitalize="characters" aria-invalid={!!err} aria-describedby={err ? "coupon-err" : undefined} maxLength={40} />
        <Button type="submit" variant="secondary" loading={applyCoupon.isPending} disabled={!code.trim()}>Apply</Button>
      </div>
      {err && <p id="coupon-err" role="alert" className="mt-1.5 text-sm font-medium text-bad">{err}</p>}
    </form>
  );
}

function IssueNotes({ line }: { line: CartLine }) {
  if (!line.issues.length) return null;
  return (
    <ul className="mt-2 space-y-1">
      {line.issues.map((i) => (
        <li key={i.code} className={`text-sm font-medium ${i.blocking ? "text-bad" : "text-warn"}`}>
          <span className="sr-only">{i.blocking ? "Problem: " : "Notice: "}</span>{i.message}
        </li>
      ))}
    </ul>
  );
}

export function OrderSummary({ cart, action, note }: { cart: CartData; action?: React.ReactNode; note?: React.ReactNode }) {
  const money = useMoney();
  const store = useStore();
  const t = cart.totals;
  return (
    <section aria-labelledby="summary-h" className="rounded-lg border border-line bg-white p-5 shadow-card">
      <h2 id="summary-h" className="text-xl">Order summary</h2>
      <dl className="num mt-4 space-y-2 text-[0.95rem]">
        <div className="flex justify-between"><dt className="text-ink-2">Subtotal ({cart.item_count} {cart.item_count === 1 ? "item" : "items"})</dt><dd>{money(t.subtotal)}</dd></div>
        {Number(t.promo_savings) > 0 && <div className="flex justify-between text-ok"><dt>Offers already applied</dt><dd>You save {money(t.promo_savings)}</dd></div>}
        {Number(t.coupon_discount) > 0 && <div className="flex justify-between text-ok"><dt>Promo code</dt><dd>−{money(t.coupon_discount)}</dd></div>}
        <div className="flex justify-between text-ink-2"><dt>Delivery</dt><dd>Chosen at checkout</dd></div>
        <div className="flex justify-between border-t border-line pt-3 text-lg font-semibold text-ink"><dt>{t.has_estimated_lines ? "Estimated total" : "Total"}</dt><dd>{money(t.estimated_total)}</dd></div>
      </dl>
      {t.has_estimated_lines && <p className="mt-3 rounded-md bg-citrus-soft p-3 text-sm text-ink-2">Your basket includes items sold by weight. You&apos;ll only pay for what is actually picked, and never more than the maximum shown at checkout (up to {store.policies.weight_tolerance_percent}% above the estimate).</p>}
      {note}
      {action && <div className="mt-5">{action}</div>}
    </section>
  );
}

export function CartView() {
  const { data: cart, isLoading, error, refetch } = useCart();
  const { setQuantity, remove, setPreference, setPolicy, fix, acknowledge, clear } = useCartActions();
  const toast = useToast();
  const money = useMoney();
  if (isLoading) return <div className="mt-8 space-y-4" aria-busy="true">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28 w-full" />)}</div>;
  if (error || !cart) return <ErrorState error={error} onRetry={() => refetch()} title="We couldn't load your basket" />;
  if (cart.lines.length === 0) {
    return <EmptyState icon={<ShoppingBasket className="size-7" aria-hidden />} title="Your basket is empty" action={<ButtonLink href="/shop">Start shopping</ButtonLink>}>Add a few things you love and they&apos;ll wait here for you.</EmptyState>;
  }
  const blocking = cart.lines.filter((l) => l.issues.some((i) => i.blocking));
  const priceChanged = cart.lines.filter((l) => l.issues.some((i) => i.code === "PRICE_CHANGED"));
  const busy = setQuantity.isPending || remove.isPending || setPreference.isPending;

  return (
    <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_24rem]">
      <div>
        {cart.notices.length > 0 && (
          <Alert tone="info" title="We updated your basket" className="mb-4">
            <ul className="list-disc pl-4">{cart.notices.map((n) => <li key={n}>{n}</li>)}</ul>
            <Button variant="link" className="mt-1" onClick={() => acknowledge.mutate()}>Dismiss</Button>
          </Alert>
        )}
        {blocking.length > 0 && (
          <Alert tone="bad" title={`${blocking.length} ${blocking.length === 1 ? "item needs" : "items need"} your attention`} className="mb-4">
            Some items can&apos;t be supplied as requested from your store, so checkout is paused.
            <div className="mt-2"><Button size="sm" variant="secondary" loading={fix.isPending} onClick={() => fix.mutate(undefined, { onSuccess: () => toast.info("Basket updated", "We've removed or reduced the items we can't supply.") })}>Fix my basket</Button></div>
          </Alert>
        )}
        {priceChanged.length > 0 && blocking.length === 0 && (
          <Alert tone="warn" title="Some prices have changed" className="mb-4">
            Please review the updated prices below. <Button variant="link" className="ml-1" onClick={() => acknowledge.mutate()}>OK, continue</Button>
          </Alert>
        )}

        <ul className="divide-y divide-line border-y border-line">
          {cart.lines.map((l) => {
            const p = l.product;
            const max = p.availability.max_orderable != null ? Number(p.availability.max_orderable) : p.quantity.max != null ? Number(p.quantity.max) : null;
            return (
              <li key={p.id} className="grid grid-cols-[5.5rem_1fr] gap-x-4 gap-y-3 py-5 sm:grid-cols-[7rem_1fr_auto]">
                <Link href={`/product/${p.slug}`} className="row-span-2 sm:row-span-1" aria-hidden tabIndex={-1}><ProductImage image={p.image} className="rounded-md border border-line" sizes="112px" /></Link>
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-wide text-ink-3">{p.brand?.name}</p>
                  <h2 className="font-sans text-base font-semibold text-ink"><Link href={`/product/${p.slug}`} className="hover:underline">{p.name}</Link></h2>
                  <p className="text-sm text-ink-3">{p.pack_label} · <span className="num">{money(l.unit_price)}</span>{p.sale_unit.kind !== "COUNT" && ` / ${p.sale_unit.symbol}`}</p>
                  {l.promotion && <p className="mt-1 text-sm font-medium text-accent">{l.promotion.label} — saving {money(l.promotion.savings)}</p>}
                  <IssueNotes line={l} />
                  <label className="mt-2 block text-sm text-ink-2">
                    <span className="sr-only">If {p.name} is unavailable</span>
                    <Select className="h-9 w-full max-w-64 text-sm" value={l.substitution_pref} onChange={(e) => setPreference.mutate({ productId: p.id, pref: e.target.value as "INHERIT" | "ALLOW" | "NONE" })}>
                      <option value="INHERIT">If unavailable: follow basket setting</option>
                      <option value="ALLOW">If unavailable: substitute</option>
                      <option value="NONE">If unavailable: don&apos;t substitute</option>
                    </Select>
                  </label>
                </div>
                <div className="col-start-2 flex items-center justify-between gap-3 sm:col-start-3 sm:flex-col sm:items-end sm:justify-start">
                  <QuantityStepper value={Number(l.quantity)} min={Number(p.quantity.min)} step={Number(p.quantity.step)} max={max} unit={p.sale_unit.symbol} name={p.name} busy={busy}
                    onChange={(n) => (n === 0 ? remove.mutate(p.id) : setQuantity.mutate({ productId: p.id, quantity: n }))} />
                  <p className="num text-right"><span className="block text-lg font-semibold text-ink">{l.is_estimate ? "≈ " : ""}{money(l.line_total)}</span>{l.is_estimate && <span className="block text-xs text-ink-3">{formatQty(l.quantity, p.sale_unit.symbol)} estimate</span>}</p>
                </div>
              </li>
            );
          })}
        </ul>
        <Button variant="ghost" size="sm" className="mt-3" onClick={() => clear.mutate()}><X className="size-4" aria-hidden /> Empty basket</Button>

        <div className="mt-8"><ChoiceGroup name="policy" legend="If something is unavailable when we pick your order" value={cart.substitution_policy} onChange={(v) => setPolicy.mutate(v)} options={POLICY_OPTIONS} /></div>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-28 lg:self-start">
        <OrderSummary cart={cart}
          note={<div className="mt-4"><CouponBox cart={cart} /></div>}
          action={
            <>
              <ButtonLink href="/checkout" size="lg" className={`w-full ${cart.can_checkout ? "" : "pointer-events-none opacity-50"}`} aria-disabled={!cart.can_checkout}>Checkout <ArrowRight className="size-5" aria-hidden /></ButtonLink>
              {!cart.can_checkout && <p className="mt-2 text-sm text-bad" role="status">Resolve the items marked above to continue.</p>}
              <Link href="/shop" className="mt-3 block text-center text-sm font-semibold text-primary hover:underline">Continue shopping</Link>
            </>
          } />
      </aside>
    </div>
  );
}
