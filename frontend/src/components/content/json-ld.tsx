import { serializeJsonLd } from "@/lib/jsonld";

/** Structured data for search engines. The payload is JSON-escaped (`<`, `>`, `&`) so it can never break out of the script tag. */
export function JsonLd({ data }: { data: Record<string, unknown> | null | undefined }) {
  if (!data) return null;
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }} />;
}
