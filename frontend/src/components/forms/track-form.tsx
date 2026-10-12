"use client";

import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, describedBy } from "@/components/ui/field";
import { Alert } from "@/components/ui/states";
import { ApiError, apiPost } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useStore } from "@/lib/hooks";
import type { OrderDetail } from "@/lib/types";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
type Errors = { number?: string; email?: string };

/**
 * Guest order lookup. `POST /orders/track/` needs the order number and the email used at checkout, and answers with the
 * full order including its tracking token — so a match goes straight to /orders/<number>?token=<token>, the same page
 * (and the same link) the order confirmation uses.
 */
export function TrackForm() {
  const id = React.useId();
  const router = useRouter();
  const store = useStore();
  const [number, setNumber] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [errors, setErrors] = React.useState<Errors>({});
  const formRef = React.useRef<HTMLFormElement>(null);
  const focusFirstInvalid = () => window.setTimeout(() => formRef.current?.querySelector<HTMLElement>("[aria-invalid=true]")?.focus(), 0);

  const lookup = useMutation({
    mutationFn: (b: { number: string; email: string }) => apiPost<OrderDetail>("/orders/track/", b),
    onSuccess: (order) => {
      if (order.tracking_token) router.push(`/orders/${encodeURIComponent(order.number)}?token=${encodeURIComponent(order.tracking_token)}`);
    },
  });
  const apiError = lookup.error instanceof ApiError ? lookup.error : null;
  const order = lookup.data;
  const redirecting = !!order?.tracking_token;
  const isValidationError = !!apiError && apiError.status === 400 && Object.keys(apiError.fieldErrors).length > 0;
  const hasFieldErrors = Object.values(errors).some(Boolean);

  const field = (k: keyof Errors) => ({ id: `${id}-${k}`, "aria-invalid": !!errors[k], "aria-describedby": describedBy(`${id}-${k}`, k === "number", !!errors[k]) });

  return (
    <div className="space-y-6">
      <form
        ref={formRef} noValidate className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          const found: Errors = {};
          if (!number.trim()) found.number = "Enter your order number.";
          if (!email.trim()) found.email = "Enter the email address you used when ordering.";
          else if (!EMAIL.test(email.trim())) found.email = "Enter a valid email address.";
          setErrors(found);
          if (Object.keys(found).length > 0) return focusFirstInvalid();
          lookup.mutate(
            { number: number.trim(), email: email.trim() },
            { onError: (err) => { if (err instanceof ApiError) setErrors(err.fieldErrors as Errors); focusFirstInvalid(); } },
          );
        }}
      >
        <Field label="Order number" htmlFor={`${id}-number`} required error={errors.number} hint="On your order confirmation, and in the emails we send about the order.">
          <Input {...field("number")} name="number" autoComplete="off" autoCapitalize="characters" spellCheck={false} required maxLength={20} value={number} onChange={(e) => { setNumber(e.target.value); setErrors((c) => ({ ...c, number: undefined })); }} />
        </Field>
        <Field label="Email address" htmlFor={`${id}-email`} required error={errors.email}>
          <Input {...field("email")} name="email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={(e) => { setEmail(e.target.value); setErrors((c) => ({ ...c, email: undefined })); }} />
        </Field>
        <Button type="submit" size="lg" loading={lookup.isPending || redirecting}>Find my order</Button>
      </form>

      <div aria-live="polite" aria-atomic="true">
        {lookup.isError && (!isValidationError || hasFieldErrors) && (
          <Alert tone="bad" title={apiError?.status === 404 ? "We couldn't find that order" : "We couldn't look that up"}>
            {isValidationError ? "Please correct the highlighted fields and try again." : apiError ? apiError.message : "Something went wrong. Please try again."}
          </Alert>
        )}
        {redirecting && order && (
          <Alert tone="ok" title={`Found order ${order.number}`}>Opening your order… <Link href={`/orders/${encodeURIComponent(order.number)}?token=${encodeURIComponent(order.tracking_token!)}`} className="font-semibold underline underline-offset-4">Open it now</Link></Alert>
        )}
      </div>

      {/* Defensive fallback: the endpoint always includes the token, but if it ever did not, show the status here instead of sending the visitor to a page they cannot open. */}
      {order && !order.tracking_token && (
        <section aria-labelledby={`${id}-status`} className="rounded-lg border border-line bg-white p-5">
          <p className="eyebrow">Order {order.number}</p>
          <h2 id={`${id}-status`} className="mt-1 text-2xl">{order.status_label}</h2>
          {order.status_summary && <p className="mt-1 text-ink-2">{order.status_summary}</p>}
          {order.timeline.length > 0 && (
            <ol className="mt-4 space-y-2 border-l border-line pl-4 text-sm">
              {order.timeline.map((t, i) => <li key={`${t.status}-${i}`}><span className="font-semibold text-ink">{t.label}</span> <span className="num text-ink-3">{formatDateTime(t.at, store.locale)}</span></li>)}
            </ol>
          )}
        </section>
      )}
    </div>
  );
}
