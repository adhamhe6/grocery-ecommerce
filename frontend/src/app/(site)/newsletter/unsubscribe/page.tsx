import type { Metadata } from "next";
import Link from "next/link";
import { TokenAction } from "@/components/forms/token-action";
import { Alert } from "@/components/ui/states";
import { PageHeader } from "@/components/ui/section";
import { ButtonLink } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Unsubscribe from our newsletter",
  robots: { index: false, follow: false },
  referrer: "no-referrer", // the link carries a private token
};

export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const token = (Array.isArray(sp.token) ? sp.token[0] : sp.token)?.trim();

  return (
    <>
      <PageHeader title="Unsubscribe from our newsletter" />
      <div className="container-x py-8"><div className="max-w-2xl">
        {token ? (
          <div className="space-y-4">
            <p className="text-ink-2">Press the button to stop receiving our newsletter at the email address this link was sent to. Emails about orders you place are separate and aren&apos;t affected.</p>
            <TokenAction
              endpoint="/newsletter/unsubscribe/" token={token} label="Unsubscribe me" variant="secondary"
              after={<>Changed your mind? You can subscribe again from the form at the bottom of any page. <Link href="/" className="font-semibold text-primary underline underline-offset-4">Back to the shop</Link></>}
            />
          </div>
        ) : (
          <Alert tone="warn" title="This link is incomplete">
            <p>It&apos;s missing the code that identifies your subscription. Try opening the full link from the email again. If that doesn&apos;t work, contact us.</p>
            <ButtonLink href="/contact" variant="secondary" className="mt-3">Contact us</ButtonLink>
          </Alert>
        )}
      </div></div>
    </>
  );
}
