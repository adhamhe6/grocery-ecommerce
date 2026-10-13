"use client";

import { useMutation } from "@tanstack/react-query";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { ApiError, apiPost } from "@/lib/api";

/** Double opt-in: the API replies identically for new and known addresses, so we only ever show its message. */
export function Newsletter() {
  const [email, setEmail] = React.useState("");
  const m = useMutation({ mutationFn: (e: string) => apiPost<{ detail: string }>("/newsletter/subscribe/", { email: e }) });
  const error = m.error instanceof ApiError ? (m.error.fieldErrors.email ?? m.error.message) : m.error ? "Something went wrong. Please try again." : null;
  return (
    <form className="mt-6 max-w-sm" onSubmit={(e) => { e.preventDefault(); m.mutate(email); }} noValidate>
      <label htmlFor="newsletter-email" className="block text-sm font-semibold text-ink">Weekly offers &amp; recipes</label>
      {m.isSuccess ? (
        <p role="status" className="mt-2 text-sm text-ok">{m.data.detail}</p>
      ) : (
        <>
          <div className="mt-2 flex gap-2">
            <Input id="newsletter-email" type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!error} aria-describedby={error ? "newsletter-error" : undefined} required />
            <Button type="submit" loading={m.isPending}>Subscribe</Button>
          </div>
          {error && <p id="newsletter-error" role="alert" className="mt-1.5 text-sm font-medium text-bad">{error}</p>}
          <p className="mt-1.5 text-xs text-ink-3">We&apos;ll email a confirmation link first. Unsubscribe any time.</p>
        </>
      )}
    </form>
  );
}
