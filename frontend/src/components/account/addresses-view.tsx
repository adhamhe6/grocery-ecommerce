"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { MapPin, Pencil, Plus, Trash2 } from "lucide-react";
import * as React from "react";
import { useForm } from "react-hook-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Textarea, describedBy } from "@/components/ui/field";
import { Alert, EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { addressSchema, type AddressValues } from "@/lib/account-schemas";
import { useAddressActions, useAddresses } from "@/lib/account-hooks";
import { applyApiErrors } from "@/lib/form-errors";
import type { Address } from "@/lib/types";
import { ConfirmDialog } from "./confirm-dialog";

const FIELDS = ["label", "recipient_name", "phone", "line1", "line2", "city", "area", "postal_code", "instructions", "is_default"] as const;

const toValues = (a?: Address, defaultOn = false): AddressValues => ({
  label: a?.label ?? "",
  recipient_name: a?.recipient_name ?? "",
  phone: a?.phone ?? "",
  line1: a?.line1 ?? "",
  line2: a?.line2 ?? "",
  city: a?.city ?? "",
  area: a?.area ?? "",
  postal_code: a?.postal_code ?? "",
  instructions: a?.instructions ?? "",
  is_default: a?.is_default ?? defaultOn,
});

// ------------------------------------------------------------------ create / edit form
function AddressForm({ address, isFirst, onDone }: { address?: Address; isFirst: boolean; onDone: () => void }) {
  const { create, update } = useAddressActions();
  const toast = useToast();
  const [formError, setFormError] = React.useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<AddressValues>({ resolver: zodResolver(addressSchema), defaultValues: toValues(address, isFirst) });
  const pending = create.isPending || update.isPending;
  const err = (k: keyof AddressValues) => errors[k]?.message;
  const props = (id: string, k: keyof AddressValues, hint = false) => ({ id, "aria-invalid": !!errors[k], "aria-describedby": describedBy(id, hint, !!errors[k]) });

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    const opts = {
      onSuccess: () => { toast.success(address ? "Address updated" : "Address saved"); onDone(); },
      onError: (e: unknown) => applyApiErrors(e, setError, setFormError, { fields: FIELDS }),
    };
    if (address) update.mutate({ id: address.id, ...values }, opts);
    else create.mutate(values, opts);
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {formError && <Alert tone="bad" title="We couldn't save this address">{formError}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Label (optional)" htmlFor="addr-label" error={err("label")} hint="For example Home or Work.">
          <Input autoComplete="off" {...props("addr-label", "label", true)} {...register("label")} />
        </Field>
        <Field label="Recipient name" htmlFor="addr-name" error={err("recipient_name")} required>
          <Input autoComplete="name" {...props("addr-name", "recipient_name")} {...register("recipient_name")} />
        </Field>
        <Field label="Phone number" htmlFor="addr-phone" error={err("phone")} required className="sm:col-span-2">
          <Input type="tel" inputMode="tel" autoComplete="tel" {...props("addr-phone", "phone")} {...register("phone")} />
        </Field>
        <Field label="Address line 1" htmlFor="addr-line1" error={err("line1")} required className="sm:col-span-2">
          <Input autoComplete="address-line1" {...props("addr-line1", "line1")} {...register("line1")} />
        </Field>
        <Field label="Address line 2 (optional)" htmlFor="addr-line2" error={err("line2")} className="sm:col-span-2">
          <Input autoComplete="address-line2" {...props("addr-line2", "line2")} {...register("line2")} />
        </Field>
        <Field label="Town or city" htmlFor="addr-city" error={err("city")} required>
          <Input autoComplete="address-level2" {...props("addr-city", "city")} {...register("city")} />
        </Field>
        <Field label="District or neighbourhood (optional)" htmlFor="addr-area" error={err("area")} hint="Used to check whether we deliver to you.">
          <Input autoComplete="address-level3" {...props("addr-area", "area", true)} {...register("area")} />
        </Field>
        <Field label="Postal code (optional)" htmlFor="addr-postal" error={err("postal_code")}>
          <Input autoComplete="postal-code" {...props("addr-postal", "postal_code")} {...register("postal_code")} />
        </Field>
        <Field label="Delivery instructions (optional)" htmlFor="addr-notes" error={err("instructions")} hint="Gate code, where to leave the bag, which bell to ring." className="sm:col-span-2">
          <Textarea rows={3} {...props("addr-notes", "instructions", true)} {...register("instructions")} />
        </Field>
      </div>
      {isFirst && !address ? (
        <p className="text-sm text-ink-3">This will be your default address, because it&apos;s your first.</p>
      ) : (
        <Checkbox label="Use as my default address" {...register("is_default")} />
      )}
      <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
        <DialogClose asChild><Button variant="secondary" disabled={pending}>Cancel</Button></DialogClose>
        <Button type="submit" loading={pending}>{address ? "Save changes" : "Save address"}</Button>
      </div>
    </form>
  );
}

// ------------------------------------------------------------------ list
function AddressCard({ a, onEdit, onDelete, onMakeDefault, makingDefault, busy }: { a: Address; onEdit: () => void; onDelete: () => void; onMakeDefault: () => void; makingDefault: boolean; busy: boolean }) {
  const lines = [a.line1, a.line2, [a.city, a.area].filter(Boolean).join(", "), a.postal_code].filter(Boolean);
  const title = a.label || a.recipient_name;
  return (
    <li className="flex flex-col rounded-lg border border-line bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-sans text-base font-bold text-ink">{title}</h2>
        {a.is_default && <Badge tone="ok">Default</Badge>}
      </div>
      <address className="mt-2 space-y-0.5 text-sm not-italic text-ink-2">
        {a.label && <p className="font-medium text-ink">{a.recipient_name}</p>}
        {lines.map((l, i) => <p key={i}>{l}</p>)}
        <p className="num">{a.phone}</p>
      </address>
      {a.instructions && <p className="mt-2 text-sm text-ink-2"><span className="font-semibold text-ink">Instructions:</span> {a.instructions}</p>}
      <div className="mt-4 flex flex-wrap gap-2 pt-1">
        <Button size="sm" variant="secondary" onClick={onEdit} aria-label={`Edit address ${title}`}><Pencil className="size-4" aria-hidden /> Edit</Button>
        {!a.is_default && <Button size="sm" variant="secondary" onClick={onMakeDefault} loading={makingDefault} disabled={busy && !makingDefault} aria-label={`Make ${title} my default address`}>Make default</Button>}
        <Button size="sm" variant="ghost" className="text-bad hover:bg-bad-soft" onClick={onDelete} aria-label={`Delete address ${title}`}><Trash2 className="size-4" aria-hidden /> Delete</Button>
      </div>
    </li>
  );
}

export function AddressesView() {
  const q = useAddresses();
  const { remove, makeDefault } = useAddressActions();
  const toast = useToast();
  const [editing, setEditing] = React.useState<Address | "new" | null>(null);
  const [deleting, setDeleting] = React.useState<Address | null>(null);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  const list = q.data ?? [];

  const confirmDelete = () => {
    if (!deleting) return;
    setDeleteError(null);
    remove.mutate(deleting.id, {
      onSuccess: () => { toast.success("Address deleted"); setDeleting(null); headingRef.current?.focus(); },
      onError: (e) => setDeleteError(e instanceof Error ? e.message : "Couldn't delete this address."),
    });
  };

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 ref={headingRef} tabIndex={-1} className="text-3xl focus:outline-none sm:text-4xl">Your addresses</h1>
          <p className="mt-1 text-ink-2">Saved delivery addresses you can pick at checkout.</p>
        </div>
        {q.data && q.data.length > 0 && <Button onClick={() => setEditing("new")}><Plus className="size-4" aria-hidden /> Add an address</Button>}
      </div>

      <div className="mt-6">
        {q.isLoading && (
          <ul className="grid gap-3 md:grid-cols-2" aria-busy="true" aria-label="Loading your addresses">
            {Array.from({ length: 2 }, (_, i) => <li key={i}><Skeleton className="h-44 w-full" /></li>)}
          </ul>
        )}
        {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} title="We couldn't load your addresses" />}
        {q.data && list.length === 0 && (
          <EmptyState icon={<MapPin className="size-6" aria-hidden />} title="No saved addresses" action={<Button onClick={() => setEditing("new")}><Plus className="size-4" aria-hidden /> Add an address</Button>}>
            Save an address once and choose it at checkout.
          </EmptyState>
        )}
        {list.length > 0 && (
          <>
            <p className="sr-only" role="status">{list.length} saved {list.length === 1 ? "address" : "addresses"}</p>
            <ul className="grid gap-3 md:grid-cols-2">
              {list.map((a) => (
                <AddressCard
                  key={a.id}
                  a={a}
                  onEdit={() => setEditing(a)}
                  onDelete={() => { setDeleteError(null); setDeleting(a); }}
                  onMakeDefault={() => makeDefault.mutate(a.id, { onSuccess: () => toast.success("Default address updated"), onError: (e) => toast.error(e) })}
                  makingDefault={makeDefault.isPending && makeDefault.variables === a.id}
                  busy={makeDefault.isPending}
                />
              ))}
            </ul>
          </>
        )}
      </div>

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent title={editing === "new" ? "Add an address" : "Edit address"} description="Fields marked * are required." className="w-[min(94vw,40rem)]">
          {editing !== null && <AddressForm key={editing === "new" ? "new" : editing.id} address={editing === "new" ? undefined : editing} isFirst={list.length === 0} onDone={() => setEditing(null)} />}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this address?"
        description={
          deleting && (
            <>
              <p>{[deleting.label || deleting.recipient_name, deleting.line1, deleting.city].filter(Boolean).join(", ")} will be removed from your account. Orders you&apos;ve already placed aren&apos;t affected.</p>
              {deleting.is_default && list.length > 1 && <p className="mt-2">You won&apos;t have a default address until you choose another.</p>}
            </>
          )
        }
        confirmLabel="Delete address"
        pending={remove.isPending}
        error={deleteError}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
