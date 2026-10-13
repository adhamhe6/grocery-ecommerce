"use client";

import * as React from "react";
import { AdminPage } from "@/components/admin/kit";
import { RequireCapability } from "@/components/admin/shell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/states";
import { EventsTab } from "./events-tab";
import { PaymentsTab } from "./payments-tab";
import { ReconciliationTab } from "./reconciliation-tab";
import { RefundsTab } from "./refunds-tab";
import { FINANCE_URL_DEFAULTS, type FinanceUrl } from "./types";
import { useUrlState } from "./url-state";

const TABS = [
  ["payments", "Payments"],
  ["refunds", "Refunds"],
  ["events", "Provider events"],
  ["reconciliation", "Reconciliation"],
] as const;

export function PaymentsPage() {
  return (
    <RequireCapability any={["finance.read"]}>
      <React.Suspense fallback={<div className="space-y-4" aria-busy="true"><Skeleton className="h-10 w-64" /><Skeleton className="h-64 w-full" /></div>}>
        <PaymentsInner />
      </React.Suspense>
    </RequireCapability>
  );
}

function PaymentsInner() {
  const [s, set] = useUrlState<FinanceUrl>(FINANCE_URL_DEFAULTS);
  const tab = TABS.some(([k]) => k === s.tab) ? s.tab : "payments";
  return (
    <AdminPage title="Payments & refunds" description="What customers paid, what has been refunded, what the payment providers told us, and whether the day's money adds up.">
      <Tabs value={tab} onValueChange={(v) => set({ tab: v })}>
        <TabsList aria-label="Finance sections">
          {TABS.map(([key, label]) => <TabsTrigger key={key} value={key}>{label}</TabsTrigger>)}
        </TabsList>
        <TabsContent value="payments"><PaymentsTab s={s} set={set} /></TabsContent>
        <TabsContent value="refunds"><RefundsTab s={s} set={set} /></TabsContent>
        <TabsContent value="events"><EventsTab s={s} set={set} /></TabsContent>
        <TabsContent value="reconciliation"><ReconciliationTab s={s} set={set} /></TabsContent>
      </Tabs>
    </AdminPage>
  );
}
