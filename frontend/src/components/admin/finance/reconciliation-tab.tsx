"use client";

import { CheckCircle2 } from "lucide-react";
import * as React from "react";
import { DataTable, StatCard, humanise, type Column } from "@/components/admin/kit";
import { Alert, ErrorState, Skeleton } from "@/components/ui/states";
import { useAdminGet } from "@/lib/admin";
import { useStore } from "@/lib/hooks";
import { todayIn } from "@/components/admin/reports/date-ranges";
import { formatInZone, useMoneyIn } from "./format";
import { DateFilter, DemoBadge, OrderLink } from "./parts";
import { DISCREPANCY_INFO, providerLabel, type FinanceUrl, type Reconciliation } from "./types";

type Discrepancy = Reconciliation["discrepancies"][number];
type ProviderRow = Reconciliation["by_provider"][number];

export function ReconciliationTab({ s, set }: { s: FinanceUrl; set: (patch: Partial<FinanceUrl>) => void }) {
  const store = useStore();
  const money = useMoneyIn();
  const today = React.useMemo(() => todayIn(store.timezone), [store.timezone]);
  const date = s.rdate || today;
  const q = useAdminGet<Reconciliation>("/finance/reconciliation/", { date });
  const d = q.data;

  const providerCols: Column<ProviderRow>[] = [
    { key: "provider", header: "Provider", cell: (r) => <span className="flex flex-wrap items-center gap-2">{providerLabel(r.provider)}{r.provider === "demo" && <DemoBadge />}</span> },
    { key: "method", header: "Method", cell: (r) => r.method },
    { key: "payments", header: "Payments captured", align: "right", cell: (r) => r.payments },
    { key: "captured", header: "Amount captured", align: "right", cell: (r) => money(r.captured) },
  ];
  const discCols: Column<Discrepancy>[] = [
    { key: "type", header: "Problem", cell: (r) => <span className="font-semibold">{DISCREPANCY_INFO[r.type]?.label ?? humanise(r.type)}</span> },
    { key: "scope", header: "Covers", hideBelow: "md", cell: (r) => (DISCREPANCY_INFO[r.type]?.scope === "day" ? "Selected day" : DISCREPANCY_INFO[r.type]?.scope === "open" ? "All dates (open item)" : "—") },
    { key: "order", header: "Order", cell: (r) => <OrderLink number={r.order} /> },
    { key: "detail", header: "Detail", cell: (r) => <span className="max-w-md">{r.detail}</span> },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-3xl text-sm text-ink-2">
          Does the money add up? For one day this compares what payments captured with what the matching orders say, and lists every open item that needs a person. Nothing here changes any data.
        </p>
        <div className="flex items-center gap-2">
          <DateFilter label="Day" value={date} max={today} onChange={(v) => set({ rdate: v })} />
          {date !== today && <button type="button" className="rounded-md px-2 py-1 text-sm font-semibold text-primary underline-offset-4 hover:underline" onClick={() => set({ rdate: "" })}>Today</button>}
        </div>
      </div>

      {q.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-3" aria-busy="true">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : q.error || !d ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} title="We couldn't run the reconciliation" />
      ) : (
        <>
          <div role="status">
            {d.ok
              ? <Alert tone="ok" title={`Nothing to flag for ${formatInZone(d.date, store.locale, store.timezone, { dateOnly: true })}`}>Captured amounts match the orders and there are no open refunds or stale authorisations.</Alert>
              : <Alert tone="warn" title={`${d.discrepancies.length} ${d.discrepancies.length === 1 ? "item needs" : "items need"} attention`}>Review the list below. Items marked “open item” are not limited to the selected day.</Alert>}
          </div>

          <section aria-label="Totals for the day" className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Captured / collected" value={money(d.captured_total)} hint="payments captured on this day, before refunds" />
            <StatCard label="Refunded" value={money(d.refunded_total)} hint="refunds completed on this day" />
            <StatCard label="Net" value={money(d.net)} hint="captured minus refunded" />
          </section>

          <section aria-labelledby="rec-providers" className="space-y-2">
            <h3 id="rec-providers" className="font-sans text-base font-bold text-ink">Captured by provider</h3>
            <DataTable caption="Amount captured on the selected day, by provider and method" columns={providerCols} rows={d.by_provider} rowKey={(r) => `${r.provider}-${r.method}`}
              empty={<p className="px-4 py-6 text-center text-sm text-ink-2">No payments were captured or collected on this day.</p>} />
            {d.by_provider.some((r) => r.provider === "demo") && (
              <p className="flex items-center gap-2 text-sm text-ink-2"><DemoBadge />Demo sandbox amounts are simulated test payments. They are included in the totals above but no real money was taken.</p>
            )}
          </section>

          <section aria-labelledby="rec-items" className="space-y-2">
            <h3 id="rec-items" className="font-sans text-base font-bold text-ink">Items needing attention</h3>
            {d.discrepancies.length === 0 ? (
              <p className="flex items-center gap-2 rounded-lg border border-line bg-white px-4 py-5 text-sm text-ink-2"><CheckCircle2 className="size-5 text-ok" aria-hidden /> No discrepancies found.</p>
            ) : (
              <DataTable caption="Discrepancies found by the reconciliation" columns={discCols} rows={d.discrepancies} rowKey={(r, i) => `${r.type}-${r.order}-${i}`} />
            )}
          </section>

          <details className="rounded-lg border border-line bg-white p-4 text-sm text-ink-2">
            <summary className="cursor-pointer font-semibold text-ink">What each check means</summary>
            <ul className="mt-3 list-disc space-y-1.5 pl-5">
              {Object.values(DISCREPANCY_INFO).map((i) => <li key={i.label}><strong>{i.label}.</strong> {i.help}</li>)}
            </ul>
            <p className="mt-3 text-xs text-ink-3">A “day” is a calendar day in the server&apos;s time zone (configured on the server, UTC unless changed), which may differ from the store&apos;s time zone. The API offers one day at a time and no CSV export.</p>
          </details>
        </>
      )}
    </div>
  );
}
