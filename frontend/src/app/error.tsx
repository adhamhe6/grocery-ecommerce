"use client";

import { Button } from "@/components/ui/button";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="main" className="container-x flex min-h-[70vh] flex-col items-center justify-center text-center">
      <p className="eyebrow">Something went wrong</p>
      <h1 className="mt-2 text-4xl">That didn&apos;t load</h1>
      <p className="mt-3 max-w-md text-ink-2">Your basket and any order you&apos;ve placed are safe. Please try again in a moment.</p>
      {error.digest && <p className="mt-2 text-xs text-ink-3">Reference: {error.digest}</p>}
      <Button className="mt-6" onClick={reset}>Try again</Button>
    </main>
  );
}
