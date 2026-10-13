"use client";

// Small building blocks shared by the inventory, purchasing and delivery screens (forms in dialogs, row menus, a product
// search box, a store picker). They sit on top of the admin kit; nothing here talks to the API except where noted.
import * as DM from "@radix-ui/react-dropdown-menu";
import { useMutation, useQuery, useQueryClient, type MutateOptions } from "@tanstack/react-query";
import { MoreHorizontal } from "lucide-react";
import * as React from "react";
import { useDebouncedValue } from "@/components/admin/kit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { Alert } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { ApiError, apiGet } from "@/lib/api";
import { fieldErrorsOf, normaliseList, useAdmin, useAdminList, type Params } from "@/lib/admin";
import { cn } from "@/lib/cn";

// ------------------------------------------------------------------------------------------------ badges
export type Tone = "ok" | "warn" | "bad" | "info" | "neutral" | "citrus";
/** A badge that never relies on colour alone: it always carries text and (optionally) an icon. */
export function ToneBadge({ tone, icon: Icon, children, className }: { tone: Tone; icon?: React.ComponentType<{ className?: string }>; children: React.ReactNode; className?: string }) {
  return <Badge tone={tone} className={cn("whitespace-nowrap", className)}>{Icon && <Icon className="size-3.5 shrink-0" aria-hidden />}{children}</Badge>;
}

// ------------------------------------------------------------------------------------------------ mutations
interface ActionOpts<TData, TVars> {
  /** Cached admin queries whose path starts with one of these are refetched on success (default: all admin queries). */
  invalidate?: string[];
  success?: string | ((d: TData) => string | undefined);
  onSuccess?: (d: TData, v: TVars) => void;
  onError?: (e: unknown) => void;
}

/**
 * A mutation for a form or confirm dialog. Like `useAdminAction` it invalidates cached admin queries by path prefix and
 * toasts the success message, but the failure stays *inside* the form (`message`, `fieldErrors`) instead of a toast, so it
 * is announced once and stays next to the fields it concerns. `mutation.mutate` ignores a second call made before the first
 * has settled (a double click lands before React has disabled the button), so an adjustment, write-off or transfer can
 * never be sent twice by accident.
 */
export function useFormAction<TData = any, TVars = any>(fn: (vars: TVars) => Promise<TData>, opts: ActionOpts<TData, TVars> = {}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [error, setError] = React.useState<unknown>(null);
  const inFlight = React.useRef(false);
  const base = useMutation<TData, unknown, TVars>({
    mutationFn: async (vars) => {
      try { return await fn(vars); } finally { inFlight.current = false; }
    },
    onSuccess: (d, v) => {
      const prefixes = opts.invalidate;
      qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "admin" && (!prefixes || prefixes.some((p) => String(q.queryKey[1] ?? "").startsWith(p))) });
      const msg = typeof opts.success === "function" ? opts.success(d) : opts.success;
      if (msg) toast.success(msg);
      setError(null);
      opts.onSuccess?.(d, v);
    },
    onError: (e) => { setError(e); opts.onError?.(e); },
  });
  const baseMutate = base.mutate;
  const mutate = React.useCallback((vars: TVars, options?: MutateOptions<TData, unknown, TVars>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    baseMutate(vars, options);
  }, [baseMutate]);
  const mutation = React.useMemo(() => ({ ...base, mutate }), [base, mutate]);
  const clear = React.useCallback(() => setError(null), []);
  return {
    mutation,
    error,
    /** Dotted-key field errors from a 400 response ("lines.0.qty_ordered"). */
    fieldErrors: fieldErrorsOf(error),
    /** The server's message, verbatim. */
    message: error instanceof ApiError ? error.message : error ? "Something went wrong. Please try again." : null,
    code: error instanceof ApiError ? error.code : null,
    clear,
  };
}

// ------------------------------------------------------------------------------------------------ dialogs
/**
 * A dialog wrapping a <form>. Mount it only while it is needed (`{target && <XDialog …/>}`) so its state resets on every open.
 * The server's message is shown inside the dialog (and as a toast by `useAdminAction`).
 */
export function FormDialog({ onClose, title, description, submitLabel = "Save", onSubmit, loading, message, children, wide, danger, submitDisabled, footerNote, onEdit }: {
  onClose: () => void; onEdit?: () => void; title: string; description?: string; submitLabel?: string; onSubmit: () => void; loading?: boolean; message?: string | null;
  children: React.ReactNode; wide?: boolean; danger?: boolean; submitDisabled?: boolean; footerNote?: React.ReactNode;
}) {
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !loading) onClose(); }}>
      <DialogContent title={title} description={description} className={wide ? "w-[min(96vw,60rem)]" : undefined}>
        <form noValidate className="space-y-4" onChange={onEdit} onSubmit={(e) => { e.preventDefault(); if (!loading) onSubmit(); }}>
          {children}
          {message && <Alert tone="bad" title="That didn't go through">{message}</Alert>}
          <div className="sticky bottom-0 -mx-6 -mb-6 flex flex-wrap items-center justify-end gap-2 border-t border-line bg-paper px-6 py-4">
            {footerNote && <div className="mr-auto text-xs text-ink-3">{footerNote}</div>}
            <Button variant="secondary" onClick={onClose} disabled={loading}>Cancel</Button>
            <Button type="submit" variant={danger ? "danger" : "primary"} loading={loading} disabled={submitDisabled}>{submitLabel}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------------------------------------ row actions menu
/** Column class that keeps a table's actions column pinned to the right edge while the table scrolls sideways on small screens. */
export const STICKY_ACTIONS = "max-md:sticky max-md:right-0 max-md:z-[1] max-md:bg-white max-md:shadow-[-8px_0_8px_-8px_rgba(27,31,28,0.25)]";

export interface MenuAction { label: string; onSelect: () => void; danger?: boolean; disabled?: boolean; hidden?: boolean }

export function RowMenu({ label, actions }: { label: string; actions: MenuAction[] }) {
  const visible = actions.filter((a) => !a.hidden);
  if (!visible.length) return <span className="text-xs text-ink-3">—</span>;
  return (
    <DM.Root>
      <DM.Trigger className="inline-flex size-9 items-center justify-center rounded-md border border-line-strong bg-white text-ink-2 hover:bg-paper-2 data-[state=open]:bg-paper-2" aria-label={label}>
        <MoreHorizontal className="size-4" aria-hidden />
      </DM.Trigger>
      <DM.Portal>
        <DM.Content align="end" sideOffset={4} className="z-50 min-w-48 rounded-md border border-line-strong bg-white p-1.5 shadow-pop">
          {visible.map((a) => (
            <DM.Item key={a.label} disabled={a.disabled} onSelect={a.onSelect}
              className={cn("flex cursor-pointer items-center gap-2 rounded px-3 py-2 text-sm outline-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[highlighted]:bg-primary-soft", a.danger && "text-bad")}>
              {a.label}
            </DM.Item>
          ))}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

// ------------------------------------------------------------------------------------------------ misc
/** Page number that snaps back to 1 whenever `resetKey` (the serialised filters) changes, without a second fetch. */
export function usePage(resetKey: string): [number, (p: number) => void] {
  const [s, setS] = React.useState({ key: resetKey, page: 1 });
  return [s.key === resetKey ? s.page : 1, (page) => setS({ key: resetKey, page })];
}

/** Announces a result count to screen readers when a list finishes loading or changes. */
export function LiveCount({ count, noun, loading }: { count: number; noun: string; loading?: boolean }) {
  return <p role="status" className="sr-only">{loading ? "Loading" : `${count} ${noun}`}</p>;
}

/** The store a single-store screen (hours, templates, slots, replenishment) is working on; follows the header switcher. */
export function useWorkingBranch(): [number | null, (id: number | null) => void] {
  const { branchId, branches } = useAdmin();
  const [id, setId] = React.useState<number | null>(branchId ?? branches[0]?.id ?? null);
  React.useEffect(() => { if (branchId) setId(branchId); }, [branchId]);
  React.useEffect(() => { setId((cur) => (cur !== null && branches.some((b) => b.id === cur) ? cur : (branches[0]?.id ?? null))); }, [branches]);
  return [id, setId];
}

export function StoreSelect({ id, value, onChange, label = "Store", allLabel, className }: { id: string; value: number | null; onChange: (v: number | null) => void; label?: string; allLabel?: string; className?: string }) {
  const { branches } = useAdmin();
  return (
    <label htmlFor={id} className={cn("flex items-center gap-2 text-sm", className)}>
      <span className="font-semibold text-ink-2">{label}</span>
      <Select id={id} className="h-10 w-auto min-w-40 text-sm" value={value ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
        {allLabel && <option value="">{allLabel}</option>}
        {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
      </Select>
    </label>
  );
}

/**
 * Every page of an admin list, fetched sequentially (100 per page, at most `maxPages`). For views that need the whole
 * set at once (the slot calendar). The query key starts with ["admin", path] so mutations invalidate it by path prefix.
 */
export function useAdminAllPages<T = Record<string, any>>(path: string, params: Params, opts: { enabled?: boolean; maxPages?: number } = {}) {
  const maxPages = opts.maxPages ?? 10;
  const q = useQuery<{ rows: T[]; truncated: boolean }>({
    queryKey: ["admin", path, { ...params, __all: true }],
    enabled: opts.enabled ?? true,
    staleTime: 10_000,
    placeholderData: (prev) => prev,
    queryFn: async ({ signal }): Promise<{ rows: T[]; truncated: boolean }> => {
      const rows: T[] = [];
      for (let page = 1; ; page++) {
        const list = normaliseList<T>(await apiGet<unknown>(`/admin${path}`, { ...params, page, page_size: 100 }, signal));
        rows.push(...list.rows);
        if (!list.paginated || page >= list.totalPages) return { rows, truncated: false };
        if (page >= maxPages) return { rows, truncated: true };
      }
    },
  });
  return { rows: q.data?.rows ?? [], truncated: q.data?.truncated ?? false, isLoading: q.isLoading, isFetching: q.isFetching, error: q.error, refetch: q.refetch };
}

// ------------------------------------------------------------------------------------------------ product search
export interface ProductOption { id: number; sku: string; name: string; tracks_batches: boolean; sale_unit_code?: string; status?: string }

/**
 * Search-as-you-type product picker (combobox pattern: arrow keys, Enter, Escape). Uses GET /admin/products/?search=.
 */
export function ProductPicker({ id, label, value, onChange, error, hint, required, onlyActive = true, disabled, exclude = [] }: {
  id: string; label: string; value: ProductOption | null; onChange: (p: ProductOption | null) => void; error?: string; hint?: React.ReactNode;
  required?: boolean; onlyActive?: boolean; disabled?: boolean; exclude?: number[];
}) {
  const [q, setQ] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const dq = useDebouncedValue(q.trim(), 300);
  const enabled = dq.length >= 2;
  const list = useAdminList<ProductOption>("/products/", { search: dq, status: onlyActive ? "ACTIVE" : undefined, page_size: 8 }, { enabled });
  const options = list.rows.filter((p) => !exclude.includes(p.id));
  const changeRef = React.useRef<HTMLButtonElement>(null);
  const showList = open && enabled;
  const listId = `${id}-list`;

  React.useEffect(() => { setActive(0); }, [dq]);

  const pick = (p: ProductOption) => {
    onChange(p);
    setQ("");
    setOpen(false);
    requestAnimationFrame(() => changeRef.current?.focus());
  };

  if (value) {
    return (
      <Field label={label} htmlFor={id} required={required} error={error} hint={hint}>
        <div className="flex items-center gap-2">
          <Input id={id} readOnly value={`${value.name} · ${value.sku}`} aria-invalid={error ? true : undefined} />
          {!disabled && <Button ref={changeRef} variant="secondary" size="sm" className="shrink-0" onClick={() => onChange(null)}>Change</Button>}
        </div>
      </Field>
    );
  }
  return (
    <Field label={label} htmlFor={id} required={required} error={error} hint={hint ?? "Type at least two letters of a name or SKU."}>
      <div className="relative">
        <Input id={id} role="combobox" aria-expanded={showList} aria-controls={listId} aria-autocomplete="list" autoComplete="off" disabled={disabled}
          aria-activedescendant={showList && options[active] ? `${id}-opt-${options[active].id}` : undefined}
          aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : `${id}-hint`}
          value={q} placeholder="Search products…"
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, Math.max(options.length - 1, 0))); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            else if (e.key === "Enter" && showList && options[active]) { e.preventDefault(); pick(options[active]); }
            else if (e.key === "Escape" && showList) { e.stopPropagation(); setOpen(false); }
          }} />
        {showList && (
          <ul id={listId} role="listbox" aria-label={`${label} results`} className="absolute inset-x-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-md border border-line-strong bg-white py-1 shadow-pop">
            {list.isLoading || (list.isFetching && !options.length) ? <li className="px-3 py-2 text-sm text-ink-3">Searching…</li>
              : list.error ? <li className="px-3 py-2 text-sm text-bad">Search failed. Try again.</li>
              : !options.length ? <li className="px-3 py-2 text-sm text-ink-3">No products match “{dq}”.</li>
              : options.map((p, i) => (
                <li key={p.id} id={`${id}-opt-${p.id}`} role="option" aria-selected={i === active}
                  className={cn("cursor-pointer px-3 py-2 text-sm", i === active && "bg-primary-soft")}
                  onMouseDown={(e) => { e.preventDefault(); pick(p); }} onMouseEnter={() => setActive(i)}>
                  <span className="font-semibold">{p.name}</span> <span className="text-ink-3">· {p.sku}{p.tracks_batches ? " · batch-tracked" : ""}</span>
                </li>
              ))}
          </ul>
        )}
      </div>
    </Field>
  );
}
