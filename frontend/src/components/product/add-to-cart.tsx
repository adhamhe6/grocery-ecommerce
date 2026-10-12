"use client";

import { ShoppingBasket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCartActions, useCartQuantities } from "@/lib/hooks";
import type { ProductCardData } from "@/lib/types";
import { QuantityStepper } from "./quantity";

export function AddToCart({ p, size = "md", className, fullWidth = true }: { p: ProductCardData; size?: "sm" | "md" | "lg"; className?: string; fullWidth?: boolean }) {
  const quantities = useCartQuantities();
  const { add, setQuantity, remove } = useCartActions();
  const inCart = quantities.get(p.id);
  const busy = add.isPending || setQuantity.isPending || remove.isPending;
  const min = Number(p.quantity.min);
  const step = Number(p.quantity.step);
  const max = p.availability.max_orderable != null ? Number(p.availability.max_orderable) : p.quantity.max != null ? Number(p.quantity.max) : null;

  if (!p.availability.can_order) {
    return <Button variant="secondary" size={size === "lg" ? "lg" : size === "sm" ? "sm" : "md"} disabled className={fullWidth ? "w-full" : className}>{p.availability.status === "UNAVAILABLE" ? "Unavailable" : "Out of stock"}</Button>;
  }
  if (inCart) {
    return (
      <QuantityStepper
        value={inCart} min={min} step={step} max={max} unit={p.sale_unit.symbol} name={p.name} busy={busy} size={size === "sm" ? "sm" : "md"}
        className={fullWidth ? `w-full justify-between ${className ?? ""}` : className}
        onChange={(n) => (n === 0 ? remove.mutate(p.id) : setQuantity.mutate({ productId: p.id, quantity: n }))}
      />
    );
  }
  return (
    <Button size={size === "lg" ? "lg" : size === "sm" ? "sm" : "md"} className={fullWidth ? `w-full ${className ?? ""}` : className} loading={add.isPending} onClick={() => add.mutate({ productId: p.id, quantity: p.quantity.min })} aria-label={`Add ${p.name} to basket`}>
      <ShoppingBasket className="size-4" aria-hidden /> Add
    </Button>
  );
}
