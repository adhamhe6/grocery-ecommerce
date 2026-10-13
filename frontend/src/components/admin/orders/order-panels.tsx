"use client";

// The side panels and timeline of the order page.
import { ArrowRight, Mail, Phone } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { Card, KeyValue, StatusBadge } from "@/components/admin/kit";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/states";
import { useAdmin } from "@/lib/admin";
import { useMoney } from "@/lib/hooks";
import { PROVIDER_LABELS, POLICY_LABELS, refundableAmount, sumCaptured, sumRefunded } from "./actions";
import { parseMoney } from "./decimal";
import { DemoBadge, ErrorAlert, FulfilmentLabel, useAsyncTask, useOrderApi, useZoneFormat } from "./shared";
import type { HistoryEntry, OrderDetail, PaymentRow, RefundRow, SubstitutionRow } from "./types";

// ------------------------------------------------------------------------------------------------ totals
function Row({ label, hint, value, strong, negative }: { label: string; hint?: string; value: React.ReactNode; strong?: boolean; negative?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="min-w-0"><span className={strong ? "font-semibold text-ink" : "text-ink-2"}>{label}</span>{hint && <span className="block text-xs text-ink-3">{hint}</span>}</dt>
      <dd className={`num shrink-0 ${strong ? "font-semibold text-ink" : ""} ${negative ? "text-ok" : ""}`}>{value}</dd>
    </div>
  );
}

/** The amounts, deliberately kept apart: what the customer was quoted, the ceiling we may charge, what it really came to, and what moved. */
export function TotalsCard({ order }: { order: OrderDetail }) {
  const money = useMoney();
  const t = order.totals;
  const captured = sumCaptured(order.payments);
  const refunded = sumRefunded(order.refunds, "SUCCEEDED");
  const pending = sumRefunded(order.refunds, "PENDING");
  const hasPending = (parseMoney(pending) ?? 0n) > 0n;
  return (
    <Card title="Totals">
      <dl className="divide-y divide-line text-sm">
        <div className="pb-2">
          <Row label="Items subtotal" value={money(t.subtotal)} />
          {(parseMoney(t.promo_savings) ?? 0n) > 0n && <Row label="Promotions" value={`−${money(t.promo_savings)}`} negative />}
          {(parseMoney(t.coupon_discount) ?? 0n) > 0n && <Row label={t.coupon_code ? `Coupon ${t.coupon_code}` : "Coupon"} value={`−${money(t.coupon_discount)}`} negative />}
          <Row label="Delivery fee" value={money(t.delivery_fee)} />
          <Row label="Tax" value={money(t.tax_total)} />
        </div>
        <div className="py-2">
          <Row label="Estimated total" hint="What the customer was quoted at checkout" value={money(t.total)} />
          <Row label="Maximum authorised" hint="The most that can be charged, including the weighing buffer" value={money(t.max_charge)} />
          <Row label="Final total" hint={t.final_total === null ? "Worked out when picking finishes" : "Based on what was actually picked"} strong value={t.final_total === null ? <span className="font-normal text-ink-3">Not final yet</span> : money(t.final_total)} />
        </div>
        <div className="pt-2">
          <Row label="Amount captured" hint="Money actually taken" value={money(captured)} />
          <Row label="Refunded" hint={hasPending ? `${money(pending)} more is pending` : "Refunds that have been paid out"} value={money(refunded)} />
        </div>
      </dl>
    </Card>
  );
}

// ------------------------------------------------------------------------------------------------ customer / fulfilment
export function CustomerCard({ order }: { order: OrderDetail }) {
  const { can } = useAdmin();
  return (
    <Card title="Customer">
      <p className="font-semibold text-ink">{order.contact.name}</p>
      <ul className="mt-2 space-y-1.5 text-sm">
        <li><a className="inline-flex items-center gap-2 text-primary hover:underline" href={`mailto:${order.contact.email}`}><Mail className="size-4 shrink-0" aria-hidden />{order.contact.email}</a></li>
        {order.contact.phone && <li><a className="inline-flex items-center gap-2 text-primary hover:underline" href={`tel:${order.contact.phone}`}><Phone className="size-4 shrink-0" aria-hidden />{order.contact.phone}</a></li>}
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-2">
        <span>{order.is_guest ? "Guest checkout (no account)" : "Registered customer"}</span>
        {!order.is_guest && can("customers.read") && <Link className="inline-flex items-center gap-1 font-semibold text-primary hover:underline" href={`/admin/customers?search=${encodeURIComponent(order.contact.email)}`}>Find profile <ArrowRight className="size-3.5" aria-hidden /></Link>}
      </div>
      <dl className="mt-4 space-y-3 text-sm">
        <div><dt className="text-xs font-semibold uppercase tracking-wide text-ink-3">If something is unavailable</dt><dd className="mt-0.5">{POLICY_LABELS[order.substitution_policy]}</dd></div>
        {order.customer_note && <div><dt className="text-xs font-semibold uppercase tracking-wide text-ink-3">Customer note</dt><dd className="mt-0.5 whitespace-pre-wrap">{order.customer_note}</dd></div>}
      </dl>
    </Card>
  );
}

export function FulfilmentCard({ order }: { order: OrderDetail }) {
  const f = useZoneFormat();
  const { can, perms } = useAdmin();
  const call = useOrderApi(order.number);
  const task = useAsyncTask();
  const a = order.address;
  const canAssign = can("orders.manage") && can("orders.fulfil");
  const assign = (userId: number | null) => task.run(() => call("assign/", { user_id: userId }));
  return (
    <Card title={order.fulfilment_type === "DELIVERY" ? "Delivery" : "Pickup"}>
      <div className="space-y-3 text-sm">
        <p className="font-semibold"><FulfilmentLabel type={order.fulfilment_type} /> · {order.branch}</p>
        {order.slot_starts_at && order.slot_ends_at ? <p>{f.slotDay(order.slot_starts_at)}, {f.slotWindow(order.slot_starts_at, order.slot_ends_at)}</p> : <p className="text-ink-3">No slot recorded.</p>}
        {a ? (
          <address className="not-italic text-ink">
            {a.recipient}{a.phone ? ` · ${a.phone}` : ""}<br />{a.line1}{a.line2 ? `, ${a.line2}` : ""}<br />{[a.area, a.city, a.postal_code].filter(Boolean).join(", ")}
            {a.instructions && <span className="mt-1 block text-ink-2">Instructions: {a.instructions}</span>}
          </address>
        ) : order.fulfilment_type === "PICKUP" ? <p className="text-ink-2">The customer collects from {order.branch}.</p> : null}
        <div className="border-t border-line pt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">Picker</p>
          <p className="mt-0.5">{order.assigned_to ?? <span className="text-ink-3">Not assigned</span>}</p>
          {canAssign && (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" loading={task.busy} onClick={() => assign(perms.id)}>Assign to me</Button>
              {order.assigned_to && <Button size="sm" variant="secondary" disabled={task.busy} onClick={() => assign(null)}>Unassign</Button>}
            </div>
          )}
          {task.error != null && <ErrorAlert error={task.error} />}
        </div>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------------------------------------ payments & refunds
function PaymentBlock({ p }: { p: PaymentRow }) {
  const money = useMoney();
  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">Attempt {p.attempt}</span>
        <StatusBadge status={p.state} />
        <span className="rounded-sm bg-paper-2 px-2 py-0.5 text-xs font-semibold text-ink-2">{PROVIDER_LABELS[p.provider] ?? p.provider}</span>
        {p.is_demo && <DemoBadge />}
      </div>
      <KeyValue columns={2} items={[["Method", p.method === "COD" ? "Pay on delivery/pickup" : p.method === "CARD" ? "Card" : p.method], ["Requested / authorised", money(p.amount)], ["Captured", money(p.captured)], ["Refunded", money(p.refunded)], ["Reference", p.reference || "—"]]} />
      {p.failure && <p className="mt-2 text-sm text-bad">Failure: {p.failure}</p>}
    </li>
  );
}

export function PaymentsCard({ order, onRefund }: { order: OrderDetail; onRefund: () => void }) {
  const { can } = useAdmin();
  const money = useMoney();
  const refundable = refundableAmount(order.payments, order.refunds);
  const canRefund = can("orders.refund") && refundable !== null && (parseMoney(refundable) ?? 0n) > 0n;
  const demo = order.payments.some((p) => p.is_demo);
  return (
    <Card title="Payments" actions={canRefund ? <Button size="sm" variant="secondary" onClick={onRefund}>Issue refund</Button> : undefined}>
      {demo && <Alert tone="warn" title="Demo payment" className="mb-4">This order was paid through the demo sandbox. No real money was taken, and refunds are not sent to a real card.</Alert>}
      {order.payments.length === 0 ? <p className="text-sm text-ink-3">No payment attempts yet.</p> : <ul className="divide-y divide-line">{order.payments.map((p) => <PaymentBlock key={p.id} p={p} />)}</ul>}
      {refundable !== null && <p className="mt-3 border-t border-line pt-3 text-sm text-ink-2">Still refundable: <strong className="num text-ink">{money(refundable)}</strong></p>}
    </Card>
  );
}

export function RefundsCard({ order, onRecordPayout }: { order: OrderDetail; onRecordPayout: (r: RefundRow) => void }) {
  const { can } = useAdmin();
  const money = useMoney();
  const f = useZoneFormat();
  if (order.refunds.length === 0) return null;
  return (
    <Card title="Refunds">
      <ul className="divide-y divide-line text-sm">
        {order.refunds.map((r) => (
          <li key={r.id} className="py-3 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="num font-semibold">{money(r.amount)}</span>
              <StatusBadge status={r.status} />
              <span className="text-xs text-ink-3">{r.method === "MANUAL" ? "Paid out by hand" : "Back to the original payment"}</span>
            </div>
            <p className="mt-1 text-ink-2">{r.reason}</p>
            <p className="mt-0.5 text-xs text-ink-3">Requested {f.dateTime(r.created_at)}{r.completed_at ? ` · completed ${f.dateTime(r.completed_at)}` : ""}{r.reference ? ` · ref ${r.reference}` : ""}</p>
            {r.failure && <p className="mt-1 text-bad">{r.failure}</p>}
            {r.status === "PENDING" && r.method === "MANUAL" && can("orders.refund") && <Button size="sm" variant="secondary" className="mt-2" onClick={() => onRecordPayout(r)}>Record payout</Button>}
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ------------------------------------------------------------------------------------------------ substitutions & cases
export function SubstitutionsCard({ order, onDecide }: { order: OrderDetail; onDecide: (s: SubstitutionRow) => void }) {
  const { can } = useAdmin();
  const money = useMoney();
  if (order.substitutions.length === 0) return null;
  const label: Record<SubstitutionRow["status"], string> = { AWAITING_CUSTOMER: "Awaiting customer", APPROVED: "Approved by customer", REJECTED: "Declined by customer", AUTO_APPROVED: "Applied (customer allows substitutes)" };
  return (
    <Card title="Substitutions">
      <ul className="divide-y divide-line text-sm">
        {order.substitutions.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
            <div className="min-w-0">
              <p className="font-semibold">{s.original} → {s.substitute}</p>
              <p className="text-ink-2">{label[s.status]} · charged {money(s.charged_unit_price)} each{s.list_unit_price !== s.charged_unit_price ? ` (list price ${money(s.list_unit_price)})` : ""}</p>
              {s.reason && <p className="text-xs text-ink-3">Note: {s.reason}</p>}
            </div>
            {s.status === "AWAITING_CUSTOMER" && can("orders.manage") && <Button size="sm" variant="secondary" onClick={() => onDecide(s)}>Record customer&apos;s answer</Button>}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function CasesCard({ order }: { order: OrderDetail }) {
  const { can } = useAdmin();
  const f = useZoneFormat();
  if (order.cases.length === 0) return null;
  return (
    <Card title="Support cases">
      <ul className="divide-y divide-line text-sm">
        {order.cases.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
            <span>{can("support.manage") ? <Link className="font-semibold text-primary hover:underline" href={`/admin/cases/${c.id}`}>Case #{c.id}</Link> : <span className="font-semibold">Case #{c.id}</span>} · {c.kind.charAt(0) + c.kind.slice(1).toLowerCase()} <span className="text-ink-3">· {f.dateTime(c.created_at)}</span></span>
            <StatusBadge status={c.status} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ------------------------------------------------------------------------------------------------ timeline
export function Timeline({ history, labels }: { history: HistoryEntry[]; labels: Record<string, string> }) {
  const f = useZoneFormat();
  const entries = [...history].reverse(); // newest first
  return (
    <Card title="History">
      {entries.length === 0 ? <p className="text-sm text-ink-3">Nothing has happened yet.</p> : (
        <ol className="space-y-4">
          {entries.map((h, i) => {
            const changed = h.from !== h.to;
            return (
              <li key={`${h.at}-${i}`} className="relative border-l-2 border-line pl-4">
                <span className="absolute -left-[5px] top-1.5 size-2 rounded-full bg-primary" aria-hidden />
                <p className="text-sm font-semibold text-ink">{changed ? `${labels[h.from] ?? (h.from || "New")} → ${labels[h.to] ?? h.to}` : h.note || "Update"}</p>
                {changed && h.note && <p className="text-sm text-ink-2">{h.note}</p>}
                {h.public_note && <p className="text-xs text-ink-3">Customer sees: “{h.public_note}”</p>}
                <p className="mt-0.5 text-xs text-ink-3"><time dateTime={h.at}>{f.dateTime(h.at)}</time> · {h.by || "system"}</p>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
