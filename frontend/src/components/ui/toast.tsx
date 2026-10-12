"use client";

import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/cn";
import { ApiError } from "@/lib/api";

type Tone = "ok" | "bad" | "info";
interface ToastItem { id: number; tone: Tone; title: string; body?: string }
interface ToastApi { show: (t: Omit<ToastItem, "id">) => void; success: (title: string, body?: string) => void; error: (e: unknown, fallback?: string) => void; info: (title: string, body?: string) => void }

const Ctx = React.createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const v = React.useContext(Ctx);
  if (!v) throw new Error("useToast must be used inside <ToastProvider>");
  return v;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);
  const next = React.useRef(1);
  const dismiss = React.useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const show = React.useCallback((t: Omit<ToastItem, "id">) => {
    const id = next.current++;
    setItems((xs) => [...xs.slice(-3), { ...t, id }]);
    window.setTimeout(() => dismiss(id), t.tone === "bad" ? 8000 : 4500);
  }, [dismiss]);
  const api = React.useMemo<ToastApi>(() => ({
    show,
    success: (title, body) => show({ tone: "ok", title, body }),
    info: (title, body) => show({ tone: "info", title, body }),
    error: (e, fallback = "Something went wrong") => show({ tone: "bad", title: e instanceof ApiError ? e.message : fallback }),
  }), [show]);
  const icon = { ok: CheckCircle2, bad: XCircle, info: Info };
  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-6" aria-live="polite" aria-atomic="false">
        {items.map((t) => {
          const Icon = icon[t.tone];
          return (
            <div key={t.id} role={t.tone === "bad" ? "alert" : "status"} className={cn("pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-md border bg-white p-3.5 shadow-pop animate-[pop-in_.18s_ease]", t.tone === "bad" ? "border-bad/40" : t.tone === "ok" ? "border-ok/40" : "border-line-strong")}>
              <Icon className={cn("mt-0.5 size-5 shrink-0", t.tone === "bad" ? "text-bad" : t.tone === "ok" ? "text-ok" : "text-info")} aria-hidden />
              <div className="min-w-0 flex-1 text-sm"><p className="font-semibold text-ink">{t.title}</p>{t.body && <p className="mt-0.5 text-ink-2">{t.body}</p>}</div>
              <button onClick={() => dismiss(t.id)} className="-m-1 rounded p-1 text-ink-3 hover:bg-paper-2" aria-label="Dismiss"><X className="size-4" aria-hidden /></button>
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}
