import { Clock, Users } from "lucide-react";
import Link from "next/link";
import { formatDuration, kindLabel } from "@/lib/content";
import { imgSrc, imgSrcSet } from "@/lib/format";
import type { ArticleListItem } from "@/lib/types";

/** Servings and time, only for the fields the article actually has. */
export function ArticleMeta({ article }: { article: Pick<ArticleListItem, "servings" | "total_minutes"> }) {
  if (!article.servings && !article.total_minutes) return null;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-2">
      {!!article.total_minutes && <li className="flex items-center gap-1.5"><Clock className="size-4 text-ink-3" aria-hidden /><span><span className="sr-only">Total time: </span>{formatDuration(article.total_minutes)}</span></li>}
      {!!article.servings && <li className="flex items-center gap-1.5"><Users className="size-4 text-ink-3" aria-hidden /><span><span className="sr-only">Serves: </span>{article.servings}</span></li>}
    </ul>
  );
}

export function ArticleCard({ article, priority }: { article: ArticleListItem; priority?: boolean }) {
  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-lg border border-line bg-white transition-shadow focus-within:shadow-card hover:shadow-card">
      {article.image ? (
        <img
          src={imgSrc(article.image, 640)} srcSet={imgSrcSet(article.image)} sizes="(min-width:1024px) 24rem, (min-width:640px) 45vw, 92vw" alt="" width={640} height={400}
          loading={priority ? "eager" : "lazy"} decoding="async" className="tile-bg aspect-[16/10] w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
        />
      ) : (
        <div className="tile-bg aspect-[16/10] w-full" aria-hidden />
      )}
      <div className="flex flex-1 flex-col p-4">
        <p className="eyebrow">{kindLabel(article.kind)}</p>
        <h2 className="mt-1 text-lg">
          <Link href={`/guides/${article.slug}`} className="after:absolute after:inset-0 after:content-[''] hover:underline">{article.title}</Link>
        </h2>
        <p className="mt-1 line-clamp-3 text-sm text-ink-2">{article.summary}</p>
        {(!!article.servings || !!article.total_minutes) && <div className="mt-auto pt-3"><ArticleMeta article={article} /></div>}
      </div>
    </article>
  );
}
