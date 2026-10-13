import { Clock, Mail, MapPin, Phone, ShoppingBag, Truck } from "lucide-react";
import type { Metadata } from "next";
import { DeliveryCheck } from "@/components/stores/delivery-check";
import { Badge } from "@/components/ui/badge";
import { Breadcrumbs, PageHeader } from "@/components/ui/section";
import { EmptyState } from "@/components/ui/states";
import { WEEKDAYS, formatTimeRange } from "@/lib/format";
import { getStore, serverGet } from "@/lib/server";
import type { Branch } from "@/lib/types";

export const metadata: Metadata = {
  title: "Our stores",
  description: "Store addresses, opening hours, collection details and a delivery postcode check.",
  alternates: { canonical: "/stores" },
};

const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;

function prepText(minutes: number) {
  if (minutes < 60) return `${minutes} minutes`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} ${h === 1 ? "hour" : "hours"}`;
}

function HoursTable({ branch, locale }: { branch: Branch; locale: string }) {
  const byDay = new Map(branch.hours.map((h) => [h.weekday, h]));
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">Opening hours for {branch.name}</caption>
      <thead className="sr-only"><tr><th scope="col">Day</th><th scope="col">Hours</th></tr></thead>
      <tbody>
        {WEEKDAYS.map((day, i) => {
          const h = byDay.get(i);
          const text = !h ? "Not listed" : h.is_closed ? "Closed" : h.opens && h.closes ? formatTimeRange(h.opens, h.closes, locale) : "Not listed";
          return (
            <tr key={day} className="border-b border-line last:border-0">
              <th scope="row" className="py-1.5 pr-4 text-left font-medium text-ink">{day}</th>
              <td className={`num py-1.5 text-right ${h && !h.is_closed && h.opens ? "text-ink-2" : "text-ink-3"}`}>{text}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function BranchCard({ branch, locale }: { branch: Branch; locale: string }) {
  return (
    <article aria-labelledby={`branch-${branch.id}`} className="rounded-lg border border-line bg-white p-5 shadow-card">
      <h2 id={`branch-${branch.id}`} className="text-2xl">{branch.name}</h2>
      <address className="mt-3 space-y-1.5 text-sm not-italic text-ink-2">
        <p className="flex gap-2"><MapPin className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden /><span><span className="sr-only">Address: </span>{branch.address}</span></p>
        {branch.phone && <p className="flex gap-2"><Phone className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden /><a href={telHref(branch.phone)} className="hover:underline"><span className="sr-only">Phone: </span>{branch.phone}</a></p>}
        {branch.email && <p className="flex gap-2"><Mail className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden /><a href={`mailto:${branch.email}`} className="break-all hover:underline"><span className="sr-only">Email: </span>{branch.email}</a></p>}
      </address>

      <ul className="mt-4 flex flex-wrap gap-2" aria-label="Services at this store">
        <li><Badge tone={branch.offers_delivery ? "ok" : "neutral"}><Truck className="size-3.5" aria-hidden />{branch.offers_delivery ? "Delivery available" : "No delivery from this store"}</Badge></li>
        <li><Badge tone={branch.offers_pickup ? "ok" : "neutral"}><ShoppingBag className="size-3.5" aria-hidden />{branch.offers_pickup ? "Collection available" : "No collection at this store"}</Badge></li>
      </ul>

      {branch.prep_minutes > 0 && (branch.offers_pickup || branch.offers_delivery) && (
        <p className="mt-3 text-sm text-ink-2">Allow at least {prepText(branch.prep_minutes)} between ordering and the start of your {branch.offers_delivery && branch.offers_pickup ? "delivery or collection" : branch.offers_delivery ? "delivery" : "collection"} slot.</p>
      )}
      {branch.offers_pickup && branch.pickup_instructions && (
        <div className="mt-4 rounded-md bg-paper-2 p-3.5 text-sm">
          <h3 className="font-sans text-sm font-bold text-ink">Collecting your order</h3>
          <p className="mt-1 text-ink-2">{branch.pickup_instructions}</p>
        </div>
      )}

      <h3 className="mt-5 flex items-center gap-2 font-sans text-sm font-bold uppercase tracking-wider text-ink"><Clock className="size-4 text-ink-3" aria-hidden /> Opening hours</h3>
      <div className="mt-2"><HoursTable branch={branch} locale={locale} /></div>
    </article>
  );
}

export default async function StoresPage() {
  const [branches, store] = await Promise.all([serverGet<Branch[]>("/branches/", undefined, { revalidate: 120, tags: ["branches"] }), getStore()]);
  return (
    <>
      <Breadcrumbs items={[{ name: "Home", href: "/" }, { name: "Our stores" }]} />
      <PageHeader title="Our stores" intro="Where to collect your order, when each store is open, and whether we deliver to you." />
      <div className="container-x grid gap-8 py-8 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        <div className="order-2 lg:order-1">
          {branches.length === 0 ? (
            <EmptyState title="No stores to show yet">Store details will appear here once they are published.</EmptyState>
          ) : (
            <ul className="grid gap-6 xl:grid-cols-2">
              {branches.map((b) => <li key={b.id}><BranchCard branch={b} locale={store.locale} /></li>)}
            </ul>
          )}
        </div>
        <div className="order-1 lg:sticky lg:top-24 lg:order-2"><DeliveryCheck /></div>
      </div>
    </>
  );
}
