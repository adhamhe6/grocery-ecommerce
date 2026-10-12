import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/account/auth-shell";
import { RegisterForm } from "@/components/account/register-form";
import { safeNextPath } from "@/lib/safe-next";

export const metadata: Metadata = { title: "Create an account", robots: { index: false, follow: false } };

type SP = Record<string, string | string[] | undefined>;

export default async function RegisterPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const next = safeNextPath(Array.isArray(sp.next) ? sp.next[0] : sp.next);
  return (
    <AuthShell
      title="Create an account"
      intro="With an account you can track orders, save delivery addresses and keep shopping lists."
      footer={
        <p>
          More about how we handle your details in our <Link href="/p/privacy" className="font-semibold text-primary underline-offset-4 hover:underline">privacy policy</Link> and{" "}
          <Link href="/p/terms" className="font-semibold text-primary underline-offset-4 hover:underline">terms</Link>.
        </p>
      }
    >
      <RegisterForm next={next} />
    </AuthShell>
  );
}
