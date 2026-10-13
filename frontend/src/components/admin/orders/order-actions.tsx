"use client";

// The buttons that move an order forward. One component serves the order page and the pick sheet, so both offer exactly
// the same actions: each is derived from the API's `allowed_transitions` and calls a real endpoint.
import * as React from "react";
import { ConfirmDialog } from "@/components/admin/kit";
import { Button } from "@/components/ui/button";
import { Field, Input, describedBy } from "@/components/ui/field";
import { Alert } from "@/components/ui/states";
import { fieldErrorsOf, useAdmin } from "@/lib/admin";
import { cn } from "@/lib/cn";
import { useMoney } from "@/lib/hooks";
import { actionDefinition, availableActions, pickProgress, type OrderAction, type OrderActionKey } from "./actions";
import { CancelDialog } from "./cancel-dialog";
import { decimalInput, fmtMoney, parseMoney } from "./decimal";
import { ErrorAlert, useAsyncTask, useOrderApi } from "./shared";
import type { OrderDetail } from "./types";

interface Props {
  order: OrderDetail;
  /** Called with the fresh order after an action succeeded. */
  onDone?: (action: OrderAction, order: OrderDetail) => void;
  /** Called when the API refused an action (e.g. lines still open), so the page can point at the problem. */
  onFailure?: (action: OrderAction, error: unknown) => void;
  size?: "sm" | "md" | "lg";
  className?: string;
  /** The pick sheet leaves cancelling to the order page, so it is never one mis-tap away from "Finish picking". */
  hideCancel?: boolean;
}

export function OrderActions({ order, onDone, onFailure, size = "md", className, hideCancel }: Props) {
  const { can } = useAdmin();
  const call = useOrderApi(order.number);
  const task = useAsyncTask();
  const [confirming, setConfirming] = React.useState<OrderAction | null>(null);
  const [cancelling, setCancelling] = React.useState(false);
  const [running, setRunning] = React.useState<OrderActionKey | null>(null);
  const [inlineError, setInlineError] = React.useState<unknown>(null);

  const actions = availableActions(order, can).filter((a) => !(hideCancel && a.key === "cancel"));
  const progress = pickProgress(order.items);

  const run = async (action: OrderAction, body?: unknown, dialog = false) => {
    let failure: unknown;
    setRunning(action.key);
    const data = await task.run(async () => {
      try {
        return await call(action.endpoint, body);
      } catch (e) {
        failure = e;
        throw e;
      }
    });
    setRunning(null);
    if (data) {
      setConfirming(null);
      onDone?.(action, data);
    } else if (failure) {
      if (!dialog) setInlineError(failure);
      onFailure?.(action, failure);
    }
  };

  const click = (a: OrderAction) => {
    task.reset();
    setInlineError(null);
    if (a.key === "cancel") setCancelling(true);
    else if (a.confirm) setConfirming(a);
    else void run(a);
  };

  const blocker = (a: OrderAction) => {
    if (a.key !== "finish-picking" || progress.openIds.length === 0) return null;
    const todo = progress.todoIds.length;
    if (todo === 0) return "Waiting for the customer to answer a substitution.";
    return `${todo} ${todo === 1 ? "line is" : "lines are"} still to do${progress.awaitingCustomer ? ", and a substitution is waiting for the customer" : ""}.`;
  };

  if (!actions.length) return null;
  const finish = actions.find((a) => a.key === "finish-picking");
  const why = finish ? blocker(finish) : null;
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {actions.map((a) => (
        <Button key={a.key} size={size} variant={a.variant === "danger" ? "secondary" : a.variant} className={a.variant === "danger" ? "border-bad/40 text-bad hover:bg-bad-soft" : undefined}
          disabled={task.busy || (a.key === "finish-picking" && !!why)} loading={running === a.key && !confirming} aria-describedby={a.key === "finish-picking" && why ? "finish-picking-why" : undefined} onClick={() => click(a)}>
          {a.label}
        </Button>
      ))}
      {why && <p id="finish-picking-why" className="basis-full text-sm text-ink-2">{why}</p>}
      {inlineError != null && !confirming && <div className="basis-full"><ErrorAlert error={inlineError} /></div>}

      {confirming && confirming.key !== "complete" && (
        <ConfirmDialog open onOpenChange={(o) => { if (!o && !task.busy) setConfirming(null); }} loading={task.busy} title={confirming.confirm!.title} description={confirming.confirm!.description}
          confirmLabel={confirming.confirm!.confirmLabel} onConfirm={() => run(confirming, undefined, true)}>
          {confirming.key === "finish-picking" && !progress.anyDelivered && <Alert tone="warn" title="Nothing has been picked">If you continue, the order is cancelled because none of the items could be supplied.</Alert>}
          {task.error != null && <ErrorAlert error={task.error} />}
        </ConfirmDialog>
      )}
      {confirming?.key === "complete" && (
        <CompleteDialog order={order} action={confirming} busy={task.busy} error={task.error} onClose={() => { if (!task.busy) setConfirming(null); }} onSubmit={(body) => run(confirming, body, true)} />
      )}
      <CancelDialog order={order} open={cancelling} onOpenChange={setCancelling} onDone={(o) => onDone?.(actionDefinition("cancel", order.fulfilment_type), o)} />
    </div>
  );
}

/** Handover. For cash-on-delivery the amount collected must be recorded and the server checks it matches what is due. */
function CompleteDialog({ order, action, busy, error, onClose, onSubmit }: { order: OrderDetail; action: OrderAction; busy: boolean; error: unknown; onClose: () => void; onSubmit: (body?: unknown) => void }) {
  const money = useMoney();
  const cod = order.payment_method === "COD";
  const due = order.totals.final_total ?? order.totals.total;
  const [amount, setAmount] = React.useState(due);
  const [reference, setReference] = React.useState("");
  const [clientError, setClientError] = React.useState("");
  const fe = fieldErrorsOf(error);
  const amountError = clientError || fe.collected_amount;

  const submit = () => {
    if (!cod) { onSubmit(); return; }
    const cents = parseMoney(amount.trim());
    if (cents === null || cents < 0n) { setClientError("Enter the amount collected, like 14.00."); return; }
    setClientError("");
    onSubmit({ collected_amount: fmtMoney(cents), reference: reference.trim() });
  };

  return (
    <ConfirmDialog open onOpenChange={(o) => { if (!o) onClose(); }} loading={busy} title={action.confirm!.title} description={action.confirm!.description} confirmLabel={action.confirm!.confirmLabel} onConfirm={submit}>
      {cod && (
        <div className="space-y-4">
          <Alert tone="info" title={`${money(due)} is due in cash`}>This is a pay-on-{order.fulfilment_type === "DELIVERY" ? "delivery" : "pickup"} order. Record what you actually collected; it must match the amount due.</Alert>
          <Field label="Amount collected" htmlFor="collected-amount" required error={amountError}>
            <Input id="collected-amount" inputMode="decimal" value={amount} aria-invalid={!!amountError} aria-describedby={describedBy("collected-amount", false, !!amountError)} onChange={(e) => { setAmount(decimalInput(e.target.value)); setClientError(""); }} />
          </Field>
          <Field label="Receipt or reference (optional)" htmlFor="collected-ref" error={fe.reference}>
            <Input id="collected-ref" value={reference} maxLength={120} onChange={(e) => setReference(e.target.value)} />
          </Field>
        </div>
      )}
      {error != null && !fe.collected_amount && !fe.reference && <ErrorAlert error={error} />}
    </ConfirmDialog>
  );
}
