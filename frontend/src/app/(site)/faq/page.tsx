import { ChevronDown } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "@/components/content/json-ld";
import { RichText } from "@/components/content/rich-text";
import { ButtonLink } from "@/components/ui/button";
import { Breadcrumbs, PageHeader } from "@/components/ui/section";
import { EmptyState } from "@/components/ui/states";
import { groupFaqs } from "@/lib/content";
import { faqJsonLd } from "@/lib/jsonld";
import { serverGet } from "@/lib/server";
import type { FaqRow } from "@/lib/types";

const loadFaqs = () => serverGet<FaqRow[]>("/faqs/", undefined, { revalidate: 120, tags: ["faqs"] });

export async function generateMetadata(): Promise<Metadata> {
  // The description is built from the topics that are actually published.
  const topics = groupFaqs(await loadFaqs()).map((g) => g.topic.toLowerCase()).slice(0, 6);
  return { title: "Frequently asked questions", ...(topics.length ? { description: `Topics covered: ${topics.join(", ")}.` } : {}), alternates: { canonical: "/faq" } };
}

export default async function FaqPage() {
  const rows = await loadFaqs();
  const groups = groupFaqs(rows);

  return (
    <>
      <JsonLd data={faqJsonLd(rows)} />
      <Breadcrumbs items={[{ name: "Home", href: "/" }, { name: "FAQs" }]} />
      <PageHeader title="Frequently asked questions" intro="Quick answers to common questions." />
      {groups.length === 0 ? (
        <EmptyState title="No questions published yet" action={<ButtonLink href="/contact" variant="secondary">Contact us</ButtonLink>}>If you need help, send us a message and we&apos;ll reply by email.</EmptyState>
      ) : (
        <div className="container-x grid gap-8 py-8 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-12">
          <nav aria-label="FAQ topics" className="lg:sticky lg:top-24 lg:self-start">
            <h2 className="font-sans text-sm font-bold uppercase tracking-wider text-ink">Topics</h2>
            <ul className="mt-3 flex flex-wrap gap-2 lg:flex-col lg:gap-1">
              {groups.map((g) => (
                <li key={g.id}>
                  <a href={`#${g.id}`} className="inline-flex min-h-9 items-center rounded-full border border-line-strong bg-white px-3.5 py-1.5 text-sm font-medium hover:bg-paper-2 lg:rounded lg:border-0 lg:bg-transparent lg:px-2 lg:py-1.5">{g.topic}</a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="max-w-3xl space-y-10">
            {groups.map((g) => (
              <section key={g.id} id={g.id} aria-labelledby={`${g.id}-h`}>
                <h2 id={`${g.id}-h`} className="text-2xl">{g.topic}</h2>
                <div className="mt-3 divide-y divide-line border-y border-line">
                  {g.rows.map((r) => (
                    <details key={r.id} className="group">
                      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 py-3.5 font-semibold text-ink marker:hidden [&::-webkit-details-marker]:hidden">
                        <span>{r.question}</span>
                        <ChevronDown className="size-5 shrink-0 text-ink-3 transition-transform group-open:rotate-180" aria-hidden />
                      </summary>
                      <RichText source={r.answer} className="pb-5 pr-9" />
                    </details>
                  ))}
                </div>
              </section>
            ))}
            <p className="text-ink-2">Can&apos;t find your answer? <Link href="/contact" className="font-semibold text-primary underline underline-offset-4">Send us a message</Link>.</p>
          </div>
        </div>
      )}
    </>
  );
}
