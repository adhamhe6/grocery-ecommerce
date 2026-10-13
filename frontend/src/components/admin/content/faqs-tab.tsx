"use client";

import { Plus } from "lucide-react";
import * as React from "react";
import { DataTable, FilterBar, FilterSelect, SearchField, useDebouncedValue, type Column } from "@/components/admin/kit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox, Input } from "@/components/ui/field";
import { Alert, EmptyState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { adminRequest, useAdmin, useAdminList } from "@/lib/admin";
import { ConfirmDelete, useEntitySave, useInvalidateAdmin } from "../catalog/entity-kit";
import { EditorSheet, FormField, ReorderButtons } from "../catalog/form-kit";
import { planSortOrder } from "../catalog/taxonomy-model";
import { emptyFaq, faqPayload, faqToForm, validateFaq, type FaqForm, type FaqRow } from "./content-model";
import { MarkdownField } from "./markdown-field";

const FIELDS = ["question", "answer", "topic", "sort_order", "is_published"] as const;
const INVALIDATE = ["/faqs"];

function FaqEditor({ faq, topics, defaultTopic, canWrite, onClose }: { faq?: FaqRow; topics: string[]; defaultTopic: string; canWrite: boolean; onClose: () => void }) {
  const uid = React.useId();
  const [curId, setCurId] = React.useState(faq?.id);
  const [form, setForm] = React.useState<FaqForm>(() => (faq ? faqToForm(faq) : emptyFaq(defaultTopic)));
  const [base, setBase] = React.useState(form);
  const dirty = JSON.stringify(form) !== JSON.stringify(base);
  const { save, saving, errors, message, clearError } = useEntitySave<FaqRow>({ path: "/faqs/", fields: FIELDS, invalidate: INVALIDATE, noun: "FAQ" });
  const [local, setLocal] = React.useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const err = (k: string) => errors[k] ?? local[k];
  const set = <K extends keyof FaqForm>(k: K, v: FaqForm[K], api: string) => { setForm((f) => ({ ...f, [k]: v })); clearError(api); setLocal((l) => (api in l ? Object.fromEntries(Object.entries(l).filter(([x]) => x !== api)) : l)); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const invalid = validateFaq(form);
    setLocal(invalid);
    if (Object.keys(invalid).length) { window.setTimeout(() => document.querySelector<HTMLElement>("[data-editor] [aria-invalid=true]")?.focus(), 0); return; }
    const res = await save(curId, faqPayload(form));
    if (res) { setCurId(res.id); const f = faqToForm(res); setForm(f); setBase(f); }
  };

  return (
    <EditorSheet open onClose={onClose} title={curId === undefined ? "New FAQ" : "Edit FAQ"} dirty={dirty} widthClass="w-[min(100vw,60rem)]"
      footer={
        <>
          {curId !== undefined && canWrite && <Button variant="ghost" className="mr-auto text-bad" onClick={() => setConfirmDelete(true)}>Delete…</Button>}
          <Button variant="secondary" onClick={onClose}>{dirty ? "Cancel" : "Close"}</Button>
          {canWrite && <Button type="submit" form={`${uid}-form`} loading={saving} disabled={!dirty}>{curId === undefined ? "Create FAQ" : "Save changes"}</Button>}
        </>
      }>
      <div data-editor className="space-y-5">
        {message && <Alert tone="bad" title="This could not be saved">{message}</Alert>}
        <form id={`${uid}-form`} onSubmit={submit} noValidate>
          <fieldset disabled={!canWrite || saving} className="m-0 min-w-0 space-y-4 border-0 p-0">
            <div className="grid gap-4 md:grid-cols-[1fr_2fr]">
              <FormField id={`${uid}-topic`} label="Topic" error={err("topic")} hint="Questions are grouped by topic on the FAQ page.">
                {(p) => (<><Input {...p} list={`${uid}-topics`} value={form.topic} maxLength={60} onChange={(e) => set("topic", e.target.value, "topic")} /><datalist id={`${uid}-topics`}>{topics.map((t) => <option key={t} value={t} />)}</datalist></>)}
              </FormField>
              <FormField id={`${uid}-q`} label="Question" required error={err("question")}>{(p) => <Input {...p} value={form.question} maxLength={200} onChange={(e) => set("question", e.target.value, "question")} />}</FormField>
            </div>
            <MarkdownField id={`${uid}-a`} label="Answer" required value={form.answer} onChange={(v) => set("answer", v, "answer")} error={err("answer")} rows={8} previewTitle="Preview of the answer" />
            <FormField id={`${uid}-sort`} label="Sort order" error={err("sort_order")} hint="Lower numbers come first within the topic. You can also use the arrows in the list.">{(p) => <Input {...p} className="num w-32" inputMode="numeric" value={form.sortOrder} onChange={(e) => set("sortOrder", e.target.value, "sort_order")} />}</FormField>
            <Checkbox checked={form.isPublished} onChange={(e) => set("isPublished", e.target.checked, "is_published")} label={<><span className="font-semibold">Published</span><span className="block text-sm text-ink-3">Unpublished questions are hidden from the FAQ page.</span></>} />
          </fieldset>
        </form>
      </div>
      {curId !== undefined && <ConfirmDelete open={confirmDelete} onOpenChange={setConfirmDelete} title="Delete this FAQ?" description="The question and answer are removed from the FAQ page." noun="FAQ" path={`/faqs/${curId}/`} invalidate={INVALIDATE} onDone={onClose} />}
    </EditorSheet>
  );
}

export function FaqsTab() {
  const { can } = useAdmin();
  const canWrite = can("content.manage");
  const toast = useToast();
  const refresh = useInvalidateAdmin();
  const [search, setSearch] = React.useState("");
  const q = useDebouncedValue(search);
  const [topic, setTopic] = React.useState("");
  const [published, setPublished] = React.useState("");
  const all = useAdminList<FaqRow>("/faqs/");
  const list = useAdminList<FaqRow>("/faqs/", { search: q.trim() || undefined, topic: topic || undefined, is_published: published || undefined });
  const topics = React.useMemo(() => [...new Set(all.rows.map((f) => f.topic))].sort(), [all.rows]);
  const [editing, setEditing] = React.useState<{ faq?: FaqRow } | null>(null);
  const [moving, setMoving] = React.useState(false);

  const move = async (f: FaqRow, delta: -1 | 1) => {
    const siblings = all.rows.filter((x) => x.topic === f.topic).sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
    const plan = planSortOrder(siblings, siblings.findIndex((x) => x.id === f.id), delta);
    if (!plan.length) return;
    setMoving(true);
    try {
      await Promise.all(plan.map((u) => adminRequest("PATCH", `/faqs/${u.id}/`, { sort_order: u.sort_order })));
      toast.success("Order updated");
    } catch (e) {
      toast.error(e);
    } finally {
      refresh(...INVALIDATE);
      setMoving(false);
    }
  };
  const columns: Column<FaqRow>[] = [
    ...(canWrite ? [{ key: "order", header: "Order", cell: (f: FaqRow) => { const sib = all.rows.filter((x) => x.topic === f.topic); const idx = sib.findIndex((x) => x.id === f.id); return <ReorderButtons index={idx} count={sib.length} label={f.question} disabled={moving} onMove={(d) => void move(f, d)} />; } }] : []),
    { key: "topic", header: "Topic", cell: (f) => f.topic },
    { key: "q", header: "Question", cell: (f) => <button type="button" className="text-left font-semibold text-primary underline-offset-4 hover:underline" onClick={() => setEditing({ faq: f })}>{f.question}</button> },
    { key: "state", header: "Status", cell: (f) => (f.is_published ? <Badge tone="ok">Published</Badge> : <Badge tone="neutral">Not published</Badge>) },
  ];
  const filtered = !!(q || topic || published);
  return (
    <div className="space-y-4">
      <FilterBar>
        <SearchField value={search} onChange={setSearch} placeholder="Search questions and answers…" label="Search FAQs" />
        <FilterSelect label="Topic" value={topic} onChange={setTopic} options={topics.map((t) => [t, t])} />
        <FilterSelect label="Status" value={published} onChange={setPublished} options={[["true", "Published"], ["false", "Not published"]]} />
        {canWrite && <Button size="sm" className="ml-auto" onClick={() => setEditing({})}><Plus className="size-4" aria-hidden /> New FAQ</Button>}
      </FilterBar>
      <DataTable<FaqRow> caption="Frequently asked questions" columns={columns} rows={list.rows} loading={list.isLoading} error={list.error} onRetry={() => list.refetch()} empty={<EmptyState title={filtered ? "No FAQs match" : "No FAQs yet"}>{filtered ? "Try a different search or filter." : "Add the questions customers ask most."}</EmptyState>} />
      <p className="num text-sm text-ink-3">{list.count} {list.count === 1 ? "question" : "questions"}</p>
      {editing && <FaqEditor key={editing.faq?.id ?? "new"} faq={editing.faq} topics={topics} defaultTopic={topic || "General"} canWrite={canWrite} onClose={() => setEditing(null)} />}
    </div>
  );
}
