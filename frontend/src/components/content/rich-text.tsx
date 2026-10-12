import Link from "next/link";
import { cn } from "@/lib/cn";
import { parseMarkdown, type Block, type Inline } from "@/lib/markdown";

/**
 * Renders CMS Markdown (page bodies, article bodies, FAQ answers) as React elements. The text goes through React's
 * escaping and the parser only emits a fixed set of elements with vetted link targets, so a body can never inject HTML
 * or script. See `src/lib/markdown.ts` for the supported subset.
 */
export function RichText({ source, className }: { source: string | null | undefined; className?: string }) {
  const blocks = parseMarkdown(source);
  if (blocks.length === 0) return null;
  return (
    <div className={cn("break-words text-ink-2 [&>*:first-child]:mt-0", className)}>
      <Blocks blocks={blocks} />
    </div>
  );
}

function Blocks({ blocks }: { blocks: Block[] }) {
  return <>{blocks.map((b, i) => <BlockView key={i} block={b} />)}</>;
}

function BlockView({ block }: { block: Block }) {
  switch (block.t) {
    case "heading": {
      // The page title is the h1, so body headings start at h2.
      if (block.level <= 2) return <h2 className="mb-1 mt-10 text-2xl"><Inlines nodes={block.c} /></h2>;
      if (block.level === 3) return <h3 className="mb-1 mt-8 text-xl"><Inlines nodes={block.c} /></h3>;
      return <h4 className="mb-1 mt-6 font-sans text-base font-bold text-ink"><Inlines nodes={block.c} /></h4>;
    }
    case "p":
      return <p className="mt-4 leading-relaxed"><Inlines nodes={block.c} /></p>;
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag start={block.ordered && block.start !== 1 ? block.start : undefined} className={cn("mt-4 space-y-2 pl-6 marker:text-ink-3", block.ordered ? "list-decimal marker:font-semibold" : "list-disc")}>
          {block.items.map((item, i) => (
            <li key={i} className="pl-1 leading-relaxed">
              {item.map((b, k) => (k === 0 && b.t === "p" ? <Inlines key={k} nodes={b.c} /> : <BlockView key={k} block={b} />))}
            </li>
          ))}
        </Tag>
      );
    }
    case "quote":
      return <blockquote className="mt-5 rounded-md border-l-4 border-line-strong bg-paper-2 px-4 py-3 text-ink-2 [&>*:first-child]:mt-0"><Blocks blocks={block.c} /></blockquote>;
    case "code":
      return <pre className="mt-4 overflow-x-auto rounded-md border border-line bg-paper-2 p-4 text-sm"><code>{block.v}</code></pre>;
    case "hr":
      return <hr className="my-8 border-line" />;
  }
}

const linkClass = "font-medium text-primary underline underline-offset-4 hover:text-primary-hover";

function Inlines({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.t) {
          case "text":
            return n.v;
          case "br":
            return <br key={i} />;
          case "strong":
            return <strong key={i} className="font-semibold text-ink"><Inlines nodes={n.c} /></strong>;
          case "em":
            return <em key={i}><Inlines nodes={n.c} /></em>;
          case "code":
            return <code key={i} className="rounded bg-paper-2 px-1 py-0.5 font-mono text-[0.9em]">{n.v}</code>;
          case "link":
            // Root-relative targets use client-side navigation; everything else is an ordinary external/mail/tel link.
            return n.href.startsWith("/") ? (
              <Link key={i} href={n.href} className={linkClass}><Inlines nodes={n.c} /></Link>
            ) : (
              <a key={i} href={n.href} className={linkClass} rel="noopener noreferrer"><Inlines nodes={n.c} /></a>
            );
        }
      })}
    </>
  );
}
