import type { Metadata } from "next";
import { Taxonomy } from "@/components/admin/catalog/taxonomy";
import { RequireCapability } from "@/components/admin/shell";

export const metadata: Metadata = { title: "Categories & brands" };

export default function TaxonomyPage() {
  return <RequireCapability any={["catalog.write", "catalog.merchandise"]}><Taxonomy /></RequireCapability>;
}
