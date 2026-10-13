"use client";

import * as React from "react";
import { DataTable, FilterBar, FilterSelect, Pager, SearchField, type Column } from "@/components/admin/kit";
import { EmptyState } from "@/components/ui/states";
import { useAdminList } from "@/lib/admin";
import { useStoreDateTime } from "./format";
import { DemoBadge, Mono, OrderLink, OutcomeBadge } from "./parts";
import { EVENT_OUTCOMES, providerLabel, type FinanceUrl, type ProviderEventRow } from "./types";

const PAGE_SIZE = 100;

/** The webhook log, read-only. The API filters by outcome only, so the text box narrows the rows already on the page. */
export function EventsTab({ s, set }: { s: FinanceUrl; set: (patch: Partial<FinanceUrl>) => void }) {
  const when = useStoreDateTime({ seconds: true, compact: true });
  const page = Math.max(1, Number(s.epage) || 1);
  const list = useAdminList<ProviderEventRow>("/payments/events/", { outcome: s.outcome, page, page_size: PAGE_SIZE });
  const needle = s.eq.trim().toLowerCase();
  const rows = React.useMemo(
    () => (needle ? list.rows.filter((e) => [e.type, e.event_id, e.order ?? "", e.error, e.provider, e.outcome].some((v) => v.toLowerCase().includes(needle))) : list.rows),
    [list.rows, needle],
  );

  const columns: Column<ProviderEventRow>[] = [
    { key: "at", header: "Received", cell: (e) => <span className="whitespace-nowrap">{when(e.at)}</span> },
    { key: "provider", header: "Provider", hideBelow: "md", cell: (e) => <span className="flex flex-wrap items-center gap-2">{providerLabel(e.provider)}{e.provider === "demo" && <DemoBadge />}</span> },
    { key: "type", header: "Event type", cell: (e) => <Mono className="text-sm">{e.type}</Mono> },
    { key: "id", header: "Provider event id", hideBelow: "lg", cell: (e) => <Mono>{e.event_id}</Mono> },
    { key: "outcome", header: "Processed result", cell: (e) => <OutcomeBadge outcome={e.outcome} /> },
    { key: "error", header: "Detail", hideBelow: "md", cell: (e) => (e.error ? <span className="line-clamp-2 max-w-72">{e.error}</span> : <span className="text-ink-3">—</span>) },
    { key: "order", header: "Order", cell: (e) => (e.order ? <OrderLink number={e.order} /> : <span className="text-ink-3">No match</span>) },
  ];

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-ink-2">
        Every verified notification received from a payment provider, newest first. Each event is applied at most once; “Ignored” means it was valid but changed nothing (for example the payment had already moved on). This log is read-only and shows the 1,000 most recent events.
      </p>
      <FilterBar>
        <SearchField value={s.eq} onChange={(v) => set({ eq: v })} label="Filter events on this page" placeholder="Filter this page: type, event id, order…" />
        <FilterSelect label="Result" value={s.outcome} onChange={(v) => set({ outcome: v, epage: "1" })} options={EVENT_OUTCOMES} allLabel="All results" />
      </FilterBar>
      {needle && !list.isLoading && !list.error && <p className="text-sm text-ink-3" role="status">Showing {rows.length} of {list.rows.length} events on this page that match “{s.eq.trim()}”. The filter doesn&apos;t search other pages.</p>}

      <DataTable
        caption="Payment provider events, newest first"
        columns={columns}
        rows={rows}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        rowKey={(e) => e.id}
        dense
        empty={needle || s.outcome
          ? <EmptyState title="No events match">Try clearing the filter or choosing another result.</EmptyState>
          : <EmptyState title="No provider events yet">Events arrive when a payment provider notifies the shop about a payment or refund.</EmptyState>}
      />
      {!list.error && !list.isLoading && <Pager page={list.page} totalPages={list.totalPages} count={list.count} onPage={(p) => set({ epage: String(p) })} label="events" />}
    </div>
  );
}
