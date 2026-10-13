"use client";

import * as React from "react";
import { Alert, Skeleton } from "@/components/ui/states";
import { cn } from "@/lib/cn";
import { ApiError } from "@/lib/api";
import { formatDate, formatTimeRange } from "@/lib/format";
import { useMoney } from "@/lib/hooks";
import type { SlotsResponse } from "@/lib/types";

export function SlotPicker({ data, loading, error, value, onChange, kind }: { data?: SlotsResponse; loading: boolean; error: unknown; value: number | null; onChange: (id: number) => void; kind: "DELIVERY" | "PICKUP" }) {
  const money = useMoney();
  const [day, setDay] = React.useState<string | null>(null);
  const days = data?.days ?? [];
  const selectedDay = days.find((d) => d.slots.some((s) => s.id === value))?.date ?? day ?? days[0]?.date;
  if (loading) return <div className="space-y-2" aria-busy="true"><Skeleton className="h-12 w-full" /><Skeleton className="h-24 w-full" /></div>;
  if (error) return <Alert tone="warn" title={kind === "DELIVERY" ? "We can't offer delivery slots yet" : "Pickup slots aren't available"}>{error instanceof ApiError ? error.message : "Please try again."}</Alert>;
  if (!data) return <p className="text-sm text-ink-3">{kind === "DELIVERY" ? "Enter your delivery address to see available slots." : "Choose a store to see collection slots."}</p>;
  if (days.length === 0) return <Alert tone="warn" title="No slots available">There are no open {kind === "DELIVERY" ? "delivery" : "collection"} slots in the next week. Please try another store or check back soon.</Alert>;
  const day_ = days.find((d) => d.date === selectedDay) ?? days[0];
  return (
    <div>
      {data.zone && kind === "DELIVERY" && (
        <p className="mb-3 text-sm text-ink-2">Delivering from <strong>{data.branch.name}</strong> · {data.zone.name}.{" "}
          {data.zone.free_delivery_threshold && <>Free delivery over <span className="num">{money(data.zone.free_delivery_threshold)}</span>. </>}
          {Number(data.zone.min_order_value) > 0 && <>Minimum order <span className="num">{money(data.zone.min_order_value)}</span>.</>}
        </p>
      )}
      <div role="tablist" aria-label="Day" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2">
        {days.map((d) => (
          <button key={d.date} type="button" role="tab" aria-selected={d.date === day_.date} onClick={() => setDay(d.date)}
            className={cn("shrink-0 rounded-md border px-3.5 py-2 text-sm font-semibold", d.date === day_.date ? "border-primary bg-primary text-primary-fg" : "border-line-strong bg-white hover:bg-paper-2")}>
            {formatDate(d.date)}
          </button>
        ))}
      </div>
      <fieldset className="mt-2 grid gap-2 sm:grid-cols-2">
        <legend className="sr-only">Time slot on {formatDate(day_.date, "en-US", { weekday: "long", day: "numeric", month: "long" })}</legend>
        {day_.slots.map((s) => (
          <label key={s.id} className={cn("flex cursor-pointer items-center justify-between gap-3 rounded-md border bg-white p-3.5 has-[:checked]:border-primary has-[:checked]:bg-primary-soft", value === s.id ? "border-primary" : "border-line-strong")}>
            <span className="flex items-center gap-3">
              <input type="radio" name="slot" value={s.id} checked={value === s.id} onChange={() => onChange(s.id)} className="size-4 accent-[var(--color-primary)]" />
              <span><span className="num block font-semibold text-ink">{formatTimeRange(s.start_time, s.end_time)}</span>{s.scarce && <span className="block text-xs font-semibold text-warn">Only {s.remaining} left</span>}</span>
            </span>
            <span className="num text-sm font-semibold">{Number(s.fee) > 0 ? money(s.fee) : "Free"}</span>
          </label>
        ))}
      </fieldset>
    </div>
  );
}
