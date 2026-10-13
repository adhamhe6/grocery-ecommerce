"use client";

import { Info } from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/field";
import { Alert } from "@/components/ui/states";
import { useAdminList, useAdmin } from "@/lib/admin";
import { formatQty } from "@/lib/format";
import { FieldGrid, FormField, Section } from "./form-kit";
import { PRODUCT_STATUSES, PRODUCT_TYPES, STOCK_MODES, STORAGE_TYPES, categoryGroups, fieldId, type CoreForm, type Lookups, type ProductDetail } from "./product-model";

export interface SectionProps {
  form: CoreForm;
  set: <K extends keyof CoreForm>(key: K, value: CoreForm[K]) => void;
  err: (name: string) => string | undefined;
  lookups: Lookups;
  saved?: ProductDetail;
}

const NOT_PROVIDED = "Not provided";

// ------------------------------------------------------------------------------------------------ basics
export function BasicsSection({ form, set, err, lookups, saved }: SectionProps) {
  const groups = categoryGroups(lookups.categories, form.category);
  return (
    <Section id="basics" title="Basics" description="What the product is called and where it lives in the shop.">
      <FieldGrid>
        <FormField id={fieldId("core.name")} label="Name" required error={err("core.name")}>
          {(p) => <Input {...p} value={form.name} maxLength={140} onChange={(e) => set("name", e.target.value)} />}
        </FormField>
        <FormField id={fieldId("core.sku")} label="SKU" required error={err("core.sku")} hint="Your own stock code. Must be unique.">
          {(p) => <Input {...p} className="num" value={form.sku} maxLength={32} onChange={(e) => set("sku", e.target.value)} />}
        </FormField>
        <FormField id={fieldId("core.slug")} label="Web address (slug)" error={err("core.slug")} hint={saved ? `Shown as /product/${form.slug || "…"}. Changing it changes the product's link.` : "Leave blank to build it from the name."}>
          {(p) => <Input {...p} className="num" value={form.slug} maxLength={140} onChange={(e) => set("slug", e.target.value)} />}
        </FormField>
        <FormField id={fieldId("core.barcode")} label="Barcode" error={err("core.barcode")} hint="EAN / UPC / GTIN, 8 to 14 digits. Optional.">
          {(p) => <Input {...p} className="num" inputMode="numeric" value={form.barcode} maxLength={14} onChange={(e) => set("barcode", e.target.value)} />}
        </FormField>
        <FormField id={fieldId("core.category")} label="Category" required error={err("core.category")}>
          {(p) => (
            <Select {...p} value={form.category} onChange={(e) => set("category", e.target.value)}>
              <option value="">Choose a category…</option>
              {groups.map((g) => <optgroup key={g.label} label={g.label}>{g.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</optgroup>)}
            </Select>
          )}
        </FormField>
        <FormField id={fieldId("core.brand")} label="Brand" error={err("core.brand")} hint={form.brand ? undefined : "No brand — nothing is shown."}>
          {(p) => (
            <Select {...p} value={form.brand} onChange={(e) => set("brand", e.target.value)}>
              <option value="">No brand</option>
              {lookups.brands.map((b) => <option key={b.id} value={b.id}>{b.name}{b.is_active ? "" : " (inactive)"}</option>)}
            </Select>
          )}
        </FormField>
        <FormField id={fieldId("core.productType")} label="Product type" error={err("core.productType")} hint="Loose produce and household items don't need an ingredients list.">
          {(p) => <Select {...p} value={form.productType} onChange={(e) => set("productType", e.target.value)}>{PRODUCT_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>}
        </FormField>
      </FieldGrid>
      <FormField id={fieldId("core.shortDescription")} label="Short description" error={err("core.shortDescription")} hint={`${form.shortDescription.length}/220 · shown on product cards and in search results.`}>
        {(p) => <Input {...p} value={form.shortDescription} maxLength={220} onChange={(e) => set("shortDescription", e.target.value)} />}
      </FormField>
      <FormField id={fieldId("core.description")} label="Description" error={err("core.description")} hint={form.description.trim() ? "Shown on the product page." : `${NOT_PROVIDED} — the product page will have no description.`}>
        {(p) => <Textarea {...p} rows={6} value={form.description} onChange={(e) => set("description", e.target.value)} />}
      </FormField>
    </Section>
  );
}

export function VisibilitySection({ form, set, err, saved }: SectionProps) {
  return (
    <Section id="visibility" title="Status & visibility" description="Who can see and buy this product right now.">
      <FieldGrid cols={3}>
        <FormField id={fieldId("core.status")} label="Status" error={err("core.status")} hint={saved ? undefined : "New products start inactive so you can finish the details first."}>
          {(p) => <Select {...p} value={form.status} onChange={(e) => set("status", e.target.value)}>{PRODUCT_STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>}
        </FormField>
      </FieldGrid>
      <div className="grid gap-3 sm:grid-cols-2">
        <Checkbox label={<><span className="font-semibold">Available to order</span><span className="block text-sm text-ink-3">A quick switch to hide the product temporarily without changing its status.</span></>} checked={form.isAvailable} onChange={(e) => set("isAvailable", e.target.checked)} />
        <Checkbox label={<><span className="font-semibold">Featured</span><span className="block text-sm text-ink-3">Eligible for featured placements on the shop.</span></>} checked={form.isFeatured} onChange={(e) => set("isFeatured", e.target.checked)} />
      </div>
      {err("core.isAvailable") && <p role="alert" className="text-sm font-medium text-bad">{err("core.isAvailable")}</p>}
      <p className="text-sm text-ink-3">The shop shows a product only while it is Active, available to order and in an active category. The storefront preview link opens its public page, which is “not found” whenever one of those is not true.</p>
      {form.status !== "ACTIVE" && <Alert tone="info">{form.status === "ARCHIVED" ? "Archived products are hidden from the shop and from search. Their history stays intact." : "Inactive products are hidden from the shop until you make them active."}</Alert>}
    </Section>
  );
}

// ------------------------------------------------------------------------------------------------ selling unit & quantity rules
export function SellingSection({ form, set, err, lookups, saved }: SectionProps) {
  const unit = lookups.units.find((u) => String(u.id) === form.saleUnit);
  const weightUnits = lookups.units.filter((u) => u.kind === "WEIGHT" || u.kind === "VOLUME");
  const group = (kind: string) => lookups.units.filter((u) => u.kind === kind);
  const notWeight = form.isVariableWeight && unit && unit.kind !== "WEIGHT";
  return (
    <Section id="selling" title="Selling unit & quantity rules" description="How customers buy this product and in what steps.">
      <FieldGrid>
        <FormField id={fieldId("core.saleUnit")} label="Sale unit" required error={err("core.saleUnit")} hint={saved ? "Can't be changed once the product has stock or orders." : "The unit the price is quoted in, for example each or per kg."}>
          {(p) => (
            <Select {...p} value={form.saleUnit} onChange={(e) => set("saleUnit", e.target.value)}>
              <option value="">Choose a unit…</option>
              {(["COUNT", "WEIGHT", "VOLUME"] as const).map((k) => <optgroup key={k} label={k === "COUNT" ? "Counted" : k === "WEIGHT" ? "By weight" : "By volume"}>{group(k).map((u) => <option key={u.id} value={u.id}>{u.name} ({u.symbol})</option>)}</optgroup>)}
            </Select>
          )}
        </FormField>
        <div className="self-end text-sm text-ink-2">
          {unit ? (unit.allows_fraction ? `${unit.name} can be sold in fractions (for example 0.5).` : `${unit.name} can only be sold in whole numbers.`) : "Choose a unit to see which quantities it allows."}
        </div>
      </FieldGrid>
      <FieldGrid cols={3}>
        <FormField id={fieldId("core.qtyMin")} label="Minimum quantity" error={err("core.qtyMin")} hint="Smallest amount in a basket.">
          {(p) => <Input {...p} className="num" inputMode="decimal" value={form.qtyMin} onChange={(e) => set("qtyMin", e.target.value)} />}
        </FormField>
        <FormField id={fieldId("core.qtyStep")} label="Quantity step" error={err("core.qtyStep")} hint="Quantities go up by this much.">
          {(p) => <Input {...p} className="num" inputMode="decimal" value={form.qtyStep} onChange={(e) => set("qtyStep", e.target.value)} />}
        </FormField>
        <FormField id={fieldId("core.qtyMax")} label="Maximum quantity" error={err("core.qtyMax")} hint={form.qtyMax.trim() ? undefined : "No maximum — only stock limits the amount."}>
          {(p) => <Input {...p} className="num" inputMode="decimal" value={form.qtyMax} onChange={(e) => set("qtyMax", e.target.value)} />}
        </FormField>
      </FieldGrid>
      <div className="space-y-2">
        <Checkbox
          id={fieldId("core.isVariableWeight")} checked={form.isVariableWeight} onChange={(e) => set("isVariableWeight", e.target.checked)}
          label={<><span className="font-semibold">Variable weight</span><span className="block text-sm text-ink-3">Sold by weight, where each piece weighs a little different (loose fruit, deli cuts, meat).</span></>}
        />
        {err("core.isVariableWeight") && <p role="alert" className="text-sm font-medium text-bad">{err("core.isVariableWeight")}</p>}
        {form.isVariableWeight && (
          <Alert tone={notWeight ? "warn" : "info"} title="What variable weight means">
            <ul className="list-disc space-y-0.5 pl-5">
              <li>The customer orders an <em>expected</em> weight; the picker records the <em>actual</em> weight when packing.</li>
              <li>The final charge is the actual weight × the price, within the store&apos;s weight tolerance. The card is authorised with a small buffer on top.</li>
              <li>It needs a weight sale unit (kg, g or 100 g){notWeight ? " — the unit chosen above is not a weight unit, so this will be refused." : "."}</li>
            </ul>
          </Alert>
        )}
      </div>
      <div className="rounded-md border border-line bg-paper-2/40 p-4">
        <p className="mb-3 flex items-start gap-2 text-sm text-ink-2"><Info className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden /><span><strong>Pack size / net content</strong> is how much is in <em>one</em> sale unit, for example 500 g in a pack. It lets the shop show a price per kg or per litre. Set both the amount and its unit, or neither.</span></p>
        <FieldGrid>
          <FormField id={fieldId("core.netContent")} label="Net content" error={err("core.netContent")} hint={form.netContent.trim() ? undefined : `${NOT_PROVIDED} — no price per kg / L unless the sale unit is a weight or volume.`}>
            {(p) => <Input {...p} className="num" inputMode="decimal" value={form.netContent} onChange={(e) => set("netContent", e.target.value)} />}
          </FormField>
          <FormField id={fieldId("core.netContentUnit")} label="Net content unit" error={err("core.netContentUnit")}>
            {(p) => (
              <Select {...p} value={form.netContentUnit} onChange={(e) => set("netContentUnit", e.target.value)}>
                <option value="">None</option>
                {weightUnits.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.symbol})</option>)}
              </Select>
            )}
          </FormField>
        </FieldGrid>
      </div>
    </Section>
  );
}

// ------------------------------------------------------------------------------------------------ pricing
export function PricingSection({ form, set, err, saved }: SectionProps) {
  const up = saved?.unit_price;
  return (
    <Section id="pricing" title="Pricing" description="The shelf price per ONE sale unit. Sale prices are set up under Promotions.">
      <FieldGrid>
        <FormField id={fieldId("core.price")} label="Price" required error={err("core.price")} hint="Per one sale unit, for example per kg. Two decimals.">
          {(p) => <Input {...p} className="num" inputMode="decimal" value={form.price} onChange={(e) => set("price", e.target.value)} />}
        </FormField>
        <FormField id={fieldId("core.taxRate")} label="Tax rate (%)" error={err("core.taxRate")} hint="0 to 100. Use 0 for tax-free items.">
          {(p) => <Input {...p} className="num" inputMode="decimal" value={form.taxRate} onChange={(e) => set("taxRate", e.target.value)} />}
        </FormField>
      </FieldGrid>
      {saved && (
        <p className="text-sm text-ink-2">
          <span className="font-semibold">Unit price on the shop (saved data):</span>{" "}
          {up ? <span className="num">{up.amount} per {up.per}</span> : <span>{NOT_PROVIDED} — it needs a weight / volume sale unit, or a net content with its unit.</span>}
        </p>
      )}
    </Section>
  );
}

// ------------------------------------------------------------------------------------------------ stock & expiry
interface StockRow { id: number; branch: string; on_hand: string; reserved: string; available: string; status: "OK" | "LOW" | "OUT"; product_id: number }

function StockSummary({ product }: { product: ProductDetail }) {
  const { can } = useAdmin();
  const allowed = can("inventory.read");
  const { rows, isLoading, error } = useAdminList<StockRow>("/inventory/stock/", { search: product.sku, page_size: 50 }, { enabled: allowed });
  if (!allowed) return null;
  const mine = rows.filter((r) => r.product_id === product.id);
  return (
    <div className="rounded-md border border-line p-4">
      <p className="mb-2 text-sm font-semibold text-ink">Stock right now</p>
      {isLoading ? <p className="text-sm text-ink-3">Loading stock…</p> : error ? <p className="text-sm text-bad">Stock couldn&apos;t be loaded.</p> : mine.length === 0 ? (
        <p className="text-sm text-ink-3">No stock has ever been recorded for this product in the stores you can see.</p>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {mine.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
              <span>{r.branch}</span>
              <span className="num flex items-center gap-3">{formatQty(r.on_hand)} on hand · {formatQty(r.reserved)} reserved · <strong>{formatQty(r.available)} available</strong>
                <Badge tone={r.status === "OK" ? "ok" : r.status === "LOW" ? "warn" : "bad"}>{r.status === "OK" ? "In stock" : r.status === "LOW" ? "Low" : "Out"}</Badge></span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-ink-3">Receive, adjust and write off stock from Inventory.</p>
    </div>
  );
}

export function StockSection({ form, set, err, saved }: SectionProps) {
  const batchHint = form.stockMode !== "TRACKED" ? "Batch tracking needs tracked stock." : undefined;
  return (
    <Section id="stock" title="Stock & expiry" description="How stock is counted and how expiry is handled.">
      <FieldGrid>
        <FormField id={fieldId("core.stockMode")} label="Stock mode" error={err("core.stockMode")} hint={saved ? "Can't be changed once the product has stock or orders." : "Made-to-order products are sold without a stock count."}>
          {(p) => <Select {...p} value={form.stockMode} onChange={(e) => { set("stockMode", e.target.value); if (e.target.value !== "TRACKED") set("tracksBatches", false); }}>{STOCK_MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>}
        </FormField>
      </FieldGrid>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Checkbox id={fieldId("core.tracksBatches")} checked={form.tracksBatches} disabled={form.stockMode !== "TRACKED"} onChange={(e) => set("tracksBatches", e.target.checked)}
            label={<><span className="font-semibold">Track batches (lot and expiry)</span><span className="block text-sm text-ink-3">Stock is received in batches with an expiry date and sold oldest-expiry first.{batchHint && ` ${batchHint}`}</span></>} />
          {err("core.tracksBatches") && <p role="alert" className="mt-1 text-sm font-medium text-bad">{err("core.tracksBatches")}</p>}
        </div>
        <Checkbox id={fieldId("core.isPerishable")} checked={form.isPerishable} onChange={(e) => set("isPerishable", e.target.checked)}
          label={<><span className="font-semibold">Perishable</span><span className="block text-sm text-ink-3">Short shelf life — can be filtered as perishable.</span></>} />
      </div>
      {(form.tracksBatches || form.isPerishable) && (
        <FieldGrid cols={3}>
          <FormField id={fieldId("core.sellBufferDays")} label="Stop selling before expiry (days)" error={err("core.sellBufferDays")} hint="A batch stops being sold this many days before its best-before date.">
            {(p) => <Input {...p} className="num" inputMode="numeric" value={form.sellBufferDays} onChange={(e) => set("sellBufferDays", e.target.value)} />}
          </FormField>
        </FieldGrid>
      )}
      {saved && <StockSummary product={saved} />}
    </Section>
  );
}

// ------------------------------------------------------------------------------------------------ storage
export function StorageSection({ form, set, err }: SectionProps) {
  return (
    <Section id="storage" title="Storage & packaging" description="How the product is kept and how customers should store it.">
      <FieldGrid>
        <FormField id={fieldId("core.storageType")} label="Kept" error={err("core.storageType")}>
          {(p) => <Select {...p} value={form.storageType} onChange={(e) => set("storageType", e.target.value)}>{STORAGE_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>}
        </FormField>
        <FormField id={fieldId("core.packaging")} label="Packaging" error={err("core.packaging")} hint={form.packaging.trim() ? undefined : NOT_PROVIDED}>
          {(p) => <Input {...p} value={form.packaging} maxLength={160} onChange={(e) => set("packaging", e.target.value)} />}
        </FormField>
      </FieldGrid>
      <FormField id={fieldId("core.storageInstructions")} label="Storage instructions" error={err("core.storageInstructions")} hint={form.storageInstructions.trim() ? `${form.storageInstructions.length}/300` : `${NOT_PROVIDED} — customers won't see storage advice.`}>
        {(p) => <Input {...p} value={form.storageInstructions} maxLength={300} onChange={(e) => set("storageInstructions", e.target.value)} placeholder="For example: Keep refrigerated. Once opened, use within 3 days." />}
      </FormField>
    </Section>
  );
}
