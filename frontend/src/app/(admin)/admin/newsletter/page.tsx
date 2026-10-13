import type { Metadata } from "next";
import { NewsletterAndMessages } from "@/components/admin/marketing/newsletter";
import { RequireCapability } from "@/components/admin/shell";

export const metadata: Metadata = { title: "Newsletter & messages" };

export default function NewsletterPage() {
  return <RequireCapability any={["content.manage"]}><NewsletterAndMessages /></RequireCapability>;
}
