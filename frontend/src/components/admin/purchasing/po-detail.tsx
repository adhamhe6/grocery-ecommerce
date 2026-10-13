"use client";

import { ArrowLeft, Ban, CheckCheck, Pencil, Send } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { FormDialog, useFormAction } from "@/components/admin/inventory/form-kit";
import { AdminPage, Card, ConfirmDialog, KeyValue } from "@/components/admin/kit";
import { RequireCapability } from "@/components/admin/shell";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Alert, ErrorState, Skeleton } from "@/components/ui/states";
import { adminRequest, useAdmin, useAdminGet } from "@/lib/admin";
import { formatDate, formatDateTime, formatQty } from "@/lib/format";
import { useMoney } from "@/lib/hooks";
import { PoStatusBadge } from "./badges";
import { lineTotal } from "./decimal";
import { EditDraftForm } from "./po-form";
import { ReceiveButton, ReceiveDialog } from "./po-receive";
import { receivedProgress } from "./receive-logic";
import type { PurchaseOrder } from "./types";

type Dialog = "submit" | "confirm" | "cancel" | "receive" | "details" | null;
const PO = ["/purchase-orders", "/suppliers"];

export function PurchaseOrderDetail({ id }: { id: number }) {
  return <RequireCapability any={["purchasing.read"]}><DetailInner id={id} /></RequireCapability>;
}

function DetailInner({ id }: { id: number }) {
  const { can } = useAdmin();
  const money = useMoney();
  const q = useAdminGet<PurchaseOrder>(`/purchase-orders/${id}/`);
  const [dialog, setDialog] = React.useState<Dialog>(null);
  const [editing, setEditing] = React.useState(false);
  const [replayed, setReplayed] = React.useState<string | null>(null);

  const submit = useFormAction(() => adminRequest<PurchaseOrder>("POST", `/purchase-orders/${id}/submit/`), { invalidate: PO, success: "Order submitted.", onSuccess: () => setDialog(null), onError: () => setDialog(null) });
  const confirm = useFormAction(() => adminRequest<PurchaseOrder>("POST", `/purchase-orders/${id}/confirm/`), { invalidate: PO, success: "Order marked as confirmed by the supplier.", onSuccess: () => setDialog(null), onError: () => setDialog(null) });

  if (q.error) return <AdminPage title="Purchase order"><ErrorState error={q.error} onRetry={() => q.refetch()} title="We couldn't load this purchase order" /></AdminPage>;
  const po = q.data;
  if (!po) return <AdminPage title="Purchase order"><div className="space-y-4"><Skeleton className="h-10 w-72" /><Skeleton className="h-48 w-full" /></div></AdminPage>;

  const write = can("purchasing.write"), receive = can("purchasing.receive");
  const open = po.status === "SUBMITTED" || po.status === "CONFIRMED" || po.status === "PARTIALLY_RECEIVED";
  const canCancel = po.status === "DRAFT" || po.status === "SUBMITTED" || po.status === "CONFIRMED";
  const progress = receivedProgress(po.lines);
  const actionError = submit.message ?? confirm.message;

  return (
    <AdminPage title={po.number} description={<span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1"><PoStatusBadge status={po.status} /><span>for <Link className="underline underline-offset-2" href={`/admin/suppliers/${po.supplier_id}`}>{po.supplier}</Link>, delivering to {po.branch}</span></span>}
      actions={
        <>
          <ButtonLink href="/admin/purchase-orders" variant="ghost" size="sm"><ArrowLeft className="size-4" aria-hidden /> All orders</ButtonLink>
          {write && po.status === "DRAFT" && !editing && <Button variant="secondary" size="sm" onClick={() => setEditing(true)}><Pencil className="size-4" aria-hidden /> Edit lines</Button>}
          {write && open && !editing && <Button variant="secondary" size="sm" onClick={() => setDialog("details")}><Pencil className="size-4" aria-hidden /> Edit date and notes</Button>}
          {write && po.status === "DRAFT" && !editing && <Button onClick={() => { confirm.clear(); setDialog("submit"); }} disabled={!po.lines.length}><Send className="size-4" aria-hidden /> Submit order</Button>}
          {write && po.status === "SUBMITTED" && <Button variant="secondary" onClick={() => { submit.clear(); setDialog("confirm"); }}><CheckCheck className="size-4" aria-hidden /> Mark as confirmed</Button>}
          {receive && open && !editing && <ReceiveButton onClick={() => setDialog("receive")} />}
          {write && canCancel && !editing && <Button variant="secondary" className="text-bad" onClick={() => setDialog("cancel")}><Ban className="size-4" aria-hidden /> Cancel order</Button>}
        </>
      }>
      {actionError && <Alert tone="bad" title="That didn’t go through">{actionError}</Alert>}
      {replayed && (
        <Alert tone="info" title="That delivery was already recorded">Receipt {replayed} was saved earlier, so nothing was added to stock a second time. The receipt history below shows what was entered.</Alert>
      )}
      {po.status === "PARTIALLY_RECEIVED" && (
        <Alert tone="warn" title="Partially received">
          {formatQty(progress.received)} of {formatQty(progress.ordered)} units delivered ({progress.percent}%). The rest is still outstanding. Cancelling isn’t possible once goods have arrived; record the remaining delivery when it comes.
        </Alert>
      )}
      {po.status === "DRAFT" && <Alert tone="info">This is a draft. Submitting locks the lines and starts the order; the system does not email the supplier, so send them the order yourself.</Alert>}

      <Card title="Order">
        <KeyValue columns={3} items={[
          ["Supplier", <Link key="s" className="underline underline-offset-2" href={`/admin/suppliers/${po.supplier_id}`}>{po.supplier}</Link>],
          ["Delivering to", po.branch],
          ["Expected", po.expected_date ? formatDate(po.expected_date) : "Not set"],
          ["Created", formatDateTime(po.created_at)],
          ["Submitted", po.submitted_at ? formatDateTime(po.submitted_at) : "Not yet"],
          ["Order total", <strong key="t" className="num">{money(po.total_cost)}</strong>],
          ["Notes", po.notes ? <span key="n" className="whitespace-pre-line">{po.notes}</span> : "—"],
        ]} />
      </Card>

      {editing ? <EditDraftForm po={po} onDone={() => setEditing(false)} /> : (
        <Card title="Lines" padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <caption className="sr-only">Lines on {po.number}</caption>
              <thead className="border-b border-line bg-paper-2/60 text-xs uppercase tracking-wide text-ink-3">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">Product</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">Ordered</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">Received</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">Rejected</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">Outstanding</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">Unit cost</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">Line total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {po.lines.map((l) => {
                  const pct = Number(l.qty_ordered) > 0 ? Math.min(100, Math.round((Number(l.qty_received) / Number(l.qty_ordered)) * 100)) : 0;
                  return (
                    <tr key={l.id}>
                      <td className="px-4 py-3"><p className="font-semibold text-ink">{l.name}</p><p className="text-xs text-ink-3">{l.sku}{l.tracks_batches ? " · batch-tracked" : ""}</p></td>
                      <td className="num px-4 py-3 text-right">{formatQty(l.qty_ordered, l.unit)}</td>
                      <td className="num px-4 py-3 text-right">
                        {formatQty(l.qty_received, l.unit)}
                        <span className="mt-1 block h-1.5 w-20 rounded-full bg-paper-2 sm:ml-auto" role="img" aria-label={`${pct}% received`}><span className="block h-1.5 rounded-full bg-primary" style={{ width: `${pct}%` }} /></span>
                      </td>
                      <td className="num px-4 py-3 text-right">{Number(l.qty_rejected) > 0 ? <span className="text-bad">{formatQty(l.qty_rejected, l.unit)}</span> : "—"}</td>
                      <td className="num px-4 py-3 text-right font-semibold">{formatQty(l.outstanding, l.unit)}</td>
                      <td className="num px-4 py-3 text-right">{money(l.unit_cost)}</td>
                      <td className="num px-4 py-3 text-right">{money(lineTotal(l.qty_ordered, l.unit_cost))}</td>
                    </tr>
                  );
                })}
                {!po.lines.length && <tr><td colSpan={7} className="px-4 py-8 text-center text-ink-3">This order has no lines yet.{write && po.status === "DRAFT" ? " Use Edit lines to add products." : ""}</td></tr>}
              </tbody>
              <tfoot><tr className="border-t border-line-strong"><th scope="row" colSpan={6} className="px-4 py-3 text-right text-sm font-semibold">Order total</th><td className="num px-4 py-3 text-right text-base font-semibold">{money(po.total_cost)}</td></tr></tfoot>
            </table>
          </div>
        </Card>
      )}

      <Card title={`Receipts (${po.receipts.length})`}>
        {!po.receipts.length ? <p className="text-sm text-ink-3">Nothing has been received against this order yet.</p> : (
          <ul className="space-y-5">
            {po.receipts.map((r) => (
              <li key={r.number} className="rounded-md border border-line">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line bg-paper-2/50 px-4 py-2.5 text-sm">
                  <p className="font-semibold text-ink">{r.number}</p>
                  <p className="text-ink-2">{formatDateTime(r.at)}{r.by ? ` · ${r.by}` : ""}{r.delivery_note ? ` · delivery note ${r.delivery_note}` : ""}</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[28rem] text-left text-sm">
                    <caption className="sr-only">Lines on receipt {r.number}</caption>
                    <thead className="text-xs uppercase tracking-wide text-ink-3"><tr><th scope="col" className="px-4 py-2 font-semibold">Product</th><th scope="col" className="px-4 py-2 text-right font-semibold">Accepted</th><th scope="col" className="px-4 py-2 text-right font-semibold">Rejected</th><th scope="col" className="px-4 py-2 font-semibold">Lot</th><th scope="col" className="px-4 py-2 font-semibold">Expiry</th></tr></thead>
                    <tbody className="divide-y divide-line">
                      {r.lines.map((l, i) => (
                        <tr key={i}>
                          <td className="px-4 py-2">{l.product}</td>
                          <td className="num px-4 py-2 text-right">{formatQty(l.accepted)}</td>
                          <td className="num px-4 py-2 text-right">{Number(l.rejected) > 0 ? <>{formatQty(l.rejected)}{l.reject_reason && <span className="block text-xs text-ink-3">{l.reject_reason}</span>}</> : "—"}</td>
                          <td className="px-4 py-2">{l.lot || "—"}</td>
                          <td className="px-4 py-2">{l.expiry ? formatDate(l.expiry, "en-US", { day: "numeric", month: "short", year: "numeric" }) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <ConfirmDialog open={dialog === "submit"} onOpenChange={(o) => !o && setDialog(null)} title={`Submit ${po.number}?`} loading={submit.mutation.isPending} confirmLabel="Submit order"
        description="Submitting locks the lines and makes the order ready to receive. The system doesn’t email the supplier, so send it to them yourself." onConfirm={() => submit.mutation.mutate(undefined)} />
      <ConfirmDialog open={dialog === "confirm"} onOpenChange={(o) => !o && setDialog(null)} title="Mark as confirmed by the supplier?" loading={confirm.mutation.isPending} confirmLabel="Mark as confirmed"
        description="Use this when the supplier has acknowledged the order. It only changes the status; you can still receive goods either way." onConfirm={() => confirm.mutation.mutate(undefined)} />
      {dialog === "cancel" && <CancelDialog po={po} onClose={() => setDialog(null)} />}
      {dialog === "details" && <DetailsDialog po={po} onClose={() => setDialog(null)} />}
      {dialog === "receive" && <ReceiveDialog po={po} onClose={() => setDialog(null)} onReplayed={setReplayed} />}
    </AdminPage>
  );
}

function CancelDialog({ po, onClose }: { po: PurchaseOrder; onClose: () => void }) {
  const [reason, setReason] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const { mutation, message, fieldErrors, clear } = useFormAction((body: { reason: string }) => adminRequest<PurchaseOrder>("POST", `/purchase-orders/${po.id}/cancel/`, body), { invalidate: PO, success: `${po.number} cancelled.`, onSuccess: onClose });
  const err = fieldErrors.reason ?? (touched && !reason.trim() ? "Say why the order is being cancelled." : undefined);
  return (
    <FormDialog onClose={onClose} onEdit={clear} title={`Cancel ${po.number}?`} description="A cancelled order can’t be reopened or received against. The reason is kept on the order." submitLabel="Cancel order" danger loading={mutation.isPending} message={message}
      onSubmit={() => { setTouched(true); if (reason.trim()) mutation.mutate({ reason: reason.trim() }); }}>
      <Field label="Reason" htmlFor="po-cancel-reason" required error={err}>
        <Textarea id="po-cancel-reason" className="min-h-20" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={err ? true : undefined} />
      </Field>
    </FormDialog>
  );
}

function DetailsDialog({ po, onClose }: { po: PurchaseOrder; onClose: () => void }) {
  const [expected, setExpected] = React.useState(po.expected_date ?? "");
  const [notes, setNotes] = React.useState(po.notes);
  const { mutation, message, fieldErrors, clear } = useFormAction((body: { expected_date: string | null; notes: string }) => adminRequest<PurchaseOrder>("PATCH", `/purchase-orders/${po.id}/`, body), { invalidate: PO, success: "Order details saved.", onSuccess: onClose });
  return (
    <FormDialog onClose={onClose} onEdit={clear} title="Edit date and notes" description="The lines are locked once an order is submitted. You can still change when it is expected and what the notes say." loading={mutation.isPending} message={message}
      onSubmit={() => mutation.mutate({ expected_date: expected || null, notes: notes.trim() })}>
      <Field label="Expected delivery date" htmlFor="po-det-date" error={fieldErrors.expected_date}><Input id="po-det-date" type="date" value={expected} onChange={(e) => setExpected(e.target.value)} /></Field>
      <Field label="Notes" htmlFor="po-det-notes" error={fieldErrors.notes}><Textarea id="po-det-notes" className="min-h-24" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
    </FormDialog>
  );
}
