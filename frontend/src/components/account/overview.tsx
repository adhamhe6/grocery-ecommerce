"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Heart, ListChecks, MapPin, Package } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, describedBy } from "@/components/ui/field";
import { Alert, Skeleton } from "@/components/ui/states";
import { changePasswordSchema, PASSWORD_HINT, profileSchema, type ChangePasswordValues, type ProfileValues } from "@/lib/account-schemas";
import { useAddresses, useChangePassword, useFavoriteProducts, useOrders, useProfileUpdate, useShoppingLists } from "@/lib/account-hooks";
import { applyApiErrors } from "@/lib/form-errors";
import { useMe } from "@/lib/hooks";
import { pluralise } from "@/lib/format";
import type { User } from "@/lib/types";
import { PasswordInput } from "./password-input";

// ------------------------------------------------------------------ at a glance
function Glance({ href, icon, title, state, children }: { href: string; icon: React.ReactNode; title: string; state: "loading" | "error" | "ready"; children?: React.ReactNode }) {
  return (
    <li>
      <Link href={href} className="flex h-full items-start gap-3 rounded-lg border border-line bg-white p-4 transition-colors hover:border-line-strong hover:bg-paper">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">{icon}</span>
        <span className="min-w-0">
          <span className="block font-semibold text-ink">{title}</span>
          {state === "loading" && <Skeleton className="mt-1.5 h-4 w-32" />}
          {state === "error" && <span className="block text-sm text-ink-3">Open to view</span>}
          {state === "ready" && <span className="block text-sm text-ink-2">{children}</span>}
        </span>
      </Link>
    </li>
  );
}

function AtAGlance() {
  const orders = useOrders(1);
  const addresses = useAddresses();
  const favourites = useFavoriteProducts();
  const lists = useShoppingLists();
  const latest = orders.data?.results[0];
  const st = (q: { isLoading: boolean; isError: boolean }) => (q.isLoading ? "loading" : q.isError ? "error" : "ready");
  return (
    <section aria-labelledby="glance-h">
      <h2 id="glance-h" className="text-xl">At a glance</h2>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2">
        <Glance href="/account/orders" icon={<Package className="size-5" aria-hidden />} title="Orders" state={st(orders)}>
          {orders.data && orders.data.count === 0 ? "No orders yet" : <>{pluralise(orders.data?.count ?? 0, "order")}{latest && <> · latest {latest.number}: {latest.status_label.toLowerCase()}</>}</>}
        </Glance>
        <Glance href="/account/addresses" icon={<MapPin className="size-5" aria-hidden />} title="Addresses" state={st(addresses)}>
          {addresses.data?.length ? `${pluralise(addresses.data.length, "saved address", "saved addresses")}` : "No saved addresses"}
        </Glance>
        <Glance href="/account/favorites" icon={<Heart className="size-5" aria-hidden />} title="Favourites" state={st(favourites)}>
          {favourites.data?.ids.length ? `${pluralise(favourites.data.ids.length, "saved product")}` : "Nothing saved yet"}
        </Glance>
        <Glance href="/account/lists" icon={<ListChecks className="size-5" aria-hidden />} title="Shopping lists" state={st(lists)}>
          {lists.data?.length ? pluralise(lists.data.length, "list") : "No lists yet"}
        </Glance>
      </ul>
    </section>
  );
}

// ------------------------------------------------------------------ profile
const toProfileValues = (u: User): ProfileValues => ({ full_name: u.full_name, phone: u.phone ?? "", notify_order_emails: u.notify_order_emails, marketing_opt_in: u.marketing_opt_in });
const PROFILE_FIELDS = ["full_name", "phone", "notify_order_emails", "marketing_opt_in"] as const;

function ProfileForm({ user }: { user: User }) {
  const update = useProfileUpdate();
  const [formError, setFormError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isDirty },
  } = useForm<ProfileValues>({ resolver: zodResolver(profileSchema), defaultValues: toProfileValues(user) });

  React.useEffect(() => {
    if (isDirty) setSaved(false);
  }, [isDirty]);

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    setSaved(false);
    update.mutate(values, {
      onSuccess: (u) => { reset(toProfileValues(u)); setSaved(true); },
      onError: (e) => applyApiErrors(e, setError, setFormError, { fields: PROFILE_FIELDS }),
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5 rounded-lg border border-line bg-white p-5 sm:p-6">
      <div aria-live="polite">
        {formError && <Alert tone="bad" title="We couldn't save your details">{formError}</Alert>}
        {saved && <Alert tone="ok">Your details are saved.</Alert>}
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Full name" htmlFor="profile-name" error={errors.full_name?.message} required>
          <Input id="profile-name" autoComplete="name" aria-invalid={!!errors.full_name} aria-describedby={describedBy("profile-name", false, !!errors.full_name)} {...register("full_name")} />
        </Field>
        <Field label="Phone number (optional)" htmlFor="profile-phone" error={errors.phone?.message}>
          <Input id="profile-phone" type="tel" autoComplete="tel" inputMode="tel" aria-invalid={!!errors.phone} aria-describedby={describedBy("profile-phone", false, !!errors.phone)} {...register("phone")} />
        </Field>
        <Field label="Email address" htmlFor="profile-email" hint="This is the email you sign in with. It can't be changed here." className="sm:col-span-2">
          <Input id="profile-email" type="email" value={user.email} readOnly aria-describedby="profile-email-hint" className="bg-paper-2 text-ink-2" />
        </Field>
      </div>
      <fieldset className="space-y-3">
        <legend className="mb-1 text-sm font-semibold text-ink">Email preferences</legend>
        <Checkbox
          label={<><span className="font-medium">Updates about my orders</span><span className="mt-0.5 block text-sm text-ink-3">Confirmations, substitution questions and delivery updates. If you turn this off, check your order page for updates.</span></>}
          {...register("notify_order_emails")}
        />
        <Checkbox label={<span className="font-medium">News and offers</span>} {...register("marketing_opt_in")} />
      </fieldset>
      <Button type="submit" loading={update.isPending} disabled={!isDirty}>Save changes</Button>
    </form>
  );
}

// ------------------------------------------------------------------ password
const PASSWORD_FIELDS = ["current_password", "new_password"] as const;

function PasswordForm() {
  const change = useChangePassword();
  const [formError, setFormError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors },
  } = useForm<ChangePasswordValues>({ resolver: zodResolver(changePasswordSchema), defaultValues: { current_password: "", new_password: "", confirm: "" } });

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    setSaved(false);
    change.mutate(
      { current_password: values.current_password, new_password: values.new_password },
      {
        onSuccess: () => { reset(); setSaved(true); },
        // New-password rule failures come back as non-field errors.
        onError: (e) => applyApiErrors(e, setError, setFormError, { fields: PASSWORD_FIELDS, nonFieldTo: "new_password" }),
      },
    );
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5 rounded-lg border border-line bg-white p-5 sm:p-6">
      <div aria-live="polite">
        {formError && <Alert tone="bad" title="We couldn't change your password">{formError}</Alert>}
        {saved && <Alert tone="ok" title="Password changed">You stay signed in on this device. Any other device that was signed in will need to sign in again.</Alert>}
      </div>
      <Field label="Current password" htmlFor="pw-current" error={errors.current_password?.message} required>
        <PasswordInput id="pw-current" autoComplete="current-password" toggleLabel="Show current password" aria-invalid={!!errors.current_password} aria-describedby={describedBy("pw-current", false, !!errors.current_password)} {...register("current_password")} />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="New password" htmlFor="pw-new" error={errors.new_password?.message} hint={PASSWORD_HINT} required className="sm:col-span-2">
          <PasswordInput id="pw-new" autoComplete="new-password" toggleLabel="Show new password" aria-invalid={!!errors.new_password} aria-describedby={describedBy("pw-new", true, !!errors.new_password)} {...register("new_password")} />
        </Field>
        <Field label="Confirm new password" htmlFor="pw-confirm" error={errors.confirm?.message} required>
          <PasswordInput id="pw-confirm" autoComplete="new-password" toggleLabel="Show confirmation password" aria-invalid={!!errors.confirm} aria-describedby={describedBy("pw-confirm", false, !!errors.confirm)} {...register("confirm")} />
        </Field>
      </div>
      <Button type="submit" loading={change.isPending}>Change password</Button>
    </form>
  );
}

// ------------------------------------------------------------------ page
export function AccountOverview() {
  const { data: me } = useMe();
  if (!me) return null; // the shell only renders children for signed-in shoppers
  const first = me.full_name.trim().split(/\s+/)[0] || "there";
  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-3xl sm:text-4xl">Hello, {first}</h1>
        <p className="mt-1 text-ink-2">Your details, orders and saved things in one place.</p>
      </header>
      <AtAGlance />
      <section aria-labelledby="profile-h">
        <h2 id="profile-h" className="mb-3 text-xl">Your details</h2>
        <ProfileForm user={me} />
      </section>
      <section aria-labelledby="password-h">
        <h2 id="password-h" className="mb-3 text-xl">Change password</h2>
        <PasswordForm />
      </section>
    </div>
  );
}
