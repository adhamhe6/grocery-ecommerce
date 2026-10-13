"use client";

import * as React from "react";
import { ConfirmDialog } from "@/components/admin/kit";
import { FormDialog, useFormAction } from "@/components/admin/inventory/form-kit";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea, describedBy } from "@/components/ui/field";
import { adminRequest } from "@/lib/admin";
import { SUPPLIER_STATUSES, type Supplier, type SupplierStatus } from "./types";

const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 20).replace(/-+$/g, "");

/** Create (no `supplier`) or edit a supplier. Fields are exactly those of the API: there is no payment-terms field. */
export function SupplierDialog({ supplier, onClose, onSaved, onDeleted }: { supplier?: Supplier; onClose: () => void; onSaved?: (s: Supplier) => void; onDeleted?: () => void }) {
  const editing = !!supplier;
  const [name, setName] = React.useState(supplier?.name ?? "");
  const [code, setCode] = React.useState(supplier?.code ?? "");
  const [codeTouched, setCodeTouched] = React.useState(editing);
  const [contact, setContact] = React.useState(supplier?.contact_name ?? "");
  const [email, setEmail] = React.useState(supplier?.email ?? "");
  const [phone, setPhone] = React.useState(supplier?.phone ?? "");
  const [address, setAddress] = React.useState(supplier?.address ?? "");
  const [status, setStatus] = React.useState<SupplierStatus>(supplier?.status ?? "ACTIVE");
  const [lead, setLead] = React.useState(String(supplier?.lead_time_days ?? 2));
  const [notes, setNotes] = React.useState(supplier?.notes ?? "");
  const [touched, setTouched] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  const save = useFormAction(
    (body: Record<string, unknown>) => (editing ? adminRequest<Supplier>("PATCH", `/suppliers/${supplier!.id}/`, body) : adminRequest<Supplier>("POST", "/suppliers/", body)),
    { invalidate: ["/suppliers"], success: editing ? "Supplier saved." : "Supplier created.", onSuccess: (s) => { onSaved?.(s); onClose(); } },
  );
  const del = useFormAction(() => adminRequest("DELETE", `/suppliers/${supplier!.id}/`), {
    invalidate: ["/suppliers"], success: "Supplier deleted.", onSuccess: () => { setConfirmDelete(false); onDeleted?.(); onClose(); }, onError: () => setConfirmDelete(false),
  });

  const leadOk = /^\d{1,5}$/.test(lead.trim()) && Number(lead) <= 32767;
  const errors = {
    name: !name.trim() ? "Enter the supplier’s name." : undefined,
    code: !code.trim() ? "Enter a short code." : !/^[-a-zA-Z0-9_]+$/.test(code.trim()) ? "Use letters, numbers, hyphens and underscores only." : undefined,
    lead: !leadOk ? "Enter a whole number of days, 0 or more." : undefined,
  };
  const submit = () => {
    setTouched(true);
    if (errors.name || errors.code || errors.lead) return;
    save.mutation.mutate({
      name: name.trim(), code: code.trim(), contact_name: contact.trim(), email: email.trim(), phone: phone.trim(), address: address.trim(),
      status, lead_time_days: Number(lead), notes: notes.trim(),
    });
  };
  const fe = save.fieldErrors;
  const err = (k: keyof typeof errors, server?: string) => server ?? (touched ? errors[k] : undefined);

  return (
    <>
      <FormDialog onClose={onClose} onEdit={save.clear} title={editing ? `Edit ${supplier!.name}` : "New supplier"} description={editing ? undefined : "Add a supplier you buy stock from. You can link the products they sell afterwards."}
        submitLabel={editing ? "Save changes" : "Create supplier"} onSubmit={submit} loading={save.mutation.isPending} message={save.message ?? del.message} wide
        footerNote={editing ? <Button variant="ghost" size="sm" className="text-bad hover:bg-bad-soft" onClick={() => setConfirmDelete(true)}>Delete supplier</Button> : undefined}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="sup-name" required error={err("name", fe.name)}>
            <Input id="sup-name" maxLength={140} value={name} onChange={(e) => { setName(e.target.value); if (!codeTouched) setCode(slugify(e.target.value)); }} aria-invalid={!!err("name", fe.name) || undefined} aria-describedby={describedBy("sup-name", false, !!err("name", fe.name))} />
          </Field>
          <Field label="Code" htmlFor="sup-code" required error={err("code", fe.code)} hint="Short and unique, for example millbrook.">
            <Input id="sup-code" maxLength={20} value={code} onChange={(e) => { setCode(e.target.value); setCodeTouched(true); }} aria-invalid={!!err("code", fe.code) || undefined} aria-describedby={describedBy("sup-code", true, !!err("code", fe.code))} />
          </Field>
          <Field label="Contact name" htmlFor="sup-contact" error={fe.contact_name}><Input id="sup-contact" maxLength={120} value={contact} onChange={(e) => setContact(e.target.value)} /></Field>
          <Field label="Email" htmlFor="sup-email" error={fe.email}><Input id="sup-email" type="email" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Phone" htmlFor="sup-phone" error={fe.phone}><Input id="sup-phone" type="tel" maxLength={40} value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
          <Field label="Lead time (days)" htmlFor="sup-lead" required error={err("lead", fe.lead_time_days)} hint="How long they usually take to deliver. Sets the default expected date on new orders.">
            <Input id="sup-lead" inputMode="numeric" value={lead} onChange={(e) => setLead(e.target.value)} aria-invalid={!!err("lead", fe.lead_time_days) || undefined} aria-describedby={describedBy("sup-lead", true, !!err("lead", fe.lead_time_days))} />
          </Field>
          <Field label="Status" htmlFor="sup-status" error={fe.status} hint="Only active suppliers can receive new purchase orders." className="sm:col-span-2">
            <Select id="sup-status" value={status} onChange={(e) => setStatus(e.target.value as SupplierStatus)}>
              {SUPPLIER_STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </Field>
          <Field label="Address" htmlFor="sup-address" error={fe.address} className="sm:col-span-2"><Textarea id="sup-address" className="min-h-16" value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
          <Field label="Internal notes" htmlFor="sup-notes" error={fe.notes} className="sm:col-span-2"><Textarea id="sup-notes" className="min-h-16" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        </div>
      </FormDialog>
      {editing && (
        <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} title={`Delete ${supplier!.name}?`} description="This permanently removes the supplier. A supplier with purchase orders or stock history can’t be deleted; set it to inactive instead."
          confirmLabel="Delete supplier" danger loading={del.mutation.isPending} onConfirm={() => del.mutation.mutate(undefined)} />
      )}
    </>
  );
}
