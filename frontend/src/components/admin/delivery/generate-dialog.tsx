"use client";

import * as React from "react";
import { FormDialog, useFormAction } from "@/components/admin/inventory/form-kit";
import { Field, Input } from "@/components/ui/field";
import { Alert } from "@/components/ui/states";
import { adminRequest, useAdmin } from "@/lib/admin";
import { validateWholeNumber } from "./forms";

/** POST /slots/generate/ — creates slots from active templates; safe to repeat because existing slots are left alone. */
export function GenerateDialog({ branchId, onClose }: { branchId: number; onClose: () => void }) {
  const { branches } = useAdmin();
  const name = branches.find((b) => b.id === branchId)?.name ?? "this store";
  const [days, setDays] = React.useState("14");
  const [touched, setTouched] = React.useState(false);
  const [created, setCreated] = React.useState<number | null>(null);
  const { mutation, message, clear } = useFormAction(
    (body: { branch_id: number; days_ahead: number }) => adminRequest<{ created: number }>("POST", "/slots/generate/", body),
    { invalidate: ["/slots"], success: (d) => `${d.created} ${d.created === 1 ? "slot" : "slots"} created.`, onSuccess: (d) => setCreated(d.created) },
  );
  const error = validateWholeNumber(days, { min: 1, max: 28, label: "number of days" }) ?? undefined;
  const submit = () => {
    setTouched(true);
    if (error) return;
    setCreated(null);
    mutation.mutate({ branch_id: branchId, days_ahead: Number(days) });
  };
  return (
    <FormDialog onClose={onClose} onEdit={() => { clear(); setCreated(null); }} title="Generate slots" description={`Creates bookable slots for ${name} from its active templates, for today and the days that follow.`}
      submitLabel={created === null ? "Generate slots" : "Generate again"} onSubmit={submit} loading={mutation.isPending} message={message}>
      <Field label="How many days ahead" htmlFor="gen-days" required error={touched ? error : undefined} hint="From 1 to 28. Slots are only made on days the store is open and not closed, and only inside its opening hours. Existing slots are left alone, so running this again is safe.">
        <Input id="gen-days" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
      </Field>
      {created !== null && (
        created > 0
          ? <Alert tone="ok" title={`${created} new ${created === 1 ? "slot" : "slots"} created`}>They are open for booking now. Look for them on the Generated slots tab.</Alert>
          : <Alert tone="info" title="No new slots were needed">Either these days already have their slots, or no active template falls inside the store’s opening hours on its open days. Check the templates and the store’s opening hours.</Alert>
      )}
    </FormDialog>
  );
}
