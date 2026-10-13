"use client";

import * as React from "react";
import { AdminPage } from "@/components/admin/kit";
import { RequireCapability } from "@/components/admin/shell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HoursClosuresTab } from "./hours-closures-tab";
import { StoresTab } from "./stores-tab";
import { ZonesTab } from "./zones-tab";

export function BranchesPage() {
  const [tab, setTab] = React.useState("stores");
  return (
    <RequireCapability any={["branches.manage", "slots.manage"]}>
      <AdminPage title="Stores and delivery zones" description="Where customers can order from, when each store is open and which areas it delivers to.">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList aria-label="Store settings">
            <TabsTrigger value="stores">Stores</TabsTrigger>
            <TabsTrigger value="hours">Opening hours &amp; closures</TabsTrigger>
            <TabsTrigger value="zones">Delivery zones</TabsTrigger>
          </TabsList>
          <TabsContent value="stores"><StoresTab /></TabsContent>
          <TabsContent value="hours"><HoursClosuresTab /></TabsContent>
          <TabsContent value="zones"><ZonesTab /></TabsContent>
        </Tabs>
      </AdminPage>
    </RequireCapability>
  );
}
