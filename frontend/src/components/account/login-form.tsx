"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Field, Input, describedBy } from "@/components/ui/field";
import { Alert, Spinner } from "@/components/ui/states";
import { loginSchema, type LoginValues } from "@/lib/account-schemas";
import { applyApiErrors } from "@/lib/form-errors";
import { useAuthActions, useMe } from "@/lib/hooks";
import { safeNextPath, withNext } from "@/lib/safe-next";
import { PasswordInput } from "./password-input";

const FIELDS = ["email", "password"] as const;

/** `next` is validated again here, so the form is safe even if a caller forgets to sanitise it. */
export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const target = safeNextPath(next);
  const { data: me } = useMe();
  const { login } = useAuthActions();
  const [formError, setFormError] = React.useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<LoginValues>({ resolver: zodResolver(loginSchema), defaultValues: { email: "", password: "" } });

  // Covers both "already signed in when the page opened" and "just signed in".
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
    login.mutate(values, { onError: (e) => applyApiErrors(e, setError, setFormError, { fields: FIELDS }) });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      {formError && <Alert tone="bad" title="We couldn't sign you in">{formError}</Alert>}
      <Field label="Email address" htmlFor="login-email" error={errors.email?.message}>
        <Input id="login-email" type="email" autoComplete="username" inputMode="email" aria-invalid={!!errors.email} aria-describedby={describedBy("login-email", false, !!errors.email)} {...register("email")} />
      </Field>
      <div className="space-y-2">
        <Field label="Password" htmlFor="login-password" error={errors.password?.message}>
          <PasswordInput id="login-password" autoComplete="current-password" aria-invalid={!!errors.password} aria-describedby={describedBy("login-password", false, !!errors.password)} {...register("password")} />
        </Field>
        <p className="text-right text-sm">
          <Link href="/forgot-password" className="font-semibold text-primary underline-offset-4 hover:underline">Forgot your password?</Link>
        </p>
      </div>
      <Button type="submit" size="lg" className="w-full" loading={login.isPending}>Sign in</Button>
      <p className="text-center text-sm text-ink-2">
        New here?{" "}
        <Link href={withNext("/register", target)} className="font-semibold text-primary underline-offset-4 hover:underline">Create an account</Link>
      </p>
    </form>
  );
}
