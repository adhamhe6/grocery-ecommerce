"use client";

import * as React from "react";
import { RichText } from "@/components/content/rich-text";
import { Textarea } from "@/components/ui/field";
import { FormField } from "../catalog/form-kit";

/**
 * Markdown textarea with a live preview rendered by the storefront's own `RichText`, so what you see is what shoppers get.
 * The server rejects raw HTML; the preview shows it as plain text, exactly as the shop would.
 */
export function MarkdownField({ id, label, value, onChange, error, rows = 14, required, hint, previewTitle = "Preview" }: {
  id: string; label: string; value: string; onChange: (v: string) => void; error?: string; rows?: number; required?: boolean; hint?: React.ReactNode; previewTitle?: string;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <FormField id={id} label={label} required={required} error={error}
        hint={hint ?? <>Markdown: <code># Heading</code>, <code>**bold**</code>, <code>*italic*</code>, lists with <code>-</code> or <code>1.</code>, <code>[text](https://…)</code>, <code>&gt; quote</code>. HTML isn&apos;t accepted.</>}>
        {(p) => <Textarea {...p} rows={rows} className="font-mono text-sm" value={value} onChange={(e) => onChange(e.target.value)} spellCheck />}
      </FormField>
      <section aria-label={previewTitle} className="min-w-0">
        <p className="mb-1.5 text-sm font-semibold text-ink">{previewTitle}</p>
        <div className="max-h-[32rem] min-h-24 overflow-y-auto rounded-md border border-line bg-white p-4">
          {value.trim() ? <RichText source={value} /> : <p className="text-sm italic text-ink-3">Nothing to preview yet.</p>}
        </div>
        <p className="mt-1 text-xs text-ink-3">Rendered with the shop&apos;s own renderer. Headings start at level 2 because the page title is the main heading.</p>
      </section>
    </div>
  );
}
