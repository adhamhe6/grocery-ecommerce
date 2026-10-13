"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { AdminPage, DataTable, FilterBar, FilterSelect, Pager, SearchField, StatusBadge, useDebouncedValue, type Column } from "@/components/admin/kit";
import { RequireCapability } from "@/components/admin/shell";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { useAdmin, useAdminList } from "@/lib/admin";
import { useMoney } from "@/lib/hooks";
import { parseMoney } from "./decimal";
import { useUrlParams, useZoneFormat } from "./shared";
import type { SupportCase } from "./types";

export const CASE_KIND_OPTIONS: [string, string][] = [
  ["MISSING", "Missing item"], ["DAMAGED", "Damaged / poor quality"], ["INCORRECT", "Incorrect item"], ["WEIGHT", "Weight / price query"], ["LATE", "Late delivery"], ["OTHER", "Other"],
];
export const CASE_STATUS_LABELS: Record<string, string> = { OPEN: "Open", IN_REVIEW: "In review", RESOLVED: "Resolved", REJECTED: "Rejected" };
export const RESOLUTION_LABELS: Record<string, string> = { NONE: "No action", REFUND: "Refund", REPLACEMENT: "Replacement", GOODWILL: "Goodwill refund" };

const STATUS_OPTIONS: [string, string][] = [["ALL", "Every status"], ["OPEN", "Open"], ["IN_REVIEW", "In review"], ["RESOLVED", "Resolved"], ["REJECTED", "Rejected"]];
const NEEDS_ACTION = "OPEN,IN_REVIEW";

export function CasesListPage() {
  return <RequireCapability any={["support.manage"]}><CasesListInner /></RequireCapability>;
}

function CasesListInner() {
  const { branchId } = useAdmin();
  const money = useMoney();
  const f = useZoneFormat();
  const router = useRouter();
  const url = useUrlParams();
  const status = url.get("status");
  const kind = url.get("kind");
  const page = Number(url.get("page")) || 1;
  const [text, setText] = React.useState(url.get("q"));
  const q = useDebouncedValue(text.trim());
  React.useEffect(() => {
    if (q !== url.get("q")) url.set({ q });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to the debounced text
  }, [q]);

  // No status chosen = the work queue (open + in review); “Every status” lifts the filter.
  const list = useAdminList<SupportCase>("/cases/", { status: status === "ALL" ? undefined : status || NEEDS_ACTION, kind: kind || undefined, q: q || undefined, branch: branchId ?? undefined, page }, { refetchInterval: 60_000 });
  const filtersActive = !!(status || kind || text);
  const clear = () => { setText(""); url.set({ status: null, kind: null, q: null }); };

  const columns: Column<SupportCase>[] = [
    { key: "id", header: "Case", className: "whitespace-nowrap", cell: (c) => <Link href={`/admin/cases/${c.id}`} className="font-semibold text-primary hover:underline" onClick={(e) => e.stopPropagation()}>#{c.id}</Link> },
    { key: "opened", header: "Opened", hideBelow: "md", className: "whitespace-nowrap", cell: (c) => f.dateTime(c.created_at) },
    { key: "order", header: "Order", className: "whitespace-nowrap", cell: (c) => <Link href={`/admin/orders/${encodeURIComponent(c.order_number)}`} className="text-primary hover:underline" onClick={(e) => e.stopPropagation()}>{c.order_number}</Link> },
    { key: "customer", header: "Customer", className: "hidden whitespace-nowrap xl:table-cell", cell: (c) => c.customer.name },
    { key: "kind", header: "Problem", cell: (c) => <span>{c.kind_label}{c.order_item && <span className="block text-xs text-ink-3">{c.order_item.name}</span>}</span> },
    { key: "status", header: "Status", cell: (c) => <StatusBadge status={c.status} label={CASE_STATUS_LABELS[c.status]} /> },
    { key: "outcome", header: "Outcome", hideBelow: "lg", cell: (c) => (c.status === "RESOLVED" ? <span>{RESOLUTION_LABELS[c.resolution]}{(parseMoney(c.refund_amount) ?? 0n) > 0n && <span className="block text-xs text-ink-3">{money(c.refund_amount)} {c.refund_status === "SUCCEEDED" ? "refunded" : "refund pending"}</span>}</span> : <span className="text-ink-3">—</span>) },
    { key: "handler", header: "Handled by", className: "hidden xl:table-cell", cell: (c) => c.handled_by ?? <span className="text-ink-3">—</span> },
  ];

  return (
    <AdminPage title="Support cases" description="Problems customers have reported with an order. Open and in-review cases are shown first by default.">
      <div className="space-y-4">
        <FilterBar>
          <SearchField value={text} onChange={setText} label="Search cases" placeholder="Order, customer, wording" />
          <FilterSelect label="Status" value={status} onChange={(v) => url.set({ status: v })} options={STATUS_OPTIONS} allLabel="Needs action" />
          <FilterSelect label="Problem" value={kind} onChange={(v) => url.set({ kind: v })} options={CASE_KIND_OPTIONS} />
          {filtersActive && <Button variant="ghost" size="sm" onClick={clear}>Clear filters</Button>}
        </FilterBar>
        <DataTable caption="Support cases" columns={columns} rows={list.rows} loading={list.isLoading} error={list.error} onRetry={() => list.refetch()} onRowClick={(c) => router.push(`/admin/cases/${c.id}`)}
          empty={<EmptyState title={filtersActive ? "No cases match these filters" : "No cases need attention"}>{filtersActive ? "Try a different status or problem type." : "Nothing is waiting for a decision right now."}</EmptyState>} />
        {!list.isLoading && !list.error && <Pager page={list.page} totalPages={list.totalPages} count={list.count} label={list.count === 1 ? "case" : "cases"} onPage={(p) => url.set({ page: String(p) })} />}
      </div>
    </AdminPage>
  );
}
