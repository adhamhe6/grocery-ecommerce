"use client";

import Link from "next/link";
import * as React from "react";
import { RequireCapability } from "@/components/admin/shell";
import { AdminPage, Card, CsvButton, RankedBars, StatCard, StatusBadge, TrendChart } from "@/components/admin/kit";
import { Select } from "@/components/ui/field";
import { ErrorState, Skeleton } from "@/components/ui/states";
import { adminCsvUrl, daysAgo, isoDate, useAdmin, useAdminGet } from "@/lib/admin";
import { formatDate } from "@/lib/format";
import { useMoney } from "@/lib/hooks";

interface Kpis {
  orders: number; gross_sales: string; aov: string | null; discounts: string; refunds: string; settled_revenue: string; net_sales: string; completed_orders: number;
  change_pct: { orders: number | null; gross_sales: number | null; aov: number | null };
  pending_orders: number; cancelled_orders: number; payment_failures: number; active_products: number; low_stock_products: number; near_expiry_batches: number; expired_batches_on_hand: number;
  waste: { movements: number; value: string; units: string; unknown_cost_movements: number };
  slot_utilization_pct: number | null;
  fulfilment: { completed_deliveries: number; on_time_rate: number | null; avg_pick_to_ready_minutes: number | null };
}
interface DashboardData {
  period: { from: string; to: string; days: number };
  kpis: Kpis;
  sales_by_day: { date: string; orders: number; gross_sales: string }[];
  orders_by_status: { status: string; label: string; count: number }[];
  sales_by_category: { category: string; revenue: string }[];
  top_products: { product_id: number; name: string; unit: string; units: string; revenue: string }[];
  branch_performance: { branch: string; orders: number; gross_sales: string }[];
  stock_health: { total_lines: number; out_of_stock: number; low_stock: number; healthy: number };
  expiry_risk: { key: string; label: string; batches: number; quantity: string; value: string }[];
  waste_by_day: { date: string; units: string }[];
}

const RANGES: [string, string][] = [["7", "Last 7 days"], ["30", "Last 30 days"], ["90", "Last 90 days"]];

export function Dashboard() {
  return <RequireCapability any={["reports.read"]}><DashboardInner /></RequireCapability>;
}

function DashboardInner() {
  const money = useMoney();
  const { branchId, can } = useAdmin();
  const [range, setRange] = React.useState("30");
  const params = { from: daysAgo(Number(range) - 1), to: isoDate(new Date()), branch: branchId ?? undefined };
  const q = useAdminGet<DashboardData>("/dashboard/", params, { refetchInterval: 60_000 });
  const d = q.data;
  const k = d?.kpis;
  const short = (s: string) => formatDate(s, "en-US", { day: "numeric", month: "short" });

  return (
    <AdminPage title="Dashboard" description="Sales, fulfilment and stock health for the selected store and period. Figures use the metric definitions listed at the bottom of this page."
      actions={<><label className="flex items-center gap-2 text-sm"><span className="sr-only">Period</span><Select className="h-9 w-auto text-sm" value={range} onChange={(e) => setRange(e.target.value)}>{RANGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></label>
        {can("reports.export") && <CsvButton href={adminCsvUrl("/reports/sales/", params)} label="Sales CSV" />}</>}>
      {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !k || !d ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-28" />)}</div>
      ) : (
        <>
          <section aria-label="Key figures" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Gross sales" value={money(k.gross_sales)} delta={k.change_pct.gross_sales} hint="vs previous period" />
            <StatCard label="Orders" value={k.orders} delta={k.change_pct.orders} hint={`${k.completed_orders} completed`} />
            <StatCard label="Average order value" value={k.aov ? money(k.aov) : "—"} delta={k.change_pct.aov} hint="vs previous period" />
            <StatCard label="Net sales" value={money(k.net_sales)} hint={`after ${money(k.refunds)} refunds`} />
          </section>

          <section aria-label="Needs attention" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Link href="/admin/orders?open=1" className="block"><StatCard label="Open orders" value={k.pending_orders} hint="awaiting action" tone={k.pending_orders > 0 ? "warn" : "neutral"} /></Link>
            <Link href="/admin/payments?state=FAILED" className="block"><StatCard label="Payment failures" value={k.payment_failures} hint="in period" tone={k.payment_failures > 0 ? "bad" : "neutral"} /></Link>
            <Link href="/admin/inventory?low=1" className="block"><StatCard label="Low-stock lines" value={k.low_stock_products} hint="at or below threshold" tone={k.low_stock_products > 0 ? "warn" : "neutral"} /></Link>
            <Link href="/admin/inventory/batches" className="block"><StatCard label="Expiring ≤ 3 days" value={k.near_expiry_batches} hint={`${k.expired_batches_on_hand} expired on hand`} tone={k.expired_batches_on_hand > 0 ? "bad" : k.near_expiry_batches > 0 ? "warn" : "neutral"} /></Link>
          </section>

          <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
            <Card title="Gross sales by day">
              <TrendChart title="Gross sales by day" kind="bars" data={d.sales_by_day.map((r) => ({ label: short(r.date), value: Number(r.gross_sales) }))} format={(n) => money(n).replace(/\.00$/, "")} />
            </Card>
            <Card title="Orders by status">
              <ul className="divide-y divide-line text-sm">
                {d.orders_by_status.length === 0 && <li className="py-2 text-ink-3">No orders in this period.</li>}
                {d.orders_by_status.map((s) => <li key={s.status} className="flex items-center justify-between py-2"><StatusBadge status={s.status} label={s.label} /><span className="num font-semibold">{s.count}</span></li>)}
              </ul>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Top products by revenue">
              <RankedBars title="Top products" data={d.top_products.map((p) => ({ label: p.name, value: Number(p.revenue) }))} format={(n) => money(n)} />
            </Card>
            <Card title="Revenue by category">
              <RankedBars title="Revenue by category" data={d.sales_by_category.map((c) => ({ label: c.category, value: Number(c.revenue) }))} format={(n) => money(n)} />
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card title="Stock health">
              <dl className="num space-y-2 text-sm">
                <div className="flex justify-between"><dt>Healthy lines</dt><dd className="font-semibold text-ok">{d.stock_health.healthy}</dd></div>
                <div className="flex justify-between"><dt>Low stock</dt><dd className="font-semibold text-warn">{d.stock_health.low_stock}</dd></div>
                <div className="flex justify-between"><dt>Out of stock</dt><dd className="font-semibold text-bad">{d.stock_health.out_of_stock}</dd></div>
                <div className="flex justify-between border-t border-line pt-2"><dt>Tracked lines</dt><dd>{d.stock_health.total_lines}</dd></div>
              </dl>
            </Card>
            <Card title="Expiry risk">
              <ul className="divide-y divide-line text-sm">
                {d.expiry_risk.map((b) => <li key={b.key} className="flex items-center justify-between gap-3 py-2"><span>{b.label}</span><span className="num text-right"><span className="font-semibold">{b.batches} {b.batches === 1 ? "batch" : "batches"}</span><span className="block text-xs text-ink-3">{Number(b.value) > 0 ? `${money(b.value)} at cost` : "cost unknown or nil"}</span></span></li>)}
              </ul>
            </Card>
            <Card title="Fulfilment">
              <dl className="num space-y-2 text-sm">
                <div className="flex justify-between"><dt>On-time deliveries</dt><dd className="font-semibold">{k.fulfilment.on_time_rate != null ? `${k.fulfilment.on_time_rate}%` : "—"}</dd></div>
                <div className="flex justify-between"><dt>Avg pick → ready</dt><dd className="font-semibold">{k.fulfilment.avg_pick_to_ready_minutes != null ? `${k.fulfilment.avg_pick_to_ready_minutes} min` : "—"}</dd></div>
                <div className="flex justify-between"><dt>Slot utilisation</dt><dd className="font-semibold">{k.slot_utilization_pct != null ? `${k.slot_utilization_pct}%` : "—"}</dd></div>
                <div className="flex justify-between"><dt>Waste recorded</dt><dd className="font-semibold">{money(k.waste.value)}</dd></div>
                {k.waste.unknown_cost_movements > 0 && <p className="text-xs text-ink-3">{k.waste.unknown_cost_movements} waste entries have no unit cost and are excluded from the value.</p>}
              </dl>
            </Card>
          </div>

          {d.branch_performance.length > 1 && (
            <Card title="Store performance">
              <RankedBars title="Store performance" data={d.branch_performance.map((b) => ({ label: `${b.branch} · ${b.orders} orders`, value: Number(b.gross_sales) }))} format={(n) => money(n)} />
            </Card>
          )}

          <Card title="How these figures are defined">
            <ul className="list-disc space-y-1 pl-5 text-sm text-ink-2">
              <li><strong>Gross sales</strong> — the amount due on orders placed in the period that are accepted (confirmed through completed): the final weighed total once known, otherwise the estimated total, including delivery and tax. Unpaid, cancelled and failed-payment orders are excluded.</li>
              <li><strong>Net sales</strong> — gross value of orders <em>completed</em> in the period, minus refunds completed in the period.</li>
              <li><strong>Average order value</strong> — gross sales ÷ accepted orders.</li>
              <li><strong>Settled revenue</strong> (Reports → Sales) — payments captured or collected in the period minus refunds completed in the period (cash basis).</li>
              <li><strong>Waste value</strong> — units written off × the batch or movement unit cost; entries without a cost are counted separately.</li>
            </ul>
            <p className="mt-3 text-xs text-ink-3">Full definitions: <Link className="underline" href="/admin/reports">Reports</Link>. Period {d.period.from} → {d.period.to}. The dashboard refreshes every minute.</p>
          </Card>
        </>
      )}
    </AdminPage>
  );
}
