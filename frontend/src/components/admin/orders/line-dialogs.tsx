"use client";

// Dialogs for the per-line fulfilment decisions: unavailable → substitute / remove, and recording a customer's answer.
import * as React from "react";
import { ConfirmDialog } from "@/components/admin/kit";
import { ChoiceGroup, Field, Input, Textarea, describedBy } from "@/components/ui/field";
import { Alert, Skeleton } from "@/components/ui/states";
import { fieldErrorsOf, useAdminGet } from "@/lib/admin";
import { useMoney } from "@/lib/hooks";
import { effectivePolicy, POLICY_LABELS } from "./actions";
import { decimalInput, normaliseQty } from "./decimal";
import { ErrorAlert, orderPath, useAsyncTask, useOrderApi } from "./shared";
import type { OrderDetail, StaffItem, SubstituteResponse, SubstitutionRow } from "./types";

const REASON_MAX = 300;

function policyOf(order: OrderDetail, item: StaffItem) {
  return effectivePolicy(order.substitution_policy, item.substitution_pref);
}

/** Mark a line as not available. What happens next depends on the customer's substitution choice, so say so up front. */
export function UnavailableDialog({ order, item, onClose }: { order: OrderDetail; item: StaffItem | null; onClose: () => void }) {
  const call = useOrderApi(order.number);
  const task = useAsyncTask();
  const [reason, setReason] = React.useState("");
  React.useEffect(() => {
    setReason(""); task.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when a different line is opened
  }, [item?.id]);
  const policy = item ? policyOf(order, item) : "ALLOW";
  const submit = async () => {
    if (!item) return;
    const data = await task.run(() => call(`items/${item.id}/unavailable/`, { reason: reason.trim() }));
    if (data) onClose();
  };
  return (
    <ConfirmDialog open={!!item} onOpenChange={(o) => { if (!o && !task.busy) onClose(); }} danger loading={task.busy} confirmLabel="Mark unavailable" title={item ? `Can't supply ${item.name}?` : "Unavailable"}
      description="The reserved stock for this line is released." onConfirm={submit}>
      <div className="space-y-4">
        <Alert tone={policy === "NONE" ? "warn" : "info"} title={`Customer's choice: ${POLICY_LABELS[policy].toLowerCase()}`}>
          {policy === "NONE" ? "This line is removed straight away and the customer is not charged for it." : policy === "CONTACT" ? "Next you can propose a replacement. The customer must approve it before picking can finish." : "Next you can propose a replacement; it is applied without asking, and the customer pays no more than the original."}
        </Alert>
        <Field label="Note (optional)" htmlFor="unavailable-reason" error={fieldErrorsOf(task.error).reason}>
          <Input id="unavailable-reason" value={reason} maxLength={REASON_MAX} placeholder="e.g. shelf empty, damaged stock" onChange={(e) => setReason(e.target.value)} />
        </Field>
        {task.error != null && !fieldErrorsOf(task.error).reason && <ErrorAlert error={task.error} />}
      </div>
    </ConfirmDialog>
  );
}

/** Drop an unavailable line when no replacement will be offered. */
export function RemoveLineDialog({ order, item, onClose }: { order: OrderDetail; item: StaffItem | null; onClose: () => void }) {
  const call = useOrderApi(order.number);
  const task = useAsyncTask();
  const [reason, setReason] = React.useState("");
  React.useEffect(() => {
    setReason(""); task.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when a different line is opened
  }, [item?.id]);
  const submit = async () => {
    if (!item) return;
    const data = await task.run(() => call(`items/${item.id}/remove/`, { reason: reason.trim() }));
    if (data) onClose();
  };
  return (
    <ConfirmDialog open={!!item} onOpenChange={(o) => { if (!o && !task.busy) onClose(); }} danger loading={task.busy} confirmLabel="Remove line" title={item ? `Remove ${item.name}?` : "Remove line"}
      description="The customer is told the item was unavailable and is not charged for it." onConfirm={submit}>
      <Field label="Reason (optional)" htmlFor="remove-reason" error={fieldErrorsOf(task.error).reason}>
        <Input id="remove-reason" value={reason} maxLength={REASON_MAX} placeholder="No suitable substitute" onChange={(e) => setReason(e.target.value)} />
      </Field>
      {task.error != null && !fieldErrorsOf(task.error).reason && <ErrorAlert error={task.error} />}
    </ConfirmDialog>
  );
}

/** Pick a replacement from the API's list of eligible candidates (same category, in stock, allergen/claims rules satisfied). */
export function SubstituteDialog({ order, item, onClose }: { order: OrderDetail; item: StaffItem | null; onClose: () => void }) {
  const money = useMoney();
  const call = useOrderApi(order.number);
  const task = useAsyncTask();
  const [productId, setProductId] = React.useState<string>("");
  const [quantity, setQuantity] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [clientErrors, setClientErrors] = React.useState<{ product?: string; quantity?: string }>({});
  const q = useAdminGet<SubstituteResponse>(item ? `${orderPath(order.number)}items/${item.id}/substitutes/` : "/orders/", {}, { enabled: !!item });
  React.useEffect(() => {
    setProductId(""); setQuantity(""); setReason(""); setClientErrors({}); task.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when a different line is opened
  }, [item?.id]);

  const policy = q.data?.policy ?? (item ? policyOf(order, item) : "ALLOW");
  const fe = fieldErrorsOf(task.error);
  const submit = async () => {
    if (!item) return;
    const errs: typeof clientErrors = {};
    if (!productId) errs.product = "Choose a replacement product.";
    let qty: string | undefined;
    if (quantity.trim()) {
      const n = normaliseQty(quantity.trim());
      if (n === null || n === "0") errs.quantity = "Enter a quantity with at most 3 decimals, like 2 or 0.5.";
      else qty = n;
    }
    setClientErrors(errs);
    if (errs.product || errs.quantity) return;
    const body: Record<string, unknown> = { product_id: Number(productId), reason: reason.trim() };
    if (qty) body.quantity = qty;
    const data = await task.run(() => call(`items/${item.id}/substitute/`, body));
    if (data) onClose();
  };

  const candidates = q.data?.candidates ?? [];
  return (
    <ConfirmDialog open={!!item} onOpenChange={(o) => { if (!o && !task.busy) onClose(); }} loading={task.busy} confirmLabel={policy === "CONTACT" ? "Propose to customer" : "Substitute"} title={item ? `Replace ${item.name}` : "Replace item"}
      description="Only replacements the system considers like-for-like are listed: same category, in stock, and no new allergens." onConfirm={submit}>
      <div className="space-y-4">
        <Alert tone="info" title={POLICY_LABELS[policy]}>
          {policy === "CONTACT" ? "The customer is asked to approve this replacement. Picking can't be finished until they answer." : order.policy.substitution_price_cap ? "Applied straight away. The customer never pays more than the original line price." : "Applied straight away at the replacement's price."}
        </Alert>
        {q.isLoading ? <div className="space-y-2" aria-busy="true"><Skeleton className="h-14" /><Skeleton className="h-14" /></div>
          : q.error ? <ErrorAlert error={q.error} title="We couldn't load replacements" />
          : candidates.length === 0 ? <Alert tone="warn" title="No eligible replacement">Nothing in stock matches this item closely enough. Close this window and remove the line instead.</Alert>
          : (
            <>
              <ChoiceGroup name="substitute" legend="Replacement" value={productId} onChange={setProductId}
                options={candidates.map((c) => ({ value: String(c.product_id), title: c.name, description: `${c.brand ? `${c.brand} · ` : ""}${money(c.price)} per ${c.unit}` }))} />
              {(clientErrors.product || fe.product_id) && <p role="alert" className="text-sm font-medium text-bad">{clientErrors.product ?? fe.product_id}</p>}
              <Field label="Quantity (optional)" htmlFor="sub-qty" error={clientErrors.quantity ?? fe.quantity} hint={`Leave blank to replace the ${item?.ordered_qty ?? ""} ordered.`}>
                <Input id="sub-qty" inputMode="decimal" value={quantity} aria-invalid={!!(clientErrors.quantity ?? fe.quantity)} aria-describedby={describedBy("sub-qty", true, !!(clientErrors.quantity ?? fe.quantity))} onChange={(e) => setQuantity(decimalInput(e.target.value))} />
              </Field>
              <Field label="Note for the customer (optional)" htmlFor="sub-reason" error={fe.reason}>
                <Input id="sub-reason" value={reason} maxLength={REASON_MAX} placeholder="e.g. same size, different brand" onChange={(e) => setReason(e.target.value)} />
              </Field>
            </>
          )}
        {task.error != null && !fe.product_id && !fe.quantity && !fe.reason && <ErrorAlert error={task.error} />}
      </div>
    </ConfirmDialog>
  );
}

/** A manager records the customer's answer on their behalf (e.g. after phoning them). The note is mandatory and logged. */
export function DecideDialog({ order, substitution, onClose }: { order: OrderDetail; substitution: SubstitutionRow | null; onClose: () => void }) {
  const money = useMoney();
  const call = useOrderApi(order.number);
  const task = useAsyncTask();
  const [answer, setAnswer] = React.useState<"yes" | "no" | "">("");
  const [note, setNote] = React.useState("");
  const [errors, setErrors] = React.useState<{ answer?: string; note?: string }>({});
  React.useEffect(() => {
    setAnswer(""); setNote(""); setErrors({}); task.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when a different substitution is opened
  }, [substitution?.id]);

  const submit = async () => {
    if (!substitution) return;
    const errs: typeof errors = {};
    if (!answer) errs.answer = "Choose what the customer said.";
    if (!note.trim()) errs.note = "Say how the customer answered, e.g. “phoned at 10:42”. It is recorded on the order.";
    setErrors(errs);
    if (errs.answer || errs.note) return;
    const data = await task.run(() => call(`substitutions/${substitution.id}/decide/`, { approve: answer === "yes", note: note.trim() }));
    if (data) onClose();
  };
  const noteError = errors.note ?? fieldErrorsOf(task.error).note;

  return (
    <ConfirmDialog open={!!substitution} onOpenChange={(o) => { if (!o && !task.busy) onClose(); }} loading={task.busy} confirmLabel="Record answer" title="Record the customer's answer"
      description={substitution ? `${substitution.original} → ${substitution.substitute}, ${money(substitution.charged_unit_price)} each. Use this only when the customer has told you their decision, for example by phone.` : undefined} onConfirm={submit}>
      <div className="space-y-4">
        <ChoiceGroup name="decide" legend="Customer's answer" value={answer} onChange={(v) => { setAnswer(v); setErrors((e) => ({ ...e, answer: undefined })); }}
          options={[{ value: "yes", title: "Approved the replacement" }, { value: "no", title: "Declined — remove the item and don't charge" }]} />
        {errors.answer && <p role="alert" className="text-sm font-medium text-bad">{errors.answer}</p>}
        <Field label="How did they answer?" htmlFor="decide-note" required error={noteError}>
          <Textarea id="decide-note" value={note} maxLength={200} aria-invalid={!!noteError} aria-describedby={describedBy("decide-note", false, !!noteError)} onChange={(e) => { setNote(e.target.value); setErrors((x) => ({ ...x, note: undefined })); }} />
        </Field>
        {task.error != null && !fieldErrorsOf(task.error).note && <ErrorAlert error={task.error} />}
      </div>
    </ConfirmDialog>
  );
}
