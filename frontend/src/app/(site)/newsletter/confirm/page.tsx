import type { Metadata } from "next";
import Link from "next/link";
import { TokenAction } from "@/components/forms/token-action";
import { Alert } from "@/components/ui/states";
import { PageHeader } from "@/components/ui/section";
import { ButtonLink } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Confirm your subscription",
  robots: { index: false, follow: false },
  referrer: "no-referrer", // the link carries a private token
};

export default async function ConfirmSubscriptionPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const token = (Array.isArray(sp.token) ? sp.token[0] : sp.token)?.trim();

  return (
    <>
      <PageHeader title="Confirm your subscription" intro="One last step before we start sending our newsletter." />
      <div className="container-x py-8"><div className="max-w-2xl">
        {token ? (
          <div className="space-y-4">
            <p className="text-ink-2">Press the button to confirm that you want to receive our newsletter at the email address this link was sent to.</p>
            <TokenAction endpoint="/newsletter/confirm/" token={token} label="Confirm subscription" after={<Link href="/shop" className="font-semibold text-primary underline underline-offset-4">Start shopping</Link>} />
          </div>
        ) : (
          <Alert tone="warn" title="This link is incomplete">
            <p>It&apos;s missing the code from your confirmation email. Open the link in that email again, or subscribe again from the form at the bottom of any page to get a new one.</p>
            <ButtonLink href="/" variant="secondary" className="mt-3">Back to the shop</ButtonLink>
          </Alert>
        )}
      </div></div>
    </>
  );
}
