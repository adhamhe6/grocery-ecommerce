"use client";

import { ImagePlus, Star, Trash2, Upload } from "lucide-react";
import * as React from "react";
import { ConfirmDialog } from "@/components/admin/kit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { adminRequest, useAdminAction } from "@/lib/admin";
import { ApiError } from "@/lib/api";
import { imgSrc } from "@/lib/format";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/ui/toast";
import { FormField, ReorderButtons, Section, moveItem } from "./form-kit";
import { MAX_IMAGES, type ProductImageRow } from "./product-model";
import { uploadMultipart } from "./upload";

function ImageCard({ productId, image, index, count, canWrite, busy, onReorder, onDelete }: {
  productId: number; image: ProductImageRow; index: number; count: number; canWrite: boolean; busy: boolean;
  onReorder: (from: number, to: "front" | -1 | 1) => void; onDelete: (img: ProductImageRow) => void;
}) {
  const id = React.useId();
  const [alt, setAlt] = React.useState(image.alt_text);
  React.useEffect(() => setAlt(image.alt_text), [image.alt_text]);
  const [error, setError] = React.useState<string | undefined>();
  const save = useAdminAction(() => adminRequest("PATCH", `/products/${productId}/images/${image.id}/`, { alt_text: alt.trim() }), {
    invalidate: ["/products"], success: "Alt text saved", onSuccess: () => setError(undefined),
    onError: (e) => setError(e instanceof ApiError ? (e.fieldErrors.alt_text ?? e.message) : undefined),
  });
  return (
    <li className="flex flex-col overflow-hidden rounded-lg border border-line bg-white">
      <div className="relative aspect-[4/3] bg-paper-2">
        <img src={imgSrc(image.urls, 320)} alt={image.alt_text} className="size-full object-contain" loading="lazy" />
        {index === 0 && <Badge className="absolute left-2 top-2" tone="primary"><Star className="size-3" aria-hidden /> Primary</Badge>}
      </div>
      <div className="flex flex-1 flex-col gap-3 p-3">
        <FormField id={`${id}-alt`} label="Alt text" required error={error} hint="Describe the picture for people using screen readers.">
          {(p) => <Input {...p} className="h-10 text-sm" value={alt} maxLength={200} disabled={!canWrite} onChange={(e) => { setAlt(e.target.value); setError(undefined); }} />}
        </FormField>
        {canWrite && (
          <div className="mt-auto flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" loading={save.isPending} disabled={alt.trim() === image.alt_text || !alt.trim()} onClick={() => save.mutate(undefined)}>Save alt text</Button>
            {index > 0 && <Button size="sm" variant="secondary" disabled={busy} onClick={() => onReorder(index, "front")}>Make primary</Button>}
            <ReorderButtons index={index} count={count} label={`image ${index + 1}`} disabled={busy} onMove={(d) => onReorder(index, d)} />
            <Button size="icon-sm" variant="ghost" className="ml-auto text-bad" disabled={busy} onClick={() => onDelete(image)} aria-label={`Delete image ${index + 1}`}><Trash2 className="size-4" aria-hidden /></Button>
          </div>
        )}
      </div>
    </li>
  );
}

export function ProductImages({ productId, images, canWrite }: { productId: number; images: ProductImageRow[]; canWrite: boolean }) {
  const id = React.useId();
  const qc = useQueryClient();
  const toast = useToast();
  const sorted = React.useMemo(() => images.slice().sort((a, b) => a.sort_order - b.sort_order || a.id - b.id), [images]);
  const [file, setFile] = React.useState<File | null>(null);
  const [alt, setAlt] = React.useState("");
  const [progress, setProgress] = React.useState<number | null>(null);
  const [errors, setErrors] = React.useState<{ image?: string; alt_text?: string; other?: string }>({});
  const [toDelete, setToDelete] = React.useState<ProductImageRow | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const uploading = progress !== null;
  const full = sorted.length >= MAX_IMAGES;

  const refresh = () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "admin" && String(q.queryKey[1] ?? "").startsWith("/products") });
  const reorder = useAdminAction((ids: number[]) => adminRequest("PATCH", `/products/${productId}/images/order/`, { ids }), { invalidate: ["/products"], success: "Image order saved" });
  const remove = useAdminAction((img: ProductImageRow) => adminRequest("DELETE", `/products/${productId}/images/${img.id}/`), { invalidate: ["/products"], success: "Image deleted", onSuccess: () => setToDelete(null) });

  const onReorder = (from: number, to: "front" | -1 | 1) => {
    const ids = sorted.map((i) => i.id);
    reorder.mutate(to === "front" ? [ids[from], ...ids.filter((_, i) => i !== from)] : moveItem(ids, from, to));
  };

  const upload = async (e: React.FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (!file) next.image = "Choose a JPEG, PNG or WebP picture.";
    if (!alt.trim()) next.alt_text = "Describe the picture for people using screen readers.";
    setErrors(next);
    if (next.image || next.alt_text || !file) return;
    const form = new FormData();
    form.append("image", file);
    form.append("alt_text", alt.trim());
    setProgress(0);
    try {
      await uploadMultipart(`/products/${productId}/images/`, form, { onProgress: setProgress });
      toast.success("Image uploaded");
      setFile(null);
      setAlt("");
      if (fileRef.current) fileRef.current.value = "";
      refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        const fe = err.fieldErrors;
        setErrors({ image: fe.image, alt_text: fe.alt_text, other: fe.image || fe.alt_text ? undefined : err.message });
      } else setErrors({ other: "The upload failed. Try again." });
    } finally {
      setProgress(null);
    }
  };

  return (
    <Section id="images" title="Images" description={`Up to ${MAX_IMAGES} pictures. The first one is the primary image shown on cards and in search. Uploads are checked, converted to WebP and resized by the server.`}
      aside={<span className="num text-sm text-ink-3">{sorted.length} of {MAX_IMAGES}</span>}>
      {sorted.length === 0 ? (
        <p className="rounded-md border border-dashed border-line-strong p-6 text-center text-sm text-ink-2"><ImagePlus className="mx-auto mb-2 size-6 text-ink-3" aria-hidden />No pictures yet — shoppers see a blank tile until you add one.</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Product images">
          {sorted.map((img, i) => <ImageCard key={img.id} productId={productId} image={img} index={i} count={sorted.length} canWrite={canWrite} busy={reorder.isPending || remove.isPending} onReorder={onReorder} onDelete={setToDelete} />)}
        </ul>
      )}
      {canWrite && (
        <form onSubmit={upload} noValidate className="space-y-3 rounded-md border border-line bg-paper-2/40 p-4" aria-label="Add an image">
          <p className="text-sm font-semibold text-ink">Add a picture</p>
          <FormField id={`${id}-file`} label="Picture file" required error={errors.image} hint="JPEG, PNG or WebP. The server rejects other types, corrupt files and files over its size limit (5 MB by default).">
            {(p) => <input {...p} ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" disabled={full || uploading} className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-line-strong file:bg-white file:px-3 file:py-2 file:text-sm file:font-semibold" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setErrors((x) => ({ ...x, image: undefined })); }} />}
          </FormField>
          <FormField id={`${id}-alt`} label="Alt text for this picture" required error={errors.alt_text}>
            {(p) => <Input {...p} value={alt} maxLength={200} disabled={full || uploading} onChange={(e) => { setAlt(e.target.value); setErrors((x) => ({ ...x, alt_text: undefined })); }} placeholder="For example: A bowl of red Gala apples" />}
          </FormField>
          {errors.other && <p role="alert" className="text-sm font-medium text-bad">{errors.other}</p>}
          {uploading && (
            <div role="progressbar" aria-label="Upload progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress ?? 0} className="h-2 overflow-hidden rounded-full bg-paper-2">
              <div className="h-full bg-primary transition-[width]" style={{ width: `${progress}%` }} />
            </div>
          )}
          <div className="flex items-center gap-3">
            <Button type="submit" loading={uploading} disabled={full}><Upload className="size-4" aria-hidden /> {uploading ? `Uploading ${progress}%` : "Upload picture"}</Button>
            {full && <span className="text-sm text-ink-3">The limit of {MAX_IMAGES} pictures is reached. Delete one to add another.</span>}
          </div>
        </form>
      )}
      <ConfirmDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)} title="Delete this picture?" description="It is removed from the product page and from storage. This can't be undone." confirmLabel="Delete picture" danger loading={remove.isPending}
        onConfirm={() => toDelete && remove.mutate(toDelete)}>
        {toDelete && <img src={imgSrc(toDelete.urls, 320)} alt={toDelete.alt_text} className="max-h-40 rounded-md border border-line" />}
      </ConfirmDialog>
    </Section>
  );
}
