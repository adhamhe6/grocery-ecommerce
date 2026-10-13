"use client";

import * as React from "react";
import { Checkbox, Input } from "@/components/ui/field";

export interface CheckItem { id: number; label: string; group?: string; hint?: string }

/** A labelled group of checkboxes (categories, brands) with a filter box once the list gets long. */
export function CheckList({ legend, items, selected, onChange, error, disabled, emptyText = "Nothing to choose from yet." }: {
  legend: string; items: CheckItem[]; selected: number[]; onChange: (ids: number[]) => void; error?: string; disabled?: boolean; emptyText?: string;
}) {
  const id = React.useId();
  const [q, setQ] = React.useState("");
  const shown = q.trim() ? items.filter((i) => `${i.group ?? ""} ${i.label}`.toLowerCase().includes(q.trim().toLowerCase())) : items;
  const groups = React.useMemo(() => {
    const m = new Map<string, CheckItem[]>();
    for (const i of shown) m.set(i.group ?? "", [...(m.get(i.group ?? "") ?? []), i]);
    return [...m.entries()];
  }, [shown]);
  const toggle = (itemId: number, on: boolean) => onChange(on ? [...selected, itemId] : selected.filter((x) => x !== itemId));
  return (
    <fieldset className="space-y-2" aria-describedby={error ? `${id}-error` : undefined} aria-invalid={!!error}>
      <legend className="text-sm font-semibold text-ink">{legend} <span className="num font-normal text-ink-3">({selected.length} chosen)</span></legend>
      {items.length > 10 && (
        <div>
          <label htmlFor={`${id}-filter`} className="sr-only">Filter {legend.toLowerCase()}</label>
          <Input id={`${id}-filter`} type="search" className="h-10" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter the list…" />
        </div>
      )}
      {items.length === 0 ? <p className="text-sm text-ink-3">{emptyText}</p> : shown.length === 0 ? <p className="text-sm text-ink-3">Nothing matches that filter.</p> : (
        <div className="max-h-64 space-y-3 overflow-y-auto rounded-md border border-line bg-white p-3">
          {groups.map(([group, list]) => (
            <div key={group || "_"}>
              {group && <p className="mb-1 text-xs font-bold uppercase tracking-wide text-ink-3">{group}</p>}
              <ul className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
                {list.map((i) => <li key={i.id}><Checkbox className="text-sm" disabled={disabled} checked={selected.includes(i.id)} onChange={(e) => toggle(i.id, e.target.checked)} label={<>{i.label}{i.hint && <span className="ml-1 text-ink-3">{i.hint}</span>}</>} /></li>)}
              </ul>
            </div>
          ))}
        </div>
      )}
      {error && <p id={`${id}-error`} role="alert" className="text-sm font-medium text-bad">{error}</p>}
    </fieldset>
  );
}
