import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/cn";
import { ApiError } from "@/lib/api";
import { Button } from "./button";

export function Spinner({ className, label = "Loading" }: { className?: string; label?: string }) {
  return <Loader2 className={cn("size-5 animate-spin text-ink-3", className)} role="status" aria-label={label} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} aria-hidden />;
}

export function EmptyState({ icon, title, children, action, className }: { icon?: React.ReactNode; title: string; children?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("mx-auto flex max-w-md flex-col items-center px-4 py-14 text-center", className)}>
      {icon && <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-primary-soft text-primary">{icon}</div>}
      <h2 className="text-xl">{title}</h2>
      {children && <div className="mt-2 text-ink-2">{children}</div>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, title = "We couldn't load this" }: { error?: unknown; onRetry?: () => void; title?: string }) {
  const message = error instanceof ApiError ? error.message : "Something went wrong. Please try again.";
  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-center px-4 py-12 text-center">
      <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-bad-soft text-bad"><XCircle className="size-7" aria-hidden /></div>
      <h2 className="text-xl">{title}</h2>
      <p className="mt-2 text-ink-2">{message}</p>
      {error instanceof ApiError && error.requestId && <p className="mt-1 text-xs text-ink-3">Reference: {error.requestId}</p>}
      {onRetry && <Button className="mt-5" variant="secondary" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

const tones = {
  info: { cls: "bg-info-soft text-info border-info/25", icon: Info },
  ok: { cls: "bg-ok-soft text-ok border-ok/25", icon: CheckCircle2 },
  warn: { cls: "bg-warn-soft text-warn border-warn/30", icon: AlertTriangle },
  bad: { cls: "bg-bad-soft text-bad border-bad/25", icon: XCircle },
};

/** Inline message. Colour is never the only signal: every tone carries an icon and a text label. */
export function Alert({ tone = "info", title, children, className }: { tone?: keyof typeof tones; title?: string; children?: React.ReactNode; className?: string }) {
  const { cls, icon: Icon } = tones[tone];
  return (
    <div role={tone === "bad" || tone === "warn" ? "alert" : "status"} className={cn("flex gap-3 rounded-md border p-3.5 text-sm", cls, className)}>
      <Icon className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 text-ink">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={title ? "mt-0.5 text-ink-2" : ""}>{children}</div>}
      </div>
    </div>
  );
}
