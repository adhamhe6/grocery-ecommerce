"use client";

import { Heart, Scale, ShoppingBasket } from "lucide-react";
import * as React from "react";
import { Alert } from "@/components/ui/states";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { formatQty } from "@/lib/format";
import { useCartActions, useCartQuantities, useCompare, useFavorites, useMoney, useStore } from "@/lib/hooks";
import type { ProductDetailData } from "@/lib/types";
import { QuantityStepper } from "./quantity";
import { useToast } from "@/components/ui/toast";

const dp = (n: number) => parseFloat(n.toFixed(3));

export function PurchasePanel({ p }: { p: ProductDetailData }) {
  const money = useMoney();
  const store = useStore();
  const toast = useToast();
  const qtys = useCartQuantities();
  const { add, setQuantity, remove, setPreference } = useCartActions();
  const fav = useFavorites();
  const compare = useCompare();
  const inCart = qtys.get(p.id);
  const min = Number(p.quantity.min);
  const step = Number(p.quantity.step);
  const max = p.availability.max_orderable != null ? Number(p.availability.max_orderable) : p.quantity.max != null ? Number(p.quantity.max) : null;
  const [qty, setQty] = React.useState(min);
  const weighed = p.is_variable_weight;
  const est = dp(qty * Number(p.price));
  const busy = add.isPending || setQuantity.isPending || remove.isPending;

  return (
    <div className="rounded-lg border border-line bg-white p-5 shadow-card">
      {p.availability.status === "LOW_STOCK" && <p className="mb-3 text-sm font-semibold text-warn">Only a few left{p.availability.max_orderable ? ` — up to ${formatQty(p.availability.max_orderable, p.sale_unit.symbol)}` : ""}</p>}
      {!p.availability.can_order ? (
        <Alert tone="warn" title={p.availability.status === "UNAVAILABLE" ? "Unavailable right now" : "Out of stock at this store"}>Add it to your favourites or try another store — availability is per store.</Alert>
      ) : inCart ? (
        <div className="space-y-3">
          <p className="text-sm font-semibold text-ok">In your basket</p>
          <QuantityStepper value={inCart} min={min} step={step} max={max} unit={p.sale_unit.symbol} name={p.name} busy={busy} className="w-full justify-between" onChange={(n) => (n === 0 ? remove.mutate(p.id) : setQuantity.mutate({ productId: p.id, quantity: n }))} />
          <Select aria-label="If this is unavailable at picking" className="h-10" defaultValue="INHERIT" onChange={(e) => setPreference.mutate({ productId: p.id, pref: e.target.value as "INHERIT" | "ALLOW" | "NONE" }, { onSuccess: () => toast.success("Substitution preference saved") })}>
            <option value="INHERIT">Use my basket&apos;s substitution setting</option>
            <option value="ALLOW">Substitute this item if needed</option>
            <option value="NONE">Never substitute this item</option>
          </Select>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <QuantityStepper value={qty} min={min} step={step} max={max} unit={p.sale_unit.symbol} name={p.name} onChange={(n) => setQty(Math.max(min, n))} />
            <p className="num text-right text-sm text-ink-2">{weighed ? "Estimated " : "Total "}<strong className="text-base text-ink">{money(est)}</strong></p>
          </div>
          <Button size="lg" className="w-full" loading={add.isPending} onClick={() => add.mutate({ productId: p.id, quantity: qty })}><ShoppingBasket className="size-5" aria-hidden /> Add to basket</Button>
        </div>
      )}
      {weighed && (
        <p className="mt-3 rounded-md bg-citrus-soft p-3 text-sm text-ink-2">
          <strong className="text-ink">Sold by weight.</strong> The price is an estimate. We pick as close to your weight as possible and charge for the exact weight, up to a maximum of {store.policies.weight_tolerance_percent}% over — shown clearly at checkout.
        </p>
      )}
      <div className="mt-4 flex gap-2 border-t border-line pt-4">
        <Button variant="secondary" size="sm" aria-pressed={fav.isFavorite(p.id)} onClick={() => (fav.signedIn ? fav.toggle(p.id) : toast.info("Sign in to save favourites"))}>
          <Heart className={cn("size-4", fav.isFavorite(p.id) && "fill-accent text-accent")} aria-hidden /> {fav.isFavorite(p.id) ? "Saved" : "Save"}
        </Button>
        <Button variant="secondary" size="sm" aria-pressed={compare.has(p.id)} onClick={() => compare.toggle(p.id)}><Scale className="size-4" aria-hidden /> {compare.has(p.id) ? "Remove from compare" : "Compare"}</Button>
      </div>
    </div>
  );
}
