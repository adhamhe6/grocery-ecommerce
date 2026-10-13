"use client";

import { Plus } from "lucide-react";
import * as React from "react";
import { DataTable, type Column } from "@/components/admin/kit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Textarea } from "@/components/ui/field";
import { Alert, EmptyState, Skeleton } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { adminRequest, isoDate, useAdmin, useAdminGet, useAdminList } from "@/lib/admin";
import { formatDate } from "@/lib/format";
import { ConfirmDelete, useEntitySave, useInvalidateAdmin } from "./entity-kit";
import { EditorSheet, FieldGrid, FormField, ReorderButtons } from "./form-kit";
import { ProductSetField, type ProductRef } from "./product-picker";
import { collectionPayload, collectionState, emptyCollection, planSortOrder, type CollectionForm, type CollectionState } from "./taxonomy-model";

export interface CollectionRow { id: number; name: string; slug: string; description: string; is_active: boolean; show_on_home: boolean; sort_order: number; starts_on: string | null; ends_on: string | null; is_current: boolean; product_count: number }
interface Member extends ProductRef { slug: string; sort_order: number }

const FIELDS = ["name", "slug", "description", "is_active", "show_on_home", "sort_order", "starts_on", "ends_on"] as const;
const INVALIDATE = ["/collections"];
const TONE: Record<CollectionState, "ok" | "info" | "neutral" | "warn"> = { Live: "ok", Scheduled: "info", Ended: "neutral", Off: "warn" };
const toForm = (c: CollectionRow): CollectionForm => ({ name: c.name, slug: c.slug, description: c.description, isActive: c.is_active, showOnHome: c.show_on_home, sortOrder: String(c.sort_order), startsOn: c.starts_on ?? "", endsOn: c.ends_on ?? "" });

function Membership({ collectionId, canWrite, onDirty }: { collectionId: number; canWrite: boolean; onDirty: (d: boolean) => void }) {
  const toast = useToast();
  const refresh = useInvalidateAdmin();
  const members = useAdminGet<Member[]>(`/collections/${collectionId}/products/`);
  const [ids, setIds] = React.useState<number[]>([]);
  const [base, setBase] = React.useState<number[]>([]);
  const [ready, setReady] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (members.data && !ready) { const v = members.data.map((m) => m.id); setIds(v); setBase(v); setReady(true); }
  }, [members.data, ready]);
  const dirty = ready && JSON.stringify(ids) !== JSON.stringify(base);
  React.useEffect(() => onDirty(dirty), [dirty, onDirty]);

  const saveMembers = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await adminRequest<Member[]>("PUT", `/collections/${collectionId}/products/`, { product_ids: ids });
      const v = res.map((m) => m.id);
      setIds(v);
      setBase(v);
      toast.success("Collection products saved");
      refresh(...INVALIDATE);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby={`coll-products-${collectionId}`} className="space-y-3 border-t border-line pt-5">
      <h3 id={`coll-products-${collectionId}`} className="font-sans text-base font-bold text-ink">Products in this collection</h3>
      <p className="text-sm text-ink-3">The order here is the order shoppers see. Adding or removing products is saved with the button below, separately from the details above.</p>
      {members.isLoading ? <Skeleton className="h-24" /> : members.error ? <Alert tone="bad" title="Products couldn't be loaded">Reload the page and try again.</Alert> : (
        <>
          <ProductSetField ids={ids} onChange={setIds} known={members.data} ordered label="Add a product" disabled={!canWrite || saving} emptyText="No products yet — the collection is empty on the shop." />
          {error && <p role="alert" className="text-sm font-medium text-bad">{error}</p>}
          {canWrite && <Button onClick={() => void saveMembers()} loading={saving} disabled={!dirty}>Save products</Button>}
          {dirty && <p className="text-sm font-semibold text-warn" role="status">Product changes not saved yet</p>}
        </>
      )}
    </section>
  );
}

function CollectionEditor({ collection, canWrite, onClose }: { collection?: CollectionRow; canWrite: boolean; onClose: () => void }) {
  const uid = React.useId();
  const [curId, setCurId] = React.useState(collection?.id);
  const [form, setForm] = React.useState<CollectionForm>(() => (collection ? toForm(collection) : emptyCollection()));
  const [base, setBase] = React.useState(form);
  const [membersDirty, setMembersDirty] = React.useState(false);
  const dirty = JSON.stringify(form) !== JSON.stringify(base) || membersDirty;
  const { save, saving, errors, message, clearError } = useEntitySave<CollectionRow>({ path: "/collections/", fields: FIELDS, invalidate: INVALIDATE, noun: "Collection" });
  const [local, setLocal] = React.useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [justCreated, setJustCreated] = React.useState(false);
  const set = <K extends keyof CollectionForm>(k: K, v: CollectionForm[K], api: string) => { setForm((f) => ({ ...f, [k]: v })); clearError(api); setLocal({}); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { setLocal({ name: "Enter a name." }); window.setTimeout(() => document.querySelector<HTMLElement>("[data-editor] [aria-invalid=true]")?.focus(), 0); return; }
    const res = await save(curId, collectionPayload(form));
    if (res) { if (curId === undefined) { setCurId(res.id); setJustCreated(true); } const f = toForm(res); setForm(f); setBase(f); }
  };
  const detailsDirty = JSON.stringify(form) !== JSON.stringify(base);

  return (
    <EditorSheet open onClose={onClose} title={curId === undefined ? "New collection" : `Edit ${collection?.name ?? "collection"}`} dirty={dirty} widthClass="w-[min(100vw,38rem)]"
      footer={
        <>
          {collection && canWrite && <Button variant="ghost" className="mr-auto text-bad" onClick={() => setConfirmDelete(true)}>Delete…</Button>}
          <Button variant="secondary" onClick={onClose}>{dirty ? "Cancel" : "Close"}</Button>
          {canWrite && <Button type="submit" form={`${uid}-form`} loading={saving} disabled={!detailsDirty}>{curId === undefined ? "Create collection" : "Save details"}</Button>}
        </>
      }>
      <div data-editor className="space-y-5">
        {justCreated && <Alert tone="ok" title="Collection created">Now add the products that belong in it.</Alert>}
        {message && <Alert tone="bad" title="This could not be saved">{message}</Alert>}
        <form id={`${uid}-form`} onSubmit={submit} noValidate>
          <fieldset disabled={!canWrite || saving} className="m-0 min-w-0 space-y-4 border-0 p-0">
            <FormField id={`${uid}-name`} label="Name" required error={errors.name ?? local.name}>{(p) => <Input {...p} value={form.name} maxLength={80} onChange={(e) => set("name", e.target.value, "name")} />}</FormField>
            <FormField id={`${uid}-slug`} label="Web address (slug)" error={errors.slug} hint="Leave blank to build it from the name.">{(p) => <Input {...p} className="num" value={form.slug} maxLength={90} onChange={(e) => set("slug", e.target.value, "slug")} />}</FormField>
            <FormField id={`${uid}-desc`} label="Description" error={errors.description} hint={`${form.description.length}/300`}>{(p) => <Textarea {...p} rows={3} maxLength={300} value={form.description} onChange={(e) => set("description", e.target.value, "description")} />}</FormField>
            <FieldGrid>
              <FormField id={`${uid}-start`} label="Starts on" error={errors.starts_on} hint="Leave empty to start straight away.">{(p) => <Input {...p} type="date" value={form.startsOn} onChange={(e) => set("startsOn", e.target.value, "starts_on")} />}</FormField>
              <FormField id={`${uid}-end`} label="Ends on" error={errors.ends_on} hint="Leave empty for no end date. The last day is included.">{(p) => <Input {...p} type="date" value={form.endsOn} onChange={(e) => set("endsOn", e.target.value, "ends_on")} />}</FormField>
            </FieldGrid>
            <FormField id={`${uid}-sort`} label="Sort order" error={errors.sort_order} hint="Lower numbers come first. You can also use the arrows in the list.">{(p) => <Input {...p} className="num w-32" inputMode="numeric" value={form.sortOrder} onChange={(e) => set("sortOrder", e.target.value, "sort_order")} />}</FormField>
            <Checkbox checked={form.isActive} onChange={(e) => set("isActive", e.target.checked, "is_active")} label={<><span className="font-semibold">Active</span><span className="block text-sm text-ink-3">Switch off to hide it without losing its products.</span></>} />
            <Checkbox checked={form.showOnHome} onChange={(e) => set("showOnHome", e.target.checked, "show_on_home")} label={<span className="font-semibold">Show on the home page</span>} />
          </fieldset>
        </form>
        {curId !== undefined ? <Membership key={curId} collectionId={curId} canWrite={canWrite} onDirty={setMembersDirty} /> : <p className="text-sm text-ink-3">Save the details first, then you can add products.</p>}
      </div>
      {collection && <ConfirmDelete open={confirmDelete} onOpenChange={setConfirmDelete} title={`Delete ${collection.name}?`} description="The collection and its product list are removed. The products themselves are not affected." noun="Collection" path={`/collections/${collection.id}/`} invalidate={INVALIDATE} onDone={onClose} />}
    </EditorSheet>
  );
}

export function CollectionsTab() {
  const { can } = useAdmin();
  const canWrite = can("catalog.merchandise");
  const toast = useToast();
  const refresh = useInvalidateAdmin();
  const list = useAdminList<CollectionRow>("/collections/");
  const [editing, setEditing] = React.useState<{ collection?: CollectionRow } | null>(null);
  const [moving, setMoving] = React.useState(false);
  const today = isoDate(new Date());
  const rows = React.useMemo(() => list.rows.slice().sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)), [list.rows]);

  const move = async (index: number, delta: -1 | 1) => {
    const plan = planSortOrder(rows, index, delta);
    if (!plan.length) return;
    setMoving(true);
    try {
      await Promise.all(plan.map((u) => adminRequest("PATCH", `/collections/${u.id}/`, { sort_order: u.sort_order })));
      toast.success("Order updated");
    } catch (e) {
      toast.error(e);
    } finally {
      refresh(...INVALIDATE);
      setMoving(false);
    }
  };

  const columns: Column<CollectionRow>[] = [
    ...(canWrite ? [{ key: "order", header: "Order", cell: (c: CollectionRow) => <ReorderButtons index={rows.indexOf(c)} count={rows.length} label={c.name} disabled={moving} onMove={(d) => void move(rows.indexOf(c), d)} /> }] : []),
    { key: "name", header: "Collection", cell: (c) => <><button type="button" className="text-left font-semibold text-primary underline-offset-4 hover:underline" onClick={() => setEditing({ collection: c })}>{c.name}</button><p className="num text-xs text-ink-3">/{c.slug}</p></> },
    { key: "state", header: "State", cell: (c) => { const s = collectionState(c, today); return <Badge tone={TONE[s]}>{s}</Badge>; } },
    { key: "dates", header: "Dates", hideBelow: "md", cell: (c) => c.starts_on || c.ends_on ? <span className="whitespace-nowrap text-ink-2">{c.starts_on ? formatDate(c.starts_on, "en-US", { day: "numeric", month: "short", year: "numeric" }) : "Any time"} → {c.ends_on ? formatDate(c.ends_on, "en-US", { day: "numeric", month: "short", year: "numeric" }) : "no end"}</span> : <span className="text-ink-3">Always</span> },
    { key: "products", header: "Products", align: "right", cell: (c) => c.product_count },
    { key: "home", header: "Home page", hideBelow: "lg", cell: (c) => (c.show_on_home ? <Badge tone="info">Shown</Badge> : <span className="text-ink-3">No</span>) },
  ];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-ink-3">Hand-picked groups of products with an optional schedule.{!canWrite && " Your role can view collections but not change them."}</p>
        {canWrite && <Button size="sm" onClick={() => setEditing({})}><Plus className="size-4" aria-hidden /> New collection</Button>}
      </div>
      <DataTable<CollectionRow> caption="Collections" columns={columns} rows={rows} loading={list.isLoading} error={list.error} onRetry={() => list.refetch()} empty={<EmptyState title="No collections yet">Create one to feature a themed group of products.</EmptyState>} />
      {editing && <CollectionEditor key={editing.collection?.id ?? "new"} collection={editing.collection} canWrite={canWrite} onClose={() => setEditing(null)} />}
    </div>
  );
}
