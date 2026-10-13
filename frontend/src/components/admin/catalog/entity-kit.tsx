"use client";

// Shared plumbing for the small CRUD editors (categories, brands, collections, banners, pages, articles, FAQs, promotions…).
import { useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Trash2, Upload } from "lucide-react";
import * as React from "react";
import { ConfirmDialog } from "@/components/admin/kit";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { adminRequest } from "@/lib/admin";
import { ApiError } from "@/lib/api";
import { imgSrc } from "@/lib/format";
import { FormField, restMessage, type Errors } from "./form-kit";
import { uploadMultipart } from "./upload";

/** Invalidate every cached admin query whose path starts with one of `prefixes`. */
export function useInvalidateAdmin() {
  const qc = useQueryClient();
  return React.useCallback((...prefixes: string[]) => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "admin" && prefixes.some((p) => String(q.queryKey[1] ?? "").startsWith(p)) }), [qc]);
}

/**
 * Create or update one record. `fields` lists the API keys the form has controls for: errors on those become field errors,
 * anything else (and message-only errors such as conflicts) lands in `message`.
 */
export function useEntitySave<R extends { id: number }>({ path, fields, invalidate, noun }: { path: string; fields: readonly string[]; invalidate: string[]; noun: string }) {
  const toast = useToast();
  const refresh = useInvalidateAdmin();
  const [errors, setErrors] = React.useState<Errors>({});
  const [message, setMessage] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  const save = React.useCallback(async (id: number | undefined, payload: Record<string, unknown>): Promise<R | null> => {
    setSaving(true);
    setMessage(null);
    setErrors({});
    try {
      const res = await adminRequest<R>(id === undefined ? "POST" : "PATCH", id === undefined ? path : `${path}${id}/`, payload);
      toast.success(id === undefined ? `${noun} created` : `${noun} saved`);
      refresh(...invalidate);
      return res;
    } catch (e) {
      const fe = e instanceof ApiError ? e.fieldErrors : {};
      const fieldErrs: Errors = {};
      const rest: Errors = {};
      for (const [k, v] of Object.entries(fe)) (fields.includes(k) ? fieldErrs : rest)[k] = v;
      setErrors(fieldErrs);
      setMessage(restMessage(e, { fields: fieldErrs, rest }));
      window.setTimeout(() => document.querySelector<HTMLElement>("[data-editor] [aria-invalid=true]")?.focus(), 0);
      return null;
    } finally {
      setSaving(false);
    }
  }, [path, fields, invalidate, noun, toast, refresh]);

  const clearError = React.useCallback((key: string) => setErrors((e) => (key in e ? Object.fromEntries(Object.entries(e).filter(([k]) => k !== key)) : e)), []);
  const reset = React.useCallback(() => { setErrors({}); setMessage(null); }, []);
  return { save, saving, errors, message, clearError, reset };
}

/** One picture for a record (category, banner, article): upload with progress, replace, remove. */
export function SingleImageCard({ path, urls, canWrite, noun = "picture", invalidate }: { path: string; urls?: Record<string, string> | null; canWrite: boolean; noun?: string; invalidate: string[] }) {
  const id = React.useId();
  const toast = useToast();
  const refresh = useInvalidateAdmin();
  const has = !!urls && Object.keys(urls).length > 0;
  const [progress, setProgress] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | undefined>();
  const [confirm, setConfirm] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);
  const ref = React.useRef<HTMLInputElement>(null);

  const upload = async (file: File) => {
    const form = new FormData();
    form.append("image", file);
    setError(undefined);
    setProgress(0);
    try {
      await uploadMultipart(path, form, { onProgress: setProgress });
      toast.success(has ? `${noun[0].toUpperCase()}${noun.slice(1)} replaced` : `${noun[0].toUpperCase()}${noun.slice(1)} uploaded`);
      refresh(...invalidate);
    } catch (e) {
      setError(e instanceof ApiError ? (e.fieldErrors.image ?? e.message) : "The upload failed. Try again.");
    } finally {
      setProgress(null);
      if (ref.current) ref.current.value = "";
    }
  };
  const remove = async () => {
    setRemoving(true);
    try {
      await adminRequest("DELETE", path);
      toast.success(`${noun[0].toUpperCase()}${noun.slice(1)} removed`);
      refresh(...invalidate);
      setConfirm(false);
    } catch (e) {
      toast.error(e);
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="space-y-3 rounded-md border border-line p-3">
      <p className="text-sm font-semibold text-ink">{noun[0].toUpperCase()}{noun.slice(1)}</p>
      {has ? <img src={imgSrc(urls!, 640)} alt="" className="max-h-48 w-full rounded-md border border-line bg-paper-2 object-contain" /> : (
        <p className="flex items-center gap-2 rounded-md border border-dashed border-line-strong p-4 text-sm text-ink-3"><ImagePlus className="size-5" aria-hidden /> No {noun} yet.</p>
      )}
      {canWrite && (
        <>
          <FormField id={`${id}-file`} label={has ? `Replace ${noun}` : `Upload a ${noun}`} error={error} hint="JPEG, PNG or WebP. The server checks the file and resizes it.">
            {(p) => <input {...p} ref={ref} type="file" accept="image/jpeg,image/png,image/webp" disabled={progress !== null} onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }}
              className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-line-strong file:bg-white file:px-3 file:py-2 file:text-sm file:font-semibold" />}
          </FormField>
          {progress !== null && (
            <div className="space-y-1">
              <div role="progressbar" aria-label="Upload progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} className="h-2 overflow-hidden rounded-full bg-paper-2"><div className="h-full bg-primary transition-[width]" style={{ width: `${progress}%` }} /></div>
              <p className="flex items-center gap-1.5 text-xs text-ink-3"><Upload className="size-3.5" aria-hidden /> Uploading {progress}%</p>
            </div>
          )}
          {has && <Button variant="ghost" size="sm" className="text-bad" onClick={() => setConfirm(true)}><Trash2 className="size-4" aria-hidden /> Remove {noun}</Button>}
        </>
      )}
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title={`Remove this ${noun}?`} description="The file is deleted from storage." confirmLabel={`Remove ${noun}`} danger loading={removing} onConfirm={() => void remove()} />
    </div>
  );
}

/** A destructive action behind a confirmation dialog (delete a record). */
export function ConfirmDelete({ open, onOpenChange, title, description, path, onDone, invalidate, noun, children }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description: string; path: string; onDone: () => void; invalidate: string[]; noun: string; children?: React.ReactNode;
}) {
  const toast = useToast();
  const refresh = useInvalidateAdmin();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => { if (open) setError(null); }, [open]);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await adminRequest("DELETE", path);
      toast.success(`${noun} deleted`);
      refresh(...invalidate);
      onOpenChange(false);
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That couldn't be deleted. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <ConfirmDialog open={open} onOpenChange={onOpenChange} title={title} description={description} confirmLabel="Delete" danger loading={busy} onConfirm={() => void run()}>
      {children}
      {error && <p role="alert" className="mt-3 rounded-md border border-bad/30 bg-bad-soft p-3 text-sm font-medium text-bad">{error}</p>}
    </ConfirmDialog>
  );
}
