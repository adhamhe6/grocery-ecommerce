"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { MailCheck } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { useForm } from "react-hook-form";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, Input, describedBy } from "@/components/ui/field";
import { Alert } from "@/components/ui/states";
import { forgotPasswordSchema, type ForgotPasswordValues } from "@/lib/account-schemas";
import { usePasswordResetRequest } from "@/lib/account-hooks";
import { applyApiErrors } from "@/lib/form-errors";

export function ForgotPasswordForm() {
  const request = usePasswordResetRequest();
  const [sentTo, setSentTo] = React.useState<string | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors },
  } = useForm<ForgotPasswordValues>({ resolver: zodResolver(forgotPasswordSchema), defaultValues: { email: "" } });

  React.useEffect(() => {
    if (sentTo) headingRef.current?.focus();
  }, [sentTo]);

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    request.mutate(values.email, {
      onSuccess: () => setSentTo(values.email),
      onError: (e) => applyApiErrors(e, setError, setFormError, { fields: ["email"] }),
    });
  });

  if (sentTo) {
    // Deliberately the same wording whether or not an account exists for this address.
    return (
      <div className="space-y-4" role="status">
        <div className="flex size-12 items-center justify-center rounded-full bg-primary-soft text-primary"><MailCheck className="size-6" aria-hidden /></div>
        <h2 ref={headingRef} tabIndex={-1} className="text-2xl focus:outline-none">Check your email</h2>
        <p className="text-ink-2">
          If an account exists for <strong className="break-all text-ink">{sentTo}</strong>, a link to choose a new password is on its way. The link is time-limited and works once.
        </p>
        <p className="text-sm text-ink-3">Nothing arrived? Check your spam folder, or try again in a few minutes.</p>
        <div className="flex flex-col gap-2 pt-2 sm:flex-row">
          <ButtonLink href="/login" className="sm:flex-1">Back to sign in</ButtonLink>
          <Button variant="secondary" className="sm:flex-1" onClick={() => { reset({ email: "" }); setSentTo(null); }}>Use a different email</Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      {formError && <Alert tone="bad" title="We couldn't send the link">{formError}</Alert>}
      <Field label="Email address" htmlFor="forgot-email" error={errors.email?.message} hint="We'll email a link to choose a new password.">
        <Input id="forgot-email" type="email" autoComplete="email" inputMode="email" aria-invalid={!!errors.email} aria-describedby={describedBy("forgot-email", true, !!errors.email)} {...register("email")} />
      </Field>
      <Button type="submit" size="lg" className="w-full" loading={request.isPending}>Send reset link</Button>
      <p className="text-center text-sm text-ink-2">
        Remembered it?{" "}
        <Link href="/login" className="font-semibold text-primary underline-offset-4 hover:underline">Back to sign in</Link>
      </p>
    </form>
  );
}
