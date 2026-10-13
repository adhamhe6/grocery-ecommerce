"use client";

// Form building blocks shared by the catalogue, marketing and content editors (kept here so those areas stay consistent).
import { ArrowDown, ArrowUp } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { ConfirmDialog } from "@/components/admin/kit";
import { Button } from "@/components/ui/button";
import { Field, Input, describedBy } from "@/components/ui/field";
import { Sheet } from "@/components/ui/dialog";
import { Alert } from "@/components/ui/states";
import { cn } from "@/lib/cn";
import { ApiError } from "@/lib/api";
import { isoToLocalInput, localInputToIso } from "./datetime";

export type Errors = Record<string, string>;

// ------------------------------------------------------------------------------------------------ pure helpers
/** Moves `items[index]` by `delta` places (clamped); returns the same array when nothing would move. */
export function moveItem<T>(items: T[], index: number, delta: number): T[] {
  const to = index + delta;
  if (index < 0 || index >= items.length || to < 0 || to >= items.length || to === index) return items;
  const next = items.slice();
  const [it] = next.splice(index, 1);
  next.splice(to, 0, it);
  return next;
}

/** Field-level errors from any thrown value (empty for non-API errors). */
export const errorsOf = (e: unknown): Errors => (e instanceof ApiError ? e.fieldErrors : {});

/**
 * The message for whatever the field errors did not explain: keys the form has no control for, plus errors that carry
 * only a message (conflicts, network problems). Null when every error landed on a field.
 */
export function restMessage(e: unknown, mapped: { fields: Errors; rest: Errors }): string | null {
  if (!(e instanceof ApiError)) return "Something went wrong. Please try again.";
  const parts = Object.entries(mapped.rest).map(([k, v]) => (k === "non_field_errors" || k === "detail" || /^\d+$/.test(k) ? v : `${k.replace(/_/g, " ")}: ${v}`));
  if (parts.length) return parts.join(" ");
  if (Object.keys(mapped.fields).length) return null;
  return e.message;
}

// ------------------------------------------------------------------------------------------------ field wrapper
export interface ControlProps { id: string; "aria-invalid": boolean; "aria-describedby"?: string }

/** Label + hint + error around a control; the control gets its id / aria wiring through the render prop. */
export function FormField({ id, label, hint, error, required, className, children }: {
  id: string; label: string; hint?: React.ReactNode; error?: string; required?: boolean; className?: string; children: (p: ControlProps) => React.ReactNode;
}) {
  return (
    <Field label={label} htmlFor={id} hint={hint} error={error} required={required} className={className}>
      {children({ id, "aria-invalid": !!error, "aria-describedby": describedBy(id, !!hint, !!error) })}
    </Field>
  );
}

/** datetime-local input that reads/writes ISO instants, interpreted in the store's time zone. */
export function DateTimeField({ id, label, value, onChange, timeZone, error, hint, required }: {
  id: string; label: string; value: string | null; onChange: (iso: string | null) => void; timeZone: string; error?: string; hint?: React.ReactNode; required?: boolean;
}) {
  const [draft, setDraft] = React.useState(() => isoToLocalInput(value, timeZone));
  const lastSent = React.useRef(value);
  React.useEffect(() => {
    if (value !== lastSent.current) {
      lastSent.current = value;
      setDraft(isoToLocalInput(value, timeZone));
    }
  }, [value, timeZone]);
  return (
    <FormField id={id} label={label} error={error} hint={hint ?? `Store time (${timeZone})`} required={required}>
      {(p) => (
        <Input {...p} type="datetime-local" value={draft} onChange={(e) => {
          setDraft(e.target.value);
          const iso = localInputToIso(e.target.value, timeZone);
          lastSent.current = iso;
          onChange(iso);
        }} />
      )}
    </FormField>
  );
}

// ------------------------------------------------------------------------------------------------ layout
export function Section({ id, title, description, children, aside }: { id: string; title: string; description?: React.ReactNode; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24 rounded-lg border border-line bg-white shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <h2 id={`${id}-title`} className="font-sans text-base font-bold text-ink">{title}</h2>
          {description && <p className="mt-0.5 max-w-3xl text-sm text-ink-3">{description}</p>}
        </div>
        {aside}
      </header>
      <div className="space-y-4 p-4 sm:p-5">{children}</div>
    </section>
  );
}

export function FieldGrid({ children, cols = 2 }: { children: React.ReactNode; cols?: 1 | 2 | 3 }) {
  return <div className={cn("grid gap-4", cols === 2 && "sm:grid-cols-2", cols === 3 && "sm:grid-cols-2 lg:grid-cols-3")}>{children}</div>;
}

/** Fixed bar at the bottom of an editor: unsaved-changes state plus Save / Discard. */
export function StickyBar({ dirty, saving, onDiscard, saveLabel = "Save changes", children, disabled, formId, fresh }: { dirty: boolean; saving?: boolean; onDiscard?: () => void; saveLabel?: string; children?: React.ReactNode; disabled?: boolean; formId?: string; fresh?: boolean }) {
  return (
    <div className="sticky bottom-0 z-20 -mx-4 border-t border-line bg-paper/95 px-4 py-3 shadow-[0_-6px_16px_-12px_rgb(27_31_28/0.35)] backdrop-blur lg:-mx-8 lg:px-8">
      <div className="mx-auto flex max-w-[88rem] flex-wrap items-center justify-between gap-3">
        <p className={cn("text-sm", dirty ? "font-semibold text-warn" : "text-ink-3")} role="status">{dirty ? "You have unsaved changes" : fresh ? "Nothing entered yet" : "All changes saved"}</p>
        <div className="flex flex-wrap items-center gap-2">
          {children}
          {onDiscard && <Button variant="secondary" disabled={!dirty || saving} onClick={onDiscard}>Discard changes</Button>}
          <Button type="submit" form={formId} loading={saving} disabled={disabled || (!dirty && !saving)}>{saveLabel}</Button>
        </div>
      </div>
    </div>
  );
}

/** Lists the problems after a failed save so keyboard and screen-reader users can jump to them. */
export function ErrorSummary({ message, fields }: { message?: string | null; fields: { id: string; label: string; message: string }[] }) {
  if (!message && fields.length === 0) return null;
  return (
    <Alert tone="bad" title={fields.length ? `${fields.length} ${fields.length === 1 ? "thing needs" : "things need"} fixing before this can be saved` : "This could not be saved"}>
      {message && <p>{message}</p>}
      {fields.length > 0 && (
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          {fields.map((f) => (
            <li key={f.id}><a className="font-semibold underline" href={`#${f.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(f.id)?.focus(); }}>{f.label}</a>: {f.message}</li>
          ))}
        </ul>
      )}
    </Alert>
  );
}

// ------------------------------------------------------------------------------------------------ controls
export function Switch({ checked, onChange, label, disabled, busy }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; busy?: boolean }) {
  return (
    <button
      type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled || busy}
      onClick={() => onChange(!checked)}
      className={cn("relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50", checked ? "border-primary bg-primary" : "border-line-strong bg-paper-2", busy && "animate-pulse")}
    >
      <span aria-hidden className={cn("inline-block size-4 rounded-full bg-white shadow transition-transform", checked ? "translate-x-6" : "translate-x-1")} />
    </button>
  );
}

/** Up / down buttons for ordering lists without drag and drop. */
export function ReorderButtons({ index, count, onMove, label, disabled }: { index: number; count: number; onMove: (delta: -1 | 1) => void; label: string; disabled?: boolean }) {
  return (
    <span className="inline-flex gap-1">
      <Button variant="secondary" size="icon-sm" disabled={disabled || index <= 0} onClick={() => onMove(-1)} aria-label={`Move ${label} up`}><ArrowUp className="size-4" aria-hidden /></Button>
      <Button variant="secondary" size="icon-sm" disabled={disabled || index >= count - 1} onClick={() => onMove(1)} aria-label={`Move ${label} down`}><ArrowDown className="size-4" aria-hidden /></Button>
    </span>
  );
}

// ------------------------------------------------------------------------------------------------ state helpers
export function useTabParam(allowed: string[], fallback: string): [string, (t: string) => void] {
  const [tab, setTab] = React.useState(fallback);
  React.useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t && allowed.includes(t)) setTab(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const change = React.useCallback((t: string) => {
    setTab(t);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", t);
    window.history.replaceState(window.history.state, "", url);
  }, []);
  return [tab, change];
}

/** Moves focus to the first invalid control after a failed submit. */
export function focusFirstInvalid(root: HTMLElement | null) {
  window.setTimeout(() => root?.querySelector<HTMLElement>("[aria-invalid=true]")?.focus(), 0);
}

/**
 * Blocks accidental navigation away from unsaved edits: tab close/refresh (native prompt) and in-app link clicks
 * (confirmation dialog). Render `dialog` somewhere in the tree.
 */
export function useUnsavedGuard(dirty: boolean) {
  const router = useRouter();
  const [pending, setPending] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || (url.pathname === window.location.pathname && url.search === window.location.search)) return;
      e.preventDefault();
      e.stopPropagation();
      setPending(url.pathname + url.search + url.hash);
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);
  const dialog = (
    <ConfirmDialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)} title="Leave without saving?" description="You have unsaved changes on this page. If you leave now they will be lost." confirmLabel="Leave page" danger
      onConfirm={() => { const to = pending; setPending(null); if (to) router.push(to); }} />
  );
  return { dialog };
}

// ------------------------------------------------------------------------------------------------ slide-over editor
/** Right-hand editor panel; asks before closing over unsaved edits. Body scrolls, footer stays put. */
export function EditorSheet({ open, onClose, title, dirty, children, footer, widthClass = "w-[min(100vw,42rem)]" }: {
  open: boolean; onClose: () => void; title: string; dirty: boolean; children: React.ReactNode; footer: React.ReactNode; widthClass?: string;
}) {
  const [confirm, setConfirm] = React.useState(false);
  const request = () => (dirty ? setConfirm(true) : onClose());
  return (
    <>
      <Sheet open={open} onOpenChange={(o) => !o && request()} title={title} widthClass={widthClass}>
        <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-paper px-5 py-3">{footer}</div>
      </Sheet>
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title="Discard your changes?" description="What you've entered here hasn't been saved." confirmLabel="Discard" danger onConfirm={() => { setConfirm(false); onClose(); }} />
    </>
  );
}

/** Wraps the controls of a form so a read-only role can still look but not touch. */
export function ReadOnlyFieldset({ readOnly, children }: { readOnly: boolean; children: React.ReactNode }) {
  return <fieldset disabled={readOnly} className="m-0 min-w-0 space-y-6 border-0 p-0">{children}</fieldset>;
}
