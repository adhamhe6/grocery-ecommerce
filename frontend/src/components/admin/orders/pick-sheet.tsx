"use client";

import { Layers, Scale, Snowflake, Thermometer } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { AdminPage, Card } from "@/components/admin/kit";
import { RequireCapability } from "@/components/admin/shell";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/field";
import { Alert, ErrorState, Skeleton } from "@/components/ui/states";
import { useAdminGet } from "@/lib/admin";
import { ApiError } from "@/lib/api";
import { useMoney } from "@/lib/hooks";
import { cn } from "@/lib/cn";
import { groupByZone, pickProgress, POLICY_LABELS, STORAGE_LABELS } from "./actions";
import { DecideDialog, RemoveLineDialog, SubstituteDialog, UnavailableDialog } from "./line-dialogs";
import { OrderActions } from "./order-actions";
import { PickLine } from "./pick-line";
import { BackLink, FulfilmentLabel, OrderStatusBadge, SlaBadge, orderPath, useNow, useOrderApi, useZoneFormat } from "./shared";
import { slaFor } from "./sla";
import type { OrderDetail, StaffItem, SubstitutionRow } from "./types";

export function PickSheetPage({ number }: { number: string }) {
  return <RequireCapability any={["orders.fulfil"]}><PickSheetInner number={number} /></RequireCapability>;
}

const ZONE_ICON = { AMBIENT: Layers, CHILLED: Thermometer, FROZEN: Snowflake } as const;
const ZONE_HINT = { AMBIENT: "Shelves and cupboard items", CHILLED: "Keep cold — pick near the end", FROZEN: "Keep frozen — pick last" } as const;

function PickSheetInner({ number }: { number: string }) {
  const q = useAdminGet<OrderDetail>(orderPath(number), {}, { refetchInterval: 30_000 });
  const order = q.data;
  if (q.error && !order) {
    const notFound = q.error instanceof ApiError && q.error.status === 404;
    return <AdminPage title={`Pick ${number}`}><BackLink href="/admin/picking">Picking queue</BackLink><ErrorState error={q.error} onRetry={() => q.refetch()} title={notFound ? "We couldn't find that order" : "We couldn't load this order"} /></AdminPage>;
  }
  if (!order) return <AdminPage title={`Pick ${number}`}><div aria-busy="true" className="space-y-3"><Skeleton className="h-16" /><Skeleton className="h-48" /><Skeleton className="h-48" /></div></AdminPage>;
  return <PickSheet order={order} stale={!!q.error} />;
}

function PickSheet({ order, stale }: { order: OrderDetail; stale: boolean }) {
  const f = useZoneFormat();
  const money = useMoney();
  const now = useNow();
  const call = useOrderApi(order.number);
  const progress = pickProgress(order.items);
  const zones = React.useMemo(() => groupByZone(order.items), [order.items]);
  const [onlyOpen, setOnlyOpen] = React.useState(false);
  const [flagged, setFlagged] = React.useState<Set<number>>(new Set());
  const [failure, setFailure] = React.useState<unknown>(null);
  const [unavailable, setUnavailable] = React.useState<StaffItem | null>(null);
  const [substituting, setSubstituting] = React.useState<StaffItem | null>(null);
  const [removing, setRemoving] = React.useState<StaffItem | null>(null);
  const [deciding, setDeciding] = React.useState<SubstitutionRow | null>(null);

  const sla = slaFor(order, now);
  const picking = order.status === "PICKING";
  const closed = ["COMPLETED", "CANCELLED", "PAYMENT_FAILED"].includes(order.status);
  const counts = {
    chilled: order.items.filter((i) => i.storage === "CHILLED" && !["REMOVED", "SUBSTITUTED"].includes(i.status)).length,
    frozen: order.items.filter((i) => i.storage === "FROZEN" && !["REMOVED", "SUBSTITUTED"].includes(i.status)).length,
    weighed: order.items.filter((i) => i.is_variable_weight && !["REMOVED", "SUBSTITUTED"].includes(i.status)).length,
  };

  const clearFlag = (id: number) => setFlagged((s) => { if (!s.has(id)) return s; const n = new Set(s); n.delete(id); return n; });
  const handlers = { onUnavailable: setUnavailable, onSubstitute: setSubstituting, onRemove: setRemoving, onDecide: setDeciding };

  // After a refused "Finish picking" the API lists the lines it objected to; mark them and bring the first into view.
  const onFailure = (_a: unknown, err: unknown) => {
    setFailure(err);
    const ids = err instanceof ApiError && Array.isArray(err.details?.item_ids) ? (err.details.item_ids as number[]) : [];
    setFlagged(new Set(ids));
    if (ids.length) window.setTimeout(() => document.getElementById(`line-${ids[0]}`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 50);
  };

  return (
    <AdminPage title={`Pick ${order.number}`} description={`${order.customer} · ${order.fulfilment_type === "DELIVERY" ? "delivery" : "pickup"} · ${order.branch}`}>
      <div className="-mt-2">
        <BackLink href="/admin/picking">Picking queue</BackLink>
        <span className="mx-2 text-ink-3" aria-hidden>·</span>
        <Link href={`/admin/orders/${encodeURIComponent(order.number)}`} className="text-sm font-semibold text-primary hover:underline">Full order details</Link>
      </div>

      {/* Status strip: stays in view while scrolling the lines */}
      <section aria-label="Order summary" className="sticky top-14 z-20 -mx-4 border-b border-line bg-paper/95 px-4 py-3 backdrop-blur lg:-mx-8 lg:px-8">
        <div className="flex flex-wrap items-center gap-2">
          <OrderStatusBadge status={order.status} label={order.status_label} />
          {!closed && <SlaBadge sla={sla} />}
          {order.slot_starts_at && order.slot_ends_at && <span className="text-sm text-ink-2">Slot {f.slotDay(order.slot_starts_at)}, {f.slotWindow(order.slot_starts_at, order.slot_ends_at)}</span>}
          <span className="ml-auto text-sm text-ink-2"><FulfilmentLabel type={order.fulfilment_type} /></span>
        </div>
        {picking && (
          <div className="mt-2.5">
            <div className="flex items-baseline justify-between text-sm"><span className="font-semibold text-ink" aria-live="polite">{progress.done} of {progress.total} lines picked</span><span className="num text-ink-3">{progress.percent}%</span></div>
            <div role="progressbar" aria-label="Lines picked" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done} aria-valuetext={`${progress.done} of ${progress.total} lines picked`} className="mt-1 h-2.5 overflow-hidden rounded-full bg-sand">
              <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${progress.percent}%` }} />
            </div>
          </div>
        )}
      </section>

      <div className="max-w-3xl space-y-6">
      {stale && <Alert tone="warn" title="Couldn't refresh">Showing the last version we loaded. Your next action will use the latest data.</Alert>}

      {(counts.chilled > 0 || counts.frozen > 0 || counts.weighed > 0 || order.substitution_policy !== "ALLOW" || order.customer_note) && (
        <Card title="Before you start">
          <div className="flex flex-wrap gap-2">
            {counts.chilled > 0 && <Badge tone="info"><Thermometer className="size-3" aria-hidden />{counts.chilled} chilled {counts.chilled === 1 ? "line" : "lines"}</Badge>}
            {counts.frozen > 0 && <Badge tone="info"><Snowflake className="size-3" aria-hidden />{counts.frozen} frozen {counts.frozen === 1 ? "line" : "lines"}</Badge>}
            {counts.weighed > 0 && <Badge tone="neutral"><Scale className="size-3" aria-hidden />{counts.weighed} weighed {counts.weighed === 1 ? "line" : "lines"}</Badge>}
            <Badge tone={order.substitution_policy === "ALLOW" ? "neutral" : "warn"}>{POLICY_LABELS[order.substitution_policy]}</Badge>
          </div>
          {order.customer_note && <p className="mt-3 text-sm"><strong>Customer note:</strong> <span className="whitespace-pre-wrap">{order.customer_note}</span></p>}
        </Card>
      )}

      {order.awaiting_customer && picking && <Alert tone="warn" title="A replacement is waiting for the customer's answer">You can keep picking other lines, but picking can&apos;t be finished until they answer.</Alert>}
      {failure != null && <Alert tone="bad" title={failure instanceof ApiError ? failure.message : "That didn't work"} />}

      {order.status === "CONFIRMED" && <Card title="Ready to start"><p className="mb-4 text-sm text-ink-2">Nobody has started this order yet. Start picking to claim it and open the lines.</p></Card>}
      {order.status === "PACKING" && (
        <Card title="Packing">
          <p className="text-sm text-ink-2">Every line is dealt with. Pack the bags, keeping chilled and frozen items separate. The final total is <strong className="num text-ink">{money(order.totals.final_total)}</strong>{order.payment_method === "CARD" ? "; finishing packing charges the card for exactly that" : "; the customer pays it in cash at handover"}.</p>
        </Card>
      )}
      {["READY_FOR_PICKUP", "READY_FOR_DISPATCH", "OUT_FOR_DELIVERY"].includes(order.status) && <Handover order={order} />}
      {closed && <Alert tone={order.status === "COMPLETED" ? "ok" : "info"} title={`This order is ${order.status_label.toLowerCase()}`}>Nothing more to do here.</Alert>}

      {order.items.length > 0 && !["CONFIRMED"].includes(order.status) && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl">Lines ({order.items.length})</h2>
            {picking && <Checkbox className="text-sm" label="Only show lines still to do" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} />}
          </div>
          {zones.map((zone) => {
            const Icon = ZONE_ICON[zone.storage];
            const categories = zone.categories.map((c) => ({ ...c, items: c.items.filter((i) => !(onlyOpen && picking && ["PICKED", "SHORT", "SUBSTITUTED", "REMOVED"].includes(i.status))) })).filter((c) => c.items.length);
            if (!categories.length) return null;
            return (
              <section key={zone.storage} aria-label={`${STORAGE_LABELS[zone.storage]} items`}>
                <h3 className={cn("flex items-center gap-2 rounded-md px-3 py-2 font-sans text-sm font-bold uppercase tracking-wide", zone.storage === "AMBIENT" ? "bg-paper-2 text-ink-2" : "bg-info-soft text-info")}>
                  <Icon className="size-4" aria-hidden />{STORAGE_LABELS[zone.storage]}<span className="font-normal normal-case tracking-normal"> — {ZONE_HINT[zone.storage]}</span>
                </h3>
                {categories.map((c) => (
                  <div key={c.name} className="mt-4">
                    <h4 className="mb-2 px-1 font-sans text-sm font-bold text-ink-2">{c.name}</h4>
                    <ul className="space-y-3">
                      {c.items.map((item) => <PickLine key={item.id} order={order} item={item} call={call} flagged={flagged.has(item.id)} onActed={clearFlag} {...handlers} />)}
                    </ul>
                  </div>
                ))}
              </section>
            );
          })}
        </div>
      )}
      </div>

      {/* Next step: pinned to the bottom of the screen so it is always one thumb away */}
      <div className="sticky bottom-0 z-20 -mx-4 border-t border-line bg-paper/95 px-4 py-3 backdrop-blur lg:-mx-8 lg:px-8">
        <OrderActions order={order} size="lg" hideCancel onFailure={onFailure} onDone={() => { setFailure(null); setFlagged(new Set()); }} />
        {picking && progress.openIds.length === 0 && !order.awaiting_customer && <p className="mt-2 text-sm font-semibold text-ok">All lines are done. You can finish picking.</p>}
      </div>

      <UnavailableDialog order={order} item={unavailable} onClose={() => setUnavailable(null)} />
      <SubstituteDialog order={order} item={substituting} onClose={() => setSubstituting(null)} />
      <RemoveLineDialog order={order} item={removing} onClose={() => setRemoving(null)} />
      <DecideDialog order={order} substitution={deciding} onClose={() => setDeciding(null)} />
    </AdminPage>
  );
}

/** Everything the person at the door or counter needs: who, where, and (for cash orders) how much to collect. */
function Handover({ order }: { order: OrderDetail }) {
  const money = useMoney();
  const cod = order.payment_method === "COD";
  const a = order.address;
  return (
    <Card title={order.fulfilment_type === "DELIVERY" ? "Delivery details" : "Pickup handover"}>
      <div className="space-y-3 text-sm">
        <p className="text-base font-semibold text-ink">{order.contact.name}</p>
        {order.contact.phone && <p><a className="font-semibold text-primary hover:underline" href={`tel:${order.contact.phone}`}>{order.contact.phone}</a></p>}
        {a ? <address className="not-italic">{a.line1}{a.line2 ? `, ${a.line2}` : ""}<br />{[a.area, a.city, a.postal_code].filter(Boolean).join(", ")}{a.instructions && <span className="mt-1 block text-ink-2">Instructions: {a.instructions}</span>}</address> : <p>Customer collects from {order.branch}.</p>}
        {cod
          ? <Alert tone="warn" title={`Collect ${money(order.totals.final_total ?? order.totals.total)} in cash`}>You will be asked to record the amount when you complete the order.</Alert>
          : <p className="text-ink-2">Already paid by card. Nothing to collect.</p>}
      </div>
    </Card>
  );
}
