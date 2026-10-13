"use client";

import { ChevronRight, Pencil, Plus } from "lucide-react";
import * as React from "react";
import { Card } from "@/components/admin/kit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/field";
import { Alert, EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { adminRequest, useAdmin, useAdminList } from "@/lib/admin";
import { imgSrc } from "@/lib/format";
import { ConfirmDelete, SingleImageCard, useEntitySave, useInvalidateAdmin } from "./entity-kit";
import { EditorSheet, FormField, ReorderButtons } from "./form-kit";
import type { CategoryRow } from "./product-model";
import { categoryPayload, emptyCategory, planSortOrder, type CategoryForm } from "./taxonomy-model";

const FIELDS = ["name", "slug", "parent", "description", "sort_order", "is_active", "show_on_home"] as const;
const INVALIDATE = ["/categories", "/products"];

function toForm(c: CategoryRow): CategoryForm {
  return { name: c.name, slug: c.slug, parent: c.parent == null ? "" : String(c.parent), description: c.description, sortOrder: String(c.sort_order), isActive: c.is_active, showOnHome: c.show_on_home };
}

function CategoryEditor({ target, categories, canWrite, onClose }: { target: { id?: number; parent?: string }; categories: CategoryRow[]; canWrite: boolean; onClose: () => void }) {
  const uid = React.useId();
  const [curId, setCurId] = React.useState(target.id);
  const existing = curId !== undefined ? categories.find((c) => c.id === curId) : undefined;
  const [form, setForm] = React.useState<CategoryForm>(() => (existing ? toForm(existing) : emptyCategory(target.parent ?? "")));
  const [base, setBase] = React.useState(form);
  const dirty = JSON.stringify(form) !== JSON.stringify(base);
  const { save, saving, errors, message, clearError } = useEntitySave<CategoryRow>({ path: "/categories/", fields: FIELDS, invalidate: INVALIDATE, noun: "Category" });
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [justCreated, setJustCreated] = React.useState(false);
  const [local, setLocal] = React.useState<Record<string, string>>({});
  const set = <K extends keyof CategoryForm>(k: K, v: CategoryForm[K], apiKey: string) => { setForm((f) => ({ ...f, [k]: v })); clearError(apiKey); setLocal({}); };
  const departments = categories.filter((c) => c.parent == null && c.id !== curId);
  const hasChildren = (existing?.children_count ?? 0) > 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { setLocal({ name: "Enter a name." }); window.setTimeout(() => document.querySelector<HTMLElement>("[data-editor] [aria-invalid=true]")?.focus(), 0); return; }
    const res = await save(curId, categoryPayload(form));
    if (res) {
      if (curId === undefined) { setCurId(res.id); setJustCreated(true); }
      const f = toForm(res);
      setForm(f);
      setBase(f);
    }
  };

  return (
    <EditorSheet open onClose={onClose} title={curId === undefined ? "New category" : `Edit ${existing?.name ?? "category"}`} dirty={dirty} widthClass="w-[min(100vw,34rem)]"
      footer={
        <>
          {existing && canWrite && <Button variant="ghost" className="mr-auto text-bad" onClick={() => setConfirmDelete(true)}>Delete…</Button>}
          <Button variant="secondary" onClick={onClose}>{dirty ? "Cancel" : "Close"}</Button>
          {canWrite && <Button type="submit" form={`${uid}-form`} loading={saving} disabled={!dirty}>{curId === undefined ? "Create category" : "Save changes"}</Button>}
        </>
      }>
      <div data-editor className="space-y-5">
        {justCreated && <Alert tone="ok" title="Category created">You can add a picture below.</Alert>}
        {message && <Alert tone="bad" title="This could not be saved">{message}</Alert>}
        <form id={`${uid}-form`} onSubmit={submit} noValidate className="space-y-4">
          <fieldset disabled={!canWrite || saving} className="m-0 min-w-0 space-y-4 border-0 p-0">
            <FormField id={`${uid}-name`} label="Name" required error={errors.name ?? local.name}>
              {(p) => <Input {...p} value={form.name} maxLength={80} onChange={(e) => set("name", e.target.value, "name")} />}
            </FormField>
            <FormField id={`${uid}-slug`} label="Web address (slug)" error={errors.slug} hint="Leave blank to build it from the name.">
              {(p) => <Input {...p} className="num" value={form.slug} maxLength={90} onChange={(e) => set("slug", e.target.value, "slug")} />}
            </FormField>
            <FormField id={`${uid}-parent`} label="Department" error={errors.parent} hint={hasChildren ? "This category has sub-categories, so it can't be moved under another one." : "Leave empty to make this a top-level department. Categories have two levels."}>
              {(p) => (
                <Select {...p} value={form.parent} disabled={hasChildren || !canWrite} onChange={(e) => set("parent", e.target.value, "parent")}>
                  <option value="">None — this is a department</option>
                  {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </Select>
              )}
            </FormField>
            <FormField id={`${uid}-desc`} label="Description" error={errors.description} hint={`${form.description.length}/300`}>
              {(p) => <Textarea {...p} rows={3} maxLength={300} value={form.description} onChange={(e) => set("description", e.target.value, "description")} />}
            </FormField>
            <FormField id={`${uid}-sort`} label="Sort order" error={errors.sort_order} hint="Lower numbers come first. You can also use the arrows in the list.">
              {(p) => <Input {...p} className="num w-32" inputMode="numeric" value={form.sortOrder} onChange={(e) => set("sortOrder", e.target.value, "sort_order")} />}
            </FormField>
            <Checkbox checked={form.isActive} onChange={(e) => set("isActive", e.target.checked, "is_active")} label={<><span className="font-semibold">Active</span><span className="block text-sm text-ink-3">Inactive categories are hidden from the shop. A category with active products can&apos;t be deactivated.</span></>} />
            {errors.is_active && <p role="alert" className="text-sm font-medium text-bad">{errors.is_active}</p>}
            <Checkbox checked={form.showOnHome} onChange={(e) => set("showOnHome", e.target.checked, "show_on_home")} label={<><span className="font-semibold">Show on the home page</span></>} />
          </fieldset>
        </form>
        {curId !== undefined ? (
          <SingleImageCard path={`/categories/${curId}/image/`} urls={existing?.image} canWrite={canWrite} noun="picture" invalidate={INVALIDATE} />
        ) : <p className="text-sm text-ink-3">Save the category first, then you can add a picture.</p>}
      </div>
      {existing && (
        <ConfirmDelete open={confirmDelete} onOpenChange={setConfirmDelete} title={`Delete ${existing.name}?`} noun="Category" path={`/categories/${existing.id}/`} invalidate={INVALIDATE} onDone={onClose}
          description={existing.product_count || existing.children_count ? `It still holds ${existing.product_count} product(s) and ${existing.children_count} sub-categor${existing.children_count === 1 ? "y" : "ies"}; the server will refuse until they are moved.` : "This permanently removes the category and its picture."} />
      )}
    </EditorSheet>
  );
}

export function CategoriesTab() {
  const { can } = useAdmin();
  const canWrite = can("catalog.write");
  const toast = useToast();
  const refresh = useInvalidateAdmin();
  const { rows, isLoading, error, refetch } = useAdminList<CategoryRow>("/categories/");
  const [editing, setEditing] = React.useState<{ id?: number; parent?: string } | null>(null);
  const [moving, setMoving] = React.useState(false);
  const sort = (a: CategoryRow, b: CategoryRow) => a.sort_order - b.sort_order || a.name.localeCompare(b.name);
  const departments = rows.filter((c) => c.parent == null).sort(sort);
  const kids = (id: number) => rows.filter((c) => c.parent === id).sort(sort);

  const move = async (siblings: CategoryRow[], index: number, delta: -1 | 1) => {
    const plan = planSortOrder(siblings, index, delta);
    if (!plan.length) return;
    setMoving(true);
    try {
      await Promise.all(plan.map((u) => adminRequest("PATCH", `/categories/${u.id}/`, { sort_order: u.sort_order })));
      toast.success("Order updated");
    } catch (e) {
      toast.error(e);
    } finally {
      refresh(...INVALIDATE);
      setMoving(false);
    }
  };

  const renderRow = (c: CategoryRow, siblings: CategoryRow[], index: number, depth: 0 | 1): React.ReactNode => (
    <li key={c.id}>
      <div className={`flex flex-wrap items-center gap-3 px-4 py-2.5 ${depth ? "pl-10 sm:pl-12" : ""}`}>
        {depth === 1 && <ChevronRight className="-ml-5 size-4 shrink-0 text-ink-3" aria-hidden />}
        {Object.keys(c.image ?? {}).length > 0 ? <img src={imgSrc(c.image, 320)} alt="" className="size-10 shrink-0 rounded-md border border-line bg-paper-2 object-cover" /> : <span className="size-10 shrink-0 rounded-md border border-dashed border-line-strong" aria-hidden />}
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-ink">{c.name} {!c.is_active && <Badge tone="neutral">Inactive</Badge>} {c.show_on_home && <Badge tone="info">On home page</Badge>}</p>
          <p className="num text-xs text-ink-3">/{c.slug} · {c.product_count} {c.product_count === 1 ? "product" : "products"} ({c.active_product_count} active){depth === 0 && ` · ${c.children_count} ${c.children_count === 1 ? "category" : "categories"}`}</p>
        </div>
        <div className="flex items-center gap-1.5">
          {canWrite && <ReorderButtons index={index} count={siblings.length} label={c.name} disabled={moving} onMove={(d) => void move(siblings, index, d)} />}
          {canWrite && depth === 0 && <Button size="sm" variant="ghost" onClick={() => setEditing({ parent: String(c.id) })}><Plus className="size-4" aria-hidden /> Sub-category{" "}<span className="sr-only">in {c.name}</span></Button>}
          <Button size="sm" variant="secondary" onClick={() => setEditing({ id: c.id })}><Pencil className="size-4" aria-hidden /> {canWrite ? "Edit" : "View"}{" "}<span className="sr-only">{c.name}</span></Button>
        </div>
      </div>
      {depth === 0 && kids(c.id).length > 0 && (
        <ul className="divide-y divide-line border-t border-line bg-paper/40" aria-label={`Categories in ${c.name}`}>
          {kids(c.id).map((k, i, arr) => renderRow(k, arr, i, 1))}
        </ul>
      )}
    </li>
  );

  return (
    <Card title="Categories" padded={false} actions={canWrite ? <Button size="sm" onClick={() => setEditing({})}><Plus className="size-4" aria-hidden /> New department</Button> : undefined}>
      <p className="border-b border-line px-4 py-3 text-sm text-ink-3 sm:px-5">Two levels: departments hold categories, and products sit in categories. Use the arrows to reorder within a level.{!canWrite && " Your role can view the tree but not change it."}</p>
      {error ? <ErrorState error={error} onRetry={() => refetch()} /> : isLoading ? <div className="space-y-2 p-4"><Skeleton className="h-12" /><Skeleton className="h-12" /><Skeleton className="h-12" /></div> : departments.length === 0 ? (
        <EmptyState title="No categories yet">Create a department first, then add categories inside it.</EmptyState>
      ) : (
        <ul className="divide-y divide-line">{departments.map((d, i) => renderRow(d, departments, i, 0))}</ul>
      )}
      {editing && <CategoryEditor key={`${editing.id ?? "new"}-${editing.parent ?? ""}`} target={editing} categories={rows} canWrite={canWrite} onClose={() => setEditing(null)} />}
    </Card>
  );
}
