import type { Metadata } from "next";
import { Reviews } from "@/components/admin/catalog/reviews";
import { RequireCapability } from "@/components/admin/shell";

export const metadata: Metadata = { title: "Reviews" };

export default function ReviewsPage() {
  return <RequireCapability any={["content.manage"]}><Reviews /></RequireCapability>;
}
