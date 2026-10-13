"use client";

import { ShoppingBasket } from "lucide-react";
import Link from "next/link";
import { Alert, EmptyState, Spinner } from "@/components/ui/states";
import { Button, ButtonLink } from "@/components/ui/button";
import { Sheet } from "@/components/ui/dialog";
import { ProductImage } from "@/components/product/product-card";
import { QuantityStepper } from "@/components/product/quantity";
import { useCart, useCartActions, useCartDrawer, useMoney } from "@/lib/hooks";

export function CartDrawer() {
  const { open, setOpen } = useCartDrawer();
  const { data: cart, isLoading } = useCart();
  const { setQuantity, remove } = useCartActions();
  const money = useMoney();
  const busy = setQuantity.isPending || remove.isPending;
  const close = () => setOpen(false);
  return (
    <Sheet open={open} onOpenChange={setOpen} title="Your basket">
      {isLoading && <div className="flex flex-1 items-center justify-center"><Spinner /></div>}
      {cart && cart.lines.length === 0 && (
        <EmptyState icon={<ShoppingBasket className="size-6" aria-hidden />} title="Your basket is empty" action={<ButtonLink href="/shop" onClick={close}>Start shopping</ButtonLink>}>
          Add fresh produce, pantry staples and more — your basket is saved as you browse.
        </EmptyState>
      )}
      {cart && cart.lines.length > 0 && (
        <>
          <ul className="flex-1 divide-y divide-line overflow-y-auto px-5">
            {cart.lines.map((l) => {
              const blocking = l.issues.find((i) => i.blocking);
              return (
                <li key={l.product.id} className="flex gap-3 py-4">
                  <Link href={`/product/${l.product.slug}`} onClick={close} className="w-16 shrink-0"><ProductImage image={l.product.image} className="rounded-md" sizes="64px" /></Link>
                  <div className="min-w-0 flex-1">
                    <Link href={`/product/${l.product.slug}`} onClick={close} className="line-clamp-2 text-sm font-semibold leading-snug hover:underline">{l.product.name}</Link>
                    <p className="num mt-0.5 text-sm text-ink-3">{money(l.unit_price)}{l.product.sale_unit.kind !== "COUNT" ? ` / ${l.product.sale_unit.symbol}` : ""}</p>
                    {blocking && <p className="mt-1 text-sm font-medium text-bad">{blocking.message}</p>}
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <QuantityStepper size="sm" value={Number(l.quantity)} min={Number(l.product.quantity.min)} step={Number(l.product.quantity.step)} max={l.product.availability.max_orderable ? Number(l.product.availability.max_orderable) : null}
                        unit={l.product.sale_unit.symbol} name={l.product.name} busy={busy} onChange={(n) => (n === 0 ? remove.mutate(l.product.id) : setQuantity.mutate({ productId: l.product.id, quantity: n }))} />
                      <span className="num text-sm font-semibold">{l.is_estimate && <span className="font-normal text-ink-3">≈ </span>}{money(l.line_total)}</span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="space-y-3 border-t border-line bg-white px-5 py-4">
            {!cart.can_checkout && <Alert tone="warn">Some items need attention before checkout. <Link href="/cart" onClick={close} className="font-semibold underline">Review basket</Link></Alert>}
            <dl className="space-y-1 text-sm">
              {Number(cart.totals.promo_savings) > 0 && <div className="flex justify-between text-ok"><dt>Offers applied</dt><dd className="num">−{money(cart.totals.promo_savings)}</dd></div>}
              <div className="flex justify-between text-base font-semibold"><dt>{cart.totals.has_estimated_lines ? "Estimated subtotal" : "Subtotal"}</dt><dd className="num">{money(cart.totals.subtotal)}</dd></div>
            </dl>
            <p className="text-xs text-ink-3">Delivery or pickup, time slot and any promo code are chosen at checkout.</p>
            <div className="grid grid-cols-2 gap-2">
              <ButtonLink href="/cart" variant="secondary" onClick={close}>View basket</ButtonLink>
              <ButtonLink href="/checkout" onClick={close} className={cart.can_checkout ? "" : "pointer-events-none opacity-50"} aria-disabled={!cart.can_checkout}>Checkout</ButtonLink>
            </div>
          </div>
        </>
      )}
      {!isLoading && !cart && <div className="p-6"><Button onClick={close} variant="secondary">Close</Button></div>}
    </Sheet>
  );
}
