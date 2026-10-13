import type { Metadata } from "next";
import { BranchesPage } from "@/components/admin/delivery/branches-page";

export const metadata: Metadata = { title: "Stores and zones" };

export default function BranchesRoute() {
  return <BranchesPage />;
}
