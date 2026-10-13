import type { Metadata } from "next";
import { ContentManager } from "@/components/admin/content/content";
import { RequireCapability } from "@/components/admin/shell";

export const metadata: Metadata = { title: "Banners & pages" };

export default function ContentPage() {
  return <RequireCapability any={["content.manage"]}><ContentManager /></RequireCapability>;
}
