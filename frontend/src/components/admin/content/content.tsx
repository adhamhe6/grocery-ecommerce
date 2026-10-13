"use client";

import { AdminPage } from "@/components/admin/kit";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTabParam } from "../catalog/form-kit";
import { ArticlesTab } from "./articles-tab";
import { BannersTab } from "./banners-tab";
import { FaqsTab } from "./faqs-tab";
import { PagesTab } from "./pages-tab";

export function ContentManager() {
  const [tab, setTab] = useTabParam(["banners", "pages", "articles", "faqs"], "banners");
  return (
    <AdminPage title="Banners & pages" description="The words and pictures on the shop: home page banners, policy pages, recipes and guides, and frequently asked questions. Text is written in Markdown and previewed with the shop's own renderer.">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="Content types">
          <TabsTrigger value="banners">Banners</TabsTrigger>
          <TabsTrigger value="pages">Pages</TabsTrigger>
          <TabsTrigger value="articles">Articles &amp; recipes</TabsTrigger>
          <TabsTrigger value="faqs">FAQs</TabsTrigger>
        </TabsList>
        <TabsContent value="banners"><BannersTab /></TabsContent>
        <TabsContent value="pages"><PagesTab /></TabsContent>
        <TabsContent value="articles"><ArticlesTab /></TabsContent>
        <TabsContent value="faqs"><FaqsTab /></TabsContent>
      </Tabs>
    </AdminPage>
  );
}
