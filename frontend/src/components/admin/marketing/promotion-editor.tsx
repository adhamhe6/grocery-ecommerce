"use client";

import { Lightbulb } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Checkbox, ChoiceGroup, Input } from "@/components/ui/field";
import { Alert } from "@/components/ui/states";
import { useAdminGet } from "@/lib/admin";
import { useMoney, useStore } from "@/lib/hooks";
import { ConfirmDelete, useEntitySave } from "../catalog/entity-kit";
import { DateTimeField, EditorSheet, FieldGrid, FormField } from "../catalog/form-kit";
import { ProductSetField, useProductRefs } from "../catalog/product-picker";
import type { BrandRow, CategoryRow } from "../catalog/product-model";
import { CheckList } from "./check-list";
import {
  PROMO_KINDS, PROMO_SCOPES, describeTargets, emptyPromotion, promotionPayload, promotionToForm, summarisePromotion, suggestLabel, validatePromotion,
  type PromotionForm, type PromotionRow,
} from "./promotion-model";

const FIELDS = ["name", "label", "kind", "scope", "products", "categories", "brands", "percent", "amount_off", "multibuy_qty", "multibuy_price", "starts_at", "ends_at", "is_active"] as const;
const INVALIDATE = ["/promotions"];

export function PromotionEditor({ promotion, categories, brands, canWrite, onClose }: { promotion?: PromotionRow; categories: CategoryRow[]; brands: BrandRow[]; canWrite: boolean; onClose: () => void }) {
  const uid = React.useId();
  const store = useStore();
  const money = useMoney();
  const [curId, setCurId] = React.useState(promotion?.id);
  const [form, setForm] = React.useState<PromotionForm>(() => (promotion ? promotionToForm(promotion) : emptyPromotion()));
  const [base, setBase] = React.useState(form);
  const dirty = JSON.stringify(form) !== JSON.stringify(base);
  const { save, saving, errors, message, clearError } = useEntitySave<PromotionRow>({ path: "/promotions/", fields: FIELDS, invalidate: INVALIDATE, noun: "Promotion" });
  const [local, setLocal] = React.useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [justCreated, setJustCreated] = React.useState(false);
  const detail = useAdminGet<PromotionRow>(`/promotions/${curId ?? 0}/`, {}, { enabled: curId !== undefined });
  const [warnings, setWarnings] = React.useState<string[] | null>(null);
  const shownWarnings = warnings ?? detail.data?.warnings ?? [];
  const err = (k: string) => errors[k] ?? local[k];
  const set = <K extends keyof PromotionForm>(k: K, v: PromotionForm[K], api: string) => { setForm((f) => ({ ...f, [k]: v })); clearError(api); setLocal((l) => (api in l ? Object.fromEntries(Object.entries(l).filter(([x]) => x !== api)) : l)); };

  const refs = useProductRefs(form.scope === "PRODUCTS" ? form.products : []);
  const targetNames = form.scope === "PRODUCTS"
    ? form.products.map((id) => refs.get(id)?.name).filter((n): n is string => !!n)
    : form.scope === "CATEGORIES" ? form.categories.map((id) => categories.find((c) => c.id === id)?.name).filter((n): n is string => !!n) : form.brands.map((id) => brands.find((b) => b.id === id)?.name).filter((n): n is string => !!n);
  const targetTotal = form.scope === "PRODUCTS" ? form.products.length : form.scope === "CATEGORIES" ? form.categories.length : form.brands.length;
  const ctx = { money, timeZone: store.timezone, locale: store.locale };
  const summary = summarisePromotion(form, describeTargets(form.scope, targetNames, targetTotal), ctx);
  const suggestion = suggestLabel(form, money);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const invalid = validatePromotion(form);
    setLocal(invalid);
    if (Object.keys(invalid).length) { window.setTimeout(() => document.querySelector<HTMLElement>("[data-editor] [aria-invalid=true]")?.focus(), 0); return; }
    const res = await save(curId, promotionPayload(form));
    if (res) {
      if (curId === undefined) { setCurId(res.id); setJustCreated(true); }
      setWarnings(res.warnings ?? []);
      const f = promotionToForm(res);
      setForm(f);
      setBase(f);
    }
  };

  const catItems = React.useMemo(() => categories.slice().sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)).map((c) => ({
    id: c.id, label: c.name, group: c.parent == null ? undefined : categories.find((p) => p.id === c.parent)?.name, hint: c.parent == null ? "(whole department)" : undefined,
  })), [categories]);
  const brandItems = React.useMemo(() => brands.map((b) => ({ id: b.id, label: b.name + (b.is_active ? "" : " (inactive)") })), [brands]);

  return (
    <EditorSheet open onClose={onClose} title={curId === undefined ? "New promotion" : `Edit ${promotion?.name ?? "promotion"}`} dirty={dirty} widthClass="w-[min(100vw,44rem)]"
      footer={
        <>
          {promotion && canWrite && <Button variant="ghost" className="mr-auto text-bad" onClick={() => setConfirmDelete(true)}>Delete…</Button>}
          <Button variant="secondary" onClick={onClose}>{dirty ? "Cancel" : "Close"}</Button>
          {canWrite && <Button type="submit" form={`${uid}-form`} loading={saving} disabled={!dirty}>{curId === undefined ? "Create promotion" : "Save changes"}</Button>}
        </>
      }>
      <div data-editor className="space-y-5">
        <div className="rounded-md border border-primary/25 bg-primary-soft p-3" aria-live="polite">
          <p className="text-xs font-bold uppercase tracking-wide text-primary">What shoppers get</p>
          <p className="mt-0.5 font-semibold text-ink">{summary}</p>
        </div>
        {justCreated && <Alert tone="ok" title="Promotion created">It follows the schedule below, and prices on the shop update within a moment.</Alert>}
        {message && <Alert tone="bad" title="This could not be saved">{message}</Alert>}
        {shownWarnings.length > 0 && (
          <Alert tone="warn" title="Check this promotion">
            <ul className="list-disc space-y-1 pl-5">{shownWarnings.map((w) => <li key={w}>{w}</li>)}</ul>
          </Alert>
        )}
        <form id={`${uid}-form`} onSubmit={submit} noValidate>
          <fieldset disabled={!canWrite || saving} className="m-0 min-w-0 space-y-5 border-0 p-0">
            <FormField id={`${uid}-name`} label="Name" required error={err("name")} hint="For your team only, for example “Autumn apples”.">{(p) => <Input {...p} value={form.name} maxLength={120} onChange={(e) => set("name", e.target.value, "name")} />}</FormField>
            <div className="space-y-2">
              <FormField id={`${uid}-label`} label="Badge text" required error={err("label")} hint="Shown on product cards, up to 40 characters.">{(p) => <Input {...p} value={form.label} maxLength={40} onChange={(e) => set("label", e.target.value, "label")} />}</FormField>
              {suggestion && form.label.trim() !== suggestion && (
                <Button size="sm" variant="ghost" onClick={() => set("label", suggestion, "label")}><Lightbulb className="size-4" aria-hidden /> Use “{suggestion}”</Button>
              )}
            </div>

            <ChoiceGroup name={`${uid}-kind`} legend="Type of offer" value={form.kind} onChange={(v) => { set("kind", v, "kind"); }} options={PROMO_KINDS.map((k) => ({ value: k.value, title: k.title, description: k.description }))} />
            {err("kind") && <p role="alert" className="text-sm font-medium text-bad">{err("kind")}</p>}
            {form.kind === "PERCENT_OFF" && (
              <FormField id={`${uid}-percent`} label="Percentage off" required error={err("percent")} hint="Above 0, up to 100. Prices are rounded to the cent.">{(p) => <Input {...p} className="num w-40" inputMode="decimal" value={form.percent} onChange={(e) => set("percent", e.target.value, "percent")} />}</FormField>
            )}
            {form.kind === "AMOUNT_OFF" && (
              <FormField id={`${uid}-amount`} label="Amount off each unit" required error={err("amount_off")} hint="Taken off the price of every unit. If it is at least the shelf price the product becomes free.">{(p) => <Input {...p} className="num w-40" inputMode="decimal" value={form.amountOff} onChange={(e) => set("amountOff", e.target.value, "amount_off")} />}</FormField>
            )}
            {form.kind === "MULTIBUY" && (
              <FieldGrid>
                <FormField id={`${uid}-mqty`} label="Number of items" required error={err("multibuy_qty")} hint="At least 2.">{(p) => <Input {...p} className="num" inputMode="numeric" value={form.multibuyQty} onChange={(e) => set("multibuyQty", e.target.value, "multibuy_qty")} />}</FormField>
                <FormField id={`${uid}-mprice`} label="Price for the group" required error={err("multibuy_price")} hint="Items beyond a full group cost the normal price.">{(p) => <Input {...p} className="num" inputMode="decimal" value={form.multibuyPrice} onChange={(e) => set("multibuyPrice", e.target.value, "multibuy_price")} />}</FormField>
              </FieldGrid>
            )}

            <ChoiceGroup name={`${uid}-scope`} legend="Applies to" value={form.scope} onChange={(v) => set("scope", v, "scope")} options={PROMO_SCOPES.map((s) => ({ value: s.value, title: s.title, description: s.description }))} />
            {form.scope === "PRODUCTS" && <ProductSetField ids={form.products} onChange={(ids) => set("products", ids, "products")} label="Add a product" error={err("products")} disabled={!canWrite || saving} emptyText="No products chosen yet." />}
            {form.scope === "CATEGORIES" && <CheckList legend="Categories" items={catItems} selected={form.categories} onChange={(ids) => set("categories", ids, "categories")} error={err("categories")} disabled={!canWrite || saving} />}
            {form.scope === "BRANDS" && <CheckList legend="Brands" items={brandItems} selected={form.brands} onChange={(ids) => set("brands", ids, "brands")} error={err("brands")} disabled={!canWrite || saving} emptyText="No brands exist yet." />}

            <FieldGrid>
              <DateTimeField id={`${uid}-start`} label="Starts" value={form.startsAt} onChange={(v) => set("startsAt", v, "starts_at")} timeZone={store.timezone} error={err("starts_at")} hint={`Store time (${store.timezone}). ${curId === undefined ? "Leave empty to start when you save." : ""}`} />
              <DateTimeField id={`${uid}-end`} label="Ends" value={form.endsAt} onChange={(v) => set("endsAt", v, "ends_at")} timeZone={store.timezone} error={err("ends_at")} hint={`Store time (${store.timezone}). Leave empty to run until switched off.`} />
            </FieldGrid>
            <Checkbox checked={form.isActive} onChange={(e) => set("isActive", e.target.checked, "is_active")} label={<><span className="font-semibold">Active</span><span className="block text-sm text-ink-3">Switch off to pause it without losing the setup. It only applies between its start and end.</span></>} />
            <Alert tone="info" title="How promotions combine">Promotions never stack on one product. When several apply, the shopper automatically gets the one that gives the lowest price for the quantity, and if two give the same price the older promotion wins, so there is no priority to set. Coupons are separate and can be limited to items without a promotion.</Alert>
          </fieldset>
        </form>
      </div>
      {promotion && <ConfirmDelete open={confirmDelete} onOpenChange={setConfirmDelete} title={`Delete ${promotion.name}?`} description="Shoppers stop getting this offer straight away. Orders already placed keep the price they were charged." noun="Promotion" path={`/promotions/${promotion.id}/`} invalidate={INVALIDATE} onDone={onClose} />}
    </EditorSheet>
  );
}
