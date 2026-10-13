"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { AdminPage, ConfirmDialog } from "@/components/admin/kit";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Alert, ErrorState, Skeleton } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/format";
import { adminRequest, useAdmin, useAdminGet, useAdminList, useAdminAction } from "@/lib/admin";
import { Section, ErrorSummary, ReadOnlyFieldset, StickyBar, errorsOf, focusFirstInvalid, restMessage, useUnsavedGuard, type Errors } from "./form-kit";
import { ProductImages } from "./product-images";
import {
  MISSING_LABELS, buildAllergensPayload, buildClaimsPayload, buildCorePayload, buildNutritionPayload, claimsFromRows, diffPayload, dirtySections, emptyProductForm, labelFor, fieldId,
  mapAllergenErrors, mapClaimErrors, mapCoreErrors, mapNutritionErrors, productToForm, sectionDirty, validateProductForm,
  type AllergenLookup, type BrandRow, type CategoryRow, type ClaimRow, type CoreForm, type Lookups, type ProductDetail, type ProductForm, type UnitRow,
} from "./product-model";
import { BasicsSection, PricingSection, SellingSection, StockSection, StorageSection, VisibilitySection } from "./product-sections";
import { AllergensSection, ClaimsSection, NutritionSection, OriginSection } from "./product-trust";

const NAV: [string, string][] = [["images", "Images"], ["basics", "Basics"], ["visibility", "Status"], ["selling", "Selling unit"], ["pricing", "Pricing"], ["stock", "Stock"], ["storage", "Storage"], ["origin", "Origin"], ["allergens", "Allergens"], ["claims", "Claims"], ["nutrition", "Nutrition"]];
const MISSING_ANCHOR: Record<string, string> = { image: "images", description: "basics", origin: "origin", nutrition: "nutrition", ingredients: "origin", allergens: "allergens", storage: "storage" };

export function ProductEditor({ productId }: { productId?: number }) {
  const { can } = useAdmin();
  const canWrite = can("catalog.write");
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();

  const [id, setId] = React.useState<number | undefined>(productId);
  const detail = useAdminGet<ProductDetail>(`/products/${id ?? 0}/`, {}, { enabled: id !== undefined });
  const categories = useAdminList<CategoryRow>("/categories/");
  const brands = useAdminList<BrandRow>("/brands/");
  const units = useAdminList<UnitRow>("/units/");
  const allergens = useAdminList<AllergenLookup>("/allergens/");
  const lookups = React.useMemo<Lookups>(() => ({ categories: categories.rows, brands: brands.rows, units: units.rows, allergens: allergens.rows }), [categories.rows, brands.rows, units.rows, allergens.rows]);
  const lookupError = categories.error || brands.error || units.error || allergens.error;

  const [form, setForm] = React.useState<ProductForm>(emptyProductForm);
  const [base, setBase] = React.useState<ProductForm>(emptyProductForm);
  const initialised = React.useRef<number | "new" | null>(productId === undefined ? "new" : null);
  React.useEffect(() => {
    if (detail.data && initialised.current !== detail.data.id) {
      initialised.current = detail.data.id;
      const f = productToForm(detail.data);
      setForm(f);
      setBase(f);
    }
  }, [detail.data]);

  const [errors, setErrors] = React.useState<Errors>({});
  const [formMsg, setFormMsg] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [confirmNutrition, setConfirmNutrition] = React.useState(false);
  const formRef = React.useRef<HTMLFormElement>(null);

  const dirtyList = dirtySections(form, base);
  const dirty = dirtyList.length > 0;
  const guard = useUnsavedGuard(dirty);
  const saved = detail.data && id !== undefined ? detail.data : undefined;

  const err = (name: string) => errors[name];
  const setCore = React.useCallback(<K extends keyof CoreForm>(key: K, value: CoreForm[K]) => {
    setForm((f) => ({ ...f, core: { ...f.core, [key]: value } }));
    setErrors((e) => (`core.${key}` in e ? Object.fromEntries(Object.entries(e).filter(([k]) => k !== `core.${key}`)) : e));
  }, []);

  const invalidate = () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "admin" && String(q.queryKey[1] ?? "").startsWith("/products") });

  async function save() {
    setSaving(true);
    setFormMsg(null);
    setConfirmNutrition(false);
    const collected: Errors = {};
    const notes: string[] = [];
    const done: string[] = [];
    const failed: string[] = [];
    let curId = id;
    const nextBase: ProductForm = { ...base };
    const nextForm: ProductForm = { ...form };
    const codes = lookups.allergens.map((a) => a.code);
    const wasNew = id === undefined;
    let created: ProductDetail | null = null;

    if (curId === undefined || sectionDirty("core", form, base)) {
      try {
        const full = buildCorePayload(form.core);
        const res = curId === undefined
          ? await adminRequest<ProductDetail>("POST", "/products/", full)
          : await adminRequest<ProductDetail>("PATCH", `/products/${curId}/`, diffPayload(buildCorePayload(base.core), full));
        curId = res.id;
        if (wasNew) created = res;
        const f = productToForm(res);
        nextBase.core = f.core;
        nextForm.core = f.core;
        done.push("details");
      } catch (e) {
        const m = mapCoreErrors(errorsOf(e));
        Object.assign(collected, m.fields);
        const note = restMessage(e, m);
        if (note) notes.push(note);
        failed.push("details");
      }
    }

    if (curId !== undefined && sectionDirty("claims", form, base)) {
      const payload = buildClaimsPayload(form.claims);
      try {
        const rows = await adminRequest<ClaimRow[]>("PUT", `/products/${curId}/claims/`, payload);
        nextBase.claims = claimsFromRows(rows);
        nextForm.claims = nextBase.claims;
        done.push("claims");
      } catch (e) {
        const m = mapClaimErrors(errorsOf(e), payload.map((p) => p.kind));
        Object.assign(collected, m.fields);
        const note = restMessage(e, m);
        if (note) notes.push(`Claims: ${note}`);
        failed.push("claims");
      }
    }

    if (curId !== undefined && sectionDirty("allergens", form, base) && codes.length > 0) {
      const payload = buildAllergensPayload(form.allergens, codes);
      try {
        await adminRequest("PUT", `/products/${curId}/allergens/`, payload);
        nextBase.allergens = { levels: { ...form.allergens.levels }, confirmed: form.allergens.confirmed };
        done.push("allergens");
      } catch (e) {
        const m = mapAllergenErrors(errorsOf(e), payload.allergens.map((a) => a.allergen));
        Object.assign(collected, m.fields);
        const note = restMessage(e, m);
        if (note) notes.push(`Allergens: ${note}`);
        failed.push("allergens");
      }
    }

    if (curId !== undefined && sectionDirty("nutrition", form, base)) {
      try {
        if (form.nutrition.enabled) {
          await adminRequest("PUT", `/products/${curId}/nutrition/`, buildNutritionPayload(form.nutrition));
          nextBase.nutrition = { ...form.nutrition, values: { ...form.nutrition.values }, isDemo: false };
          nextForm.nutrition = nextBase.nutrition;
        } else {
          await adminRequest("DELETE", `/products/${curId}/nutrition/`);
          nextBase.nutrition = { ...form.nutrition, values: { ...form.nutrition.values } };
        }
        done.push("nutrition");
      } catch (e) {
        const m = mapNutritionErrors(errorsOf(e));
        Object.assign(collected, m.fields);
        const note = restMessage(e, m);
        if (note) notes.push(`Nutrition: ${note}`);
        failed.push("nutrition");
      }
    }

    setBase(nextBase);
    setForm(nextForm);
    setErrors(collected);
    setSaving(false);

    if (curId !== undefined && wasNew) {
      // The product exists now: switch the page to edit mode without remounting (the form keeps whatever failed to save).
      initialised.current = curId;
      if (created) qc.setQueryData(["admin", `/products/${curId}/`, {}], created);
      setId(curId);
      window.history.replaceState(window.history.state, "", `/admin/products/${curId}`);
    }
    if (done.length) invalidate();
    if (failed.length === 0) {
      toast.success(wasNew ? "Product created" : "Product saved");
    } else {
      setFormMsg(`${done.length ? `Saved: ${done.join(", ")}. ` : ""}Not saved: ${failed.join(", ")}.${notes.length ? ` ${notes.join(" ")}` : ""}`);
      toast.show({ tone: "bad", title: "Some changes weren't saved", body: "See the details at the top of the page." });
      focusFirstInvalid(formRef.current);
    }
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canWrite || saving) return;
    const invalid = validateProductForm(form);
    setErrors(invalid);
    if (Object.keys(invalid).length) {
      setFormMsg(null);
      focusFirstInvalid(formRef.current);
      return;
    }
    if (id !== undefined && base.nutrition.enabled && !form.nutrition.enabled) setConfirmNutrition(true);
    else void save();
  };

  const archive = useAdminAction((force: boolean) => adminRequest<{ result: "archived" | "deleted" }>("DELETE", `/products/${id}/`, undefined, force ? { archive: true } : undefined), {
    invalidate: ["/products"],
    onSuccess: (d) => {
      if (d.result === "deleted") { toast.success("Product deleted"); router.push("/admin/products"); }
      else toast.success("Product archived", "It is hidden from the shop. Its stock and order history are untouched.");
      setDanger(null);
    },
  });
  const [danger, setDanger] = React.useState<"archive" | "delete" | null>(null);

  const title = saved?.name || (id === undefined ? "New product" : "Product");
  const summary = Object.entries(errors).map(([key, message]) => ({ id: fieldId(key), label: labelFor(key), message }));

  if (id !== undefined && detail.isLoading) return <AdminPage title="Product"><Skeleton className="h-10 w-72" /><Skeleton className="h-96 w-full" /></AdminPage>;
  if (id !== undefined && detail.error && !detail.data) return <AdminPage title="Product"><ErrorState error={detail.error} onRetry={() => detail.refetch()} title="We couldn't load this product" /></AdminPage>;

  const props = { form: form.core, set: setCore, err, lookups, saved };
  return (
    <AdminPage
      title={title}
      description={saved ? <>SKU <span className="num">{saved.sku}</span> · last updated {formatDateTime(saved.updated_at)}</> : "Fill in the essentials, then add the trust details shoppers rely on: allergens, ingredients, origin and nutrition."}
      actions={
        <>
          <ButtonLink href="/admin/products" variant="secondary" size="sm"><ArrowLeft className="size-4" aria-hidden /> All products</ButtonLink>
          {saved && <ButtonLink href={`/product/${saved.slug}`} target="_blank" rel="noopener" variant="secondary" size="sm"><ExternalLink className="size-4" aria-hidden /> Storefront preview{" "}<span className="sr-only">(opens in a new tab)</span></ButtonLink>}
        </>
      }
    >
      {guard.dialog}
      {!canWrite && <Alert tone="info" title="Read only">Your role can look at products but not change them. Availability can be switched from the product list if your role allows it.</Alert>}
      {lookupError && <Alert tone="warn" title="Some choices couldn't be loaded">Categories, brands, units or allergens failed to load, so parts of this form may be incomplete. Reload the page before saving.</Alert>}
      {saved && saved.is_demo && <Alert tone="warn" title="Demo product">This is sample data from the seed. Edit it freely, but don&apos;t treat it as real stock information.</Alert>}

      <nav aria-label="Sections on this page" className="-mt-2 flex gap-1 overflow-x-auto pb-1">
        {NAV.map(([k, l]) => <a key={k} href={`#${k}`} className="whitespace-nowrap rounded-full border border-line-strong bg-white px-3 py-1 text-sm font-medium text-ink-2 hover:bg-paper-2">{l}</a>)}
      </nav>

      {saved && saved.missing.length > 0 && (
        <Alert tone="info" title="The product page still has gaps">
          <p>Shoppers see “Not provided” for these until you fill them in:</p>
          <ul className="mt-1.5 flex flex-wrap gap-2">
            {saved.missing.map((m) => <li key={m}><a className="inline-flex" href={`#${MISSING_ANCHOR[m] ?? "basics"}`}><Badge tone="warn">{MISSING_LABELS[m] ?? m}</Badge></a></li>)}
          </ul>
        </Alert>
      )}
      <ErrorSummary message={formMsg} fields={summary} />

      {saved ? (
        <ProductImages productId={saved.id} images={saved.images} canWrite={canWrite} />
      ) : (
        <Section id="images" title="Images" description="Pictures are uploaded to a saved product."><p className="text-sm text-ink-2">Save the product first, then add up to 8 pictures here. Products without a picture show a blank tile in the shop.</p></Section>
      )}

      <form id="product-form" ref={formRef} onSubmit={onSubmit} noValidate aria-label={saved ? `Edit ${saved.name}` : "New product"}>
        <ReadOnlyFieldset readOnly={!canWrite || saving}>
          <BasicsSection {...props} />
          <VisibilitySection {...props} />
          <SellingSection {...props} />
          <PricingSection {...props} />
          <StockSection {...props} />
          <StorageSection {...props} />
          <OriginSection {...props} />
          <AllergensSection value={form.allergens} onChange={(v) => { setForm((f) => ({ ...f, allergens: v })); setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !k.startsWith("allergens")))); }} lookups={lookups} err={err} />
          <ClaimsSection value={form.claims} onChange={(v) => { setForm((f) => ({ ...f, claims: v })); setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !k.startsWith("claims")))); }} err={err} />
          <NutritionSection value={form.nutrition} hadPanel={base.nutrition.enabled && id !== undefined} onChange={(v) => { setForm((f) => ({ ...f, nutrition: v })); setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !k.startsWith("nutrition")))); }} err={err} />
        </ReadOnlyFieldset>
      </form>

      {saved && canWrite && (
        <Section id="danger" title="Archive or delete" description="Archiving hides the product but keeps its stock and order history. Deleting is only possible if nothing ever referenced the product.">
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={saved.status === "ARCHIVED"} onClick={() => setDanger("archive")}>{saved.status === "ARCHIVED" ? "Already archived" : "Archive product"}</Button>
            <Button variant="danger" onClick={() => setDanger("delete")}>Delete product…</Button>
          </div>
          {saved.status === "ARCHIVED" && <p className="text-sm text-ink-3">To bring it back, set the status to Active above and save.</p>}
        </Section>
      )}

      {canWrite && <StickyBar formId="product-form" fresh={id === undefined} dirty={dirty} saving={saving} saveLabel={id === undefined ? "Create product" : "Save changes"} onDiscard={() => { setForm(base); setErrors({}); setFormMsg(null); }} />}

      <ConfirmDialog open={confirmNutrition} onOpenChange={setConfirmNutrition} title="Delete the nutrition panel?" description="You unticked “This product has a nutrition panel”. Saving deletes the stored values; shoppers will see “Not provided”." confirmLabel="Save and delete panel" danger loading={saving} onConfirm={() => void save()} />
      <ConfirmDialog open={danger === "archive"} onOpenChange={(o) => !o && setDanger(null)} title="Archive this product?" description="It disappears from the shop and from search. Stock, orders and history stay as they are, and you can restore it later by setting it back to Active." confirmLabel="Archive product" loading={archive.isPending} onConfirm={() => archive.mutate(true)} />
      <ConfirmDialog open={danger === "delete"} onOpenChange={(o) => !o && setDanger(null)} title="Delete this product?" description="If the product has never had stock, orders or purchase orders it is deleted permanently, along with its pictures. If it has, the server archives it instead and tells you." confirmLabel="Delete product" danger loading={archive.isPending} onConfirm={() => archive.mutate(false)} />
      <p className="sr-only" aria-live="polite">{saving ? "Saving…" : ""}</p>
    </AdminPage>
  );
}
