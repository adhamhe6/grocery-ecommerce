import { ButtonLink } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main id="main" className="container-x flex min-h-[70vh] flex-col items-center justify-center text-center">
      <p className="eyebrow">Error 404</p>
      <h1 className="mt-2 text-4xl">We couldn&apos;t find that page</h1>
      <p className="mt-3 max-w-md text-ink-2">The link may be old, or the product may have sold out and been removed. Try searching, or head back to the shop.</p>
      <div className="mt-6 flex gap-3"><ButtonLink href="/">Home</ButtonLink><ButtonLink href="/shop" variant="secondary">Shop all</ButtonLink></div>
    </main>
  );
}
