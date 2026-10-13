"use client";

import { CheckCircle2, Clock, HelpCircle, PackageCheck, PauseCircle, Pencil, Send, XCircle } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import * as React from "react";
import { ToneBadge } from "@/components/admin/inventory/form-kit";
import type { POStatus, SupplierStatus } from "./types";

const PO: Record<POStatus, { label: string; tone: "ok" | "warn" | "bad" | "info" | "neutral"; icon: React.ComponentType<{ className?: string }> }> = {
  DRAFT: { label: "Draft", tone: "neutral", icon: Pencil },
  SUBMITTED: { label: "Submitted", tone: "info", icon: Send },
  CONFIRMED: { label: "Confirmed by supplier", tone: "info", icon: CheckCircle2 },
  PARTIALLY_RECEIVED: { label: "Partially received", tone: "warn", icon: Clock },
  RECEIVED: { label: "Received", tone: "ok", icon: PackageCheck },
  CANCELLED: { label: "Cancelled", tone: "bad", icon: XCircle },
};

export function PoStatusBadge({ status }: { status: POStatus }) {
  const s = PO[status] ?? PO.DRAFT;
  return <ToneBadge tone={s.tone} icon={s.icon}>{s.label}</ToneBadge>;
}

export function SupplierStatusBadge({ status }: { status: SupplierStatus }) {
  if (status === "ACTIVE") return <ToneBadge tone="ok" icon={CheckCircle2}>Active</ToneBadge>;
  if (status === "ON_HOLD") return <ToneBadge tone="warn" icon={PauseCircle}>On hold</ToneBadge>;
  return <ToneBadge tone="neutral" icon={XCircle}>Inactive</ToneBadge>;
}

/** A “?” button that opens a small panel of explanatory text. Keyboard and screen-reader friendly (Radix Popover). */
export function HelpPopover({ label, title, children }: { label: string; title: string; children: React.ReactNode }) {
  return (
    <Popover.Root>
      <Popover.Trigger className="inline-flex size-7 items-center justify-center rounded-full text-ink-3 hover:bg-paper-2 hover:text-ink" aria-label={label}>
        <HelpCircle className="size-4" aria-hidden />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={6} collisionPadding={12} className="z-50 w-[min(24rem,92vw)] rounded-md border border-line-strong bg-white p-4 text-sm shadow-pop focus:outline-none">
          <p className="font-sans text-sm font-bold text-ink">{title}</p>
          <div className="mt-2 space-y-2 text-ink-2">{children}</div>
          <Popover.Arrow className="fill-white" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
