"use client";

import { ExternalLink, Plus } from "lucide-react";
import * as React from "react";
import { DataTable, FilterBar, FilterSelect, SearchField, useDebouncedValue, type Column } from "@/components/admin/kit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Textarea } from "@/components/ui/field";
import { Alert, EmptyState } from "@/components/ui/states";
import { useAdmin, useAdminList } from "@/lib/admin";
import { formatDate } from "@/lib/format";
import { ConfirmDelete, useEntitySave } from "../catalog/entity-kit";
import { EditorSheet, FormField } from "../catalog/form-kit";
import { emptyPage, pagePayload, pageToForm, validatePage, type PageForm, type PageRow } from "./content-model";
import { MarkdownField } from "./markdown-field";

const FIELDS = ["title", "slug", "summary", "body", "is_published", "is_template"] as const;
const INVALIDATE = ["/pages"];

function PageEditor({ page, canWrite, onClose }: { page?: PageRow; canWrite: boolean; onClose: () => void }) {
  const uid = React.useId();
  const [curId, setCurId] = React.useState(page?.id);
  const [saved, setSaved] = React.useState(page);
  const [form, setForm] = React.useState<PageForm>(() => (page ? pageToForm(page) : emptyPage()));
  const [base, setBase] = React.useState(form);
  const dirty = JSON.stringify(form) !== JSON.stringify(base);
  const { save, saving, errors, message, clearError } = useEntitySave<PageRow>({ path: "/pages/", fields: FIELDS, invalidate: INVALIDATE, noun: "Page" });
  const [local, setLocal] = React.useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const err = (k: string) => errors[k] ?? local[k];
  const set = <K extends keyof PageForm>(k: K, v: PageForm[K], api: string) => { setForm((f) => ({ ...f, [k]: v })); clearError(api); setLocal((l) => (api in l ? Object.fromEntries(Object.entries(l).filter(([x]) => x !== api)) : l)); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const invalid = validatePage(form);
    setLocal(invalid);
    if (Object.keys(invalid).length) { window.setTimeout(() => document.querySelector<HTMLElement>("[data-editor] [aria-invalid=true]")?.focus(), 0); return; }
    const res = await save(curId, pagePayload(form));
    if (res) { setCurId(res.id); setSaved(res); const f = pageToForm(res); setForm(f); setBase(f); }
  };

  return (
    <EditorSheet open onClose={onClose} title={curId === undefined ? "New page" : `Edit ${saved?.title ?? "page"}`} dirty={dirty} widthClass="w-[min(100vw,70rem)]"
      footer={
        <>
          {saved && canWrite && <Button variant="ghost" className="mr-auto text-bad" onClick={() => setConfirmDelete(true)}>Delete…</Button>}
          {saved?.is_published && <a className="mr-2 inline-flex items-center gap-1 text-sm font-semibold text-primary underline-offset-4 hover:underline" href={`/p/${saved.slug}`} target="_blank" rel="noopener">View on the shop <ExternalLink className="size-3.5" aria-hidden />{" "}<span className="sr-only">(opens in a new tab)</span></a>}
          <Button variant="secondary" onClick={onClose}>{dirty ? "Cancel" : "Close"}</Button>
          {canWrite && <Button type="submit" form={`${uid}-form`} loading={saving} disabled={!dirty}>{curId === undefined ? "Create page" : "Save changes"}</Button>}
        </>
      }>
      <div data-editor className="space-y-5">
        {message && <Alert tone="bad" title="This could not be saved">{message}</Alert>}
        <form id={`${uid}-form`} onSubmit={submit} noValidate>
          <fieldset disabled={!canWrite || saving} className="m-0 min-w-0 space-y-4 border-0 p-0">
            <div className="grid gap-4 md:grid-cols-2">
              <FormField id={`${uid}-title`} label="Title" required error={err("title")}>{(p) => <Input {...p} value={form.title} maxLength={140} onChange={(e) => set("title", e.target.value, "title")} />}</FormField>
              <FormField id={`${uid}-slug`} label="Web address (slug)" error={err("slug")} hint={curId === undefined ? "Leave blank to build it from the title. The page lives at /p/slug." : `Lives at /p/${form.slug || "…"}. Changing it breaks existing links to the page.`}>{(p) => <Input {...p} className="num" value={form.slug} maxLength={80} onChange={(e) => set("slug", e.target.value, "slug")} />}</FormField>
            </div>
            <FormField id={`${uid}-summary`} label="Summary" error={err("summary")} hint={form.summary.trim() ? `${form.summary.length}/300 · shown under the title and in search results.` : "Not provided"}>{(p) => <Textarea {...p} rows={2} maxLength={300} value={form.summary} onChange={(e) => set("summary", e.target.value, "summary")} />}</FormField>
            <MarkdownField id={`${uid}-body`} label="Page text" required value={form.body} onChange={(v) => set("body", v, "body")} error={err("body")} rows={18} />
            <div className="grid gap-3 md:grid-cols-2">
              <Checkbox checked={form.isPublished} onChange={(e) => set("isPublished", e.target.checked, "is_published")} label={<><span className="font-semibold">Published</span><span className="block text-sm text-ink-3">Unpublished pages return “not found” on the shop.</span></>} />
              <Checkbox checked={form.isTemplate} onChange={(e) => set("isTemplate", e.target.checked, "is_template")} label={<><span className="font-semibold">Placeholder wording</span><span className="block text-sm text-ink-3">Tick while legal or business owners still need to review the text. The shop labels it as a template.</span></>} />
            </div>
          </fieldset>
        </form>
      </div>
      {saved && <ConfirmDelete open={confirmDelete} onOpenChange={setConfirmDelete} title={`Delete “${saved.title}”?`} description="Links to this page will stop working." noun="Page" path={`/pages/${saved.id}/`} invalidate={INVALIDATE} onDone={onClose} />}
    </EditorSheet>
  );
}

export function PagesTab() {
  const { can } = useAdmin();
  const canWrite = can("content.manage");
  const [search, setSearch] = React.useState("");
  const q = useDebouncedValue(search);
  const [published, setPublished] = React.useState("");
  const [template, setTemplate] = React.useState("");
  const list = useAdminList<PageRow>("/pages/", { search: q.trim() || undefined, is_published: published || undefined, is_template: template || undefined });
  const [editing, setEditing] = React.useState<{ page?: PageRow } | null>(null);
  const columns: Column<PageRow>[] = [
    { key: "title", header: "Page", cell: (p) => <><button type="button" className="text-left font-semibold text-primary underline-offset-4 hover:underline" onClick={() => setEditing({ page: p })}>{p.title}</button><p className="num text-xs text-ink-3">/p/{p.slug}</p></> },
    { key: "state", header: "Status", cell: (p) => <span className="flex flex-wrap gap-1.5">{p.is_published ? <Badge tone="ok">Published</Badge> : <Badge tone="neutral">Not published</Badge>}{p.is_template && <Badge tone="warn">Placeholder wording</Badge>}</span> },
    { key: "updated", header: "Updated", hideBelow: "md", cell: (p) => <span className="whitespace-nowrap text-ink-3">{formatDate(p.updated_at, "en-US", { day: "numeric", month: "short", year: "numeric" })}</span> },
  ];
  const filtered = !!(q || published || template);
  return (
    <div className="space-y-4">
      <FilterBar>
        <SearchField value={search} onChange={setSearch} placeholder="Search pages…" label="Search pages" />
        <FilterSelect label="Status" value={published} onChange={setPublished} options={[["true", "Published"], ["false", "Not published"]]} />
        <FilterSelect label="Wording" value={template} onChange={setTemplate} options={[["true", "Placeholder — needs review"], ["false", "Reviewed"]]} />
        {canWrite && <Button size="sm" className="ml-auto" onClick={() => setEditing({})}><Plus className="size-4" aria-hidden /> New page</Button>}
      </FilterBar>
      <DataTable<PageRow> caption="Pages" columns={columns} rows={list.rows} loading={list.isLoading} error={list.error} onRetry={() => list.refetch()} empty={<EmptyState title={filtered ? "No pages match" : "No pages yet"}>{filtered ? "Try a different search or filter." : "Pages hold policies and information such as delivery, privacy and terms."}</EmptyState>} />
      <p className="num text-sm text-ink-3">{list.count} {list.count === 1 ? "page" : "pages"}</p>
      {editing && <PageEditor key={editing.page?.id ?? "new"} page={editing.page} canWrite={canWrite} onClose={() => setEditing(null)} />}
    </div>
  );
}
