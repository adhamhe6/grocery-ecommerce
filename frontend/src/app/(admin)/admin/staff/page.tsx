import type { Metadata } from "next";
import { StaffPage } from "@/components/admin/staff/staff-page";

export const metadata: Metadata = { title: "Staff & roles" };

export default function Page() {
  return <StaffPage />;
}
