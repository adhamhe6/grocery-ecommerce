"use client";

import { Check, Star, X } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { AdminPage, ConfirmDialog, FilterBar, FilterSelect, Pager, SearchField, StatusBadge, useDebouncedValue } from "@/components/admin/kit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { adminRequest, useAdmin, useAdminAction, useAdminList } from "@/lib/admin";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/cn";

interface ReviewRow {
  id: number; product: { id: number; sku: string; name: string }; author: string; rating: number; title: string; body: string;
  status: "PENDING" | "APPROVED" | "REJECTED"; verified_purchase: boolean; is_demo: boolean; created_at: string; updated_at: string;
}
const TABS: [string, string][] = [["PENDING", "Pending"], ["APPROVED", "Approved"], ["REJECTED", "Rejected"], ["", "All"]];

function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => <Star key={n} aria-hidden className={cn("size-4", n <= value ? "fill-citrus text-citrus" : "text-line-strong")} />)}
    </span>
  );
}

export function Reviews() {
  const { can } = useAdmin();
  const allowed = can("content.manage");
  const [status, setStatus] = React.useState("PENDING");
  const [rating, setRating] = React.useState("");
  const [search, setSearch] = React.useState("");
  const q = useDebouncedValue(search);
  const [page, setPage] = React.useState(1);
  React.useEffect(() => setPage(1), [q, status, rating]);
  const list = useAdminList<ReviewRow>("/reviews/", { status: status || undefined, rating: rating || undefined, q: q.trim() || undefined, page, page_size: 20 }, { enabled: allowed });
  const pending = useAdminList<ReviewRow>("/reviews/", { status: "PENDING", page_size: 1 }, { enabled: allowed });
  const [rejecting, setRejecting] = React.useState<ReviewRow | null>(null);
  const [note, setNote] = React.useState("");

  const decide = useAdminAction(({ id, verb, note }: { id: number; verb: "approve" | "reject"; note?: string }) => adminRequest<ReviewRow>("POST", `/reviews/${id}/${verb}/`, note ? { note } : {}), {
    invalidate: ["/reviews", "/products"], success: (r) => (r.status === "APPROVED" ? "Review approved" : "Review rejected"), onSuccess: () => { setRejecting(null); setNote(""); },
  });
  const busyId = decide.isPending ? decide.variables?.id : undefined;

  if (!allowed) return <AdminPage title="Reviews"><EmptyState title="Moderating reviews needs the content permission">Your role can open this page but the reviews list is limited to people who manage content. Ask an administrator if you need it.</EmptyState></AdminPage>;

  return (
    <AdminPage title="Reviews" description="Customer reviews wait here until you approve them. Only approved reviews reach the shop and count towards a product's rating. Decisions can be changed later.">
      <div role="group" aria-label="Review status" className="flex flex-wrap gap-2">
        {TABS.map(([v, l]) => (
          <button key={v || "all"} type="button" aria-pressed={status === v} onClick={() => setStatus(v)}
            className={cn("rounded-full border px-4 py-1.5 text-sm font-semibold", status === v ? "border-primary bg-primary text-primary-fg" : "border-line-strong bg-white text-ink-2 hover:bg-paper-2")}>
            {l}{v === "PENDING" && !pending.isLoading && <>{" "}<span className="num ml-1.5 rounded-full bg-white/25 px-1.5 text-xs">{pending.count}</span></>}
          </button>
        ))}
      </div>
      <FilterBar>
        <SearchField value={search} onChange={setSearch} placeholder="Search review text or product…" label="Search reviews" />
        <FilterSelect label="Rating" value={rating} onChange={setRating} options={[["5", "5 stars"], ["4", "4 stars"], ["3", "3 stars"], ["2", "2 stars"], ["1", "1 star"]]} allLabel="Any" />
      </FilterBar>

      {list.error ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : list.isLoading ? (
        <div className="space-y-3"><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" /></div>
      ) : list.rows.length === 0 ? (
        <EmptyState title={status === "PENDING" && !q && !rating ? "Nothing waiting for moderation" : "No reviews match"}>{status === "PENDING" && !q && !rating ? "New customer reviews appear here as soon as they are submitted." : "Try another status or clear the search."}</EmptyState>
      ) : (
        <ul className="space-y-3" aria-label="Reviews">
          {list.rows.map((r) => (
            <li key={r.id} className="rounded-lg border border-line bg-white p-4 shadow-sm sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2"><Stars value={r.rating} /><span className="font-semibold text-ink">{r.title || <span className="font-normal text-ink-3">No title</span>}</span></p>
                  <p className="mt-0.5 text-sm text-ink-3">{r.author} · {formatDateTime(r.created_at)} · on <Link className="font-medium text-primary underline-offset-4 hover:underline" href={`/admin/products/${r.product.id}`}>{r.product.name}</Link> <span className="num">({r.product.sku})</span></p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <StatusBadge status={r.status} />
                  {r.verified_purchase ? <Badge tone="ok">Verified purchase</Badge> : <Badge tone="neutral">Not a verified purchase</Badge>}
                  {r.is_demo && <Badge tone="warn">Demo review</Badge>}
                </div>
              </div>
              {r.body ? <p className="mt-3 whitespace-pre-line text-ink-2">{r.body}</p> : <p className="mt-3 text-sm italic text-ink-3">No written comment — rating only.</p>}
              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" disabled={r.status === "APPROVED"} loading={busyId === r.id && decide.variables?.verb === "approve"} onClick={() => decide.mutate({ id: r.id, verb: "approve" })}><Check className="size-4" aria-hidden /> Approve{" "}<span className="sr-only">review by {r.author}</span></Button>
                <Button size="sm" variant="secondary" disabled={r.status === "REJECTED" || busyId === r.id} onClick={() => { setNote(""); setRejecting(r); }}><X className="size-4" aria-hidden /> Reject{" "}<span className="sr-only">review by {r.author}</span></Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Pager page={list.page} totalPages={list.totalPages} count={list.count} onPage={setPage} label="reviews" />

      <ConfirmDialog open={!!rejecting} onOpenChange={(o) => !o && setRejecting(null)} title="Reject this review?" description="It won't appear on the shop or count towards the rating. You can approve it again later." confirmLabel="Reject review" danger loading={decide.isPending}
        onConfirm={() => rejecting && decide.mutate({ id: rejecting.id, verb: "reject", note: note.trim() })}>
        <label className="block text-sm font-semibold text-ink" htmlFor="reject-note">Reason (optional)</label>
        <Textarea id="reject-note" className="mt-1.5" rows={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: spam, off topic, contains personal details" />
        <p className="mt-1 text-xs text-ink-3">Kept in the audit log, not shown to the customer.</p>
      </ConfirmDialog>
    </AdminPage>
  );
}
