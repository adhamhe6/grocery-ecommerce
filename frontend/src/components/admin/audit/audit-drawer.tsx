"use client";

import * as React from "react";
import { KeyValue } from "@/components/admin/kit";
import { Mono } from "@/components/admin/finance/parts";
import { useStoreDateTime } from "@/components/admin/finance/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/dialog";
import { cn } from "@/lib/cn";
import { buildAuditDiff, displayValue, truncate, type DiffRow, type DiffStatus } from "./audit-diff";

export interface AuditEntry {
  id: number;
  actor: number | null;
  actor_email: string;
  action: string;
  target_type: string;
  target_id: string;
  summary: string;
  before: unknown;
  after: unknown;
  ip_address: string | null;
  request_id: string;
  created_at: string;
}

const STATUS: Record<Exclude<DiffStatus, "unchanged">, { label: string; tone: "warn" | "ok" | "bad"; row: string }> = {
  changed: { label: "Changed", tone: "warn", row: "bg-warn-soft/60" },
  added: { label: "Added", tone: "ok", row: "bg-ok-soft/60" },
  removed: { label: "Removed", tone: "bad", row: "bg-bad-soft/60" },
};

export function AuditDrawer({ entry, onClose }: { entry: AuditEntry | null; onClose: () => void }) {
  return (
    <Sheet open={entry !== null} onOpenChange={(o) => !o && onClose()} title="Audit entry" widthClass="w-[min(100vw,44rem)]">
      <div className="flex-1 overflow-y-auto p-5">{entry && <EntryBody entry={entry} />}</div>
    </Sheet>
  );
}

function EntryBody({ entry }: { entry: AuditEntry }) {
  const when = useStoreDateTime({ seconds: true });
  const diff = React.useMemo(() => buildAuditDiff(entry.before, entry.after), [entry.before, entry.after]);
  const [showAll, setShowAll] = React.useState(false);
  const rows = showAll ? diff.rows : diff.rows.filter((r) => r.status !== "unchanged");

  return (
    <div className="space-y-6">
      <div>
        <Mono className="text-base font-semibold">{entry.action}</Mono>
        {entry.summary && <p className="mt-1 text-sm text-ink-2">{entry.summary}</p>}
      </div>
      <KeyValue
        items={[
          ["When", when(entry.created_at)],
          ["Actor", entry.actor_email || "—"],
          ["Target", entry.target_type ? `${entry.target_type}${entry.target_id ? ` #${entry.target_id}` : ""}` : "—"],
          ["IP address", entry.ip_address ?? "Not recorded"],
          ["Request id", entry.request_id ? <Mono key="rid">{entry.request_id}</Mono> : "Not recorded"],
        ]}
      />

      <section aria-labelledby="audit-diff">
        <h3 id="audit-diff" className="font-sans text-sm font-bold uppercase tracking-wide text-ink-2">
          {diff.mode === "created" ? "Values when created" : diff.mode === "deleted" ? "Values before deletion" : "What changed"}
        </h3>
        {diff.mode === "none" ? (
          <p className="mt-2 text-sm text-ink-2">No field values were recorded for this entry. The summary above says what happened.</p>
        ) : (
          <>
            <p className="mt-1 text-sm text-ink-3" role="status">
              {diff.mode === "changed" ? `${diff.changedCount} ${diff.changedCount === 1 ? "field" : "fields"} changed` : `${diff.rows.length} ${diff.rows.length === 1 ? "field" : "fields"}`}
              {diff.unchangedCount > 0 && ` · ${diff.unchangedCount} unchanged`}. The server leaves passwords and tokens out of these snapshots.
            </p>
            {rows.length === 0 ? <p className="mt-3 text-sm text-ink-2">Nothing differs between the two snapshots.</p> : (
              <div className="mt-3 overflow-x-auto rounded-lg border border-line bg-white">
                <table className="w-full min-w-[32rem] table-fixed text-left text-sm">
                  <caption className="sr-only">Field-by-field comparison of the record before and after this action</caption>
                  <colgroup>
                    <col className="w-[26%]" />
                    {diff.mode !== "created" && <col />}
                    {diff.mode !== "deleted" && <col />}
                    <col className="w-[5.5rem]" />
                  </colgroup>
                  <thead className="border-b border-line bg-paper-2/60 text-xs uppercase tracking-wide text-ink-3">
                    <tr><th scope="col" className="px-3 py-2 font-semibold">Field</th>{diff.mode !== "created" && <th scope="col" className="px-3 py-2 font-semibold">Before</th>}{diff.mode !== "deleted" && <th scope="col" className="px-3 py-2 font-semibold">After</th>}<th scope="col" className="px-3 py-2 font-semibold">Change</th></tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {rows.map((r) => <DiffLine key={r.key} row={r} mode={diff.mode} />)}
                  </tbody>
                </table>
              </div>
            )}
            {diff.unchangedCount > 0 && diff.mode === "changed" && (
              <Button className="mt-3" size="sm" variant="ghost" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
                {showAll ? "Hide unchanged fields" : `Show ${diff.unchangedCount} unchanged ${diff.unchangedCount === 1 ? "field" : "fields"}`}
              </Button>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function DiffLine({ row, mode }: { row: DiffRow; mode: string }) {
  const s = row.status === "unchanged" ? null : STATUS[row.status];
  return (
    <tr className={cn("align-top", s?.row)}>
      <th scope="row" className="px-3 py-2 font-mono text-xs font-semibold text-ink [overflow-wrap:anywhere]">{row.key}</th>
      {mode !== "created" && <td className="px-3 py-2"><Value value={row.before} missing={row.status === "added"} /></td>}
      {mode !== "deleted" && <td className="px-3 py-2"><Value value={row.after} missing={row.status === "removed"} /></td>}
      <td className="px-3 py-2">{s ? <Badge tone={s.tone}>{s.label}</Badge> : <span className="text-xs text-ink-3">Same</span>}</td>
    </tr>
  );
}

/** Long values are cut off with a toggle; the full text is always one click away. */
function Value({ value, missing }: { value: unknown; missing?: boolean }) {
  const [open, setOpen] = React.useState(false);
  if (missing) return <span className="text-ink-3">—<span className="sr-only"> not present</span></span>;
  const text = displayValue(value);
  const cut = truncate(text);
  return (
    <div className="min-w-0">
      <p className={cn("whitespace-pre-wrap font-mono text-xs [overflow-wrap:anywhere]", (value === null || text === "(empty)") && "text-ink-3")}>{open || !cut.truncated ? text : cut.text}</p>
      {cut.truncated && <button type="button" className="mt-0.5 text-left text-xs font-semibold text-primary underline-offset-2 hover:underline" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? "Show less" : `Show all ${text.length.toLocaleString()} characters`}</button>}
    </div>
  );
}
