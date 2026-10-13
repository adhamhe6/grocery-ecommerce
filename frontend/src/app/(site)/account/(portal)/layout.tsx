import type { Metadata } from "next";
import { AccountShell } from "@/components/account/account-shell";

// Personal pages: never indexed. The shell redirects visitors who aren't signed in to /login?next=…
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return <AccountShell>{children}</AccountShell>;
}
