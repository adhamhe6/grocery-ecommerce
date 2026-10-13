"use client";

import { MessageCircleQuestion, RefreshCw, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { AdminPage } from "@/components/admin/kit";
import { RequireCapability } from "@/components/admin/shell";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Checkbox, Input } from "@/components/ui/field";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { adminRequest, useAdmin, useAdminAction, useAdminGet } from "@/lib/admin";
import { cn } from "@/lib/cn";
import { useMoney } from "@/lib/hooks";
import { POLICY_SHORT } from "./actions";
import { FulfilmentLabel, OrderStatusBadge, SlaBadge, useNow, useUrlParams, useZoneFormat } from "./shared";
import { slaFor } from "./sla";
import type { QueueResponse, QueueRow } from "./types";

const STAGES: { key: string; label: string; statuses: string[] | null }[] = [
  { key: "", label: "All", statuses: null },
  { key: "todo", label: "To pick", statuses: ["CONFIRMED"] },
  { key: "picking", label: "Picking", statuses: ["PICKING"] },
  { key: "packing", label: "Packing", statuses: ["PACKING"] },
  { key: "ready", label: "Ready", statuses: ["READY_FOR_PICKUP", "READY_FOR_DISPATCH"] },
  { key: "out", label: "Out for delivery", statuses: ["OUT_FOR_DELIVERY"] },
];
const REFRESH_MS = 30_000;

export function PickingQueuePage() {
  return <RequireCapability any={["orders.fulfil"]}><PickingQueueInner /></RequireCapability>;
}

function PickingQueueInner() {
  const { branchId } = useAdmin();
  const f = useZoneFormat();
  const now = useNow();
  const url = useUrlParams();
  const stage = url.get("stage");
  const date = url.get("date");
  const mine = url.get("mine") === "1";
  const q = useAdminGet<QueueResponse>("/orders/queue/", { date: date || undefined, mine: mine ? "true" : undefined, branch: branchId ?? undefined }, { refetchInterval: REFRESH_MS });

  const selected = STAGES.find((s) => s.key === stage) ?? STAGES[0];
  const counts = q.data?.counts ?? {};
  const stageCount = (s: (typeof STAGES)[number]) => (s.statuses ? s.statuses.reduce((n, st) => n + (counts[st] ?? 0), 0) : Object.values(counts).reduce((n, c) => n + c, 0));

  const groups = React.useMemo(
    () => (q.data?.groups ?? []).map((g) => ({ ...g, orders: g.orders.filter((o) => !selected.statuses || selected.statuses.includes(o.status)) })).filter((g) => g.orders.length > 0),
    [q.data, selected],
  );

  return (
    <AdminPage title="Picking queue" description="Orders that still need picking, packing or handing over, earliest delivery slot first. Refreshes every 30 seconds."
      actions={<Button variant="secondary" size="sm" onClick={() => q.refetch()} loading={q.isFetching && !q.isLoading}><RefreshCw className="size-4" aria-hidden />Refresh</Button>}>
      <div className="space-y-4">
        <div role="group" aria-label="Filter by stage" className="flex flex-wrap gap-2">
          {STAGES.map((s) => (
            <button key={s.key || "all"} type="button" aria-pressed={selected.key === s.key} onClick={() => url.set({ stage: s.key })}
              className={cn("inline-flex h-10 items-center gap-2 rounded-md border px-3 text-sm font-semibold transition-colors", selected.key === s.key ? "border-primary bg-primary text-primary-fg" : "border-line-strong bg-white text-primary hover:bg-paper-2")}>
              {s.label}<span className={cn("num rounded-full px-2 text-xs", selected.key === s.key ? "bg-white/20" : "bg-paper-2 text-ink-2")}>{q.data ? stageCount(s) : "–"}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <label className="flex items-center gap-2 text-sm"><span className="font-semibold text-ink-2">Slot date</span><Input type="date" className="h-10 w-auto text-sm" value={date} onChange={(e) => url.set({ date: e.target.value })} /></label>
          <Checkbox className="text-sm" label="Only orders assigned to me" checked={mine} onChange={(e) => url.set({ mine: e.target.checked ? "1" : null })} />
          {(date || mine) && <Button variant="ghost" size="sm" onClick={() => url.set({ date: null, mine: null })}>Clear filters</Button>}
        </div>
        {!date && <p className="text-xs text-ink-3">Showing everything due in the next two days, plus anything overdue. Pick a date to see a single day.</p>}
      </div>

      {q.error && !q.data ? <ErrorState error={q.error} onRetry={() => q.refetch()} title="We couldn't load the queue" />
        : !q.data ? <div aria-busy="true" className="space-y-4"><Skeleton className="h-40" /><Skeleton className="h-40" /></div>
        : groups.length === 0 ? (
          <div className="rounded-lg border border-line bg-white shadow-sm"><EmptyState title="Nothing to pick">{selected.statuses || date || mine ? "No orders match these filters." : "All caught up. New orders appear here as soon as they are paid for or confirmed."}</EmptyState></div>
        ) : (
          <div className="space-y-8">
            {groups.map((g) => {
              const key = g.slot_starts_at ?? "none";
              const late = g.orders.filter((o) => slaFor(o, now).level === "late").length;
              return (
                <section key={key} aria-labelledby={`slot-${key}`}>
                  <header className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h2 id={`slot-${key}`} className="text-xl">
                      {g.slot_starts_at && g.slot_ends_at ? `${f.dayLabel(g.slot_starts_at, now)}, ${f.slotWindow(g.slot_starts_at, g.slot_ends_at)}` : "No delivery slot"}
                    </h2>
                    <p className="text-sm text-ink-3">{g.orders.length} {g.orders.length === 1 ? "order" : "orders"}{late > 0 ? ` · ${late} late` : ""}</p>
                  </header>
                  <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {g.orders.map((o) => <li key={o.number}><QueueCard order={o} now={now} /></li>)}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
    </AdminPage>
  );
}

const CTA: Record<string, string> = {
  PICKING: "Continue picking", PACKING: "Pack order", READY_FOR_PICKUP: "Hand over", READY_FOR_DISPATCH: "Dispatch", OUT_FOR_DELIVERY: "Complete delivery",
};

function QueueCard({ order: o, now }: { order: QueueRow; now: number }) {
  const router = useRouter();
  const money = useMoney();
  const sla = slaFor(o, now);
  const href = `/admin/picking/${encodeURIComponent(o.number)}`;
  const start = useAdminAction((number: string) => adminRequest("POST", `/orders/${encodeURIComponent(number)}/start-picking/`), {
    invalidate: ["/orders"], onSuccess: (_d, number) => router.push(`/admin/picking/${encodeURIComponent(number)}`),
  });
  const pct = o.lines ? Math.round((o.lines_done / o.lines) * 100) : 0;
  const trackProgress = ["PICKING", "PACKING"].includes(o.status) || (o.status === "CONFIRMED" && o.lines_done > 0);

  return (
    <article className={cn("flex h-full flex-col rounded-lg border bg-white p-4 shadow-sm", sla.level === "late" ? "border-bad/50" : "border-line")} aria-label={`Order ${o.number}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link href={`/admin/orders/${encodeURIComponent(o.number)}`} className="font-semibold text-primary hover:underline">{o.number}</Link>
          <p className="truncate text-sm text-ink-2">{o.customer}</p>
        </div>
        <OrderStatusBadge status={o.status} label={o.status_label} />
      </div>
      <div className="mt-2"><SlaBadge sla={sla} /></div>
      <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-2">
        <FulfilmentLabel type={o.fulfilment_type} />
        <span className="num">{o.item_count ?? o.lines} {(o.item_count ?? o.lines) === 1 ? "item" : "items"}</span>
        <span className="num">{money(o.final_total ?? o.total)}</span>
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {o.substitution_policy === "CONTACT" && <Badge tone="warn">{POLICY_SHORT.CONTACT}</Badge>}
        {o.substitution_policy === "NONE" && <Badge tone="neutral">{POLICY_SHORT.NONE}</Badge>}
        {o.awaiting_customer && <Badge tone="warn"><MessageCircleQuestion className="size-3" aria-hidden />Awaiting customer</Badge>}
        {o.payment_method === "COD" && <Badge tone="neutral">Collect cash</Badge>}
      </div>
      {trackProgress && (
        <div className="mt-3">
          <div className="flex justify-between text-xs text-ink-2"><span>{o.lines_done} of {o.lines} lines</span><span className="num">{pct}%</span></div>
          <div role="progressbar" aria-label={`Lines picked on ${o.number}`} aria-valuemin={0} aria-valuemax={o.lines} aria-valuenow={o.lines_done} className="mt-1 h-2 overflow-hidden rounded-full bg-sand"><div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} /></div>
        </div>
      )}
      <p className="mt-3 flex items-center gap-1.5 text-sm text-ink-2"><UserRound className="size-4 shrink-0 text-ink-3" aria-hidden />{o.assigned_to ? <>Picker: <strong className="text-ink">{o.assigned_to}</strong></> : "Nobody assigned"}</p>
      <div className="mt-auto pt-4">
        {o.status === "CONFIRMED"
          ? <Button className="w-full" size="lg" loading={start.isPending} onClick={() => start.mutate(o.number)}>Start picking</Button>
          : <ButtonLink href={href} size="lg" className="w-full" variant={o.status === "PICKING" ? "primary" : "secondary"}>{CTA[o.status] ?? "Open"}</ButtonLink>}
      </div>
    </article>
  );
}
