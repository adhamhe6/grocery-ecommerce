"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox, ChoiceGroup, Input, Textarea } from "@/components/ui/field";
import { Alert, Skeleton } from "@/components/ui/states";
import { useAdminGet } from "@/lib/admin";
import { formatDateTime } from "@/lib/format";
import { useMoney, useStore } from "@/lib/hooks";
import { ConfirmDelete, useEntitySave } from "../catalog/entity-kit";
import { DateTimeField, EditorSheet, FieldGrid, FormField } from "../catalog/form-kit";
import { ProductSetField, useProductRefs } from "../catalog/product-picker";
import type { CategoryRow } from "../catalog/product-model";
import { CheckList } from "./check-list";
import { COUPON_KINDS, COUPON_SCOPES, couponPayload, couponToForm, emptyCoupon, summariseCoupon, validateCoupon, type CouponForm, type CouponRow } from "./coupon-model";
import { describeTargets } from "./promotion-model";

const FIELDS = ["code", "description", "kind", "value", "max_discount", "min_order_value", "starts_at", "ends_at", "usage_limit", "per_customer_limit", "first_order_only", "scope", "categories", "products", "excluded_products", "exclude_discounted_items", "is_active"] as const;
const INVALIDATE = ["/coupons"];

interface Stats {
  code: string; used_count: number; usage_limit: number | null; redemptions: { active: number; void: number }; total_discount: string; voided_discount: string;
  last_redemptions: { order_number: string; email: string; amount: string; status: string; created_at: string }[];
}

function CouponUsage({ id }: { id: number }) {
  const money = useMoney();
  const stats = useAdminGet<Stats>(`/coupons/${id}/stats/`);
  return (
    <section aria-labelledby={`usage-${id}`} className="space-y-3 border-t border-line pt-5">
      <h3 id={`usage-${id}`} className="font-sans text-base font-bold text-ink">Usage</h3>
      {stats.isLoading ? <Skeleton className="h-24" /> : stats.error || !stats.data ? <p className="text-sm text-bad">Usage couldn&apos;t be loaded.</p> : (
        <>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div><dt className="text-xs font-semibold uppercase tracking-wide text-ink-3">Used</dt><dd className="num text-lg font-semibold">{stats.data.used_count}{stats.data.usage_limit != null && <span className="text-sm font-normal text-ink-3"> / {stats.data.usage_limit}</span>}</dd></div>
            <div><dt className="text-xs font-semibold uppercase tracking-wide text-ink-3">Active redemptions</dt><dd className="num text-lg font-semibold">{stats.data.redemptions.active}</dd></div>
            <div><dt className="text-xs font-semibold uppercase tracking-wide text-ink-3">Discount given</dt><dd className="num text-lg font-semibold">{money(stats.data.total_discount)}</dd></div>
            <div><dt className="text-xs font-semibold uppercase tracking-wide text-ink-3">Voided</dt><dd className="num text-lg font-semibold">{stats.data.redemptions.void}<span className="block text-xs font-normal text-ink-3">{money(stats.data.voided_discount)} returned</span></dd></div>
          </dl>
          {stats.data.last_redemptions.length === 0 ? <p className="text-sm text-ink-3">Not redeemed yet.</p> : (
            <div className="overflow-x-auto rounded-md border border-line">
              <table className="w-full min-w-[28rem] text-left text-sm">
                <caption className="sr-only">Most recent redemptions</caption>
                <thead className="border-b border-line bg-paper-2/60 text-xs uppercase tracking-wide text-ink-3"><tr><th scope="col" className="px-3 py-2">Order</th><th scope="col" className="px-3 py-2">Customer</th><th scope="col" className="px-3 py-2 text-right">Discount</th><th scope="col" className="px-3 py-2">When</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {stats.data.last_redemptions.map((r) => (
                    <tr key={r.order_number}><td className="num px-3 py-2">{r.order_number}</td><td className="px-3 py-2 text-ink-2">{r.email}</td><td className="num px-3 py-2 text-right">{money(r.amount)}{r.status === "VOID" && <Badge className="ml-2" tone="neutral">Voided</Badge>}</td><td className="whitespace-nowrap px-3 py-2 text-ink-3">{formatDateTime(r.created_at)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-ink-3">Showing up to the 20 most recent redemptions. Customer emails are masked.</p>
        </>
      )}
    </section>
  );
}

export function CouponEditor({ coupon, categories, canWrite, onClose }: { coupon?: CouponRow; categories: CategoryRow[]; canWrite: boolean; onClose: () => void }) {
  const uid = React.useId();
  const store = useStore();
  const money = useMoney();
  const [curId, setCurId] = React.useState(coupon?.id);
  const [saved, setSaved] = React.useState<CouponRow | undefined>(coupon);
  const [form, setForm] = React.useState<CouponForm>(() => (coupon ? couponToForm(coupon) : emptyCoupon()));
  const [base, setBase] = React.useState(form);
  const dirty = JSON.stringify(form) !== JSON.stringify(base);
  const { save, saving, errors, message, clearError } = useEntitySave<CouponRow>({ path: "/coupons/", fields: FIELDS, invalidate: INVALIDATE, noun: "Coupon" });
  const [local, setLocal] = React.useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [justCreated, setJustCreated] = React.useState(false);
  const err = (k: string) => errors[k] ?? local[k];
  const set = <K extends keyof CouponForm>(k: K, v: CouponForm[K], api: string) => { setForm((f) => ({ ...f, [k]: v })); clearError(api); setLocal((l) => (api in l ? Object.fromEntries(Object.entries(l).filter(([x]) => x !== api)) : l)); };
  const free = form.kind === "FREE_DELIVERY";
  const scope = free ? "ALL" : form.scope;

  const refs = useProductRefs(scope === "PRODUCTS" ? form.products : []);
  const names = scope === "PRODUCTS" ? form.products.map((id) => refs.get(id)?.name).filter((n): n is string => !!n) : form.categories.map((id) => categories.find((c) => c.id === id)?.name).filter((n): n is string => !!n);
  const total = scope === "PRODUCTS" ? form.products.length : form.categories.length;
  const summary = summariseCoupon({ ...form, scope }, describeTargets(scope === "ALL" ? "ALL" : scope, names, total), { money, timeZone: store.timezone, locale: store.locale });
  const catItems = React.useMemo(() => categories.slice().sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)).map((c) => ({ id: c.id, label: c.name, group: c.parent == null ? undefined : categories.find((p) => p.id === c.parent)?.name, hint: c.parent == null ? "(whole department)" : undefined })), [categories]);
  const redeemed = !!saved?.is_redeemed;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const invalid = validateCoupon(form);
    setLocal(invalid);
    if (Object.keys(invalid).length) { window.setTimeout(() => document.querySelector<HTMLElement>("[data-editor] [aria-invalid=true]")?.focus(), 0); return; }
    const res = await save(curId, couponPayload(form));
    if (res) {
      if (curId === undefined) { setCurId(res.id); setJustCreated(true); }
      setSaved(res);
      const f = couponToForm(res);
      setForm(f);
      setBase(f);
    }
  };

  return (
    <EditorSheet open onClose={onClose} title={curId === undefined ? "New coupon" : `Edit ${saved?.code ?? "coupon"}`} dirty={dirty} widthClass="w-[min(100vw,44rem)]"
      footer={
        <>
          {saved && canWrite && <Button variant="ghost" className="mr-auto text-bad" onClick={() => setConfirmDelete(true)}>Delete…</Button>}
          <Button variant="secondary" onClick={onClose}>{dirty ? "Cancel" : "Close"}</Button>
          {canWrite && <Button type="submit" form={`${uid}-form`} loading={saving} disabled={!dirty}>{curId === undefined ? "Create coupon" : "Save changes"}</Button>}
        </>
      }>
      <div data-editor className="space-y-5">
        <div className="rounded-md border border-primary/25 bg-primary-soft p-3" aria-live="polite">
          <p className="text-xs font-bold uppercase tracking-wide text-primary">What customers get</p>
          <p className="mt-0.5 font-semibold text-ink">{summary}</p>
        </div>
        {justCreated && <Alert tone="ok" title="Coupon created">Customers can use it at checkout once it is within its dates.</Alert>}
        {message && <Alert tone="bad" title="This could not be saved">{message}</Alert>}
        <form id={`${uid}-form`} onSubmit={submit} noValidate>
          <fieldset disabled={!canWrite || saving} className="m-0 min-w-0 space-y-5 border-0 p-0">
            <FieldGrid>
              <FormField id={`${uid}-code`} label="Code" required error={err("code")} hint={redeemed ? "Already redeemed, so it can't be renamed. Create a new coupon for a new code." : "3–40 letters, digits, - or _. Not case sensitive."}>
                {(p) => <Input {...p} className="num uppercase" value={form.code} maxLength={40} disabled={redeemed} onChange={(e) => set("code", e.target.value.toUpperCase(), "code")} />}
              </FormField>
            </FieldGrid>
            <FormField id={`${uid}-desc`} label="Description" error={err("description")} hint="For your team only.">{(p) => <Textarea {...p} rows={2} maxLength={200} value={form.description} onChange={(e) => set("description", e.target.value, "description")} />}</FormField>

            <ChoiceGroup name={`${uid}-kind`} legend="Type of coupon" value={form.kind} onChange={(v) => set("kind", v, "kind")} options={COUPON_KINDS.map((k) => ({ value: k.value, title: k.title, description: k.description }))} />
            {err("kind") && <p role="alert" className="text-sm font-medium text-bad">{err("kind")}</p>}
            {!free && (
              <FieldGrid>
                <FormField id={`${uid}-value`} label={form.kind === "PERCENT" ? "Percentage off" : "Amount off"} required error={err("value")} hint={form.kind === "PERCENT" ? "Above 0, up to 100." : "Above 0."}>{(p) => <Input {...p} className="num" inputMode="decimal" value={form.value} onChange={(e) => set("value", e.target.value, "value")} />}</FormField>
                {form.kind === "PERCENT" && <FormField id={`${uid}-max`} label="Maximum discount" error={err("max_discount")} hint={form.maxDiscount.trim() ? undefined : "No cap."}>{(p) => <Input {...p} className="num" inputMode="decimal" value={form.maxDiscount} onChange={(e) => set("maxDiscount", e.target.value, "max_discount")} />}</FormField>}
              </FieldGrid>
            )}

            <FieldGrid>
              <FormField id={`${uid}-min`} label="Minimum spend" error={err("min_order_value")} hint={form.minOrderValue.trim() ? "Of eligible items in the basket." : "No minimum."}>{(p) => <Input {...p} className="num" inputMode="decimal" value={form.minOrderValue} onChange={(e) => set("minOrderValue", e.target.value, "min_order_value")} />}</FormField>
            </FieldGrid>
            <Checkbox checked={form.firstOrderOnly} onChange={(e) => set("firstOrderOnly", e.target.checked, "first_order_only")} label={<><span className="font-semibold">First order only</span><span className="block text-sm text-ink-3">Only customers (or emails) with no earlier order can use it.</span></>} />
            {!free && <Checkbox checked={form.excludeDiscountedItems} onChange={(e) => set("excludeDiscountedItems", e.target.checked, "exclude_discounted_items")} label={<><span className="font-semibold">Skip items that already have a promotion</span><span className="block text-sm text-ink-3">Recommended, so shoppers don&apos;t get two discounts on one item.</span></>} />}

            {!free ? (
              <>
                <ChoiceGroup name={`${uid}-scope`} legend="Applies to" value={form.scope} onChange={(v) => set("scope", v, "scope")} options={COUPON_SCOPES.map((s) => ({ value: s.value, title: s.title, description: s.description }))} />
                {err("scope") && <p role="alert" className="text-sm font-medium text-bad">{err("scope")}</p>}
                {form.scope === "CATEGORIES" && <CheckList legend="Categories" items={catItems} selected={form.categories} onChange={(ids) => set("categories", ids, "categories")} error={err("categories")} disabled={!canWrite || saving} />}
                {form.scope === "PRODUCTS" && <ProductSetField ids={form.products} onChange={(ids) => set("products", ids, "products")} label="Add a product" error={err("products")} disabled={!canWrite || saving} emptyText="No products chosen yet." />}
                <details className="rounded-md border border-line p-3" open={form.excludedProducts.length > 0}>
                  <summary className="cursor-pointer text-sm font-semibold text-ink">Exclude specific products ({form.excludedProducts.length})</summary>
                  <div className="mt-3"><ProductSetField ids={form.excludedProducts} onChange={(ids) => set("excludedProducts", ids, "excluded_products")} label="Add a product to exclude" error={err("excluded_products")} disabled={!canWrite || saving} emptyText="Nothing excluded." /></div>
                </details>
              </>
            ) : <p className="text-sm text-ink-3">Free-delivery coupons apply to the whole order.</p>}

            <FieldGrid>
              <FormField id={`${uid}-limit`} label="Total uses" error={err("usage_limit")} hint={form.usageLimit.trim() ? `Stops working after ${form.usageLimit} redemptions.` : "Unlimited."}>{(p) => <Input {...p} className="num" inputMode="numeric" value={form.usageLimit} onChange={(e) => set("usageLimit", e.target.value, "usage_limit")} />}</FormField>
              <FormField id={`${uid}-per`} label="Uses per customer" error={err("per_customer_limit")} hint={form.perCustomerLimit.trim() ? undefined : "Unlimited per customer."}>{(p) => <Input {...p} className="num" inputMode="numeric" value={form.perCustomerLimit} onChange={(e) => set("perCustomerLimit", e.target.value, "per_customer_limit")} />}</FormField>
            </FieldGrid>
            <FieldGrid>
              <DateTimeField id={`${uid}-start`} label="Valid from" value={form.startsAt} onChange={(v) => set("startsAt", v, "starts_at")} timeZone={store.timezone} error={err("starts_at")} hint={`Store time (${store.timezone}). ${curId === undefined ? "Leave empty to start when you save." : ""}`} />
              <DateTimeField id={`${uid}-end`} label="Valid until" value={form.endsAt} onChange={(v) => set("endsAt", v, "ends_at")} timeZone={store.timezone} error={err("ends_at")} hint={`Store time (${store.timezone}). Leave empty for no expiry.`} />
            </FieldGrid>
            <Checkbox checked={form.isActive} onChange={(e) => set("isActive", e.target.checked, "is_active")} label={<><span className="font-semibold">Active</span><span className="block text-sm text-ink-3">Switch off to stop the code working without deleting it.</span></>} />
          </fieldset>
        </form>
        {curId !== undefined && <CouponUsage id={curId} />}
      </div>
      {saved && <ConfirmDelete open={confirmDelete} onOpenChange={setConfirmDelete} title={`Delete ${saved.code}?`} description={redeemed ? "This coupon has been redeemed, so the server will refuse to delete it. Switch it off instead." : "The code stops working immediately. This can't be undone."} noun="Coupon" path={`/coupons/${saved.id}/`} invalidate={INVALIDATE} onDone={onClose} />}
    </EditorSheet>
  );
}
