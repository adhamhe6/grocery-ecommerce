"use client";

import * as React from "react";
import { AdminPage } from "@/components/admin/kit";
import { RequireCapability } from "@/components/admin/shell";
import { ErrorState, Skeleton } from "@/components/ui/states";
import { useAdminGet } from "@/lib/admin";
import { SettingsFormView } from "./settings-form";
import type { StoreSettingsData } from "./settings-model";

export function SettingsPage() {
  return (
    <RequireCapability any={["settings.manage"]}>
      <SettingsInner />
    </RequireCapability>
  );
}

function SettingsInner() {
  const q = useAdminGet<StoreSettingsData>("/settings/");
  return (
    <AdminPage title="Store settings" description="Everything the business can change without a developer: how the store looks, how it can be contacted, the order rules and the payment methods on offer. Every change is recorded in the audit log, and the storefront picks it up within about a minute.">
      {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} title="We couldn't load the store settings" />
        : !q.data ? <div className="space-y-4" aria-busy="true" aria-label="Loading settings">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-48 w-full" />)}</div>
        : <SettingsFormView latest={q.data} />}
    </AdminPage>
  );
}
