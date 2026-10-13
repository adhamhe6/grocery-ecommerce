"use client";

import { Sparkles } from "lucide-react";
import * as React from "react";
import { StoreSelect, useWorkingBranch } from "@/components/admin/inventory/form-kit";
import { AdminPage } from "@/components/admin/kit";
import { RequireCapability } from "@/components/admin/shell";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GenerateDialog } from "./generate-dialog";
import { SlotCalendar } from "./slot-calendar";
import { TemplatesTab } from "./templates-tab";

export function SlotsPage() {
  return <RequireCapability any={["slots.manage"]}><SlotsPageInner /></RequireCapability>;
}

function SlotsPageInner() {
  const [branchId, setBranchId] = useWorkingBranch();
  const [tab, setTab] = React.useState("templates");
  const [generating, setGenerating] = React.useState(false);
  return (
    <AdminPage title="Delivery slots" description="Set the weekly pattern of delivery and pickup windows, turn it into bookable slots, and open or close individual slots."
      actions={
        <>
          <StoreSelect id="slots-store" value={branchId} onChange={setBranchId} />
          <Button disabled={!branchId} onClick={() => setGenerating(true)}><Sparkles className="size-4" aria-hidden /> Generate slots</Button>
        </>
      }>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="Slot views">
          <TabsTrigger value="templates">Slot templates</TabsTrigger>
          <TabsTrigger value="slots">Generated slots</TabsTrigger>
        </TabsList>
        <TabsContent value="templates"><TemplatesTab branchId={branchId} /></TabsContent>
        <TabsContent value="slots"><SlotCalendar branchId={branchId} /></TabsContent>
      </Tabs>
      {generating && branchId && <GenerateDialog branchId={branchId} onClose={() => setGenerating(false)} />}
    </AdminPage>
  );
}
