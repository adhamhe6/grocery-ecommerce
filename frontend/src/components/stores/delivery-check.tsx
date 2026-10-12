"use client";

import { useMutation } from "@tanstack/react-query";
import { Check, Truck } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, describedBy } from "@/components/ui/field";
import { Alert } from "@/components/ui/states";
import { ApiError, apiGet } from "@/lib/api";
import { useMoney } from "@/lib/hooks";
import type { DeliveryCheckResult } from "@/lib/types";

const isZero = (v: string | null | undefined) => v == null || Number(v) === 0;

/** Asks the real `GET /delivery/check/` endpoint whether a postcode (or area) is inside a delivery zone. */
export function DeliveryCheck() {
  const id = React.useId();
  const money = useMoney();
  const [value, setValue] = React.useState("");
  const [fieldError, setFieldError] = React.useState<string | null>(null);
  const check = useMutation<DeliveryCheckResult, unknown, string>({
    // The API matches a postcode prefix or a district name; sending the entry as both lets one box serve either.
    mutationFn: (v) => apiGet<DeliveryCheckResult>("/delivery/check/", { postal_code: v, area: v }),
  });
  const result = check.data;
  const apiError = check.error instanceof ApiError ? check.error : null;
  const serverFieldError = apiError ? (apiError.fieldErrors.postal_code ?? apiError.fieldErrors.area ?? null) : null;
  const error = fieldError ?? serverFieldError;

  return (
    <section aria-labelledby={`${id}-h`} className="rounded-lg border border-line bg-white p-5 shadow-card">
      <h2 id={`${id}-h`} className="flex items-center gap-2 text-xl"><Truck className="size-5 text-accent" aria-hidden /> Check delivery to your postcode</h2>
      <p className="mt-1 text-sm text-ink-2">See whether we deliver to you, what it costs and what the minimum order is.</p>
      <form
        className="mt-4 space-y-3" noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const v = value.trim();
          if (!v) {
            setFieldError("Enter a postcode or area to check.");
            return;
          }
          setFieldError(null);
          check.mutate(v);
        }}
      >
        <Field label="Postcode or area" htmlFor={`${id}-q`} error={error ?? undefined}>
          <Input
            id={`${id}-q`} name="postal_code" autoComplete="postal-code" value={value} maxLength={32} aria-invalid={!!error} aria-describedby={describedBy(`${id}-q`, false, !!error)}
            onChange={(e) => { setValue(e.target.value); setFieldError(null); }}
          />
        </Field>
        <Button type="submit" loading={check.isPending} className="w-full sm:w-auto">Check delivery</Button>
      </form>

      <div aria-live="polite" aria-atomic="true" className="mt-4 empty:mt-0">
        {check.isPending && <p className="text-sm text-ink-3">Checking…</p>}
        {apiError && !serverFieldError && <Alert tone="bad" title="We couldn't check that">{apiError.message}</Alert>}
        {check.isError && !apiError && <Alert tone="bad" title="We couldn't check that">Something went wrong. Please try again.</Alert>}
        {result && !result.serviceable && <Alert tone="warn" title="Not covered for delivery">{result.message}</Alert>}
        {result?.serviceable && (
          <div className="rounded-md border border-ok/25 bg-ok-soft p-4 text-sm">
            <p className="flex items-center gap-2 font-semibold text-ok"><Check className="size-5" aria-hidden /> We deliver to this address</p>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-ink">
              <dt className="text-ink-2">Delivery zone</dt><dd className="font-medium">{result.zone.name}</dd>
              <dt className="text-ink-2">Delivered from</dt><dd className="font-medium">{result.branch.name}</dd>
              <dt className="text-ink-2">Delivery fee</dt><dd className="num font-medium">{isZero(result.zone.delivery_fee) ? "Free" : money(result.zone.delivery_fee)}</dd>
              <dt className="text-ink-2">Free delivery</dt><dd className="num font-medium">{result.zone.free_delivery_threshold ? `On baskets of ${money(result.zone.free_delivery_threshold)} or more, after discounts` : "No free-delivery threshold in this zone"}</dd>
              <dt className="text-ink-2">Minimum order</dt><dd className="num font-medium">{isZero(result.zone.min_order_value) ? "None" : money(result.zone.min_order_value)}</dd>
            </dl>
            <p className="mt-3 text-xs text-ink-3">You choose a delivery window at checkout; the fee and minimum shown there are the ones that apply to your basket.</p>
          </div>
        )}
      </div>
    </section>
  );
}
