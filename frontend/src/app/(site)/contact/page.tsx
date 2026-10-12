import { Clock, Mail, MapPin, Phone } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ContactForm } from "@/components/forms/contact-form";
import { Breadcrumbs, PageHeader } from "@/components/ui/section";
import { getStore } from "@/lib/server";

export const metadata: Metadata = {
  title: "Contact us",
  description: "Send us a message about an order, delivery, a product or anything else. We reply by email.",
  alternates: { canonical: "/contact" },
};

export default async function ContactPage() {
  const { contact } = await getStore();
  const details = [
    contact.email && { icon: Mail, label: "Email", node: <a href={`mailto:${contact.email}`} className="break-all hover:underline">{contact.email}</a> },
    contact.phone && { icon: Phone, label: "Phone", node: <a href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`} className="hover:underline">{contact.phone}</a> },
    contact.hours && { icon: Clock, label: "Hours", node: <span>{contact.hours}</span> },
    contact.address && { icon: MapPin, label: "Address", node: <span>{contact.address}</span> },
  ].filter(Boolean) as { icon: typeof Mail; label: string; node: React.ReactNode }[];

  return (
    <>
      <Breadcrumbs items={[{ name: "Home", href: "/" }, { name: "Contact us" }]} />
      <PageHeader title="Contact us" intro="Send us a message and we'll reply by email. For quick answers, the FAQs may already cover it." />
      <div className="container-x grid gap-10 py-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-14">
        <ContactForm />
        <aside aria-label="Other ways to reach us" className="space-y-6 text-sm">
          {details.length > 0 && (
            <div className="rounded-lg border border-line bg-white p-5">
              <h2 className="font-sans text-base font-bold text-ink">Other ways to reach us</h2>
              <ul className="mt-3 space-y-3 text-ink-2">
                {details.map(({ icon: Icon, label, node }) => (
                  <li key={label} className="flex gap-3"><Icon className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden /><span><span className="sr-only">{label}: </span>{node}</span></li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <h2 className="font-sans text-base font-bold text-ink">Quicker answers</h2>
            <ul className="mt-3 space-y-2 text-ink-2">
              <li><Link href="/faq" className="font-medium text-primary underline underline-offset-4">Frequently asked questions</Link></li>
              <li><Link href="/track" className="font-medium text-primary underline underline-offset-4">Track an order</Link></li>
              <li><Link href="/stores" className="font-medium text-primary underline underline-offset-4">Store addresses and opening hours</Link></li>
            </ul>
          </div>
        </aside>
      </div>
    </>
  );
}
