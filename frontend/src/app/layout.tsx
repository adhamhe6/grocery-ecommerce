import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";
import { getStore, SITE_URL } from "@/lib/server";

// Every page reads live store configuration and the shopper's store cookie, so nothing is prerendered at build time
// (the build therefore needs no running backend). Upstream fetches are still cached per `revalidate` in lib/server.ts.
export const dynamic = "force-dynamic";

const HEX = /^#[0-9a-fA-F]{6}$/;

export async function generateMetadata(): Promise<Metadata> {
  const store = await getStore().catch(() => null);
  const name = store?.name ?? "Orchard Row";
  return {
    metadataBase: new URL(SITE_URL),
    title: { default: `${name} — ${store?.tagline ?? "Fresh, honestly labelled."}`, template: `%s · ${name}` },
    description: "Fresh groceries with honest labelling: clear weights and prices, real substitutions policy, and delivery slots that hold.",
    openGraph: { siteName: name, type: "website", locale: "en_US" },
    robots: store?.demo_mode ? { index: false, follow: false } : undefined, // a demo catalogue must not be indexed
  };
}

export const viewport: Viewport = { themeColor: "#1f3d2b", width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const store = await getStore();
  // Brand colours are owner-editable; only well-formed hex values ever reach the stylesheet.
  const vars: Record<string, string> = {};
  if (HEX.test(store.brand.primary)) vars["--brand-primary"] = store.brand.primary;
  if (HEX.test(store.brand.accent)) vars["--brand-accent"] = store.brand.accent;
  return (
    <html lang="en" style={vars}>
      <body>
        <Providers store={store}>{children}</Providers>
      </body>
    </html>
  );
}
