"use client";

import * as React from "react";
import { ConfirmDialog } from "@/components/admin/kit";
import { FormDialog, useFormAction } from "@/components/admin/inventory/form-kit";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Textarea, describedBy } from "@/components/ui/field";
import { adminRequest } from "@/lib/admin";
import { slugify, validateTimeZone, validateWholeNumber } from "./forms";
import type { Branch } from "./types";

const REFRESH = ["/branches", "/zones", "/slot", "/closures", "perms"]; // perms: the header's store switcher is built from it

function timeZoneNames(): string[] {
  try { return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? []; } catch { return []; }
}

/** Create (no `branch`) or edit a store. Opening hours have their own editor; saving here never touches them. */
export function BranchDialog({ branch, onClose, onDeleted }: { branch?: Branch; onClose: () => void; onDeleted?: () => void }) {
  const editing = !!branch;
  const [name, setName] = React.useState(branch?.name ?? "");
  const [code, setCode] = React.useState(branch?.code ?? "");
  const [slug, setSlug] = React.useState(branch?.slug ?? "");
  const [derived, setDerived] = React.useState(!editing);
  const [line1, setLine1] = React.useState(branch?.address_line1 ?? "");
  const [line2, setLine2] = React.useState(branch?.address_line2 ?? "");
  const [city, setCity] = React.useState(branch?.city ?? "");
  const [area, setArea] = React.useState(branch?.area ?? "");
  const [postal, setPostal] = React.useState(branch?.postal_code ?? "");
  const [phone, setPhone] = React.useState(branch?.phone ?? "");
  const [email, setEmail] = React.useState(branch?.email ?? "");
  const [tz, setTz] = React.useState(branch?.timezone ?? "");
  const [active, setActive] = React.useState(branch?.is_active ?? true);
  const [isDefault, setIsDefault] = React.useState(branch?.is_default ?? false);
  const [delivery, setDelivery] = React.useState(branch?.offers_delivery ?? true);
  const [pickup, setPickup] = React.useState(branch?.offers_pickup ?? true);
  const [prep, setPrep] = React.useState(String(branch?.prep_minutes ?? 120));
  const [instructions, setInstructions] = React.useState(branch?.pickup_instructions ?? "");
  const [touched, setTouched] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const zones = React.useMemo(timeZoneNames, []);

  const save = useFormAction(
    (body: Record<string, unknown>) => (editing ? adminRequest<Branch>("PATCH", `/branches/${branch!.id}/`, body) : adminRequest<Branch>("POST", "/branches/", body)),
    { invalidate: REFRESH, success: editing ? "Store saved." : "Store created. Set its opening hours next.", onSuccess: onClose },
  );
  const del = useFormAction(() => adminRequest("DELETE", `/branches/${branch!.id}/`), {
    invalidate: REFRESH, success: "Store deleted.", onSuccess: () => { setConfirmDelete(false); onDeleted?.(); onClose(); }, onError: () => setConfirmDelete(false),
  });

  const errors: Record<string, string | undefined> = {
    name: !name.trim() ? "Enter the store’s name." : undefined,
    code: !code.trim() ? "Enter a short code." : !/^[-a-zA-Z0-9_]+$/.test(code.trim()) ? "Use letters, numbers, hyphens and underscores only." : undefined,
    slug: !slug.trim() ? "Enter a URL name." : !/^[-a-zA-Z0-9_]+$/.test(slug.trim()) ? "Use letters, numbers, hyphens and underscores only." : undefined,
    line1: !line1.trim() ? "Enter the street address." : undefined,
    city: !city.trim() ? "Enter the town or city." : undefined,
    prep: validateWholeNumber(prep, { min: 0, max: 100000, label: "number of minutes" }) ?? undefined,
    tz: validateTimeZone(tz) ?? undefined,
  };
  const submit = () => {
    setTouched(true);
    if (Object.values(errors).some(Boolean)) return;
    save.mutation.mutate({
      name: name.trim(), code: code.trim(), slug: slug.trim(), address_line1: line1.trim(), address_line2: line2.trim(), city: city.trim(), area: area.trim(), postal_code: postal.trim(),
      phone: phone.trim(), email: email.trim(), timezone: tz.trim(), is_active: active, is_default: isDefault, offers_delivery: delivery, offers_pickup: pickup,
      prep_minutes: Number(prep), pickup_instructions: instructions.trim(),
    });
  };
  const fe = save.fieldErrors;
  const e = (k: string, server?: string) => server ?? (touched ? errors[k] : undefined);
  const inv = (k: string, server?: string) => (e(k, server) ? true : undefined);

  return (
    <>
      <FormDialog wide onClose={onClose} onEdit={save.clear} title={editing ? `Edit ${branch!.name}` : "New store"} description={editing ? "Changes apply to the storefront straight away." : "Add a store, then set its opening hours and delivery zones."}
        submitLabel={editing ? "Save changes" : "Create store"} onSubmit={submit} loading={save.mutation.isPending} message={save.message ?? del.message}
        footerNote={editing ? <Button variant="ghost" size="sm" className="text-bad hover:bg-bad-soft" onClick={() => setConfirmDelete(true)}>Delete store</Button> : undefined}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Store name" htmlFor="br-name" required error={e("name", fe.name)}>
            <Input id="br-name" maxLength={120} value={name} onChange={(ev) => { setName(ev.target.value); if (derived) setSlug(slugify(ev.target.value)); }} aria-invalid={inv("name", fe.name)} aria-describedby={describedBy("br-name", false, !!e("name", fe.name))} />
          </Field>
          <Field label="Code" htmlFor="br-code" required error={e("code", fe.code)} hint="Short and unique, for example central.">
            <Input id="br-code" maxLength={20} value={code} onChange={(ev) => setCode(ev.target.value)} aria-invalid={inv("code", fe.code)} aria-describedby={describedBy("br-code", true, !!e("code", fe.code))} />
          </Field>
          <Field label="URL name" htmlFor="br-slug" required error={e("slug", fe.slug)} hint="Used in the store’s web address." className="sm:col-span-2">
            <Input id="br-slug" maxLength={80} value={slug} onChange={(ev) => { setSlug(ev.target.value); setDerived(false); }} aria-invalid={inv("slug", fe.slug)} aria-describedby={describedBy("br-slug", true, !!e("slug", fe.slug))} />
          </Field>
          <Field label="Address line 1" htmlFor="br-l1" required error={e("line1", fe.address_line1)}><Input id="br-l1" maxLength={160} value={line1} onChange={(ev) => setLine1(ev.target.value)} aria-invalid={inv("line1", fe.address_line1)} /></Field>
          <Field label="Address line 2" htmlFor="br-l2" error={fe.address_line2}><Input id="br-l2" maxLength={160} value={line2} onChange={(ev) => setLine2(ev.target.value)} /></Field>
          <Field label="Town or city" htmlFor="br-city" required error={e("city", fe.city)}><Input id="br-city" maxLength={80} value={city} onChange={(ev) => setCity(ev.target.value)} aria-invalid={inv("city", fe.city)} /></Field>
          <Field label="Area or district" htmlFor="br-area" error={fe.area}><Input id="br-area" maxLength={80} value={area} onChange={(ev) => setArea(ev.target.value)} /></Field>
          <Field label="Postcode" htmlFor="br-post" error={fe.postal_code}><Input id="br-post" maxLength={16} value={postal} onChange={(ev) => setPostal(ev.target.value)} /></Field>
          <Field label="Phone" htmlFor="br-phone" error={fe.phone}><Input id="br-phone" type="tel" maxLength={40} value={phone} onChange={(ev) => setPhone(ev.target.value)} /></Field>
          <Field label="Email" htmlFor="br-email" error={fe.email}><Input id="br-email" type="email" maxLength={254} value={email} onChange={(ev) => setEmail(ev.target.value)} /></Field>
          <Field label="Timezone" htmlFor="br-tz" error={e("tz", fe.timezone)} hint="Leave blank to use the store-wide timezone. Slot times are read in this timezone.">
            <Input id="br-tz" list="br-tz-list" maxLength={64} autoComplete="off" placeholder="Same as the shop" value={tz} onChange={(ev) => setTz(ev.target.value)} aria-invalid={inv("tz", fe.timezone)} aria-describedby={describedBy("br-tz", true, !!e("tz", fe.timezone))} />
            <datalist id="br-tz-list">{zones.map((z) => <option key={z} value={z} />)}</datalist>
          </Field>
          <Field label="Preparation time (minutes)" htmlFor="br-prep" required error={e("prep", fe.prep_minutes)} hint="The earliest a customer can book is this long after ordering.">
            <Input id="br-prep" inputMode="numeric" value={prep} onChange={(ev) => setPrep(ev.target.value)} aria-invalid={inv("prep", fe.prep_minutes)} aria-describedby={describedBy("br-prep", true, !!e("prep", fe.prep_minutes))} />
          </Field>
          <Field label="Pickup instructions" htmlFor="br-instr" error={fe.pickup_instructions} className="sm:col-span-2" hint="Shown to customers collecting an order. Up to 300 characters.">
            <Textarea id="br-instr" className="min-h-16" maxLength={300} value={instructions} onChange={(ev) => setInstructions(ev.target.value)} />
          </Field>
        </div>
        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-semibold text-ink">Services and visibility</legend>
          <Checkbox label="Offers home delivery" checked={delivery} onChange={(ev) => setDelivery(ev.target.checked)} />
          <Checkbox label="Offers pickup" checked={pickup} onChange={(ev) => setPickup(ev.target.checked)} />
          <Checkbox label="Active (customers can order from it)" checked={active} onChange={(ev) => setActive(ev.target.checked)} />
          <Checkbox label={<>Default store{!branch?.is_default && isDefault ? <span className="block text-xs text-ink-3">Whichever store is the default now will stop being the default.</span> : null}</>} checked={isDefault} onChange={(ev) => setIsDefault(ev.target.checked)} />
        </fieldset>
      </FormDialog>
      {editing && (
        <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} title={`Delete ${branch!.name}?`} description="This permanently removes the store, its hours, zones and slot templates. A store with orders or stock can’t be deleted; make it inactive instead."
          confirmLabel="Delete store" danger loading={del.mutation.isPending} onConfirm={() => del.mutation.mutate(undefined)} />
      )}
    </>
  );
}
