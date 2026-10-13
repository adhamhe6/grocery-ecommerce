"use client";

import { Plus } from "lucide-react";
import * as React from "react";
import { DataTable, FilterBar, FilterSelect, Pager, SearchField, useDebouncedValue, type Column } from "@/components/admin/kit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Select } from "@/components/ui/field";
import { Alert, EmptyState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { adminRequest, useAdmin, useAdminGet, useAdminList } from "@/lib/admin";
import { imgSrc } from "@/lib/format";
import { useStore } from "@/lib/hooks";
import { formatSchedule } from "../catalog/datetime";
import { ConfirmDelete, SingleImageCard, useEntitySave, useInvalidateAdmin } from "../catalog/entity-kit";
import { DateTimeField, EditorSheet, FieldGrid, FormField, ReorderButtons } from "../catalog/form-kit";
import { planSortOrder } from "../catalog/taxonomy-model";
import { PLACEMENTS, bannerPayload, bannerState, bannerToForm, emptyBanner, validateBanner, type BannerForm, type BannerRow, type BannerState } from "./content-model";

const FIELDS = ["placement", "title", "subtitle", "image", "cta_label", "cta_link", "starts_at", "ends_at", "sort_order", "is_active"] as const;
const INVALIDATE = ["/banners"];
const TONE: Record<BannerState, "ok" | "info" | "neutral" | "warn"> = { Live: "ok", Scheduled: "info", Ended: "neutral", Off: "warn" };
const placementLabel = (v: string) => PLACEMENTS.find(([k]) => k === v)?.[1] ?? v;

function BannerEditor({ banner, canWrite, onClose }: { banner?: BannerRow; canWrite: boolean; onClose: () => void }) {
  const uid = React.useId();
  const store = useStore();
  const [curId, setCurId] = React.useState(banner?.id);
  const detail = useAdminGet<BannerRow>(`/banners/${curId ?? 0}/`, {}, { enabled: curId !== undefined });
  const current = detail.data ?? banner;
  const [form, setForm] = React.useState<BannerForm>(() => (banner ? bannerToForm(banner) : emptyBanner()));
  const [base, setBase] = React.useState(form);
  const dirty = JSON.stringify(form) !== JSON.stringify(base);
  const { save, saving, errors, message, clearError } = useEntitySave<BannerRow>({ path: "/banners/", fields: FIELDS, invalidate: INVALIDATE, noun: "Banner" });
  const [local, setLocal] = React.useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [justCreated, setJustCreated] = React.useState(false);
  const err = (k: string) => errors[k] ?? local[k];
  const set = <K extends keyof BannerForm>(k: K, v: BannerForm[K], api: string) => { setForm((f) => ({ ...f, [k]: v })); clearError(api); setLocal({}); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const invalid = validateBanner(form);
    setLocal(invalid);
    if (Object.keys(invalid).length) { window.setTimeout(() => document.querySelector<HTMLElement>("[data-editor] [aria-invalid=true]")?.focus(), 0); return; }
    const res = await save(curId, bannerPayload(form));
    if (res) { if (curId === undefined) { setCurId(res.id); setJustCreated(true); } const f = bannerToForm(res); setForm(f); setBase(f); }
  };

  return (
    <EditorSheet open onClose={onClose} title={curId === undefined ? "New banner" : `Edit ${current?.title ?? "banner"}`} dirty={dirty} widthClass="w-[min(100vw,36rem)]"
      footer={
        <>
          {current && canWrite && <Button variant="ghost" className="mr-auto text-bad" onClick={() => setConfirmDelete(true)}>Delete…</Button>}
          <Button variant="secondary" onClick={onClose}>{dirty ? "Cancel" : "Close"}</Button>
          {canWrite && <Button type="submit" form={`${uid}-form`} loading={saving} disabled={!dirty}>{curId === undefined ? "Create banner" : "Save changes"}</Button>}
        </>
      }>
      <div data-editor className="space-y-5">
        {justCreated && <Alert tone="ok" title="Banner created">Add its picture below.</Alert>}
        {message && <Alert tone="bad" title="This could not be saved">{message}</Alert>}
        <form id={`${uid}-form`} onSubmit={submit} noValidate>
          <fieldset disabled={!canWrite || saving} className="m-0 min-w-0 space-y-4 border-0 p-0">
            <FormField id={`${uid}-placement`} label="Where it appears" error={err("placement")}>
              {(p) => <Select {...p} value={form.placement} onChange={(e) => set("placement", e.target.value, "placement")}>{PLACEMENTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>}
            </FormField>
            <FormField id={`${uid}-title`} label="Headline" required error={err("title")}>{(p) => <Input {...p} value={form.title} maxLength={120} onChange={(e) => set("title", e.target.value, "title")} />}</FormField>
            <FormField id={`${uid}-sub`} label="Supporting text" error={err("subtitle")} hint={form.subtitle.trim() ? `${form.subtitle.length}/240` : "Not provided"}>{(p) => <Input {...p} value={form.subtitle} maxLength={240} onChange={(e) => set("subtitle", e.target.value, "subtitle")} />}</FormField>
            <FieldGrid>
              <FormField id={`${uid}-cta`} label="Button label" error={err("cta_label")} hint="Leave empty for no button.">{(p) => <Input {...p} value={form.ctaLabel} maxLength={40} onChange={(e) => set("ctaLabel", e.target.value, "cta_label")} />}</FormField>
              <FormField id={`${uid}-link`} label="Button link" error={err("cta_link")} hint="A site path such as /offers, or an https:// address.">{(p) => <Input {...p} className="num" value={form.ctaLink} maxLength={300} onChange={(e) => set("ctaLink", e.target.value, "cta_link")} />}</FormField>
            </FieldGrid>
            <FieldGrid>
              <DateTimeField id={`${uid}-start`} label="Shows from" value={form.startsAt} onChange={(v) => set("startsAt", v, "starts_at")} timeZone={store.timezone} error={err("starts_at")} hint={`Store time (${store.timezone}). ${curId === undefined ? "Leave empty to show when you save." : ""}`} />
              <DateTimeField id={`${uid}-end`} label="Shows until" value={form.endsAt} onChange={(v) => set("endsAt", v, "ends_at")} timeZone={store.timezone} error={err("ends_at")} hint={`Store time (${store.timezone}). Leave empty for no end.`} />
            </FieldGrid>
            <FormField id={`${uid}-sort`} label="Sort order" error={err("sort_order")} hint="Lower numbers show first within the same place. You can also use the arrows in the list.">{(p) => <Input {...p} className="num w-32" inputMode="numeric" value={form.sortOrder} onChange={(e) => set("sortOrder", e.target.value, "sort_order")} />}</FormField>
            <Checkbox checked={form.isActive} onChange={(e) => set("isActive", e.target.checked, "is_active")} label={<><span className="font-semibold">Active</span><span className="block text-sm text-ink-3">Switch off to hide it without deleting it. It only shows between its start and end.</span></>} />
          </fieldset>
        </form>
        {curId !== undefined ? <SingleImageCard path={`/banners/${curId}/image/`} urls={current?.image} canWrite={canWrite} noun="picture" invalidate={INVALIDATE} /> : <p className="text-sm text-ink-3">Save the banner first, then you can add its picture.</p>}
      </div>
      {current && <ConfirmDelete open={confirmDelete} onOpenChange={setConfirmDelete} title={`Delete “${current.title}”?`} description="The banner and its picture are removed from the shop straight away." noun="Banner" path={`/banners/${current.id}/`} invalidate={INVALIDATE} onDone={onClose} />}
    </EditorSheet>
  );
}

export function BannersTab() {
  const { can } = useAdmin();
  const canWrite = can("content.manage");
  const store = useStore();
  const toast = useToast();
  const refresh = useInvalidateAdmin();
  const [search, setSearch] = React.useState("");
  const q = useDebouncedValue(search);
  const [placement, setPlacement] = React.useState("");
  const [active, setActive] = React.useState("");
  const [page, setPage] = React.useState(1);
  React.useEffect(() => setPage(1), [q, placement, active]);
  const list = useAdminList<BannerRow>("/banners/", { search: q.trim() || undefined, placement: placement || undefined, is_active: active || undefined, page, page_size: 50 });
  const [editing, setEditing] = React.useState<{ banner?: BannerRow } | null>(null);
  const [moving, setMoving] = React.useState(false);

  const move = async (b: BannerRow, delta: -1 | 1) => {
    const siblings = list.rows.filter((x) => x.placement === b.placement).sort((x, y) => x.sort_order - y.sort_order || x.id - y.id);
    const plan = planSortOrder(siblings, siblings.findIndex((x) => x.id === b.id), delta);
    if (!plan.length) return;
    setMoving(true);
    try {
      await Promise.all(plan.map((u) => adminRequest("PATCH", `/banners/${u.id}/`, { sort_order: u.sort_order })));
      toast.success("Order updated");
    } catch (e) {
      toast.error(e);
    } finally {
      refresh(...INVALIDATE);
      setMoving(false);
    }
  };

  const columns: Column<BannerRow>[] = [
    ...(canWrite ? [{ key: "order", header: "Order", cell: (b: BannerRow) => { const sib = list.rows.filter((x) => x.placement === b.placement); return <ReorderButtons index={sib.findIndex((x) => x.id === b.id)} count={sib.length} label={b.title} disabled={moving} onMove={(d) => void move(b, d)} />; } }] : []),
    { key: "pic", header: "Picture", hideBelow: "sm", cell: (b) => (Object.keys(b.image ?? {}).length ? <img src={imgSrc(b.image, 320)} alt="" className="h-12 w-20 rounded border border-line bg-paper-2 object-cover" /> : <Badge tone="warn">No picture</Badge>) },
    { key: "title", header: "Banner", cell: (b) => <><button type="button" className="text-left font-semibold text-primary underline-offset-4 hover:underline" onClick={() => setEditing({ banner: b })}>{b.title}</button>{b.subtitle && <p className="max-w-64 truncate text-xs text-ink-3">{b.subtitle}</p>}</> },
    { key: "placement", header: "Where", cell: (b) => placementLabel(b.placement) },
    { key: "when", header: "Schedule", hideBelow: "md", cell: (b) => <span className="text-ink-2">{formatSchedule(b.starts_at, b.ends_at, store.timezone, store.locale)}</span> },
    { key: "state", header: "State", cell: (b) => { const s = bannerState(b); return <Badge tone={TONE[s]}>{s}</Badge>; } },
  ];
  const filtered = !!(q || placement || active);
  return (
    <div className="space-y-4">
      <FilterBar>
        <SearchField value={search} onChange={setSearch} placeholder="Search banners…" label="Search banners" />
        <FilterSelect label="Where" value={placement} onChange={setPlacement} options={PLACEMENTS} />
        <FilterSelect label="Switch" value={active} onChange={setActive} options={[["true", "On"], ["false", "Off"]]} />
        {canWrite && <Button size="sm" className="ml-auto" onClick={() => setEditing({})}><Plus className="size-4" aria-hidden /> New banner</Button>}
      </FilterBar>
      <DataTable<BannerRow> caption="Banners" columns={columns} rows={list.rows} loading={list.isLoading} error={list.error} onRetry={() => list.refetch()}
        empty={<EmptyState title={filtered ? "No banners match" : "No banners yet"}>{filtered ? "Try a different search or filter." : "Banners are the pictures and messages at the top of the home page."}</EmptyState>} />
      <Pager page={list.page} totalPages={list.totalPages} count={list.count} onPage={setPage} label="banners" />
      {editing && <BannerEditor key={editing.banner?.id ?? "new"} banner={editing.banner} canWrite={canWrite} onClose={() => setEditing(null)} />}
    </div>
  );
}
