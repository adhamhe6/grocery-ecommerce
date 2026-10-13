import * as React from "react";
import { Card } from "@/components/admin/kit";
import { DEFINITIONS, DEFINITIONS_INTRO, REPORT_NOTES } from "./report-meta";

/** Renders `code` spans written with backticks in the definition text. */
function Inline({ text }: { text: string }) {
  return <>{text.split("`").map((part, i) => (i % 2 ? <code key={i} className="rounded bg-paper-2 px-1 py-0.5 font-mono text-[0.8rem]">{part}</code> : <React.Fragment key={i}>{part}</React.Fragment>))}</>;
}

/** Always visible: the metric definitions the backend uses (verbatim) plus notes specific to the open report. */
export function DefinitionsPanel({ reportKey }: { reportKey?: string }) {
  const note = reportKey ? REPORT_NOTES[reportKey] : undefined;
  return (
    <Card title="Definitions">
      <p className="text-sm text-ink-2">{DEFINITIONS_INTRO}</p>
      <dl className="mt-3 space-y-2.5 text-sm">
        {DEFINITIONS.map((d) => (
          <div key={d.term} className="grid gap-x-4 sm:grid-cols-[11rem_1fr]">
            <dt className="font-semibold text-ink">{d.term}</dt>
            <dd className="text-ink-2"><Inline text={d.text} /></dd>
          </div>
        ))}
      </dl>
      {note && note.notes.length > 0 && (
        <div className="mt-5 border-t border-line pt-4">
          <h3 className="font-sans text-sm font-bold uppercase tracking-wide text-ink-2">About this report</h3>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-ink-2">{note.notes.map((n) => <li key={n}>{n}</li>)}</ul>
        </div>
      )}
      <p className="mt-4 text-xs text-ink-3">Dates are cut at midnight in the store&apos;s time zone. Money is in the store&apos;s currency.</p>
    </Card>
  );
}
