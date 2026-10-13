"use client";

import { AdminPage } from "@/components/admin/kit";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTabParam } from "../catalog/form-kit";
import { CouponsTab } from "./coupons-tab";
import { PromotionsTab } from "./promotions-tab";

export function Promotions() {
  const [tab, setTab] = useTabParam(["promotions", "coupons"], "promotions");
  return (
    <AdminPage title="Promotions & coupons" description="Promotions change prices automatically between their start and end dates. Coupons are codes customers type at checkout.">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="Promotions and coupons">
          <TabsTrigger value="promotions">Promotions</TabsTrigger>
          <TabsTrigger value="coupons">Coupons</TabsTrigger>
        </TabsList>
        <TabsContent value="promotions"><PromotionsTab /></TabsContent>
        <TabsContent value="coupons"><CouponsTab /></TabsContent>
      </Tabs>
    </AdminPage>
  );
}
