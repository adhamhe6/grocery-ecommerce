"use client";

import { Scale, Snowflake, Thermometer } from "lucide-react";
import * as React from "react";
import { DataTable, type Column } from "@/components/admin/kit";
import { Badge } from "@/components/ui/badge";
import { formatQty } from "@/lib/format";
import { useMoney } from "@/lib/hooks";
import { ITEM_STATUS_LABELS, STORAGE_LABELS } from "./actions";
import type { OrderDetail, StaffItem } from "./types";

const ITEM_TONE: Record<string, "ok" | "warn" | "bad" | "info" | "neutral" | "citrus"> = {
  PENDING: "neutral", PROPOSED: "warn", PICKED: "ok", SHORT: "warn", UNAVAILABLE: "bad", SUBSTITUTED: "info", REMOVED: "bad",
};

export function ItemStatusBadge({ status, label }: { status: StaffItem["status"]; label?: string }) {
  return <Badge tone={ITEM_TONE[status] ?? "neutral"}>{label ?? ITEM_STATUS_LABELS[status]}</Badge>;
}

export function StorageTag({ storage }: { storage: StaffItem["storage"] }) {
  if (storage === "AMBIENT") return null;
  const Icon = storage === "FROZEN" ? Snowflake : Thermometer;
  return <Badge tone="info"><Icon className="size-3" aria-hidden />{STORAGE_LABELS[storage]}</Badge>;
}

/** The plain-English rule behind a weighed line, so nobody has to guess why 1.62 kg of a 1.5 kg order is fine. */
export function ToleranceNote({ item, percent }: { item: StaffItem; percent: string }) {
  if (!item.is_variable_weight || !item.tolerance) return null;
  const pct = formatQty(percent);
  return (
    <p className="mt-1 text-xs text-ink-2">
      <Scale className="mr-1 inline size-3.5 align-text-bottom" aria-hidden />
      Weighed item: the customer pays for the weight actually picked. Accepted from {item.tolerance.min} to {item.tolerance.max} {item.unit} (ordered {item.ordered_qty} {item.unit} ±{pct}%).
      Lighter is recorded as short-picked; heavier needs a manager override and is charged at {item.tolerance.max} {item.unit} at most.
    </p>
  );
}

/** Read-only item table for the order page. Picking itself happens on the pick sheet. */
export function OrderItemsTable({ order }: { order: OrderDetail }) {
  const money = useMoney();
  const byId = React.useMemo(() => new Map(order.items.map((i) => [i.id, i])), [order.items]);
  const replacedBy = React.useMemo(() => {
    const m = new Map<number, StaffItem[]>();
    for (const i of order.items) if (i.substitute_for) m.set(i.substitute_for, [...(m.get(i.substitute_for) ?? []), i]);
    return m;
  }, [order.items]);
  const subFor = (id: number) => order.substitutions.find((s) => s.item_id === id);

  const columns: Column<StaffItem>[] = [
    {
      key: "item", header: "Item", className: "min-w-64",
      cell: (i) => (
        <div className="flex gap-3">
          {i.image ? <img src={i.image} alt="" className="size-11 shrink-0 rounded-md border border-line bg-paper-2 object-cover" /> : <div className="size-11 shrink-0 rounded-md border border-line bg-paper-2" aria-hidden />}
          <div className="min-w-0">
            <p className="font-semibold text-ink">{i.name}</p>
            <p className="text-xs text-ink-3">{i.sku} · {i.category}</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <StorageTag storage={i.storage} />
              {i.is_variable_weight && <Badge tone="neutral"><Scale className="size-3" aria-hidden />Weighed</Badge>}
              {i.substitution_pref === "NONE" && <Badge tone="neutral">Never substitute</Badge>}
            </div>
            {i.is_substitute && i.substitute_for && <p className="mt-1 text-xs text-info">Substitute for {byId.get(i.substitute_for)?.name ?? `line ${i.substitute_for}`}{(() => { const s = subFor(i.substitute_for!); return s ? ` · ${money(s.charged_unit_price)} each charged` : ""; })()}</p>}
            {(replacedBy.get(i.id) ?? []).map((r) => <p key={r.id} className="mt-1 text-xs text-info">Replaced by {r.name} ({r.ordered_qty} {r.unit})</p>)}
            {i.picker_note && <p className="mt-1 text-xs text-ink-2">Picker note: {i.picker_note}</p>}
            <ToleranceNote item={i} percent={order.policy.weight_tolerance_percent} />
          </div>
        </div>
      ),
    },
    { key: "ordered", header: "Ordered", align: "right", cell: (i) => formatQty(i.ordered_qty, i.unit) },
    { key: "picked", header: "Picked", align: "right", cell: (i) => (i.picked_qty === null ? <span className="text-ink-3">—</span> : formatQty(i.picked_qty, i.unit)) },
    { key: "price", header: "Unit price", align: "right", hideBelow: "sm", cell: (i) => money(i.unit_price) },
    {
      key: "total", header: "Line total", align: "right",
      cell: (i) => (i.status === "SUBSTITUTED" ? <span className="text-ink-3">Replaced</span> : i.line_total_final !== null ? <span className="font-semibold">{money(i.line_total_final)}</span> : <span>{money(i.line_total_estimated)}<span className="block text-xs font-normal text-ink-3">estimate</span></span>),
    },
    { key: "status", header: "Status", cell: (i) => <ItemStatusBadge status={i.status} /> },
  ];
  return <DataTable caption={`Items on order ${order.number}`} columns={columns} rows={order.items} rowKey={(i) => i.id} />;
}
