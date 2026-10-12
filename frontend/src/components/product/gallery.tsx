"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import { imgSrc, imgSrcSet } from "@/lib/format";
import type { ImageSet } from "@/lib/types";

export function Gallery({ images, name }: { images: ImageSet[]; name: string }) {
  const [i, setI] = React.useState(0);
  if (!images.length) return <div className="tile-bg flex aspect-square w-full items-center justify-center rounded-lg border border-line text-ink-3">No image yet</div>;
  const cur = images[Math.min(i, images.length - 1)];
  return (
    <div>
      <div className="overflow-hidden rounded-lg border border-line bg-white">
        <img src={imgSrc(cur.urls, 1024)} srcSet={imgSrcSet(cur.urls)} sizes="(min-width:1024px) 560px, 92vw" alt={cur.alt || name} width={1024} height={1024} fetchPriority="high" className="tile-bg aspect-square w-full object-contain" />
      </div>
      {images.length > 1 && (
        <ul className="mt-3 flex gap-2 overflow-x-auto" aria-label={`${name} images`}>
          {images.map((im, n) => (
            <li key={n}>
              <button type="button" onClick={() => setI(n)} aria-label={`Show image ${n + 1} of ${images.length}`} aria-current={n === i} className={cn("overflow-hidden rounded-md border-2 bg-white", n === i ? "border-primary" : "border-line")}>
                <img src={imgSrc(im.urls, 320)} alt="" width={72} height={72} loading="lazy" className="tile-bg size-[4.5rem] object-contain" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
