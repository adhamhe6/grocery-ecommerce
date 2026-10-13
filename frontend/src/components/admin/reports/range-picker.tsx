"use client";

import * as React from "react";
import { Field, Input, Select, describedBy } from "@/components/ui/field";
import { checkRange, presetRange, RANGE_PRESETS, type RangePreset } from "./date-ranges";

export interface RangeState { from: string; to: string; preset: RangePreset }

/** Preset drop-down plus custom from/to dates. Calls onChange only with a range the API will accept as intended. */
export function RangePicker({ today, value, onChange }: { today: string; value: RangeState; onChange: (v: RangeState) => void }) {
  const check = checkRange(value.from, value.to);
  const error = !check.ok ? check.message : undefined;
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex items-center gap-2 text-sm">
        <span className="font-semibold text-ink-2">Period</span>
        <Select
          className="h-10 w-auto min-w-40 text-sm"
          value={value.preset}
          onChange={(e) => {
            const preset = e.target.value as RangePreset;
            onChange(preset === "custom" ? { ...value, preset } : { preset, ...presetRange(preset, today) });
          }}
        >
          {RANGE_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </Select>
      </label>
      {value.preset === "custom" && (
        <>
          <Field label="From" htmlFor="rep-from" className="space-y-0.5">
            <Input id="rep-from" type="date" className="h-10 w-auto text-sm" value={value.from} max={value.to || today} onChange={(e) => onChange({ ...value, from: e.target.value, preset: "custom" })} aria-invalid={!!error} aria-describedby={describedBy("rep-range", false, !!error)} />
          </Field>
          <Field label="To" htmlFor="rep-to" className="space-y-0.5">
            <Input id="rep-to" type="date" className="h-10 w-auto text-sm" value={value.to} min={value.from || undefined} onChange={(e) => onChange({ ...value, to: e.target.value, preset: "custom" })} aria-invalid={!!error} aria-describedby={describedBy("rep-range", false, !!error)} />
          </Field>
        </>
      )}
      {error && <p id="rep-range-error" role="alert" className="basis-full text-sm font-medium text-bad">{error} The report isn&apos;t refreshed until the range is valid.</p>}
    </div>
  );
}
