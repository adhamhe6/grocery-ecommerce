"use client";

import Link from "next/link";
import * as React from "react";
import { AdminPage, Card, CsvButton, KeyValue, RankedBars, StatCard, TrendChart } from "@/components/admin/kit";
import { useUrlState } from "@/components/admin/finance/url-state";
import { RequireCapability } from "@/components/admin/shell";
import { Alert, EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { ApiError } from "@/lib/api";
import { adminCsvUrl, useAdmin, useAdminGet } from "@/lib/admin";
import { formatDate } from "@/lib/format";
import { useMoney, useStore } from "@/lib/hooks";
import { checkRange, daysBetween, fillDays, presetRange, RANGE_PRESETS, todayIn, type RangePreset } from "./date-ranges";
import { DefinitionsPanel } from "./definitions-panel";
import { RangePicker, type RangeState } from "./range-picker";
import { buildChart, summaryItems, type ReportColumn, type ReportRow } from "./report-format";
import { REPORT_NOTES } from "./report-meta";
import { NoRows, ReportTable } from "./report-table";

interface ReportData {
  key: string;
  title: string;
  period: { from: string; to: string; days: number };
  columns: ReportColumn[];
  rows: ReportRow[];
  summary?: Record<string, unknown>;
}

export function ReportPage({ name }: { name: string }) {
  return (
    <RequireCapability any={["reports.read"]}>
      <React.Suspense fallback={<div className="space-y-4" aria-busy="true"><Skeleton className="h-10 w-64" /><Skeleton className="h-64 w-full" /></div>}>
        <ReportInner name={name} />
      </React.Suspense>
    </RequireCapability>
  );
}

function ReportInner({ name }: { name: string }) {
  const store = useStore();
  const money = useMoney();
  const { branchId, branchName, can, perms } = useAdmin();
  const note = REPORT_NOTES[name];
  const today = React.useMemo(() => todayIn(store.timezone), [store.timezone]);
  const [u, setU] = useUrlState({ range: "", from: "", to: "" });

  // A link with ?from=…&to=… (and no preset) is a custom range; otherwise default to the last 30 days.
  const preset: RangePreset = RANGE_PRESETS.some((p) => p.key === u.range) ? (u.range as RangePreset) : u.from || u.to ? "custom" : "30d";
  const range: RangeState = preset === "custom"
    ? { preset, from: u.from || presetRange("30d", today).from, to: u.to || today }
    : { preset, ...presetRange(preset, today) };
  const valid = checkRange(range.from, range.to).ok;

  const titles = useAdminGet<{ key: string; title: string }[]>("/reports/");
  const title = titles.data?.find((r) => r.key === name)?.title;
  const params = { from: range.from, to: range.to, branch: branchId ?? undefined };
  const q = useAdminGet<ReportData>(`/reports/${encodeURIComponent(name)}/`, params, { enabled: valid });
  const data = q.data;
  const notFound = q.error instanceof ApiError && q.error.status === 404;

  const fmt = React.useMemo(() => ({ money: (v: string | number) => money(v), locale: store.locale }), [money, store.locale]);
  const summary = React.useMemo(() => (data ? summaryItems(name, data.summary, fmt) : null), [data, name, fmt]);
  const chart = React.useMemo(() => (data ? buildChart(name, data.rows) : null), [data, name]);
  const short = (d: string) => formatDate(d, store.locale, { day: "numeric", month: "short" });
  const tick = (n: number) => money(n).replace(/\.00$/, "");
  const scope = branchId ? branchName(branchId) : perms.branch_scope.global ? "All stores" : "All your stores";
  const ignoresPeriod = !!note?.ignoresPeriod;

  const setRange = (v: RangeState) => setU(v.preset === "custom" ? { range: "custom", from: v.from, to: v.to } : { range: v.preset, from: "", to: "" });

  if (notFound) {
    return (
      <AdminPage title="Report not found">
        <EmptyState title={`There is no report called “${name}”`} action={<Link className="font-semibold text-primary underline" href="/admin/reports">Back to all reports</Link>}>It may have been renamed. Pick a report from the list.</EmptyState>
      </AdminPage>
    );
  }

  return (
    <AdminPage
      title={title ?? data?.title ?? "Report"}
      description={note?.blurb}
      actions={<>
        <Link href="/admin/reports" className="inline-flex h-9 items-center rounded-md px-3 text-sm font-semibold text-primary underline-offset-4 hover:underline">All reports</Link>
        {can("reports.export") && <CsvButton href={adminCsvUrl(`/reports/${encodeURIComponent(name)}/`, params)} label="Export CSV" />}
      </>}
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        {ignoresPeriod ? (
          <Alert tone="info" className="max-w-xl">This report is a snapshot of the stock on hand now, so a date range doesn&apos;t apply.</Alert>
        ) : (
          <RangePicker today={today} value={range} onChange={setRange} />
        )}
        <p className="text-sm text-ink-2">
          <span className="font-semibold">Store:</span> {note?.ignoresStore ? "all suppliers (the store switcher doesn't apply)" : scope}
          {valid && !ignoresPeriod && <> · <span className="num">{formatDate(range.from, store.locale, { day: "numeric", month: "short", year: "numeric" })} – {formatDate(range.to, store.locale, { day: "numeric", month: "short", year: "numeric" })}</span> ({daysBetween(range.from, range.to)} {daysBetween(range.from, range.to) === 1 ? "day" : "days"})</>}
        </p>
      </div>

      {!valid ? (
        <EmptyState title="Choose a valid date range">Pick a start date that is on or before the end date to run this report.</EmptyState>
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} title="We couldn't run this report" />
      ) : q.isLoading || !data || !summary ? (
        <div className="space-y-4" aria-busy="true" aria-label="Loading report">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-28" />)}</div>
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <>
          {summary.items.some((i) => i.primary) && (
            <section aria-label="Totals" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {summary.items.filter((i) => i.primary).map((i) => <StatCard key={i.key} label={i.label} value={i.text} hint={i.hint} />)}
            </section>
          )}
          {summary.items.some((i) => !i.primary) && (
            <Card title={summary.items.some((i) => i.primary) ? "More totals" : "Totals"}>
              <KeyValue columns={3} items={summary.items.filter((i) => !i.primary).map((i) => [i.label, <span key={i.key} className="num">{i.text}{i.hint && <span className="ml-1 text-xs text-ink-3">({i.hint})</span>}</span>] as [string, React.ReactNode])} />
            </Card>
          )}
          {summary.distributions.map((d) => (
            <Card key={d.key} title={d.label}>
              <RankedBars title={d.label} data={d.entries} format={(n) => String(n)} />
            </Card>
          ))}

          {chart && (
            <Card title={chart.title}>
              {chart.type === "trend"
                ? <TrendChart title={chart.title} data={fillDays(chart.points, data.period.from, data.period.to).map((p) => ({ label: short(p.date), value: p.value }))} format={tick} />
                : <RankedBars title={chart.title} data={chart.points} format={(n) => money(n)} />}
            </Card>
          )}

          {note?.rowCap && data.rows.length >= note.rowCap && (
            <Alert tone="warn" title={`This report is limited to ${note.rowCap.toLocaleString(store.locale)} rows${name === "refunds" ? " per section" : ""}`}>
              Some rows may be missing, and the CSV export has the same limit. Use a shorter period or pick a single store to see the rest.
            </Alert>
          )}

          <ReportTable caption={`${data.title}: ${data.rows.length} rows`} columns={data.columns} rows={data.rows} format={fmt} empty={<NoRows />} />
        </>
      )}

      <DefinitionsPanel reportKey={name} />
    </AdminPage>
  );
}
