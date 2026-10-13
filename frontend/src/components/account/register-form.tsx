"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, describedBy } from "@/components/ui/field";
import { Alert, Spinner } from "@/components/ui/states";
import { PASSWORD_HINT, registerSchema, type RegisterValues } from "@/lib/account-schemas";
import { applyApiErrors } from "@/lib/form-errors";
import { useAuthActions, useMe } from "@/lib/hooks";
import { safeNextPath, withNext } from "@/lib/safe-next";
import { PasswordInput } from "./password-input";

const FIELDS = ["full_name", "email", "phone", "password", "marketing_opt_in"] as const;

export function RegisterForm({ next }: { next: string }) {
  const router = useRouter();
  const target = safeNextPath(next);
  const { data: me } = useMe();
  const { register: signUp } = useAuthActions();
  const [formError, setFormError] = React.useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<RegisterValues>({ resolver: zodResolver(registerSchema), defaultValues: { full_name: "", email: "", phone: "", password: "", marketing_opt_in: false } });

  React.useEffect(() => {
    if (me) router.replace(target);
  }, [me, router, target]);

  if (me) {
    return (
      <div role="status" className="flex items-center gap-3 text-ink-2">
        <Spinner /> You&apos;re signed in. Taking you on…
      </div>
    );
  }

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    signUp.mutate(
      { email: values.email, password: values.password, full_name: values.full_name, marketing_opt_in: values.marketing_opt_in, ...(values.phone ? { phone: values.phone } : {}) },
      // The API reports password-rule failures as non-field errors; they belong next to the password field.
      { onError: (e) => applyApiErrors(e, setError, setFormError, { fields: FIELDS, nonFieldTo: "password" }) },
    );
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      {formError && <Alert tone="bad" title="We couldn't create your account">{formError}</Alert>}
      <Field label="Full name" htmlFor="reg-name" error={errors.full_name?.message} required>
        <Input id="reg-name" autoComplete="name" aria-invalid={!!errors.full_name} aria-describedby={describedBy("reg-name", false, !!errors.full_name)} {...register("full_name")} />
      </Field>
      <Field label="Email address" htmlFor="reg-email" error={errors.email?.message} required>
        <Input id="reg-email" type="email" autoComplete="email" inputMode="email" aria-invalid={!!errors.email} aria-describedby={describedBy("reg-email", false, !!errors.email)} {...register("email")} />
      </Field>
      <Field label="Phone number (optional)" htmlFor="reg-phone" error={errors.phone?.message}>
        <Input id="reg-phone" type="tel" autoComplete="tel" inputMode="tel" aria-invalid={!!errors.phone} aria-describedby={describedBy("reg-phone", false, !!errors.phone)} {...register("phone")} />
      </Field>
      <Field label="Password" htmlFor="reg-password" error={errors.password?.message} hint={PASSWORD_HINT} required>
        <PasswordInput id="reg-password" autoComplete="new-password" aria-invalid={!!errors.password} aria-describedby={describedBy("reg-password", true, !!errors.password)} {...register("password")} />
      </Field>
      <Checkbox label="Send me news and offers by email" {...register("marketing_opt_in")} />
      <Button type="submit" size="lg" className="w-full" loading={signUp.isPending}>Create account</Button>
      <p className="text-center text-sm text-ink-2">
        Already have an account?{" "}
        <Link href={withNext("/login", target)} className="font-semibold text-primary underline-offset-4 hover:underline">Sign in</Link>
      </p>
    </form>
  );
}
