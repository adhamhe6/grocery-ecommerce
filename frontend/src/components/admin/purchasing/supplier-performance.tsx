"use client";

import * as React from "react";
import { Card, StatCard } from "@/components/admin/kit";
import { Select } from "@/components/ui/field";
import { ErrorState, Skeleton } from "@/components/ui/states";
import { daysAgo, useAdminGet } from "@/lib/admin";
import { HelpPopover } from "./badges";
import type { SupplierPerformance } from "./types";

const PERIODS: [string, string][] = [["", "All time"], ["30", "Last 30 days"], ["90", "Last 90 days"], ["365", "Last 12 months"]];

/** The definitions below restate `supplier_performance()` in backend/apps/purchasing/services.py, line for line. */
export function MetricDefinitions() {
  return (
    <dl className="space-y-2">
      <div><dt className="font-semibold text-ink">Orders</dt><dd>Purchase orders that have been submitted. Drafts and cancelled orders are left out. With a period selected, only orders submitted on or after its start date count.</dd></div>
      <div><dt className="font-semibold text-ink">Receipts</dt><dd>Goods receipts recorded against those orders. A partial delivery is one receipt.</dd></div>
      <div><dt className="font-semibold text-ink">Fill rate</dt><dd>Units received ÷ units ordered, across every line of those orders, as a percentage. Orders still waiting for their delivery count as ordered but not received, so the rate rises as deliveries are recorded.</dd></div>
      <div><dt className="font-semibold text-ink">On-time rate</dt><dd>The share of receipts recorded on or before the order’s expected date. It counts receipts, not orders, and a receipt against an order with no expected date counts as late. Dates are compared in UTC.</dd></div>
      <div><dt className="font-semibold text-ink">Rejection rate</dt><dd>Units rejected on receipt ÷ (units received + units rejected), as a percentage.</dd></div>
      <p className="text-xs text-ink-3">Every figure is measured from recorded receipts only. When there is nothing to measure it shows a dash rather than zero.</p>
    </dl>
  );
}

export function SupplierPerformanceCard({ supplierId }: { supplierId: number }) {
  const [period, setPeriod] = React.useState("");
  const since = period ? daysAgo(Number(period)) : undefined;
  const q = useAdminGet<SupplierPerformance>(`/suppliers/${supplierId}/performance/`, { since });
  const d = q.data;
  const pct = (v: string | null | undefined) => (v == null ? "—" : `${v}%`);
  return (
    <Card title="Performance" actions={
      <>
        <label className="flex items-center gap-2 text-sm"><span className="sr-only">Period</span>
          <Select className="h-9 w-auto text-sm" value={period} onChange={(e) => setPeriod(e.target.value)}>{PERIODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
        </label>
        <HelpPopover label="How performance is measured" title="How these figures are measured"><MetricDefinitions /></HelpPopover>
      </>
    }>
      {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} title="We couldn't load performance" /> : !d ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard label="On-time rate" value={pct(d.on_time_rate)} hint={d.receipts ? "of receipts on or before the expected date" : "no receipts yet"} />
            <StatCard label="Fill rate" value={pct(d.fill_rate)} hint={d.orders ? "units received ÷ units ordered" : "no submitted orders yet"} />
            <StatCard label="Rejection rate" value={pct(d.rejection_rate)} hint={d.rejection_rate == null ? "nothing received yet" : "of units delivered"} />
            <StatCard label="Orders" value={d.orders} hint="submitted, not draft or cancelled" />
            <StatCard label="Receipts" value={d.receipts} hint="deliveries recorded" />
          </div>
          <p className="mt-3 text-xs text-ink-3">Measured from recorded receipts only. A dash means there is nothing to measure yet. Use the ? button for exact definitions.</p>
        </>
      )}
    </Card>
  );
}
