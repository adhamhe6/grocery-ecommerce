"use client";

import { Download, Mail } from "lucide-react";
import * as React from "react";
import { AdminPage, ConfirmDialog, DataTable, FilterBar, FilterSelect, Pager, SearchField, StatCard, StatusBadge, useDebouncedValue, type Column } from "@/components/admin/kit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { adminRequest, useAdmin, useAdminAction, useAdminList } from "@/lib/admin";
import { formatDateTime } from "@/lib/format";
import { useStore } from "@/lib/hooks";
import { useTabParam } from "../catalog/form-kit";
import { CONTACT_TOPICS, SUBSCRIBER_STATES, mailtoHref, topicLabel, type ContactMessageRow, type SubscriberRow } from "./newsletter-model";

const EXPORT_URL = "/api/v1/admin/newsletter/export/";

function Subscribers() {
  const [search, setSearch] = React.useState("");
  const q = useDebouncedValue(search);
  const [status, setStatus] = React.useState("");
  const [page, setPage] = React.useState(1);
  React.useEffect(() => setPage(1), [q, status]);
  const list = useAdminList<SubscriberRow>("/newsletter/", { search: q.trim() || undefined, status: status || undefined, page, page_size: 25 });
  const all = useAdminList<SubscriberRow>("/newsletter/", { page_size: 1 });
  const confirmed = useAdminList<SubscriberRow>("/newsletter/", { status: "CONFIRMED", page_size: 1 });
  const pending = useAdminList<SubscriberRow>("/newsletter/", { status: "PENDING", page_size: 1 });
  const gone = useAdminList<SubscriberRow>("/newsletter/", { status: "UNSUBSCRIBED", page_size: 1 });
  const columns: Column<SubscriberRow>[] = [
    { key: "email", header: "Email", cell: (s) => <span className="font-medium text-ink">{s.email}</span> },
    { key: "status", header: "Status", cell: (s) => <Badge tone={s.status === "CONFIRMED" ? "ok" : s.status === "PENDING" ? "warn" : "neutral"}>{SUBSCRIBER_STATES.find(([k]) => k === s.status)?.[1] ?? s.status}</Badge> },
    { key: "signed", header: "Signed up", hideBelow: "sm", cell: (s) => <span className="whitespace-nowrap text-ink-2">{formatDateTime(s.created_at)}</span> },
    { key: "confirmed", header: "Confirmed", hideBelow: "md", cell: (s) => (s.confirmed_at ? <span className="whitespace-nowrap text-ink-2">{formatDateTime(s.confirmed_at)}</span> : <span className="text-ink-3">Not confirmed</span>) },
    { key: "left", header: "Unsubscribed", hideBelow: "lg", cell: (s) => (s.unsubscribed_at ? <span className="whitespace-nowrap text-ink-2">{formatDateTime(s.unsubscribed_at)}</span> : <span className="text-ink-3">—</span>) },
  ];
  const num = (l: { isLoading: boolean; count: number }) => (l.isLoading ? "…" : l.count);
  return (
    <div className="space-y-5">
      <section aria-label="Subscriber counts" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Confirmed" value={num(confirmed)} hint="can be emailed" tone="ok" />
        <StatCard label="Waiting for confirmation" value={num(pending)} hint="signed up, not confirmed" />
        <StatCard label="Unsubscribed" value={num(gone)} hint="must not be emailed" />
        <StatCard label="All sign-ups" value={num(all)} />
      </section>
      <FilterBar>
        <SearchField value={search} onChange={setSearch} placeholder="Search by email…" label="Search subscribers" />
        <FilterSelect label="Status" value={status} onChange={setStatus} options={SUBSCRIBER_STATES} />
        <a href={EXPORT_URL} download className="ml-auto inline-flex h-9 items-center gap-2 rounded-md border border-line-strong bg-white px-3 text-sm font-semibold text-primary hover:bg-paper-2"><Download className="size-4" aria-hidden /> Export confirmed addresses (CSV)</a>
      </FilterBar>
      <p className="-mt-2 text-xs text-ink-3">The export contains only people who confirmed and haven&apos;t left, the only ones you may email. Each export is recorded in the audit log.</p>
      <DataTable<SubscriberRow> caption="Newsletter subscribers" columns={columns} rows={list.rows} loading={list.isLoading} error={list.error} onRetry={() => list.refetch()}
        empty={<EmptyState title={q || status ? "No subscribers match" : "No subscribers yet"}>{q || status ? "Try a different search or status." : "People who sign up on the shop appear here once they confirm by email."}</EmptyState>} />
      <Pager page={list.page} totalPages={list.totalPages} count={list.count} onPage={setPage} label="subscribers" />
    </div>
  );
}

function Messages() {
  const store = useStore();
  const [search, setSearch] = React.useState("");
  const q = useDebouncedValue(search);
  const [status, setStatus] = React.useState("NEW");
  const [topic, setTopic] = React.useState("");
  const [page, setPage] = React.useState(1);
  React.useEffect(() => setPage(1), [q, status, topic]);
  const list = useAdminList<ContactMessageRow>("/contact-messages/", { q: q.trim() || undefined, status: status || undefined, topic: topic || undefined, page, page_size: 15 });
  const fresh = useAdminList<ContactMessageRow>("/contact-messages/", { status: "NEW", page_size: 1 });
  const [handling, setHandling] = React.useState<ContactMessageRow | null>(null);
  const [note, setNote] = React.useState("");
  const [open, setOpen] = React.useState<Set<number>>(new Set());
  const handle = useAdminAction(({ id, note }: { id: number; note: string }) => adminRequest<ContactMessageRow>("POST", `/contact-messages/${id}/handle/`, note ? { note } : {}), {
    invalidate: ["/contact-messages"], success: "Marked as handled", onSuccess: () => { setHandling(null); setNote(""); },
  });
  const toggle = (id: number) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="space-y-4">
      <div role="group" aria-label="Message status" className="flex flex-wrap gap-2">
        {([["NEW", "New"], ["HANDLED", "Handled"], ["", "All"]] as const).map(([v, l]) => (
          <button key={v || "all"} type="button" aria-pressed={status === v} onClick={() => setStatus(v)}
            className={`rounded-full border px-4 py-1.5 text-sm font-semibold ${status === v ? "border-primary bg-primary text-primary-fg" : "border-line-strong bg-white text-ink-2 hover:bg-paper-2"}`}>
            {l}{v === "NEW" && !fresh.isLoading && <>{" "}<span className="num ml-1.5 rounded-full bg-white/25 px-1.5 text-xs">{fresh.count}</span></>}
          </button>
        ))}
      </div>
      <FilterBar>
        <SearchField value={search} onChange={setSearch} placeholder="Search name, email, order number or text…" label="Search messages" />
        <FilterSelect label="Topic" value={topic} onChange={setTopic} options={CONTACT_TOPICS} />
      </FilterBar>

      {list.error ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : list.isLoading ? (
        <div className="space-y-3"><Skeleton className="h-28" /><Skeleton className="h-28" /></div>
      ) : list.rows.length === 0 ? (
        <EmptyState title={status === "NEW" && !q && !topic ? "Inbox zero" : "No messages match"}>{status === "NEW" && !q && !topic ? "Every message has been handled." : "Try another status, topic or search."}</EmptyState>
      ) : (
        <ul className="space-y-3" aria-label="Contact messages">
          {list.rows.map((m) => {
            const long = m.message.length > 280 || m.message.split("\n").length > 4;
            const expanded = open.has(m.id);
            return (
              <li key={m.id} className="rounded-lg border border-line bg-white p-4 shadow-sm sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-ink">{m.name} <a className="font-normal text-primary underline-offset-4 hover:underline" href={`mailto:${m.email}`}>{m.email}</a></p>
                    <p className="mt-0.5 text-sm text-ink-3">{formatDateTime(m.created_at)} · {topicLabel(m.topic)}{m.order_number && <> · order <span className="num">{m.order_number}</span></>}</p>
                  </div>
                  <StatusBadge status={m.status} label={m.status === "NEW" ? "New" : "Handled"} />
                </div>
                <p id={`msg-${m.id}`} className={`mt-3 whitespace-pre-line break-words text-ink-2 ${long && !expanded ? "line-clamp-4" : ""}`}>{m.message}</p>
                {long && <button type="button" className="mt-1 text-sm font-semibold text-primary underline-offset-4 hover:underline" aria-expanded={expanded} aria-controls={`msg-${m.id}`} onClick={() => toggle(m.id)}>{expanded ? "Show less" : "Show the full message"}</button>}
                {m.status === "HANDLED" && <p className="mt-3 rounded-md bg-paper-2/60 p-3 text-sm text-ink-2">Handled{m.handled_by ? ` by ${m.handled_by}` : ""}{m.handled_at ? ` on ${formatDateTime(m.handled_at)}` : ""}.{m.staff_note && <> Note: {m.staff_note}</>}</p>}
                <div className="mt-4 flex flex-wrap gap-2">
                  <a className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-semibold text-primary-fg hover:bg-primary-hover" href={mailtoHref(m, store.name, formatDateTime(m.created_at))}><Mail className="size-4" aria-hidden /> Reply by email{" "}<span className="sr-only">to {m.name}</span></a>
                  {m.status === "NEW" && <Button size="sm" variant="secondary" onClick={() => { setNote(""); setHandling(m); }}>Mark handled{" "}<span className="sr-only">message from {m.name}</span></Button>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Pager page={list.page} totalPages={list.totalPages} count={list.count} onPage={setPage} label="messages" />
      <p className="text-xs text-ink-3">“Reply by email” opens your own mail app with the reply started. Replies are not sent from this dashboard, so mark the message handled once you have answered it.</p>

      <ConfirmDialog open={!!handling} onOpenChange={(o) => !o && setHandling(null)} title="Mark this message as handled?" description="Use this once someone has replied. It records who handled it and when, and it can't be undone." confirmLabel="Mark handled" loading={handle.isPending}
        onConfirm={() => handling && handle.mutate({ id: handling.id, note: note.trim() })}>
        <label htmlFor="handle-note" className="block text-sm font-semibold text-ink">Note (optional)</label>
        <Textarea id="handle-note" className="mt-1.5" rows={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: Called back, refund issued" />
      </ConfirmDialog>
    </div>
  );
}

export function NewsletterAndMessages() {
  const { can, canAny } = useAdmin();
  const subs = canAny("content.manage", "reports.export");
  const msgs = can("customers.read");
  const [tab, setTab] = useTabParam(["subscribers", "messages"], subs ? "subscribers" : "messages");
  const active = tab === "messages" && msgs ? "messages" : subs ? "subscribers" : "messages";
  return (
    <AdminPage title="Newsletter & messages" description={`Who has signed up to hear from the shop, and what customers have written to you.${msgs ? "" : " Contact messages are visible to roles with customer access, such as support and store managers."}`}>
      <Tabs value={active} onValueChange={setTab}>
        <TabsList aria-label="Newsletter and messages">
          {subs && <TabsTrigger value="subscribers">Subscribers</TabsTrigger>}
          {msgs && <TabsTrigger value="messages">Contact messages</TabsTrigger>}
        </TabsList>
        {subs && <TabsContent value="subscribers"><Subscribers /></TabsContent>}
        {msgs && <TabsContent value="messages"><Messages /></TabsContent>}
      </Tabs>
    </AdminPage>
  );
}
