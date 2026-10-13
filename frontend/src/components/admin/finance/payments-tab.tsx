"use client";

import * as React from "react";
import { DataTable, FilterBar, FilterSelect, Pager, SearchField, useDebouncedValue, type Column } from "@/components/admin/kit";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { useAdmin, useAdminList } from "@/lib/admin";
import { useMoneyIn, useStoreDateTime } from "./format";
import { DateFilter, OrderLink, PaymentStateBadge, ProviderCell } from "./parts";
import { PaymentDrawer } from "./payment-drawer";
import { PAYMENT_STATES, PROVIDERS, type FinanceUrl, type PaymentRow } from "./types";

export function PaymentsTab({ s, set }: { s: FinanceUrl; set: (patch: Partial<FinanceUrl>) => void }) {
  const { branches, perms } = useAdmin();
  const money = useMoneyIn();
  const when = useStoreDateTime({ compact: true });
  const q = useDebouncedValue(s.q);
  const [open, setOpen] = React.useState<number | null>(null);
  const page = Math.max(1, Number(s.page) || 1);
  const list = useAdminList<PaymentRow>("/payments/", { state: s.state, provider: s.provider, date_from: s.from, date_to: s.to, search: q.trim(), page });
  const filtered = !!(s.q || s.state || s.provider || s.from || s.to);
  const multiStore = perms.branch_scope.global || branches.length > 1;

  // A shared link may carry several states (?state=FAILED,CANCELLED): keep the drop-down honest about what is applied.
  const stateOptions = React.useMemo<[string, string][]>(() => {
    if (!s.state || PAYMENT_STATES.some(([v]) => v === s.state)) return PAYMENT_STATES;
    return [...PAYMENT_STATES, [s.state, s.state.split(",").map((x) => PAYMENT_STATES.find(([v]) => v === x)?.[1] ?? x).join(" or ")]];
  }, [s.state]);

  const columns: Column<PaymentRow>[] = [
    { key: "order", header: "Order", cell: (r) => <div className="flex flex-col"><OrderLink number={r.order} /><span className="whitespace-nowrap text-xs text-ink-3">Attempt {r.attempt}{multiStore ? ` · ${r.branch}` : ""}</span></div> },
    { key: "provider", header: "Provider / mode", cell: (r) => <ProviderCell p={r} /> },
    { key: "state", header: "State", cell: (r) => <PaymentStateBadge state={r.state} label={r.state_label} /> },
    { key: "amount", header: "Authorised", align: "right", cell: (r) => money(r.amount, r.currency) },
    { key: "captured", header: "Captured", align: "right", cell: (r) => money(r.captured, r.currency) },
    { key: "refunded", header: "Refunded", align: "right", cell: (r) => (Number(r.refunded) > 0 ? money(r.refunded, r.currency) : <span className="text-ink-3">—</span>) },
    { key: "created", header: "Created", cell: (r) => <span className="whitespace-nowrap">{when(r.created_at)}</span> },
    { key: "open", header: "Details", cell: (r) => <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setOpen(r.id); }} aria-label={`Open payment details for order ${r.order}`}>Open</Button> },
  ];

  return (
    <div className="space-y-4">
      <FilterBar>
        <SearchField value={s.q} onChange={(v) => set({ q: v, page: "1" })} label="Search payments" placeholder="Order number, provider reference or email" />
        <FilterSelect label="State" value={s.state} onChange={(v) => set({ state: v, page: "1" })} options={stateOptions} allLabel="All states" />
        <FilterSelect label="Provider" value={s.provider} onChange={(v) => set({ provider: v, page: "1" })} options={PROVIDERS} allLabel="All providers" />
        <DateFilter label="From" value={s.from} max={s.to || undefined} onChange={(v) => set({ from: v, page: "1" })} />
        <DateFilter label="To" value={s.to} min={s.from || undefined} onChange={(v) => set({ to: v, page: "1" })} />
        {filtered && <Button variant="ghost" size="sm" onClick={() => set({ q: "", state: "", provider: "", from: "", to: "", page: "1" })}>Clear filters</Button>}
      </FilterBar>
      <p className="text-sm text-ink-3">“Authorised” is the most that may be charged (for cash on delivery, the amount to collect). Dates filter by when the payment was created. Payments from every store you can access are listed; the store switcher doesn&apos;t narrow this page.</p>

      <DataTable
        caption="Payments, newest first"
        columns={columns}
        rows={list.rows}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        onRowClick={(r) => setOpen(r.id)}
        empty={filtered
          ? <EmptyState title="No payments match these filters" action={<Button variant="secondary" onClick={() => set({ q: "", state: "", provider: "", from: "", to: "", page: "1" })}>Clear filters</Button>}>Try a different state, provider or date range.</EmptyState>
          : <EmptyState title="No payments yet">Payments appear here as soon as customers start paying for orders.</EmptyState>}
      />
      {!list.error && !list.isLoading && <Pager page={list.page} totalPages={list.totalPages} count={list.count} onPage={(p) => set({ page: String(p) })} label="payments" />}
      <PaymentDrawer paymentId={open} onClose={() => setOpen(null)} />
    </div>
  );
}
