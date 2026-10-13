import type { Metadata } from "next";
import { PaymentsPage } from "@/components/admin/finance/payments-page";

export const metadata: Metadata = { title: "Payments & refunds" };

export default function Page() {
  return <PaymentsPage />;
}
