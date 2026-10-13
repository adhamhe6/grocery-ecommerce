"use client";

import * as React from "react";
import { CartDrawerProvider, QueryProvider, StoreProvider } from "@/lib/hooks";
import { ToastProvider } from "@/components/ui/toast";
import type { StoreConfig } from "@/lib/types";

export function Providers({ store, children }: { store: StoreConfig; children: React.ReactNode }) {
  return (
    <StoreProvider store={store}>
      <QueryProvider>
        <ToastProvider>
          <CartDrawerProvider>{children}</CartDrawerProvider>
        </ToastProvider>
      </QueryProvider>
    </StoreProvider>
  );
}
