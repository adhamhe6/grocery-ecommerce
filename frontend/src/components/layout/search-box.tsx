"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { apiGet } from "@/lib/api";
import { cn } from "@/lib/cn";
import { imgSrc } from "@/lib/format";

interface Suggest {
  products: { slug: string; name: string; category: string; image: Record<string, string> }[];
  categories: { slug: string; name: string }[];
  brands: { slug: string; name: string }[];
}

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Accessible combobox (ARIA 1.2 list autocomplete). Suggestions are fetched server-side — never the whole catalog. */
export function SearchBox({ className, autoFocus, onDone }: { className?: string; autoFocus?: boolean; onDone?: () => void }) {
  const router = useRouter();
  const [q, setQ] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(-1);
  const debounced = useDebounced(q.trim(), 180);
  const listId = React.useId();
  const { data, isFetching } = useQuery<Suggest>({ queryKey: ["suggest", debounced], queryFn: () => apiGet<Suggest>("/search/suggest/", { q: debounced }), enabled: debounced.length >= 2, staleTime: 30_000, placeholderData: (p) => p });

  const options = React.useMemo(() => {
    if (!data || debounced.length < 2) return [];
    return [
      ...data.products.map((p) => ({ key: `p-${p.slug}`, href: `/product/${p.slug}`, label: p.name, sub: p.category, img: imgSrc(p.image, 320) })),
      ...data.categories.map((c) => ({ key: `c-${c.slug}`, href: `/shop?category=${c.slug}`, label: c.name, sub: "Category", img: "" })),
      ...data.brands.map((b) => ({ key: `b-${b.slug}`, href: `/shop?brand=${b.slug}`, label: b.name, sub: "Brand", img: "" })),
    ];
  }, [data, debounced]);

  const go = (href: string) => { setOpen(false); setActive(-1); onDone?.(); router.push(href); };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (active >= 0 && options[active]) return go(options[active].href);
    if (q.trim()) go(`/shop?q=${encodeURIComponent(q.trim())}`);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => (a + 1) % Math.max(options.length, 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a <= 0 ? options.length - 1 : a - 1)); }
    else if (e.key === "Escape") { setOpen(false); setActive(-1); }
  };
  const show = open && debounced.length >= 2;

  return (
    <form role="search" onSubmit={submit} className={cn("relative", className)} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
      <label htmlFor="site-search" className="sr-only">Search groceries</label>
      <Search className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-ink-3" aria-hidden />
      <input
        id="site-search" type="search" role="combobox" autoComplete="off" autoFocus={autoFocus} value={q} placeholder="Search for vegetables, bread, milk…"
        aria-expanded={show} aria-controls={listId} aria-autocomplete="list" aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(-1); }} onFocus={() => setOpen(true)} onKeyDown={onKey}
        className="h-12 w-full rounded-md border border-line-strong bg-white pl-11 pr-20 text-[0.97rem] text-ink placeholder:text-ink-3 focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
      />
      <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-1">
        {isFetching && <Loader2 className="size-4 animate-spin text-ink-3" aria-hidden />}
        {q && <button type="button" onClick={() => { setQ(""); setOpen(false); }} className="rounded p-1.5 text-ink-3 hover:bg-paper-2" aria-label="Clear search"><X className="size-4" aria-hidden /></button>}
        <button type="submit" className="h-9 rounded bg-primary px-3.5 text-sm font-semibold text-primary-fg hover:bg-primary-hover">Search</button>
      </div>
      {show && (
        <ul id={listId} role="listbox" aria-label="Search suggestions" className="absolute inset-x-0 top-[calc(100%+6px)] z-40 max-h-[70dvh] overflow-y-auto rounded-md border border-line-strong bg-white py-1 shadow-pop">
          {options.length === 0 && !isFetching && <li className="px-4 py-3 text-sm text-ink-2" role="option" aria-selected={false}>No matches for “{debounced}”. Try a shorter word.</li>}
          {options.map((o, i) => (
            <li key={o.key} id={`${listId}-${i}`} role="option" aria-selected={i === active}>
              <button type="button" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => go(o.href)} onMouseEnter={() => setActive(i)} className={cn("flex w-full items-center gap-3 px-3 py-2 text-left", i === active ? "bg-primary-soft" : "hover:bg-paper")}>
                {o.img ? <img src={o.img} alt="" width={40} height={40} className="tile-bg size-10 rounded object-contain" /> : <span className="flex size-10 items-center justify-center rounded bg-paper-2 text-ink-3"><Search className="size-4" aria-hidden /></span>}
                <span className="min-w-0"><span className="block truncate text-sm font-semibold text-ink">{o.label}</span><span className="block truncate text-xs text-ink-3">{o.sub}</span></span>
              </button>
            </li>
          ))}
          <li role="presentation" className="border-t border-line"><button type="submit" className="w-full px-4 py-2.5 text-left text-sm font-semibold text-primary hover:bg-paper" tabIndex={-1}>See all results for “{debounced}”</button></li>
        </ul>
      )}
    </form>
  );
}
