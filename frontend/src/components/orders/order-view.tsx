"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock, MapPin, Store as StoreIcon } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Select, Textarea } from "@/components/ui/field";
import { Alert, ErrorState, Skeleton } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { ApiError, api, apiGet } from "@/lib/api";
import { formatDateTime, formatQty, formatSlotDay, formatSlotWindow } from "@/lib/format";
import { useMe, useMoney, useStore } from "@/lib/hooks";
import type { OrderDetail, OrderItem } from "@/lib/types";

const TONE: Record<string, "ok" | "warn" | "bad" | "info" | "neutral"> = { COMPLETED: "ok", CANCELLED: "bad", REFUNDED: "bad", FAILED: "bad", PENDING_PAYMENT: "warn" };

function useOrder(number: string, token: string | null) {
  return useQuery({
    queryKey: ["order", number, token],
    queryFn: () => apiGet<OrderDetail>(`/orders/${number}/`, token ? { token } : undefined),
    // An order moves under the shopper (payment events, picking), so never trust a cached copy on arrival.
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: (q) => (q.state.data?.is_terminal ? false : 15_000),
    retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2,
  });
}

function itemStatusLabel(i: OrderItem): { label: string; tone: "ok" | "warn" | "bad" | "neutral" } {
  switch (i.status) {
    case "PICKED": return { label: "Picked", tone: "ok" };
    case "SUBSTITUTED": return { label: "Substituted", tone: "warn" };
    case "OUT_OF_STOCK": case "UNAVAILABLE": return { label: "Unavailable — refunded", tone: "bad" };
    case "SHORT": return { label: "Partly picked", tone: "warn" };
    default: return { label: "Not picked yet", tone: "neutral" };
  }
}

export function OrderView({ number }: { number: string }) {
  const sp = useSearchParams();
  const token = sp.get("token");
  const placed = sp.get("placed") === "1";
  const { data: me } = useMe();
  const { data: o, isLoading, error, refetch } = useOrder(number, token);
  const money = useMoney();
  const store = useStore();
  const qc = useQueryClient();
  const toast = useToast();
  const router = useRouter();
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [problemOpen, setProblemOpen] = React.useState(false);
  const q = token ? { token } : undefined;
  const refresh = (data: OrderDetail) => qc.setQueryData(["order", number, token], data);

  const decide = useMutation({ mutationFn: (v: { id: number; approve: boolean }) => api<OrderDetail>(`/orders/${number}/substitutions/${v.id}/`, { method: "POST", body: { approve: v.approve }, query: q }), onSuccess: (d) => { refresh(d); toast.success("Thanks — we've passed that to your picker"); }, onError: (e) => { toast.error(e); refetch(); } });
  const retry = useMutation({ mutationFn: (method?: "CARD" | "COD") => api<OrderDetail>(`/payments/orders/${number}/retry/`, { method: "POST", body: method ? { method } : {}, query: q }), onSuccess: (d) => {
    refresh(d);
    const url = d.payment?.checkout_url;
    if (d.payment?.state === "REQUIRES_ACTION" && url) {
      const u = new URL(url, window.location.origin);
      if (u.origin === window.location.origin) router.push(`${u.pathname}${u.search}${token ? (u.search ? "&" : "?") + "token=" + encodeURIComponent(token) : ""}`);
      else if (u.protocol === "https:") window.location.assign(u.toString());
    } else if (d.payment_init_failed) toast.error(null, "We couldn't reach the payment provider. Please try again in a moment.");
  }, onError: (e) => toast.error(e) });

  if (isLoading) return <div className="space-y-4" aria-busy="true"><Skeleton className="h-12 w-72" /><Skeleton className="h-40 w-full" /><Skeleton className="h-64 w-full" /></div>;
  if (error || !o) {
    const nf = error instanceof ApiError && error.status === 404;
    return nf ? <ErrorState title="We couldn't find that order" error={error} /> : <ErrorState error={error} onRetry={() => refetch()} />;
  }
  const pay = o.payment;
  const awaitingPayment = o.status === "PENDING_PAYMENT";
  const expires = pay?.expires_at ? new Date(pay.expires_at) : null;

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-8">
        <header>
          {placed && !awaitingPayment && (
            <div className="mb-5 flex items-start gap-3 rounded-lg border border-ok/30 bg-ok-soft p-4" role="status">
              <CheckCircle2 className="mt-0.5 size-6 shrink-0 text-ok" aria-hidden />
              <div><p className="font-semibold text-ink">Thank you — your order is in.</p><p className="text-sm text-ink-2">We&apos;ve emailed a confirmation to {o.contact.email}. {!me && "Save the link to this page to follow your order."}</p></div>
            </div>
          )}
          <p className="eyebrow">Order <span className="num">{o.number}</span></p>
          <h1 className="mt-1 flex flex-wrap items-center gap-3 text-3xl sm:text-4xl">{o.status_label}<Badge tone={TONE[o.status] ?? "info"}>{o.fulfilment_type === "DELIVERY" ? "Delivery" : "Collection"}</Badge>{o.is_demo && <Badge tone="warn">Demo order</Badge>}</h1>
          <p className="mt-2 max-w-2xl text-ink-2">{o.status_summary}</p>
          <p className="mt-1 text-sm text-ink-3">Placed {formatDateTime(o.placed_at)}</p>
        </header>

        {awaitingPayment && pay && (
          <Alert tone="warn" title="Payment needed to confirm this order">
            <p>{pay.failure_message || "Your order and delivery slot are being held while you pay."}{expires && <> Held until <span className="num font-semibold">{formatDateTime(expires)}</span>.</>}</p>
            {pay.is_demo && <p className="mt-1 font-medium">Demo mode: the payment page is a simulation — no money moves.</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              {pay.state === "REQUIRES_ACTION" && pay.checkout_url ? (
                <Button size="sm" onClick={() => { const u = new URL(pay.checkout_url, window.location.origin); if (u.origin === window.location.origin) router.push(`${u.pathname}${u.search}${token ? (u.search ? "&" : "?") + "token=" + encodeURIComponent(token) : ""}`); else window.location.assign(u.toString()); }}>Continue to payment</Button>
              ) : (
                <Button size="sm" loading={retry.isPending} onClick={() => retry.mutate("CARD")}>Pay by card</Button>
              )}
              {o.can_cancel && <Button size="sm" variant="secondary" onClick={() => setCancelOpen(true)}>Cancel order</Button>}
            </div>
          </Alert>
        )}

        {o.pending_substitutions.length > 0 && (
          <section aria-labelledby="subs-h" className="rounded-lg border-2 border-citrus bg-citrus-soft p-5">
            <h2 id="subs-h" className="text-xl">Your picker needs an answer</h2>
            <p className="mt-1 text-sm text-ink-2">These items were unavailable. Approve a suggestion or decline it and we&apos;ll refund the item. You&apos;ll never be charged more than the original price.</p>
            <ul className="mt-4 space-y-3">
              {o.pending_substitutions.map((s) => (
                <li key={s.id} className="rounded-md border border-line bg-white p-4">
                  <p className="text-sm text-ink-3">Instead of <strong className="text-ink">{s.original}</strong></p>
                  <p className="mt-0.5 font-semibold text-ink">{s.substitute} · <span className="num">{formatQty(s.quantity, s.unit)}</span></p>
                  <p className="num mt-1 text-sm text-ink-2">You&apos;d pay {money(s.charged_unit_price)} / {s.unit}{Number(s.charged_unit_price) < Number(s.list_unit_price) && <> (its shelf price is {money(s.list_unit_price)}; capped at the original&apos;s {money(s.original_unit_price)})</>}</p>
                  {s.reason && <p className="mt-1 text-sm text-ink-3">{s.reason}</p>}
                  <div className="mt-3 flex gap-2"><Button size="sm" loading={decide.isPending} onClick={() => decide.mutate({ id: s.id, approve: true })}>Approve</Button><Button size="sm" variant="secondary" disabled={decide.isPending} onClick={() => decide.mutate({ id: s.id, approve: false })}>No thanks</Button></div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-labelledby="items-h">
          <h2 id="items-h" className="text-2xl">Items</h2>
          <ul className="mt-3 divide-y divide-line border-y border-line">
            {o.items.map((i) => {
              const st = itemStatusLabel(i);
              return (
                <li key={i.id} className="flex gap-4 py-4">
                  {i.image && <img src={i.image} alt="" width={64} height={64} loading="lazy" className="tile-bg size-16 shrink-0 rounded-md border border-line object-contain" />}
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-ink">{i.is_substitute && <Badge tone="warn" className="mr-2">Substitute</Badge>}{i.name}</p>
                    <p className="num text-sm text-ink-3">Ordered {formatQty(i.ordered_qty, i.unit)}{i.picked_qty != null && i.picked_qty !== i.ordered_qty && <> · picked {formatQty(i.picked_qty, i.unit)}</>} · {money(i.unit_price)}{i.promo_label && ` · ${i.promo_label}`}</p>
                    {i.price_note && i.line_total_final == null && <p className="text-sm text-ink-3">{i.price_note}</p>}
                    {i.picker_note && <p className="mt-1 text-sm text-ink-2">Note from your picker: {i.picker_note}</p>}
                    <Badge tone={st.tone} className="mt-1.5">{st.label}</Badge>
                  </div>
                  <p className="num shrink-0 text-right font-semibold text-ink">{i.line_total_final != null ? money(i.line_total_final) : <>{i.is_variable_weight ? "≈ " : ""}{money(i.line_total_estimated)}</>}</p>
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-labelledby="timeline-h">
          <h2 id="timeline-h" className="text-2xl">Progress</h2>
          <ol className="mt-4 space-y-4 border-l-2 border-line pl-5">
            {o.timeline.map((t, i) => (
              <li key={i} className="relative">
                <span className="absolute -left-[1.72rem] top-1.5 size-3 rounded-full border-2 border-primary bg-paper" aria-hidden />
                <p className="font-semibold text-ink">{t.label}</p>
                <p className="num text-sm text-ink-3">{formatDateTime(t.at)}</p>
              </li>
            ))}
          </ol>
        </section>

        {o.refunds.length > 0 && (
          <section aria-labelledby="refunds-h">
            <h2 id="refunds-h" className="text-2xl">Refunds</h2>
            <ul className="mt-3 divide-y divide-line border-y border-line">
              {o.refunds.map((r, i) => <li key={i} className="flex justify-between gap-4 py-3 text-sm"><span><span className="font-semibold text-ink">{r.reason || "Refund"}</span>{r.note && <span className="block text-ink-3">{r.note}</span>}<span className="num block text-ink-3">Requested {formatDateTime(r.requested_at)}</span></span><span className="num text-right"><span className="block font-semibold">{money(r.amount)}</span><Badge tone={r.status === "SUCCEEDED" ? "ok" : "neutral"}>{r.status === "SUCCEEDED" ? "Refunded" : r.status === "PENDING" ? "Processing" : r.status}</Badge></span></li>)}
            </ul>
          </section>
        )}
      </div>

      <aside className="space-y-5 lg:sticky lg:top-28 lg:self-start">
        <section aria-labelledby="totals-h" className="rounded-lg border border-line bg-white p-5 shadow-card">
          <h2 id="totals-h" className="text-xl">Payment summary</h2>
          <dl className="num mt-3 space-y-2 text-[0.95rem]">
            <div className="flex justify-between"><dt className="text-ink-2">Subtotal</dt><dd>{money(o.totals.subtotal)}</dd></div>
            {Number(o.totals.promo_savings) > 0 && <div className="flex justify-between text-ok"><dt>Offers</dt><dd>−{money(o.totals.promo_savings)}</dd></div>}
            {Number(o.totals.coupon_discount) > 0 && <div className="flex justify-between text-ok"><dt>Code {o.totals.coupon_code}</dt><dd>−{money(o.totals.coupon_discount)}</dd></div>}
            <div className="flex justify-between"><dt className="text-ink-2">{o.fulfilment_type === "DELIVERY" ? "Delivery" : "Collection"}</dt><dd>{Number(o.totals.delivery_fee) > 0 ? money(o.totals.delivery_fee) : "Free"}</dd></div>
            <div className="flex justify-between border-t border-line pt-3 font-semibold text-ink"><dt>{o.totals.final_total != null ? "Order total" : "Estimated total"}</dt><dd>{money(o.totals.final_total ?? o.totals.total)}</dd></div>
            {o.totals.final_total == null && Number(o.totals.max_charge) > Number(o.totals.total) && <div className="flex justify-between text-sm text-ink-3"><dt>Most you can be charged</dt><dd>{money(o.totals.max_charge)}</dd></div>}
            {o.totals.difference != null && Number(o.totals.difference) !== 0 && <div className="flex justify-between text-sm text-ink-3"><dt>Difference from estimate</dt><dd>{Number(o.totals.difference) > 0 ? "+" : ""}{money(o.totals.difference)}</dd></div>}
          </dl>
          {pay && (
            <p className="mt-3 border-t border-line pt-3 text-sm text-ink-2">
              {pay.mode === "cod" ? "Pay on delivery/collection" : pay.is_demo ? "Demo card payment (simulated)" : "Card payment"} · <strong className="text-ink">{pay.state.replace(/_/g, " ").toLowerCase()}</strong>
              {Number(pay.amount_refunded) > 0 && <span className="num block text-ink-3">Refunded {money(pay.amount_refunded)}</span>}
            </p>
          )}
        </section>

        <section aria-labelledby="where-h" className="rounded-lg border border-line bg-white p-5">
          <h2 id="where-h" className="flex items-center gap-2 text-xl">{o.fulfilment_type === "DELIVERY" ? <MapPin className="size-5" aria-hidden /> : <StoreIcon className="size-5" aria-hidden />}{o.fulfilment_type === "DELIVERY" ? "Delivery" : "Collection"}</h2>
          {o.slot && <p className="mt-3 flex items-start gap-2 text-sm"><Clock className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden /><span><strong className="block text-ink">{formatSlotDay(o.slot.starts_at, store.timezone, store.locale)}</strong><span className="num text-ink-2">{formatSlotWindow(o.slot.starts_at, o.slot.ends_at, store.timezone, store.locale)}</span></span></p>}
          {o.fulfilment_type === "DELIVERY" && o.address ? (
            <address className="mt-3 text-sm not-italic text-ink-2">{o.address.recipient}<br />{[o.address.line1, o.address.line2].filter(Boolean).join(", ")}<br />{[o.address.city, o.address.postal_code].filter(Boolean).join(" ")}{o.address.instructions && <><br /><em>{o.address.instructions}</em></>}</address>
          ) : (
            <p className="mt-3 text-sm text-ink-2"><strong className="text-ink">{o.branch.name}</strong><br />{o.branch.address}{o.branch.pickup_instructions && <><br />{o.branch.pickup_instructions}</>}</p>
          )}
          <p className="mt-3 text-sm text-ink-3">If something is unavailable: {({ ALLOW: "substitute for me", CONTACT: "ask me first", NONE: "no substitutions" } as Record<string, string>)[o.substitution_policy]}.</p>
        </section>

        <div className="flex flex-wrap gap-2">
          {o.can_cancel && !awaitingPayment && <Button variant="secondary" size="sm" onClick={() => setCancelOpen(true)}>Cancel order</Button>}
          {o.can_report_problem && <Button variant="secondary" size="sm" onClick={() => setProblemOpen(true)}>Report a problem</Button>}
          <Link href="/contact" className="inline-flex h-9 items-center px-2 text-sm font-semibold text-primary hover:underline">Contact us</Link>
        </div>
        {o.cases.length > 0 && <section aria-labelledby="cases-h" className="text-sm"><h2 id="cases-h" className="font-sans text-base font-bold text-ink">Your reports</h2><ul className="mt-2 space-y-1.5">{o.cases.map((c) => <li key={c.id} className="flex justify-between gap-2"><span>{c.kind.charAt(0) + c.kind.slice(1).toLowerCase()}</span><Badge tone={c.status === "RESOLVED" ? "ok" : "info"}>{c.status.replace("_", " ").toLowerCase()}</Badge></li>)}</ul></section>}
      </aside>

      <CancelDialog open={cancelOpen} onOpenChange={setCancelOpen} number={number} token={token} onDone={refresh} />
      <ProblemDialog open={problemOpen} onOpenChange={setProblemOpen} order={o} token={token} onDone={() => { refetch(); }} />
    </div>
  );
}

function CancelDialog({ open, onOpenChange, number, token, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; number: string; token: string | null; onDone: (o: OrderDetail) => void }) {
  const toast = useToast();
  const [reason, setReason] = React.useState("");
  const m = useMutation({ mutationFn: () => api<OrderDetail>(`/orders/${number}/cancel/`, { method: "POST", body: { reason: reason.trim() || "Cancelled by customer" }, query: token ? { token } : undefined }), onSuccess: (d) => { onDone(d); onOpenChange(false); toast.success("Order cancelled", "Any payment will be released or refunded."); }, onError: (e) => toast.error(e) });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Cancel this order?" description="Stock and your slot are released straight away. Card payments are released or refunded.">
        <Field label="Reason (optional)" htmlFor="cancel-reason"><Textarea id="cancel-reason" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <div className="mt-5 flex justify-end gap-2"><Button variant="secondary" onClick={() => onOpenChange(false)}>Keep order</Button><Button variant="danger" loading={m.isPending} onClick={() => m.mutate()}>Cancel order</Button></div>
      </DialogContent>
    </Dialog>
  );
}

const KINDS: [string, string][] = [["MISSING", "An item was missing"], ["DAMAGED", "Damaged or poor quality"], ["INCORRECT", "I received the wrong item"], ["WEIGHT", "Weight or price query"], ["LATE", "Late delivery"], ["OTHER", "Something else"]];

function ProblemDialog({ open, onOpenChange, order, token, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; order: OrderDetail; token: string | null; onDone: () => void }) {
  const toast = useToast();
  const [kind, setKind] = React.useState("MISSING");
  const [item, setItem] = React.useState("");
  const [description, setDescription] = React.useState("");
  const m = useMutation({
    mutationFn: () => api(`/orders/${order.number}/cases/`, { method: "POST", body: { kind, description: description.trim(), order_item_id: item ? Number(item) : null }, query: token ? { token } : undefined }),
    onSuccess: () => { onDone(); onOpenChange(false); setDescription(""); toast.success("Thanks — we've logged your report", "We'll reply by email."); },
    onError: (e) => toast.error(e),
  });
  const err = m.error instanceof ApiError ? m.error.fieldErrors : {};
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Report a problem" description={`Order ${order.number}. Tell us what went wrong and we'll put it right.`}>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
          <Field label="What happened?" htmlFor="case-kind"><Select id="case-kind" value={kind} onChange={(e) => setKind(e.target.value)}>{KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
          <Field label="Which item? (optional)" htmlFor="case-item"><Select id="case-item" value={item} onChange={(e) => setItem(e.target.value)}><option value="">The whole order</option>{order.items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</Select></Field>
          <Field label="Tell us more" htmlFor="case-desc" required error={err.description}><Textarea id="case-desc" required maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} aria-invalid={!!err.description} /></Field>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Close</Button><Button type="submit" loading={m.isPending} disabled={description.trim().length < 5}>Send report</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
