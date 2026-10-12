import Link from "next/link";
import { Logo } from "./logo";
import { Newsletter } from "./newsletter";
import type { StoreConfig } from "@/lib/types";

const COLUMNS: { title: string; links: [string, string][] }[] = [
  { title: "Shop", links: [["All products", "/shop"], ["Offers", "/offers"], ["New in", "/new"], ["Recipes & guides", "/guides"]] },
  { title: "Help", links: [["Delivery & collection", "/p/delivery"], ["Substitutions & weights", "/p/substitutions"], ["Returns & refunds", "/p/returns"], ["FAQs", "/faq"], ["Track an order", "/track"], ["Contact us", "/contact"]] },
  { title: "Company", links: [["Our stores", "/stores"], ["About Orchard Row", "/p/about"], ["Privacy", "/p/privacy"], ["Terms", "/p/terms"], ["Accessibility", "/p/accessibility"]] },
];

const SOCIAL_LABEL: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", x: "X", youtube: "YouTube", tiktok: "TikTok" };

export function SiteFooter({ store }: { store: StoreConfig }) {
  // Social links are only rendered when the owner has configured real ones — never placeholder URLs.
  const socials = store.socials_are_placeholders ? [] : Object.entries(store.socials).filter(([, url]) => !!url);
  return (
    <footer className="mt-20 border-t border-line bg-paper-2">
      <div className="container-x grid gap-10 py-12 md:grid-cols-[1.3fr_repeat(3,1fr)]">
        <div>
          <Logo name={store.name} logoUrl={store.logo} />
          <p className="mt-3 max-w-xs text-sm text-ink-2">{store.tagline}</p>
          <address className="mt-4 text-sm not-italic text-ink-2">
            {store.contact.address && <p>{store.contact.address}</p>}
            {store.contact.hours && <p className="mt-1">{store.contact.hours}</p>}
            {store.contact.phone && <p className="mt-1"><a className="hover:underline" href={`tel:${store.contact.phone.replace(/[^\d+]/g, "")}`}>{store.contact.phone}</a></p>}
            {store.contact.email && <p><a className="hover:underline" href={`mailto:${store.contact.email}`}>{store.contact.email}</a></p>}
          </address>
          <Newsletter />
        </div>
        {COLUMNS.map((c) => (
          <nav key={c.title} aria-label={c.title}>
            <h2 className="font-sans text-sm font-bold uppercase tracking-wider text-ink">{c.title}</h2>
            <ul className="mt-3 space-y-2">
              {c.links.map(([label, href]) => <li key={href}><Link href={href} className="text-sm text-ink-2 hover:text-primary hover:underline">{label}</Link></li>)}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-line">
        <div className="container-x flex flex-col gap-2 py-5 text-sm text-ink-3 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} {store.name}. {store.demo_mode && "Demonstration store — products, prices and stock are sample data."}</p>
          {socials.length > 0 && (
            <ul className="flex gap-4">
              {socials.map(([k, url]) => <li key={k}><a href={url} rel="noopener noreferrer" target="_blank" className="hover:text-primary hover:underline">{SOCIAL_LABEL[k] ?? k}</a></li>)}
            </ul>
          )}
        </div>
      </div>
    </footer>
  );
}
