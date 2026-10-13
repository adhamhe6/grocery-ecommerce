"use client";

import { ImageUp, Trash2 } from "lucide-react";
import * as React from "react";
import { ConfirmDialog } from "@/components/admin/kit";
import { serverFormErrors } from "@/components/admin/finance/server-errors";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/states";
import { adminRequest, useAdminAction } from "@/lib/admin";
import type { StoreSettingsData } from "./settings-model";

/** Logo upload/removal. These are their own requests (POST/DELETE /settings/logo/) and don't touch unsaved form edits. */
export function LogoField({ logo, onChanged }: { logo: string | null; onChanged: (s: StoreSettingsData | null) => void }) {
  const [file, setFile] = React.useState<File | null>(null);
  const [preview, setPreview] = React.useState<string | null>(null);
  const [removing, setRemoving] = React.useState(false);
  const input = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!file) { setPreview(null); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const upload = useAdminAction(
    (f: File) => { const body = new FormData(); body.append("image", f); return adminRequest<StoreSettingsData>("POST", "/settings/logo/", body); },
    { invalidate: ["/settings"], success: "Logo updated", onSuccess: (s) => { setFile(null); if (input.current) input.current.value = ""; onChanged(s); } },
  );
  const remove = useAdminAction(() => adminRequest<void>("DELETE", "/settings/logo/"), { invalidate: ["/settings"], success: "Logo removed", onSuccess: () => { setRemoving(false); onChanged(null); } });
  const errors = serverFormErrors(upload.error, ["image"]);
  const message = errors.fields.image ?? errors.form;

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-semibold text-ink">Logo</legend>
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex h-24 w-40 items-center justify-center rounded-md border border-line bg-white p-2" aria-live="polite">
          {preview || logo ? <img src={preview ?? logo ?? ""} alt={preview ? "Preview of the logo you chose" : "Current logo"} className="max-h-full max-w-full object-contain" /> : <span className="text-center text-xs text-ink-3">No logo yet. The store name is shown instead.</span>}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <label htmlFor="s-logo-file" className="sr-only">Choose a logo image</label>
            <input
              id="s-logo-file"
              ref={input}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => { setFile(e.target.files?.[0] ?? null); upload.reset(); }}
              aria-describedby="s-logo-hint"
              className="block w-full max-w-sm text-sm file:mr-3 file:rounded-md file:border file:border-line-strong file:bg-white file:px-3 file:py-2 file:font-semibold file:text-primary hover:file:bg-paper-2"
            />
            <p id="s-logo-hint" className="mt-1 text-sm text-ink-3">JPEG, PNG or WebP. It is checked and converted on upload, and replaces the current logo straight away (you don&apos;t need to press Save).</p>
          </div>
          {message && <Alert tone="bad">{message}</Alert>}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={!file} loading={upload.isPending} onClick={() => file && upload.mutate(file)}><ImageUp className="size-4" aria-hidden /> Upload logo</Button>
            {logo && !file && <Button variant="ghost" onClick={() => setRemoving(true)}><Trash2 className="size-4" aria-hidden /> Remove logo</Button>}
            {file && <Button variant="ghost" onClick={() => { setFile(null); if (input.current) input.current.value = ""; }}>Cancel</Button>}
          </div>
        </div>
      </div>
      <ConfirmDialog open={removing} onOpenChange={(o) => !remove.isPending && setRemoving(o)} danger title="Remove the logo?" description="The storefront and dashboard go back to showing the store name as text." confirmLabel="Remove logo" loading={remove.isPending} onConfirm={() => remove.mutate(undefined)} />
    </fieldset>
  );
}
