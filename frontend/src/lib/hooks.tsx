"use client";

import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { ApiError, apiDelete, apiGet, apiPatch, apiPost, apiPut } from "./api";
import type { CartData, StoreConfig, SubstitutionPolicy, User } from "./types";
import { useToast } from "@/components/ui/toast";

// ------------------------------------------------------------------ store config
const StoreCtx = React.createContext<StoreConfig | null>(null);
export const StoreProvider = ({ store, children }: { store: StoreConfig; children: React.ReactNode }) => <StoreCtx.Provider value={store}>{children}</StoreCtx.Provider>;
export function useStore(): StoreConfig {
  const v = React.useContext(StoreCtx);
  if (!v) throw new Error("useStore must be used inside <StoreProvider>");
  return v;
}
export function useMoney() {
  const s = useStore();
  return React.useCallback(
    (v: string | number | null | undefined) => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? "—" : new Intl.NumberFormat(s.locale, { style: "currency", currency: s.currency }).format(Number(v))),
    [s.locale, s.currency],
  );
}

// ------------------------------------------------------------------ query client
export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 20_000, refetchOnWindowFocus: true, retry: (n, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && n < 2 },
    },
  });
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(makeQueryClient);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

// ------------------------------------------------------------------ session
export function useMe() {
  return useQuery<User | null>({
    queryKey: ["me"],
    // /auth/session/ answers 200 with {user: null} for visitors, so anonymous page loads produce no failing requests.
    queryFn: async () => (await apiGet<{ user: User | null }>("/auth/session/")).user,
    staleTime: 60_000,
  });
}

export function useAuthActions() {
  const qc = useQueryClient();
  const afterAuth = (user: User | null) => {
    qc.setQueryData(["me"], user);
    qc.invalidateQueries({ queryKey: ["cart"] });
    qc.invalidateQueries({ queryKey: ["favorites"] });
    qc.invalidateQueries({ queryKey: ["orders"] });
  };
  const login = useMutation({ mutationFn: (b: { email: string; password: string }) => apiPost<User>("/auth/login/", b), onSuccess: afterAuth });
  const register = useMutation({ mutationFn: (b: { email: string; password: string; full_name: string; phone?: string; marketing_opt_in?: boolean }) => apiPost<User>("/auth/register/", b), onSuccess: afterAuth });
  const logout = useMutation({
    mutationFn: () => apiPost<void>("/auth/logout/"),
    onSuccess: () => {
      afterAuth(null);
      qc.clear();
      qc.setQueryData(["me"], null);
    },
  });
  return { login, register, logout };
}

export function hasCapability(user: User | null | undefined, cap: string) {
  return !!user && user.capabilities.includes(cap);
}

// ------------------------------------------------------------------ cart
const EMPTY_CART: CartData = { item_count: 0, substitution_policy: "ALLOW", branch_id: null, lines: [], coupon: null, totals: { subtotal: "0.00", promo_savings: "0.00", coupon_discount: "0.00", estimated_total: "0.00", has_estimated_lines: false }, notices: [], can_checkout: false };

export function useCart() {
  return useQuery<CartData>({ queryKey: ["cart"], queryFn: () => apiGet<CartData>("/cart/"), staleTime: 10_000, placeholderData: (prev) => prev });
}

export function useCartQuantities() {
  const { data } = useCart();
  return React.useMemo(() => new Map((data ?? EMPTY_CART).lines.map((l) => [l.product.id, Number(l.quantity)])), [data]);
}

export function useCartActions() {
  const qc = useQueryClient();
  const toast = useToast();
  const set = (cart: CartData) => qc.setQueryData(["cart"], cart);
  const onError = (e: unknown) => {
    toast.error(e);
    qc.invalidateQueries({ queryKey: ["cart"] });
  };
  return {
    add: useMutation({ mutationFn: (v: { productId: number; quantity: string | number }) => apiPost<CartData>("/cart/items/", { product_id: v.productId, quantity: String(v.quantity) }), onSuccess: set, onError }),
    setQuantity: useMutation({ mutationFn: (v: { productId: number; quantity: string | number }) => apiPatch<CartData>(`/cart/items/${v.productId}/`, { quantity: String(v.quantity) }), onSuccess: set, onError }),
    setPreference: useMutation({ mutationFn: (v: { productId: number; pref: "INHERIT" | "ALLOW" | "NONE" }) => apiPatch<CartData>(`/cart/items/${v.productId}/`, { substitution_pref: v.pref }), onSuccess: set, onError }),
    remove: useMutation({ mutationFn: (productId: number) => apiDelete<CartData>(`/cart/items/${productId}/`), onSuccess: set, onError }),
    clear: useMutation({ mutationFn: () => apiDelete<CartData>("/cart/"), onSuccess: set, onError }),
    applyCoupon: useMutation({ mutationFn: (code: string) => apiPost<CartData>("/cart/coupon/", { code }), onSuccess: set }),
    removeCoupon: useMutation({ mutationFn: () => apiDelete<CartData>("/cart/coupon/"), onSuccess: set, onError }),
    fix: useMutation({ mutationFn: () => apiPost<CartData>("/cart/fix/"), onSuccess: set, onError }),
    acknowledge: useMutation({ mutationFn: () => apiPost<CartData>("/cart/acknowledge/"), onSuccess: set, onError }),
    setPolicy: useMutation({ mutationFn: (p: SubstitutionPolicy) => apiPatch<CartData>("/cart/", { substitution_policy: p }), onSuccess: set, onError }),
    reorder: useMutation({ mutationFn: (number: string) => apiPost<CartData>(`/cart/reorder/${number}/`), onSuccess: set, onError }),
  };
}

// ------------------------------------------------------------------ cart drawer open state
const DrawerCtx = React.createContext<{ open: boolean; setOpen: (o: boolean) => void }>({ open: false, setOpen: () => {} });
export const useCartDrawer = () => React.useContext(DrawerCtx);
export function CartDrawerProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  return <DrawerCtx.Provider value={{ open, setOpen }}>{children}</DrawerCtx.Provider>;
}

// ------------------------------------------------------------------ favourites (account feature)
export function useFavorites() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery<{ ids: number[] }>({ queryKey: ["favorites"], queryFn: () => apiGet<{ ids: number[]; products: unknown[] }>("/favorites/"), enabled: !!me, staleTime: 60_000 });
  const ids = React.useMemo(() => new Set(q.data?.ids ?? []), [q.data]);
  const toggle = useMutation({
    mutationFn: async ({ id, on }: { id: number; on: boolean }) => (on ? apiPost<{ ids: number[] }>("/favorites/", { product_id: id }) : apiDelete<void>(`/favorites/${id}/`)),
    onMutate: async ({ id, on }) => {
      await qc.cancelQueries({ queryKey: ["favorites"] });
      const prev = qc.getQueryData<{ ids: number[] }>(["favorites"]);
      qc.setQueryData(["favorites"], { ids: on ? [...(prev?.ids ?? []), id] : (prev?.ids ?? []).filter((x) => x !== id) });
      return { prev };
    },
    onError: (e, _v, ctx) => {
      qc.setQueryData(["favorites"], ctx?.prev);
      toast.error(e);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["favorites"] }),
  });
  return { signedIn: !!me, ids, isFavorite: (id: number) => ids.has(id), toggle: (id: number) => toggle.mutate({ id, on: !ids.has(id) }) };
}

// ------------------------------------------------------------------ comparison (localStorage for everyone, mirrored to the account when signed in)
const KEY = "orchardrow.compare";
export const MAX_COMPARE = 4;
const listeners = new Set<() => void>();
const readIds = (): number[] => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]").filter((x: unknown) => Number.isInteger(x)).slice(0, MAX_COMPARE);
  } catch {
    return [];
  }
};
const EMPTY: number[] = [];
let snapshot: number[] = EMPTY;
let hydrated = false;
function emit(next: number[]) {
  snapshot = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {}
  listeners.forEach((l) => l());
}

export function useCompare() {
  const { data: me } = useMe();
  const ids = React.useSyncExternalStore(
    (cb) => {
      if (!hydrated) {
        hydrated = true;
        snapshot = readIds();
      }
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => snapshot,
    () => EMPTY,
  );
  // Mirror to the account (best effort) so the list follows the customer across devices.
  const synced = React.useRef<string>("");
  React.useEffect(() => {
    if (!me) return;
    const key = ids.join(",");
    if (synced.current === key) return;
    synced.current = key;
    apiPut("/account/comparison/", { ids }).catch(() => {});
  }, [ids, me]);
  const toast = useToast();
  return {
    ids,
    has: (id: number) => ids.includes(id),
    toggle: (id: number) => {
      if (ids.includes(id)) return emit(ids.filter((x) => x !== id));
      if (ids.length >= MAX_COMPARE) return toast.info(`You can compare up to ${MAX_COMPARE} products`, "Remove one to add another.");
      emit([...ids, id]);
    },
    remove: (id: number) => emit(ids.filter((x) => x !== id)),
    clear: () => emit([]),
  };
}
