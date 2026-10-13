import type { Metadata } from "next";
import { SlotsPage } from "@/components/admin/delivery/slots-page";

export const metadata: Metadata = { title: "Delivery slots" };

export default function SlotsRoute() {
  return <SlotsPage />;
}
