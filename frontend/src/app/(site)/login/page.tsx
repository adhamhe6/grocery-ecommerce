import type { Metadata } from "next";
import { AuthShell } from "@/components/account/auth-shell";
import { LoginForm } from "@/components/account/login-form";
import { safeNextPath } from "@/lib/safe-next";

export const metadata: Metadata = { title: "Sign in", robots: { index: false, follow: false } };

type SP = Record<string, string | string[] | undefined>;

export default async function LoginPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  // Only a same-site path survives; anything else (absolute URLs, //host, javascript:) falls back to /account.
  const next = safeNextPath(Array.isArray(sp.next) ? sp.next[0] : sp.next);
  return (
    <AuthShell title="Sign in" intro="Sign in to track your orders, order your usual things again and use your saved lists.">
      <LoginForm next={next} />
    </AuthShell>
  );
}
