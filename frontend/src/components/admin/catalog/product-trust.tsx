"use client";

import * as React from "react";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/field";
import { Alert } from "@/components/ui/states";
import { formatDateTime } from "@/lib/format";
import { FieldGrid, FormField, Section } from "./form-kit";
import { CLAIM_KINDS, NUTRIENTS, NUTRITION_BASES, fieldId, type AllergensForm, type ClaimState, type Lookups, type NutritionForm } from "./product-model";
import type { SectionProps } from "./product-sections";

const NOT_PROVIDED = "Not provided";

// ------------------------------------------------------------------------------------------------ origin & ingredients
export function OriginSection({ form, set, err }: SectionProps) {
  return (
    <Section id="origin" title="Origin & ingredients" description="Anything left blank is shown to shoppers as “Not provided”, never guessed.">
      <FieldGrid>
        <FormField id={fieldId("core.originCountry")} label="Country of origin" error={err("core.originCountry")} hint={form.originCountry.trim() ? undefined : NOT_PROVIDED}>
          {(p) => <Input {...p} value={form.originCountry} maxLength={60} onChange={(e) => set("originCountry", e.target.value)} />}
        </FormField>
        <FormField id={fieldId("core.originNote")} label="Origin note" error={err("core.originNote")} hint={form.originNote.trim() ? undefined : `${NOT_PROVIDED} — for example a region or farm.`}>
          {(p) => <Input {...p} value={form.originNote} maxLength={200} onChange={(e) => set("originNote", e.target.value)} />}
        </FormField>
        <FormField id={fieldId("core.manufacturer")} label="Producer / manufacturer" error={err("core.manufacturer")} hint={form.manufacturer.trim() ? undefined : NOT_PROVIDED}>
          {(p) => <Input {...p} value={form.manufacturer} maxLength={160} onChange={(e) => set("manufacturer", e.target.value)} />}
        </FormField>
      </FieldGrid>
      <FormField id={fieldId("core.ingredients")} label="Ingredients" error={err("core.ingredients")}
        hint={form.ingredients.trim() ? "Copy the list exactly as printed on the label." : form.productType === "LOOSE_PRODUCE" || form.productType === "HOUSEHOLD" ? `${NOT_PROVIDED} — not required for this product type.` : `${NOT_PROVIDED} — packaged food should list its ingredients.`}>
        {(p) => <Textarea {...p} rows={4} value={form.ingredients} onChange={(e) => set("ingredients", e.target.value)} />}
      </FormField>
    </Section>
  );
}

// ------------------------------------------------------------------------------------------------ allergens
type Level = "" | "CONTAINS" | "MAY_CONTAIN";

export function AllergensSection({ value, onChange, lookups, err }: { value: AllergensForm; onChange: (v: AllergensForm) => void; lookups: Lookups; err: (name: string) => string | undefined }) {
  const declared = Object.values(value.levels).filter(Boolean).length;
  return (
    <Section id="allergens" title="Allergens" description="Declare what the product contains or may contain, then confirm you checked it against the label or supplier sheet.">
      <fieldset className="grid gap-x-6 gap-y-2 sm:grid-cols-2" aria-describedby="allergens-status">
        <legend className="sr-only">Allergens in this product</legend>
        {lookups.allergens.map((a) => (
          <div key={a.code} className="rounded-md border border-line px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor={fieldId(`allergens.${a.code}`)} className="text-sm font-medium text-ink">{a.name}</label>
              <Select id={fieldId(`allergens.${a.code}`)} className="h-9 w-auto min-w-36 text-sm" aria-invalid={!!err(`allergens.${a.code}`)} aria-describedby={err(`allergens.${a.code}`) ? `${fieldId(`allergens.${a.code}`)}-error` : undefined} value={value.levels[a.code] ?? ""}
                onChange={(e) => onChange({ ...value, levels: { ...value.levels, [a.code]: e.target.value as Level } })}>
                <option value="">Not present</option>
                <option value="CONTAINS">Contains</option>
                <option value="MAY_CONTAIN">May contain</option>
              </Select>
            </div>
            {err(`allergens.${a.code}`) && <p id={`${fieldId(`allergens.${a.code}`)}-error`} role="alert" className="mt-1 text-sm font-medium text-bad">{err(`allergens.${a.code}`)}</p>}
          </div>
        ))}
      </fieldset>
      {lookups.allergens.length === 0 && <p className="text-sm text-ink-3">The allergen list couldn&apos;t be loaded.</p>}
      {err("allergens") && <p role="alert" className="text-sm font-medium text-bad">{err("allergens")}</p>}
      <div id="allergens-status" role="status">
        {value.confirmed ? (
          <Alert tone="ok" title="Allergen information confirmed"><span>{declared === 0 ? "The shop will say this product contains none of the 14 major allergens." : `The shop will list ${declared} declared ${declared === 1 ? "allergen" : "allergens"}.`}</span></Alert>
        ) : (
          <Alert tone="warn" title="Allergen information not confirmed"><span>Until this is confirmed the product page tells shoppers “Allergen information not confirmed” and doesn&apos;t list any allergens.</span></Alert>
        )}
      </div>
      <Checkbox id={fieldId("allergens.confirmed")} checked={value.confirmed} aria-invalid={!!err("allergens.confirmed")} onChange={(e) => onChange({ ...value, confirmed: e.target.checked })}
        label={<><span className="font-semibold">I have checked this allergen information against the label or supplier sheet</span><span className="block text-sm text-ink-3">Leave unticked if you are not sure. “Not present” for every allergen, with this ticked, means “contains none of the 14”.</span></>} />
      {err("allergens.confirmed") && <p role="alert" className="text-sm font-medium text-bad">{err("allergens.confirmed")}</p>}
    </Section>
  );
}

// ------------------------------------------------------------------------------------------------ dietary claims
const CLAIM_STATES: [ClaimState["status"], string][] = [["none", "Not claimed"], ["claimed", "Claimed — not verified (hidden)"], ["verified", "Verified (shown to shoppers)"]];

export function ClaimsSection({ value, onChange, err }: { value: Record<string, ClaimState>; onChange: (v: Record<string, ClaimState>) => void; err: (name: string) => string | undefined }) {
  const patch = (kind: string, next: Partial<ClaimState>) => onChange({ ...value, [kind]: { ...value[kind], ...next } });
  return (
    <Section id="claims" title="Dietary & quality claims" description="Only verified claims appear on the shop or in dietary filters, and a verified claim needs evidence on record.">
      <ul className="divide-y divide-line rounded-md border border-line">
        {CLAIM_KINDS.map(([kind, label]) => {
          const c = value[kind];
          const evId = fieldId(`claims.${kind}.evidence`);
          const stId = fieldId(`claims.${kind}.status`);
          return (
            <li key={kind} className="grid gap-3 p-3 sm:grid-cols-[11rem_16rem_1fr] sm:items-start">
              <label htmlFor={stId} className="pt-2 text-sm font-semibold text-ink">{label}</label>
              <Select id={stId} className="h-10 text-sm" value={c.status} onChange={(e) => patch(kind, { status: e.target.value as ClaimState["status"] })}>
                {CLAIM_STATES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
              <div>
                {c.status === "none" ? <p className="pt-2 text-sm text-ink-3">{NOT_PROVIDED}</p> : (
                  <FormField id={evId} label={`Evidence for ${label.toLowerCase()}`} error={err(`claims.${kind}.evidence`)} required={c.status === "verified"}
                    hint={c.status === "verified" ? (c.verifiedBy ? `Verified by ${c.verifiedBy}${c.verifiedAt ? ` on ${formatDateTime(c.verifiedAt)}` : ""}. Changing the evidence re-verifies it under your name.` : "Certificate number, label review or supplier statement.") : "Optional until you verify it."}>
                    {(p) => <Input {...p} value={c.evidence} maxLength={300} onChange={(e) => patch(kind, { evidence: e.target.value })} />}
                  </FormField>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {err("claims") && <p role="alert" className="text-sm font-medium text-bad">{err("claims")}</p>}
    </Section>
  );
}

// ------------------------------------------------------------------------------------------------ nutrition
export function NutritionSection({ value, onChange, err, hadPanel }: { value: NutritionForm; onChange: (v: NutritionForm) => void; err: (name: string) => string | undefined; hadPanel: boolean }) {
  const setValue = (key: string, v: string) => onChange({ ...value, values: { ...value.values, [key]: v } });
  return (
    <Section id="nutrition" title="Nutrition" description="Values from the label or a datasheet. A blank value means unknown — it is shown as not provided, never as zero.">
      <Checkbox id={fieldId("nutrition.enabled")} checked={value.enabled} onChange={(e) => onChange({ ...value, enabled: e.target.checked })}
        label={<><span className="font-semibold">This product has a nutrition panel</span><span className="block text-sm text-ink-3">{value.enabled ? "Untick to remove the panel when you save." : `${NOT_PROVIDED} — the product page says so.`}</span></>} />
      {hadPanel && !value.enabled && <Alert tone="warn" title="The nutrition panel will be deleted when you save"><span>Tick the box again to keep it.</span></Alert>}
      {value.enabled && (
        <>
          {value.isDemo && <Alert tone="warn" title="These values are sample data"><span>Saving your own figures replaces the sample values.</span></Alert>}
          <FieldGrid>
            <FormField id={fieldId("nutrition.basis")} label="Values are" required error={err("nutrition.basis")} hint="What the figures refer to.">
              {(p) => (
                <>
                  <Input {...p} list="nutrition-bases" value={value.basis} maxLength={30} onChange={(e) => onChange({ ...value, basis: e.target.value })} placeholder="per 100 g" />
                  <datalist id="nutrition-bases">{NUTRITION_BASES.map((b) => <option key={b} value={b} />)}</datalist>
                </>
              )}
            </FormField>
            <FormField id={fieldId("nutrition.source")} label="Source" required error={err("nutrition.source")} hint="Label, supplier datasheet, lab report…">
              {(p) => <Input {...p} value={value.source} maxLength={200} onChange={(e) => onChange({ ...value, source: e.target.value })} />}
            </FormField>
          </FieldGrid>
          <div className="grid gap-4 sm:grid-cols-3">
            {NUTRIENTS.map((n) => (
              <FormField key={n.key} id={fieldId(`nutrition.${n.key}`)} label={`${n.label} (${n.unit})`} error={err(`nutrition.${n.key}`)}>
                {(p) => <Input {...p} className="num" inputMode="decimal" value={value.values[n.key]} onChange={(e) => setValue(n.key, e.target.value)} placeholder={NOT_PROVIDED} />}
              </FormField>
            ))}
          </div>
        </>
      )}
    </Section>
  );
}

