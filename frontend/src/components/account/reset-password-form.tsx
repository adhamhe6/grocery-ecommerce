"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, LinkIcon } from "lucide-react";
import * as React from "react";
import { useForm } from "react-hook-form";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, describedBy } from "@/components/ui/field";
import { Alert } from "@/components/ui/states";
import { PASSWORD_HINT, resetPasswordSchema, type ResetPasswordValues } from "@/lib/account-schemas";
import { usePasswordResetConfirm } from "@/lib/account-hooks";
import { ApiError } from "@/lib/api";
import { applyApiErrors } from "@/lib/form-errors";
import { PasswordInput } from "./password-input";

function InvalidLink({ message }: { message?: string }) {
  return (
    <div className="space-y-4">
      <div className="flex size-12 items-center justify-center rounded-full bg-warn-soft text-warn"><LinkIcon className="size-6" aria-hidden /></div>
      <h2 className="text-2xl">This link can&apos;t be used</h2>
      <p className="text-ink-2">{message || "The reset link is incomplete. Open the link from your email again, or ask for a new one."}</p>
      <ButtonLink href="/forgot-password" className="w-full">Email me a new link</ButtonLink>
    </div>
  );
}

/** `uid` and `token` come from the emailed link (`/account/reset-password?uid=…&token=…`). */
export function ResetPasswordForm({ uid, token }: { uid: string | null; token: string | null }) {
  const confirm = usePasswordResetConfirm();
  const [formError, setFormError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);
  const [badLink, setBadLink] = React.useState<string | null>(null);
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<ResetPasswordValues>({ resolver: zodResolver(resetPasswordSchema), defaultValues: { password: "", confirm: "" } });

  React.useEffect(() => {
    if (done) headingRef.current?.focus();
  }, [done]);

  if (!uid || !token || badLink) return <InvalidLink message={badLink ?? undefined} />;

  if (done) {
    return (
      <div className="space-y-4" role="status">
        <div className="flex size-12 items-center justify-center rounded-full bg-ok-soft text-ok"><CheckCircle2 className="size-6" aria-hidden /></div>
        <h2 ref={headingRef} tabIndex={-1} className="text-2xl focus:outline-none">Password changed</h2>
        <p className="text-ink-2">You can now sign in with your new password.</p>
        <ButtonLink href="/login" className="w-full">Go to sign in</ButtonLink>
      </div>
    );
  }

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    confirm.mutate(
      { uid, token, new_password: values.password },
      {
        onSuccess: () => setDone(true),
        onError: (e) => {
          // A dead link is a different situation from a weak password: the form can't help, a new email can.
          if (e instanceof ApiError && e.code === "INVALID_RESET_LINK") return setBadLink(e.message);
          // Password-rule failures arrive as a plain list of messages (no field name).
          applyApiErrors(e, setError, setFormError, { fields: ["password"], nonFieldTo: "password" });
        },
      },
    );
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      {formError && <Alert tone="bad" title="We couldn't change your password">{formError}</Alert>}
      <Field label="New password" htmlFor="reset-password" error={errors.password?.message} hint={PASSWORD_HINT} required>
        <PasswordInput id="reset-password" autoComplete="new-password" toggleLabel="Show new password" aria-invalid={!!errors.password} aria-describedby={describedBy("reset-password", true, !!errors.password)} {...register("password")} />
      </Field>
      <Field label="Confirm new password" htmlFor="reset-confirm" error={errors.confirm?.message} required>
        <PasswordInput id="reset-confirm" autoComplete="new-password" toggleLabel="Show confirmation password" aria-invalid={!!errors.confirm} aria-describedby={describedBy("reset-confirm", false, !!errors.confirm)} {...register("confirm")} />
      </Field>
      <Button type="submit" size="lg" className="w-full" loading={confirm.isPending}>Change password</Button>
    </form>
  );
}
