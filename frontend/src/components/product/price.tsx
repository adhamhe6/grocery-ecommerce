"use client";

import { cn } from "@/lib/cn";
import { useMoney } from "@/lib/hooks";
import type { ProductCardData } from "@/lib/types";

/** Shelf price with the unit it applies to; shows the was-price and per-kg/L unit price when relevant. */
export function Price({ p, size = "md", className }: { p: Pick<ProductCardData, "price" | "base_price" | "promotion" | "sale_unit" | "unit_price" | "is_variable_weight">; size?: "md" | "lg"; className?: string }) {
  const money = useMoney();
  const discounted = Number(p.price) < Number(p.base_price);
  const perUnit = p.sale_unit.kind === "COUNT" ? "" : ` / ${p.sale_unit.symbol}`;
  return (
    <div className={className}>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className={cn("num font-semibold text-ink", size === "lg" ? "text-3xl" : "text-lg")}>
          {money(p.price)}
          {perUnit && <span className={cn("font-medium text-ink-2", size === "lg" ? "text-lg" : "text-sm")}>{perUnit}</span>}
        </span>
        {discounted && <span className={cn("num text-ink-3 line-through", size === "lg" ? "text-base" : "text-sm")}><span className="sr-only">Was </span>{money(p.base_price)}</span>}
      </div>
      {p.unit_price && p.sale_unit.kind === "COUNT" && <p className="num text-sm text-ink-3">{money(p.unit_price.amount)} / {p.unit_price.per}</p>}
      {p.is_variable_weight && <p className="text-sm text-ink-3">Priced by weight</p>}
    </div>
  );
}
