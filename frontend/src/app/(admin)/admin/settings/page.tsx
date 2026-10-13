import type { Metadata } from "next";
import { SettingsPage } from "@/components/admin/settings/settings-page";

export const metadata: Metadata = { title: "Store settings" };

export default function Page() {
  return <SettingsPage />;
}
