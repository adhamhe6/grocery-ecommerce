"use client";

import { ExternalLink, Plus } from "lucide-react";
import * as React from "react";
import { DataTable, FilterBar, FilterSelect, Pager, SearchField, useDebouncedValue, type Column } from "@/components/admin/kit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/field";
import { Alert, EmptyState } from "@/components/ui/states";
import { useAdmin, useAdminGet, useAdminList } from "@/lib/admin";
import { formatDate, imgSrc } from "@/lib/format";
import { useStore } from "@/lib/hooks";
import { ConfirmDelete, SingleImageCard, useEntitySave } from "../catalog/entity-kit";
import { DateTimeField, EditorSheet, FieldGrid, FormField } from "../catalog/form-kit";
import { ProductSetField } from "../catalog/product-picker";
import { ARTICLE_KINDS, articlePayload, articleState, articleToForm, emptyArticle, validateArticle, type ArticleForm, type ArticleRow, type ArticleState } from "./content-model";
import { MarkdownField } from "./markdown-field";

const FIELDS = ["kind", "slug", "title", "summary", "body", "image", "products", "servings", "total_minutes", "published_at", "is_published"] as const;
const INVALIDATE = ["/articles"];
const TONE: Record<ArticleState, "ok" | "info" | "neutral"> = { Live: "ok", Scheduled: "info", "Not published": "neutral" };
const kindLabel = (k: string) => ARTICLE_KINDS.find(([v]) => v === k)?.[1] ?? k;

function ArticleEditor({ article, canWrite, onClose }: { article?: ArticleRow; canWrite: boolean; onClose: () => void }) {
  const uid = React.useId();
  const store = useStore();
  const [curId, setCurId] = React.useState(article?.id);
  const detail = useAdminGet<ArticleRow>(`/articles/${curId ?? 0}/`, {}, { enabled: curId !== undefined });
  const current = detail.data ?? article;
  const [form, setForm] = React.useState<ArticleForm>(() => (article ? articleToForm(article) : emptyArticle()));
  const [base, setBase] = React.useState(form);
  const dirty = JSON.stringify(form) !== JSON.stringify(base);
  const { save, saving, errors, message, clearError } = useEntitySave<ArticleRow>({ path: "/articles/", fields: FIELDS, invalidate: INVALIDATE, noun: "Article" });
  const [local, setLocal] = React.useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [justCreated, setJustCreated] = React.useState(false);
  const err = (k: string) => errors[k] ?? local[k];
  const set = <K extends keyof ArticleForm>(k: K, v: ArticleForm[K], api: string) => { setForm((f) => ({ ...f, [k]: v })); clearError(api); setLocal((l) => (api in l ? Object.fromEntries(Object.entries(l).filter(([x]) => x !== api)) : l)); };
  const recipe = form.kind === "RECIPE";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const invalid = validateArticle(form);
    setLocal(invalid);
    if (Object.keys(invalid).length) { window.setTimeout(() => document.querySelector<HTMLElement>("[data-editor] [aria-invalid=true]")?.focus(), 0); return; }
    const res = await save(curId, articlePayload(form));
    if (res) { if (curId === undefined) { setCurId(res.id); setJustCreated(true); } const f = articleToForm(res); setForm(f); setBase(f); }
  };

  return (
    <EditorSheet open onClose={onClose} title={curId === undefined ? "New article" : `Edit ${current?.title ?? "article"}`} dirty={dirty} widthClass="w-[min(100vw,70rem)]"
      footer={
        <>
          {current && canWrite && <Button variant="ghost" className="mr-auto text-bad" onClick={() => setConfirmDelete(true)}>Delete…</Button>}
          {current && articleState(current) === "Live" && <a className="mr-2 inline-flex items-center gap-1 text-sm font-semibold text-primary underline-offset-4 hover:underline" href={`/guides/${current.slug}`} target="_blank" rel="noopener">View on the shop <ExternalLink className="size-3.5" aria-hidden />{" "}<span className="sr-only">(opens in a new tab)</span></a>}
          <Button variant="secondary" onClick={onClose}>{dirty ? "Cancel" : "Close"}</Button>
          {canWrite && <Button type="submit" form={`${uid}-form`} loading={saving} disabled={!dirty}>{curId === undefined ? "Create article" : "Save changes"}</Button>}
        </>
      }>
      <div data-editor className="space-y-5">
        {justCreated && <Alert tone="ok" title="Article created">You can add a picture below.</Alert>}
        {message && <Alert tone="bad" title="This could not be saved">{message}</Alert>}
        <form id={`${uid}-form`} onSubmit={submit} noValidate>
          <fieldset disabled={!canWrite || saving} className="m-0 min-w-0 space-y-4 border-0 p-0">
            <div className="grid gap-4 md:grid-cols-3">
              <FormField id={`${uid}-kind`} label="Kind" error={err("kind")}>{(p) => <Select {...p} value={form.kind} onChange={(e) => set("kind", e.target.value, "kind")}>{ARTICLE_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>}</FormField>
              <FormField className="md:col-span-2" id={`${uid}-title`} label="Title" required error={err("title")}>{(p) => <Input {...p} value={form.title} maxLength={160} onChange={(e) => set("title", e.target.value, "title")} />}</FormField>
            </div>
            <FormField id={`${uid}-summary`} label="Summary" required error={err("summary")} hint={`${form.summary.length}/300 · shown on cards and in search results.`}>{(p) => <Textarea {...p} rows={2} maxLength={300} value={form.summary} onChange={(e) => set("summary", e.target.value, "summary")} />}</FormField>
            {recipe && <Alert tone="info" title="Tip for recipes">Use a <code>## Ingredients</code> heading followed by a list, and a <code>## Method</code> heading followed by a numbered list. The shop reads those two lists for search engines and structured recipe data. Servings and time come from the fields below.</Alert>}
            <MarkdownField id={`${uid}-body`} label="Text" required value={form.body} onChange={(v) => set("body", v, "body")} error={err("body")} rows={18} />
            <FieldGrid cols={3}>
              <FormField id={`${uid}-serv`} label="Servings" error={err("servings")} hint={form.servings.trim() ? undefined : recipe ? "Not provided" : "Optional"}>{(p) => <Input {...p} className="num" inputMode="numeric" value={form.servings} onChange={(e) => set("servings", e.target.value, "servings")} />}</FormField>
              <FormField id={`${uid}-mins`} label="Total minutes" error={err("total_minutes")} hint={form.totalMinutes.trim() ? undefined : recipe ? "Not provided" : "Optional"}>{(p) => <Input {...p} className="num" inputMode="numeric" value={form.totalMinutes} onChange={(e) => set("totalMinutes", e.target.value, "total_minutes")} />}</FormField>
              <FormField id={`${uid}-slug`} label="Web address (slug)" error={err("slug")} hint={curId === undefined ? "Leave blank to build it from the title." : `Lives at /guides/${form.slug || "…"}.`}>{(p) => <Input {...p} className="num" value={form.slug} maxLength={100} onChange={(e) => set("slug", e.target.value, "slug")} />}</FormField>
            </FieldGrid>
            <FieldGrid>
              <DateTimeField id={`${uid}-pub`} label="Publish date" value={form.publishedAt} onChange={(v) => set("publishedAt", v, "published_at")} timeZone={store.timezone} error={err("published_at")} hint={`Store time (${store.timezone}). A future date schedules it. ${curId === undefined ? "Leave empty to use the moment you save." : ""}`} />
              <div className="self-end"><Checkbox checked={form.isPublished} onChange={(e) => set("isPublished", e.target.checked, "is_published")} label={<><span className="font-semibold">Published</span><span className="block text-sm text-ink-3">Needs both this tick and a publish date that has passed.</span></>} /></div>
            </FieldGrid>
            <ProductSetField ids={form.products} onChange={(ids) => set("products", ids, "products")} label="Link products (shown as “Shop this recipe”)" error={err("products")} disabled={!canWrite || saving} emptyText="No products linked." />
          </fieldset>
        </form>
        {curId !== undefined ? <SingleImageCard path={`/articles/${curId}/image/`} urls={current?.image} canWrite={canWrite} noun="picture" invalidate={INVALIDATE} /> : <p className="text-sm text-ink-3">Save the article first, then you can add its picture.</p>}
      </div>
      {current && <ConfirmDelete open={confirmDelete} onOpenChange={setConfirmDelete} title={`Delete “${current.title}”?`} description="The article and its picture are removed from the shop." noun="Article" path={`/articles/${current.id}/`} invalidate={INVALIDATE} onDone={onClose} />}
    </EditorSheet>
  );
}

export function ArticlesTab() {
  const { can } = useAdmin();
  const canWrite = can("content.manage");
  const [search, setSearch] = React.useState("");
  const q = useDebouncedValue(search);
  const [kind, setKind] = React.useState("");
  const [published, setPublished] = React.useState("");
  const [page, setPage] = React.useState(1);
  React.useEffect(() => setPage(1), [q, kind, published]);
  const list = useAdminList<ArticleRow>("/articles/", { search: q.trim() || undefined, kind: kind || undefined, is_published: published || undefined, page, page_size: 20 });
  const [editing, setEditing] = React.useState<{ article?: ArticleRow } | null>(null);
  const columns: Column<ArticleRow>[] = [
    { key: "pic", header: "Picture", hideBelow: "sm", cell: (a) => (Object.keys(a.image ?? {}).length ? <img src={imgSrc(a.image, 320)} alt="" className="h-12 w-[4.5rem] rounded border border-line bg-paper-2 object-cover" /> : <Badge tone="warn">No picture</Badge>) },
    { key: "title", header: "Article", cell: (a) => <><button type="button" className="text-left font-semibold text-primary underline-offset-4 hover:underline" onClick={() => setEditing({ article: a })}>{a.title}</button><p className="max-w-72 truncate text-xs text-ink-3">{a.summary}</p></> },
    { key: "kind", header: "Kind", cell: (a) => <Badge tone={a.kind === "RECIPE" ? "citrus" : "info"}>{kindLabel(a.kind)}</Badge> },
    { key: "date", header: "Publish date", hideBelow: "md", cell: (a) => <span className="whitespace-nowrap text-ink-2">{formatDate(a.published_at, "en-US", { day: "numeric", month: "short", year: "numeric" })}</span> },
    { key: "products", header: "Products", align: "right", hideBelow: "md", cell: (a) => a.products.length },
    { key: "state", header: "State", cell: (a) => { const s = articleState(a); return <Badge tone={TONE[s]}>{s}</Badge>; } },
  ];
  const filtered = !!(q || kind || published);
  return (
    <div className="space-y-4">
      <FilterBar>
        <SearchField value={search} onChange={setSearch} placeholder="Search articles…" label="Search articles" />
        <FilterSelect label="Kind" value={kind} onChange={setKind} options={ARTICLE_KINDS} />
        <FilterSelect label="Status" value={published} onChange={setPublished} options={[["true", "Published"], ["false", "Not published"]]} />
        {canWrite && <Button size="sm" className="ml-auto" onClick={() => setEditing({})}><Plus className="size-4" aria-hidden /> New article</Button>}
      </FilterBar>
      <DataTable<ArticleRow> caption="Articles and recipes" columns={columns} rows={list.rows} loading={list.isLoading} error={list.error} onRetry={() => list.refetch()} empty={<EmptyState title={filtered ? "No articles match" : "No articles yet"}>{filtered ? "Try a different search or filter." : "Recipes and grocery guides appear on the shop's Recipes & guides page."}</EmptyState>} />
      <Pager page={list.page} totalPages={list.totalPages} count={list.count} onPage={setPage} label="articles" />
      {editing && <ArticleEditor key={editing.article?.id ?? "new"} article={editing.article} canWrite={canWrite} onClose={() => setEditing(null)} />}
    </div>
  );
}
