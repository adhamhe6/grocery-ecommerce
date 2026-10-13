"use client";

import * as RD from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/cn";

export const Dialog = RD.Root;
export const DialogTrigger = RD.Trigger;
export const DialogClose = RD.Close;

export function DialogContent({ title, description, children, className, hideTitle }: { title: string; description?: string; children: React.ReactNode; className?: string; hideTitle?: boolean }) {
  return (
    <RD.Portal>
      <RD.Overlay className="fixed inset-0 z-50 bg-ink/45 backdrop-blur-[1px] data-[state=open]:animate-[fade-in_.15s_ease]" />
      <RD.Content className={cn("fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[min(92vw,34rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg bg-paper p-6 shadow-pop focus:outline-none data-[state=open]:animate-[pop-in_.18s_ease]", className)}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <RD.Title className={cn("font-display text-xl font-semibold text-primary", hideTitle && "sr-only")}>{title}</RD.Title>
          <RD.Close className="-m-2 rounded-md p-2 text-ink-2 hover:bg-paper-2" aria-label="Close"><X className="size-5" aria-hidden /></RD.Close>
        </div>
        {description ? <RD.Description className="mb-4 text-sm text-ink-2">{description}</RD.Description> : <RD.Description className="sr-only">{title}</RD.Description>}
        {children}
      </RD.Content>
    </RD.Portal>
  );
}

/** Slide-over panel (cart drawer, mobile navigation, filters). */
export function Sheet({ open, onOpenChange, side = "right", title, children, className, widthClass = "w-[min(100vw,26rem)]" }: { open: boolean; onOpenChange: (o: boolean) => void; side?: "left" | "right"; title: string; children: React.ReactNode; className?: string; widthClass?: string }) {
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-50 bg-ink/45 data-[state=open]:animate-[fade-in_.15s_ease]" />
        <RD.Content aria-describedby={undefined} className={cn("fixed top-0 z-50 flex h-dvh flex-col bg-paper shadow-pop focus:outline-none", widthClass, side === "right" ? "right-0 data-[state=open]:animate-[slide-in-right_.22s_ease]" : "left-0 data-[state=open]:animate-[slide-in-left_.22s_ease]", className)}>
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <RD.Title className="font-display text-xl font-semibold text-primary">{title}</RD.Title>
            <RD.Close className="-m-2 rounded-md p-2 text-ink-2 hover:bg-paper-2" aria-label="Close"><X className="size-5" aria-hidden /></RD.Close>
          </div>
          {children}
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}
