import type { Metadata } from "next";
import { AuthShell } from "@/components/account/auth-shell";
import { ResetPasswordForm } from "@/components/account/reset-password-form";

// The reset email links here (backend/apps/accounts/tasks.py: /account/reset-password?uid=…&token=…).
// This page sits outside the signed-in account layout on purpose: someone who forgot their password isn't signed in.
// The token is a secret, so keep the page out of search engines and don't send it onward in a Referer header.
export const metadata: Metadata = { title: "Choose a new password", robots: { index: false, follow: false }, referrer: "no-referrer" };

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || null;

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  return (
    <AuthShell title="Choose a new password" intro="Pick a password you don't use anywhere else.">
      <ResetPasswordForm uid={first(sp.uid)} token={first(sp.token)} />
    </AuthShell>
  );
}
