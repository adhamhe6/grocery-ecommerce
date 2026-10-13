import type { Metadata } from "next";
import Link from "next/link";
import { TrackForm } from "@/components/forms/track-form";
import { Breadcrumbs, PageHeader } from "@/components/ui/section";

export const metadata: Metadata = {
  title: "Track an order",
  description: "Look up an order with its order number and the email address used at checkout.",
  robots: { index: false, follow: true },
};

export default function TrackPage() {
  return (
    <>
      <Breadcrumbs items={[{ name: "Home", href: "/" }, { name: "Track an order" }]} />
      <PageHeader title="Track an order" intro="Enter your order number and the email address you used at checkout to see where your order is." />
      <div className="container-x grid gap-10 py-8 lg:grid-cols-[minmax(0,32rem)_1fr] lg:gap-16">
        <TrackForm />
        <aside aria-label="Other ways to find an order" className="max-w-md text-sm text-ink-2">
          <h2 className="font-sans text-base font-bold text-ink">Have an account?</h2>
          <p className="mt-2"><Link href="/login" className="font-medium text-primary underline underline-offset-4">Sign in</Link> to see all of your orders without typing these details.</p>
          <h2 className="mt-6 font-sans text-base font-bold text-ink">Can&apos;t find your order?</h2>
          <p className="mt-2">Check that the email matches the one on the order. If it still doesn&apos;t work, <Link href="/contact" className="font-medium text-primary underline underline-offset-4">contact us</Link> with the order number.</p>
        </aside>
      </div>
    </>
  );
}
