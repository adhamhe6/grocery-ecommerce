import type { Metadata } from "next";
import { Promotions } from "@/components/admin/marketing/promotions";
import { RequireCapability } from "@/components/admin/shell";

export const metadata: Metadata = { title: "Promotions & coupons" };

export default function PromotionsPage() {
  return <RequireCapability any={["promotions.manage"]}><Promotions /></RequireCapability>;
}
