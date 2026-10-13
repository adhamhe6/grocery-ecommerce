"use client";

import { AdminPage } from "@/components/admin/kit";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BrandsTab } from "./brands-tab";
import { CategoriesTab } from "./categories-tab";
import { CollectionsTab } from "./collections-tab";
import { useTabParam } from "./form-kit";
import { AllergensTab, UnitsTab } from "./lookups-tab";

const TABS = ["categories", "brands", "collections", "units", "allergens"];

export function Taxonomy() {
  const [tab, setTab] = useTabParam(TABS, "categories");
  return (
    <AdminPage title="Categories & brands" description="How the catalogue is organised: the category tree, brands, hand-picked collections, and the reference lists products draw from.">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="Catalogue organisation">
          <TabsTrigger value="categories">Categories</TabsTrigger>
          <TabsTrigger value="brands">Brands</TabsTrigger>
          <TabsTrigger value="collections">Collections</TabsTrigger>
          <TabsTrigger value="units">Units</TabsTrigger>
          <TabsTrigger value="allergens">Allergens</TabsTrigger>
        </TabsList>
        <TabsContent value="categories"><CategoriesTab /></TabsContent>
        <TabsContent value="brands"><BrandsTab /></TabsContent>
        <TabsContent value="collections"><CollectionsTab /></TabsContent>
        <TabsContent value="units"><UnitsTab /></TabsContent>
        <TabsContent value="allergens"><AllergensTab /></TabsContent>
      </Tabs>
    </AdminPage>
  );
}
