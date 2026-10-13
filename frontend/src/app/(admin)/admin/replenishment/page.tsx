import type { Metadata } from "next";
import { Replenishment } from "@/components/admin/purchasing/replenishment";

export const metadata: Metadata = { title: "Replenishment" };

export default function ReplenishmentPage() {
  return <Replenishment />;
}
