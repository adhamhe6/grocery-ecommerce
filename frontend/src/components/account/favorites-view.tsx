"use client";

import { Heart } from "lucide-react";
import { ProductGrid } from "@/components/product/product-card";
import { Button, ButtonLink } from "@/components/ui/button";
import { Alert, EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { useFavoriteProducts, useRemoveFavorites } from "@/lib/account-hooks";
import { pluralise } from "@/lib/format";

export function FavoritesView() {
  const q = useFavoriteProducts();
  const removeUnavailable = useRemoveFavorites();
  const toast = useToast();
  const products = q.data?.products ?? [];
  // `ids` lists every saved product; `products` only the ones that can be shown right now.
  const shown = new Set(products.map((p) => p.id));
  const hidden = q.data ? q.data.ids.filter((id) => !shown.has(id)) : [];

  return (
    <div>
      <h1 className="text-3xl sm:text-4xl">Your favourites</h1>
      <p className="mt-1 text-ink-2">Products you&apos;ve saved with the heart. Add them to your basket from here.</p>

      <div className="mt-6 space-y-6">
        {q.isLoading && (
          <ul className="grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-4 md:grid-cols-3 xl:grid-cols-4" aria-busy="true" aria-label="Loading your favourites">
            {Array.from({ length: 8 }, (_, i) => <li key={i}><Skeleton className="aspect-[3/4] w-full" /></li>)}
          </ul>
        )}
        {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} title="We couldn't load your favourites" />}

        {hidden.length > 0 && (
          <Alert tone="info" title={`${pluralise(hidden.length, "saved product")} can't be shown`}>
            <p>{hidden.length === 1 ? "It isn't" : "They aren't"} available to view right now.</p>
            <Button
              className="mt-3"
              size="sm"
              variant="secondary"
              loading={removeUnavailable.isPending}
              onClick={() => removeUnavailable.mutate(hidden, { onSuccess: () => toast.success("Removed from your favourites"), onError: (e) => toast.error(e) })}
            >
              Remove {hidden.length === 1 ? "it" : "them"} from favourites
            </Button>
          </Alert>
        )}

        {q.data && q.data.ids.length === 0 && (
          <EmptyState icon={<Heart className="size-6" aria-hidden />} title="No favourites yet" action={<ButtonLink href="/shop">Browse the shop</ButtonLink>}>
            Tap the heart on any product to save it here for next time.
          </EmptyState>
        )}

        {products.length > 0 && (
          <>
            <p className="num text-sm text-ink-2" role="status">{pluralise(products.length, "saved product")}</p>
            <ProductGrid products={products} className="xl:grid-cols-4" />
          </>
        )}
      </div>
    </div>
  );
}
