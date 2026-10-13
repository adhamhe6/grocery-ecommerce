"use client";

import { Plus } from "lucide-react";
import * as React from "react";
import { DataTable, FilterBar, FilterSelect, SearchField, useDebouncedValue, type Column } from "@/components/admin/kit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Textarea } from "@/components/ui/field";
import { Alert, EmptyState } from "@/components/ui/states";
import { useAdmin, useAdminList } from "@/lib/admin";
import { ConfirmDelete, useEntitySave } from "./entity-kit";
import { EditorSheet, FormField } from "./form-kit";
import type { BrandRow } from "./product-model";
import { brandPayload, emptyBrand, type BrandForm } from "./taxonomy-model";

const FIELDS = ["name", "slug", "description", "is_active"] as const;
const INVALIDATE = ["/brands", "/products"];
const toForm = (b: BrandRow): BrandForm => ({ name: b.name, slug: b.slug, description: b.description, isActive: b.is_active });

function BrandEditor({ brand, canWrite, onClose }: { brand?: BrandRow; canWrite: boolean; onClose: () => void }) {
  const uid = React.useId();
  const [curId, setCurId] = React.useState(brand?.id);
  const [form, setForm] = React.useState<BrandForm>(() => (brand ? toForm(brand) : emptyBrand()));
  const [base, setBase] = React.useState(form);
  const dirty = JSON.stringify(form) !== JSON.stringify(base);
  const { save, saving, errors, message, clearError } = useEntitySave<BrandRow>({ path: "/brands/", fields: FIELDS, invalidate: INVALIDATE, noun: "Brand" });
  const [local, setLocal] = React.useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const set = <K extends keyof BrandForm>(k: K, v: BrandForm[K], api: string) => { setForm((f) => ({ ...f, [k]: v })); clearError(api); setLocal({}); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { setLocal({ name: "Enter a name." }); window.setTimeout(() => document.querySelector<HTMLElement>("[data-editor] [aria-invalid=true]")?.focus(), 0); return; }
    const res = await save(curId, brandPayload(form));
    if (res) { setCurId(res.id); const f = toForm(res); setForm(f); setBase(f); }
  };

  return (
    <EditorSheet open onClose={onClose} title={curId === undefined ? "New brand" : `Edit ${brand?.name ?? "brand"}`} dirty={dirty} widthClass="w-[min(100vw,30rem)]"
      footer={
        <>
          {brand && canWrite && <Button variant="ghost" className="mr-auto text-bad" onClick={() => setConfirmDelete(true)}>Delete…</Button>}
          <Button variant="secondary" onClick={onClose}>{dirty ? "Cancel" : "Close"}</Button>
          {canWrite && <Button type="submit" form={`${uid}-form`} loading={saving} disabled={!dirty}>{curId === undefined ? "Create brand" : "Save changes"}</Button>}
        </>
      }>
      <div data-editor className="space-y-4">
        {message && <Alert tone="bad" title="This could not be saved">{message}</Alert>}
        <form id={`${uid}-form`} onSubmit={submit} noValidate>
          <fieldset disabled={!canWrite || saving} className="m-0 min-w-0 space-y-4 border-0 p-0">
            <FormField id={`${uid}-name`} label="Name" required error={errors.name ?? local.name}>{(p) => <Input {...p} value={form.name} maxLength={80} onChange={(e) => set("name", e.target.value, "name")} />}</FormField>
            <FormField id={`${uid}-slug`} label="Web address (slug)" error={errors.slug} hint="Leave blank to build it from the name.">{(p) => <Input {...p} className="num" value={form.slug} maxLength={90} onChange={(e) => set("slug", e.target.value, "slug")} />}</FormField>
            <FormField id={`${uid}-desc`} label="Description" error={errors.description} hint={form.description.trim() ? `${form.description.length}/300` : "Not provided"}>{(p) => <Textarea {...p} rows={3} maxLength={300} value={form.description} onChange={(e) => set("description", e.target.value, "description")} />}</FormField>
            <Checkbox checked={form.isActive} onChange={(e) => set("isActive", e.target.checked, "is_active")} label={<><span className="font-semibold">Active</span><span className="block text-sm text-ink-3">Inactive brands stay on existing products but can be hidden from brand filters.</span></>} />
          </fieldset>
        </form>
        {brand && brand.product_count > 0 && <p className="text-sm text-ink-3">{brand.product_count} {brand.product_count === 1 ? "product uses" : "products use"} this brand, so it can&apos;t be deleted. Deactivate it instead, or move those products to another brand.</p>}
      </div>
      {brand && <ConfirmDelete open={confirmDelete} onOpenChange={setConfirmDelete} title={`Delete ${brand.name}?`} description="This permanently removes the brand." noun="Brand" path={`/brands/${brand.id}/`} invalidate={INVALIDATE} onDone={onClose} />}
    </EditorSheet>
  );
}

export function BrandsTab() {
  const { can } = useAdmin();
  const canWrite = can("catalog.write");
  const [search, setSearch] = React.useState("");
  const q = useDebouncedValue(search);
  const [state, setState] = React.useState("");
  const list = useAdminList<BrandRow>("/brands/", { search: q, is_active: state || undefined });
  const [editing, setEditing] = React.useState<{ brand?: BrandRow } | null>(null);
  const columns: Column<BrandRow>[] = [
    { key: "name", header: "Brand", cell: (b) => <button type="button" className="text-left font-semibold text-primary underline-offset-4 hover:underline" onClick={() => setEditing({ brand: b })}>{b.name}</button> },
    { key: "slug", header: "Slug", hideBelow: "md", cell: (b) => <span className="num text-ink-3">{b.slug}</span> },
    { key: "products", header: "Products", align: "right", cell: (b) => b.product_count },
    { key: "status", header: "Status", cell: (b) => <>{b.is_active ? <Badge tone="ok">Active</Badge> : <Badge tone="neutral">Inactive</Badge>}{b.is_demo && <Badge className="ml-2" tone="neutral">Demo</Badge>}</> },
  ];
  return (
    <div className="space-y-4">
      <FilterBar>
        <SearchField value={search} onChange={setSearch} placeholder="Search brands…" label="Search brands" />
        <FilterSelect label="Status" value={state} onChange={setState} options={[["true", "Active"], ["false", "Inactive"]]} />
        {canWrite && <Button size="sm" className="ml-auto" onClick={() => setEditing({})}><Plus className="size-4" aria-hidden /> New brand</Button>}
      </FilterBar>
      <DataTable<BrandRow> caption="Brands" columns={columns} rows={list.rows} loading={list.isLoading} error={list.error} onRetry={() => list.refetch()} empty={<EmptyState title={q || state ? "No brands match" : "No brands yet"}>{q || state ? "Try a different search." : "Brands you add can be attached to products."}</EmptyState>} />
      <p className="num text-sm text-ink-3">{list.count} {list.count === 1 ? "brand" : "brands"}</p>
      {editing && <BrandEditor key={editing.brand?.id ?? "new"} brand={editing.brand} canWrite={canWrite} onClose={() => setEditing(null)} />}
    </div>
  );
}
