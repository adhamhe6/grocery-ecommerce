"use client";

import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import type { CompareResponse, FavoritesResponse, ShoppingList } from "./account-types";
import type { DetailState } from "./compare";
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "./api";
import type { Address, CartData, OrderSummary, Paginated, ProductCardData, ProductDetailData, User } from "./types";

// ------------------------------------------------------------------ profile & password
export function useProfileUpdate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { full_name: string; phone: string; marketing_opt_in: boolean; notify_order_emails: boolean }) => apiPatch<User>("/account/me/", b),
    onSuccess: (user) => qc.setQueryData(["me"], user),
  });
}

export function useChangePassword() {
  return useMutation({ mutationFn: (b: { current_password: string; new_password: string }) => apiPost<void>("/account/password/", b) });
}

// ------------------------------------------------------------------ password reset (public)
export function usePasswordResetRequest() {
  return useMutation({ mutationFn: (email: string) => apiPost<{ detail: string }>("/auth/password-reset/", { email }) });
}

export function usePasswordResetConfirm() {
  return useMutation({ mutationFn: (b: { uid: string; token: string; new_password: string }) => apiPost<void>("/auth/password-reset/confirm/", b) });
}

// ------------------------------------------------------------------ addresses
export type AddressInput = Omit<Address, "id">;

export function useAddresses() {
  return useQuery<Address[]>({ queryKey: ["addresses"], queryFn: () => apiGet<Address[]>("/addresses/") });
}

export function useAddressActions() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["addresses"] });
  return {
    create: useMutation({ mutationFn: (b: AddressInput) => apiPost<Address>("/addresses/", b), onSuccess: refresh }),
    update: useMutation({ mutationFn: ({ id, ...b }: AddressInput & { id: number }) => apiPatch<Address>(`/addresses/${id}/`, b), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (id: number) => apiDelete<void>(`/addresses/${id}/`), onSuccess: refresh }),
    makeDefault: useMutation({ mutationFn: (id: number) => apiPost<Address>(`/addresses/${id}/make-default/`), onSuccess: refresh }),
  };
}

// ------------------------------------------------------------------ orders
export function useOrders(page: number) {
  return useQuery<Paginated<OrderSummary>>({
    queryKey: ["orders", "list", page],
    queryFn: () => apiGet<Paginated<OrderSummary>>("/orders/", { page }),
    placeholderData: keepPreviousData,
  });
}

// ------------------------------------------------------------------ favourites
// `useFavorites()` (hooks.tsx) keeps ["favorites"] as a bare { ids } object for optimistic updates, so the product grid
// lives under its own key. invalidateQueries({ queryKey: ["favorites"] }) still refreshes both.
export function useFavoriteProducts() {
  return useQuery<FavoritesResponse>({ queryKey: ["favorites", "products"], queryFn: () => apiGet<FavoritesResponse>("/favorites/") });
}

export function useRemoveFavorites() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) => Promise.all(ids.map((id) => apiDelete<void>(`/favorites/${id}/`))),
    onSettled: () => qc.invalidateQueries({ queryKey: ["favorites"] }),
  });
}

// ------------------------------------------------------------------ shopping lists
export function useShoppingLists() {
  return useQuery<ShoppingList[]>({ queryKey: ["lists"], queryFn: () => apiGet<ShoppingList[]>("/lists/") });
}

export function useListActions() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["lists"] });
  const replace = (list: ShoppingList) => qc.setQueryData<ShoppingList[]>(["lists"], (old) => (old ? old.map((l) => (l.id === list.id ? list : l)) : [list]));
  return {
    create: useMutation({ mutationFn: (name: string) => apiPost<ShoppingList>("/lists/", { name }), onSuccess: refresh }),
    rename: useMutation({ mutationFn: (v: { id: number; name: string }) => apiPatch<ShoppingList>(`/lists/${v.id}/`, { name: v.name }), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (id: number) => apiDelete<void>(`/lists/${id}/`), onSuccess: refresh }),
    setItem: useMutation({ mutationFn: (v: { listId: number; productId: number; quantity: string }) => apiPut<ShoppingList>(`/lists/${v.listId}/items/${v.productId}/`, { quantity: v.quantity }), onSuccess: replace }),
    removeItem: useMutation({ mutationFn: (v: { listId: number; productId: number }) => apiDelete<void>(`/lists/${v.listId}/items/${v.productId}/`), onSuccess: refresh }),
    addToCart: useMutation({ mutationFn: (id: number) => apiPost<CartData>(`/lists/${id}/add-to-cart/`), onSuccess: (cart) => qc.setQueryData(["cart"], cart) }),
  };
}

/** Debounced catalogue search used to pick products for a list. */
export function useProductSearch(term: string) {
  const [debounced, setDebounced] = React.useState(term.trim());
  React.useEffect(() => {
    const t = window.setTimeout(() => setDebounced(term.trim()), 250);
    return () => window.clearTimeout(t);
  }, [term]);
  const query = useQuery<Paginated<ProductCardData>>({
    queryKey: ["product-search", debounced],
    queryFn: () => apiGet<Paginated<ProductCardData>>("/products/", { q: debounced, page_size: 6 }),
    enabled: debounced.length >= 2,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
  return { ...query, term: debounced, settled: debounced === term.trim() };
}

// ------------------------------------------------------------------ comparison
export function useComparison(ids: number[], enabled: boolean) {
  return useQuery<CompareResponse>({
    queryKey: ["compare", ids.join(",")],
    queryFn: () => apiGet<CompareResponse>("/compare/", { ids: ids.join(",") }),
    enabled: enabled && ids.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

/** Product details (allergens, full nutrition, storage) for the products being compared. */
export function useCompareDetails(slugs: string[]): Record<string, DetailState> {
  const results = useQueries({
    queries: slugs.map((slug) => ({
      queryKey: ["product-detail", slug],
      queryFn: () => apiGet<ProductDetailData>(`/products/${slug}/`),
      staleTime: 60_000,
    })),
  });
  const out: Record<string, DetailState> = {};
  slugs.forEach((slug, i) => {
    const r = results[i];
    out[slug] = r?.data ? { status: "ok", data: r.data } : r?.isError ? { status: "error" } : { status: "loading" };
  });
  return out;
}
