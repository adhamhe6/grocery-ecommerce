import type { Metadata } from "next";
import { ReportsIndex } from "@/components/admin/reports/reports-index";

export const metadata: Metadata = { title: "Reports" };

export default function Page() {
  return <ReportsIndex />;
}
