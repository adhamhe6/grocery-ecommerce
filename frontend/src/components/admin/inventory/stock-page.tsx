"use client";

import * as React from "react";
import { AdminPage } from "@/components/admin/kit";
import { RequireCapability } from "@/components/admin/shell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MovementLedger } from "./movement-ledger";
import { StockLevels } from "./stock-levels";

/** Stock levels and the movement ledger. `low` comes from the dashboard's “Low-stock lines” link (?low=1). */
export function StockPage({ low }: { low: boolean }) {
  const [tab, setTab] = React.useState("levels");
  return (
    <RequireCapability any={["inventory.read"]}>
      <AdminPage title="Stock" description="How much of each product is on hand, reserved for orders and available to sell, store by store. Adjust counts, write off waste and move stock between stores.">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList aria-label="Stock views">
            <TabsTrigger value="levels">Stock levels</TabsTrigger>
            <TabsTrigger value="ledger">Movement ledger</TabsTrigger>
          </TabsList>
          <TabsContent value="levels"><StockLevels initialLow={low} /></TabsContent>
          <TabsContent value="ledger"><MovementLedger /></TabsContent>
        </Tabs>
      </AdminPage>
    </RequireCapability>
  );
}
