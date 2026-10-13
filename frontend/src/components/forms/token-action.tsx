"use client";

import { useMutation } from "@tanstack/react-query";
import { CheckCircle2 } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/states";
import { ApiError, apiPost } from "@/lib/api";

interface TokenActionProps {
  /** API path that takes `{ token }`, e.g. "/newsletter/confirm/". */
  endpoint: string;
  token: string;
  /** Label of the button the visitor presses. Nothing is sent until they do — email scanners and link previews must not trigger it. */
  label: string;
  variant?: "primary" | "secondary";
  /** Shown after success, below the API's own message. */
  after?: React.ReactNode;
}

/** A one-click confirmation for links in our emails: POSTs the token only when the button is pressed, then shows the API's reply. */
export function TokenAction({ endpoint, token, label, variant = "primary", after }: TokenActionProps) {
  const doneRef = React.useRef<HTMLParagraphElement>(null);
  const run = useMutation({ mutationFn: () => apiPost<{ detail: string }>(endpoint, { token }) });
  const apiError = run.error instanceof ApiError ? run.error : null;

  React.useEffect(() => {
    if (run.isSuccess) doneRef.current?.focus();
  }, [run.isSuccess]);

  return (
    <div className="space-y-4">
      {!run.isSuccess && <Button size="lg" variant={variant} loading={run.isPending} onClick={() => run.mutate()}>{label}</Button>}
      <div aria-live="polite" aria-atomic="true">
        {run.isSuccess && (
          <div className="rounded-md border border-ok/25 bg-ok-soft p-4">
            <p ref={doneRef} tabIndex={-1} className="flex items-start gap-2 font-semibold text-ok focus:outline-none"><CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden /> {run.data.detail}</p>
            {after && <div className="mt-3 text-sm text-ink-2">{after}</div>}
          </div>
        )}
        {run.isError && <Alert tone="bad" title="That didn't work">{apiError ? (apiError.fieldErrors.token ?? apiError.message) : "Something went wrong. Please try again."}</Alert>}
      </div>
    </div>
  );
}
