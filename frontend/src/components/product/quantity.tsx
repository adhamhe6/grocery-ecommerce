"use client";

import { Minus, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatQty } from "@/lib/format";

interface Props {
  value: number;
  min: number;
  step: number;
  max?: number | null;
  unit: string;
  name: string;
  busy?: boolean;
  onChange: (next: number) => void; // next === 0 means "remove"
  size?: "sm" | "md";
  className?: string;
}

const dp = (n: number) => parseFloat(n.toFixed(3));

/** + / − stepper that respects the product's minimum, step and maximum. Going below the minimum removes the item. */
export function QuantityStepper({ value, min, step, max, unit, name, busy, onChange, size = "md", className }: Props) {
  const canInc = max == null || dp(value + step) <= max;
  const atMin = dp(value - step) < min;
  const btn = cn("flex shrink-0 items-center justify-center rounded-md text-primary transition-colors hover:bg-primary-soft disabled:opacity-40", size === "md" ? "size-11" : "size-9");
  return (
    <div className={cn("inline-flex items-center rounded-md border border-line-strong bg-white", busy && "opacity-70", className)} role="group" aria-label={`Quantity of ${name}`}>
      <button type="button" className={btn} disabled={busy} onClick={() => onChange(atMin ? 0 : dp(value - step))} aria-label={atMin ? `Remove ${name}` : `Decrease quantity of ${name}`}>
        {atMin ? <Trash2 className="size-4" aria-hidden /> : <Minus className="size-4" aria-hidden />}
      </button>
      <span className={cn("num min-w-[4.25rem] px-1 text-center font-semibold text-ink", size === "md" ? "text-[0.95rem]" : "text-sm")} aria-live="polite">
        {formatQty(value)} <span className="text-xs font-medium text-ink-3">{unit}</span>
      </span>
      <button type="button" className={btn} disabled={busy || !canInc} onClick={() => onChange(dp(value + step))} aria-label={canInc ? `Increase quantity of ${name}` : `Maximum quantity of ${name} reached`}>
        <Plus className="size-4" aria-hidden />
      </button>
    </div>
  );
}
