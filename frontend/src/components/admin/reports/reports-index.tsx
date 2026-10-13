"use client";

import { BarChart3, ChevronRight } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { AdminPage } from "@/components/admin/kit";
import { RequireCapability } from "@/components/admin/shell";
import { Badge } from "@/components/ui/badge";
import { ErrorState, Skeleton } from "@/components/ui/states";
import { useAdminGet } from "@/lib/admin";
import { DefinitionsPanel } from "./definitions-panel";
import { REPORT_NOTES } from "./report-meta";

export function ReportsIndex() {
  return (
    <RequireCapability any={["reports.read"]}>
      <ReportsInner />
    </RequireCapability>
  );
}

function ReportsInner() {
  const q = useAdminGet<{ key: string; title: string }[]>("/reports/");
  return (
    <AdminPage title="Reports" description="Detailed tables for sales, products, stock, suppliers, refunds and delivery. Choose a period and a store on each report, and export it as CSV if your role allows it.">
      {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} title="We couldn't load the report list" />
        : q.isLoading ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-28" />)}</div>
        : (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {(q.data ?? []).map((r) => {
              const note = REPORT_NOTES[r.key];
              return (
                <li key={r.key}>
                  <Link href={`/admin/reports/${encodeURIComponent(r.key)}`} className="group flex h-full flex-col rounded-lg border border-line bg-white p-4 shadow-sm transition-colors hover:border-line-strong hover:bg-paper/70">
                    <span className="flex items-start justify-between gap-2">
                      <span className="flex items-center gap-2 font-sans text-base font-bold text-ink"><BarChart3 className="size-4 shrink-0 text-accent" aria-hidden />{r.title}</span>
                      <ChevronRight className="mt-0.5 size-4 shrink-0 text-ink-3 transition-transform group-hover:translate-x-0.5" aria-hidden />
                    </span>
                    {note && <span className="mt-2 text-sm text-ink-2">{note.blurb}</span>}
                    {(note?.ignoresPeriod || note?.ignoresStore) && (
                      <span className="mt-3 flex flex-wrap gap-1.5">
                        {note.ignoresPeriod && <Badge>Current stock — no date range</Badge>}
                        {note.ignoresStore && <Badge>All suppliers — not per store</Badge>}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      {!q.isLoading && !q.error && (q.data ?? []).length === 0 && <p className="text-sm text-ink-2">No reports are available.</p>}
      <DefinitionsPanel />
    </AdminPage>
  );
}
