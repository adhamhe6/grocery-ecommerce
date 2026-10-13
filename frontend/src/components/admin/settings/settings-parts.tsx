"use client";

import { AlertTriangle, CheckCircle2 } from "lucide-react";
import * as React from "react";
import { Checkbox, Field, Input, Textarea, describedBy } from "@/components/ui/field";
import { parseHex, whiteTextContrast } from "./contrast";
import type { SettingsForm } from "./settings-model";

export interface FormCtx { form: SettingsForm; set: (patch: Partial<SettingsForm>) => void; errors: Record<string, string> }
type StringKey = { [K in keyof SettingsForm]: SettingsForm[K] extends string ? K : never }[keyof SettingsForm];
type BoolKey = { [K in keyof SettingsForm]: SettingsForm[K] extends boolean ? K : never }[keyof SettingsForm];

/** "What it affects" line shown under risky fields so nobody changes a policy without knowing the consequence. */
export const Impact = ({ children }: { children: React.ReactNode }) => (
  <span className="mt-0.5 block text-ink-2"><span className="font-semibold">What it affects:</span> {children}</span>
);

export function TextInput({ c, name, label, hint, impact, required, type = "text", inputMode, maxLength, list, placeholder, multiline, className }: {
  c: FormCtx; name: StringKey; label: string; hint?: React.ReactNode; impact?: React.ReactNode; required?: boolean; type?: string; inputMode?: "decimal" | "numeric" | "email" | "tel" | "url";
  maxLength?: number; list?: string; placeholder?: string; multiline?: boolean; className?: string;
}) {
  const id = `s-${name}`;
  const error = c.errors[name];
  const hasHint = !!(hint || impact);
  const common = { id, value: c.form[name], onChange: (e: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) => c.set({ [name]: e.target.value }), "aria-invalid": !!error, "aria-describedby": describedBy(id, hasHint, !!error), maxLength, placeholder };
  return (
    <Field label={label} htmlFor={id} required={required} error={error} className={className} hint={hasHint ? <>{hint}{impact && <Impact>{impact}</Impact>}</> : undefined}>
      {multiline ? <Textarea {...common} rows={3} /> : <Input {...common} type={type} inputMode={inputMode} list={list} spellCheck={type === "url" || type === "email" ? false : undefined} />}
    </Field>
  );
}

export function Toggle({ c, name, title, description, impact }: { c: FormCtx; name: BoolKey; title: string; description?: React.ReactNode; impact?: React.ReactNode }) {
  const error = c.errors[name];
  return (
    <div>
      <Checkbox
        id={`s-${name}`}
        checked={c.form[name]}
        onChange={(e) => c.set({ [name]: e.target.checked })}
        aria-invalid={!!error}
        aria-describedby={error ? `s-${name}-error` : undefined}
        label={<><span className="font-semibold">{title}</span>{description && <span className="block text-sm text-ink-3">{description}</span>}{impact && <span className="block text-sm text-ink-2"><span className="font-semibold">What it affects:</span> {impact}</span>}</>}
      />
      {error && <p id={`s-${name}-error`} role="alert" className="mt-1 flex items-start gap-1.5 pl-8 text-sm font-medium text-bad"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {error}</p>}
    </div>
  );
}

/** Hex colour: free text + native picker + a live swatch and a WCAG AA check against white text. */
export function ColourField({ c, name, label, usage }: { c: FormCtx; name: "brand_primary" | "brand_accent"; label: string; usage: React.ReactNode }) {
  const id = `s-${name}`;
  const value = c.form[name];
  const error = c.errors[name];
  const report = whiteTextContrast(value);
  return (
    <div className="space-y-2.5">
      <Field label={label} htmlFor={id} required error={error} hint={usage}>
        <div className="flex items-center gap-2">
          <input
            type="color"
            aria-label={`${label}: colour picker`}
            value={parseHex(value) ? value.toLowerCase() : "#000000"}
            onChange={(e) => c.set({ [name]: e.target.value.toUpperCase() })}
            className="h-11 w-14 shrink-0 cursor-pointer rounded-md border border-line-strong bg-white p-1"
          />
          <Input id={id} value={value} onChange={(e) => c.set({ [name]: e.target.value })} maxLength={7} spellCheck={false} autoComplete="off" className="max-w-40 font-mono uppercase" aria-invalid={!!error} aria-describedby={describedBy(id, true, !!error)} />
        </div>
      </Field>
      {report && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex h-10 items-center rounded-md px-4 text-sm font-semibold text-white" style={{ backgroundColor: value }} aria-hidden>Sample button</span>
          <p aria-live="polite" className={`flex items-start gap-1.5 text-sm ${report.passesAA ? "text-ok" : "text-bad"}`}>
            {report.passesAA ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />}
            <span>
              White text on this colour: <strong className="num">{report.display}:1</strong>. {report.passesAA ? "Passes" : "Fails"} WCAG AA for normal text (needs 4.5:1).
              {!report.passesAA && " Buttons and headers that use this colour will be hard to read; choose a darker shade."}
            </span>
          </p>
        </div>
      )}
    </div>
  );
}
