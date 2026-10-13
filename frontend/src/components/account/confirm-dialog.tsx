"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";

/** Yes/no confirmation. The caller closes it on success, so a failed request leaves it open and retryable. */
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, pending, onConfirm, error }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  pending?: boolean;
  onConfirm: () => void;
  error?: string | null;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => (pending ? undefined : onOpenChange(o))}>
      <DialogContent title={title}>
        <div className="space-y-4">
          <div className="text-ink-2">{description}</div>
          {error && <p role="alert" className="text-sm font-medium text-bad">{error}</p>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <DialogClose asChild><Button variant="secondary" disabled={pending}>Cancel</Button></DialogClose>
            <Button variant="danger" loading={pending} onClick={onConfirm}>{confirmLabel}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
