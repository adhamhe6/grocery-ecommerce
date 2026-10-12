// A tiny, dependency-free Markdown subset → typed AST.
//
// CMS pages, articles and FAQ answers are authored as Markdown in the dashboard (see `Page.body` in the backend).
// This parser never produces HTML: it returns plain data that React renders as escaped text nodes, so nothing in a
// body can inject markup or script. Raw HTML in the source (`<b>`, `<script>`, `<img onerror=…>`) simply shows up as
// literal text, and link destinations are limited to http(s), mailto, tel, in-page (#…) and root-relative (/…) URLs.
//
// Supported: paragraphs, ATX headings (# …), unordered and ordered lists (nested, multi-paragraph), blockquotes,
// fenced code, horizontal rules, **bold**, *italic* / _italic_, `code`, [links](url), <https://autolinks>,
// backslash escapes and hard line breaks. Not supported (rendered as plain text): tables, images, setext headings,
// indented code, reference-style links, HTML entities.

export type Inline =
  | { t: "text"; v: string }
  | { t: "strong"; c: Inline[] }
  | { t: "em"; c: Inline[] }
  | { t: "code"; v: string }
  | { t: "link"; href: string; c: Inline[] }
  | { t: "br" };

export type Block =
  | { t: "heading"; level: number; c: Inline[] }
  | { t: "p"; c: Inline[] }
  | { t: "list"; ordered: boolean; start: number; items: Block[][] }
  | { t: "quote"; c: Block[] }
  | { t: "code"; v: string; lang: string }
  | { t: "hr" };

const MAX_DEPTH = 6; // nesting limit for lists / quotes / emphasis; deeper content is flattened to text

// ------------------------------------------------------------------------------------------------ links
/** Returns a cleaned, safe link destination, or null when the URL must not become a link. */
export function safeHref(raw: string): string | null {
  // Browsers ignore whitespace and control characters inside a URL scheme (`java\tscript:`), so drop them before checking.
  const href = raw.replace(/[\u0000-\u0020\u007f-\u009f\u2028\u2029]/g, "");
  if (!href || href.includes("\\")) return null;
  if (href.startsWith("#")) return href.length > 1 ? href : null;
  if (href.startsWith("/")) return href.startsWith("//") ? null : href; // never protocol-relative
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href)?.[1]?.toLowerCase();
  if (!scheme) return null;
  if (scheme === "http" || scheme === "https") {
    try {
      new URL(href);
      return href;
    } catch {
      return null;
    }
  }
  if (scheme === "mailto" || scheme === "tel") return href.length > scheme.length + 1 ? href : null;
  return null;
}

// ------------------------------------------------------------------------------------------------ inline
const ESCAPABLE = /[!-/:-@[-`{-~]/; // ASCII punctuation
const WORD = /[A-Za-z0-9]/;
const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c);
const LINK = /\[((?:[^[\]\\]|\\.)*)\]\(\s*(?:<([^<>\n]*)>|([^\s()]*(?:\([^\s()]*\)[^\s()]*)*))(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/y;
const AUTOLINK = /<((?:https?:\/\/|mailto:)[^\s<>]+)>/y;

function findCodeClose(src: string, from: number, run: number): number {
  let j = from;
  while (j < src.length) {
    if (src[j] === "`") {
      let e = j;
      while (src[e] === "`") e++;
      if (e - j === run) return j;
      j = e;
    } else j++;
  }
  return -1;
}

/** Finds the delimiter that closes an emphasis opened just before `from`. */
function findEmphasisClose(src: string, from: number, ch: string, len: number): { innerEnd: number; end: number } | null {
  for (let j = from; j < src.length; j++) {
    const c = src[j];
    if (c === "\\") {
      j++;
      continue;
    }
    if (c === "`") {
      let e = j;
      while (src[e] === "`") e++;
      const close = findCodeClose(src, e, e - j);
      j = (close === -1 ? e : close + (e - j)) - 1;
      continue;
    }
    if (c !== ch) continue;
    let e = j;
    while (src[e] === ch) e++;
    const run = e - j;
    const closes = j > from && !isSpace(src[j - 1]) && !(ch === "_" && WORD.test(src[e] ?? ""));
    if (closes) {
      if (run === len) return { innerEnd: j, end: e };
      // `**bold *em***`: the run of three closes the inner emphasis first, then the outer strong
      if (len === 2 && run === 3) return { innerEnd: j + 1, end: e };
    }
    j = e - 1;
  }
  return null;
}

export function parseInline(src: string, depth = 0, noLinks = false): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  const flush = () => {
    if (buf) {
      out.push({ t: "text", v: buf });
      buf = "";
    }
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i];

    if (ch === "\\") {
      const next = src[i + 1];
      if (next === "\n") {
        flush();
        out.push({ t: "br" });
        i += 2;
        while (src[i] === " ") i++;
      } else if (next !== undefined && ESCAPABLE.test(next)) {
        buf += next;
        i += 2;
      } else {
        buf += ch;
        i++;
      }
      continue;
    }

    if (ch === "\n") {
      const hard = / {2,}$/.exec(buf);
      if (hard) {
        buf = buf.slice(0, buf.length - hard[0].length);
        flush();
        out.push({ t: "br" });
      } else {
        buf = buf.replace(/ +$/, "") + " "; // a soft line break is a space
      }
      i++;
      while (src[i] === " ") i++;
      continue;
    }

    if (ch === "`") {
      let e = i;
      while (src[e] === "`") e++;
      const run = e - i;
      const close = findCodeClose(src, e, run);
      if (close === -1) {
        buf += src.slice(i, e);
        i = e;
        continue;
      }
      let code = src.slice(e, close).replace(/\n/g, " ");
      if (code.length > 2 && code.startsWith(" ") && code.endsWith(" ") && code.trim()) code = code.slice(1, -1);
      flush();
      out.push({ t: "code", v: code });
      i = close + run;
      continue;
    }

    if (ch === "[" || (ch === "!" && src[i + 1] === "[")) {
      const isImage = ch === "!";
      const at = isImage ? i + 1 : i;
      LINK.lastIndex = at;
      const m = LINK.exec(src);
      if (m) {
        const href = noLinks || isImage ? null : safeHref(m[2] ?? m[3] ?? "");
        flush();
        // Images are not supported: show their alt text. Unsafe or nested links keep their text but lose the link.
        const inner = parseInline(m[1], depth + 1, true);
        if (href) out.push({ t: "link", href, c: inner });
        else out.push(...inner);
        i = at + m[0].length;
        continue;
      }
    }

    if (ch === "<" && !noLinks) {
      AUTOLINK.lastIndex = i;
      const m = AUTOLINK.exec(src);
      const href = m ? safeHref(m[1]) : null;
      if (m && href) {
        flush();
        out.push({ t: "link", href, c: [{ t: "text", v: m[1] }] });
        i += m[0].length;
        continue;
      }
    }

    if (ch === "*" || ch === "_") {
      let e = i;
      while (src[e] === ch) e++;
      const run = e - i;
      const prev = src[i - 1];
      const canOpen = run <= 3 && depth < MAX_DEPTH && !isSpace(src[e]) && !(ch === "_" && prev !== undefined && WORD.test(prev));
      if (canOpen) {
        let matched = false;
        for (let len = run; len >= 1 && !matched; len--) {
          const close = findEmphasisClose(src, i + len, ch, len);
          if (!close || close.innerEnd <= i + len) continue;
          const inner = parseInline(src.slice(i + len, close.innerEnd), depth + 1, noLinks);
          flush();
          if (len === 3) out.push({ t: "strong", c: [{ t: "em", c: inner }] });
          else if (len === 2) out.push({ t: "strong", c: inner });
          else out.push({ t: "em", c: inner });
          i = close.end;
          matched = true;
        }
        if (matched) continue;
      }
      buf += src.slice(i, e);
      i = e;
      continue;
    }

    buf += ch;
    i++;
  }
  flush();
  return out;
}

// ------------------------------------------------------------------------------------------------ blocks
const LIST_RE = /^( {0,3})([-*+]|\d{1,9}[.)])( +|$)(.*)$/;
const HR_RE = /^ {0,3}([-*_])(?: *\1){2,} *$/;
const HEADING_RE = /^ {0,3}(#{1,6})(?: +(.*?))?(?: +#+)? *$/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,}) *([^`\s]*)[^`]*$/;
const QUOTE_RE = /^ {0,3}> ?(.*)$/;

const indentOf = (line: string) => line.length - line.trimStart().length;
const isOrdered = (marker: string) => /\d/.test(marker[0]);

/** Does this line start a new block (and so end a paragraph)? */
function interrupts(line: string): boolean {
  if (HEADING_RE.test(line) || FENCE_RE.test(line) || HR_RE.test(line) || QUOTE_RE.test(line)) return true;
  const m = LIST_RE.exec(line);
  if (!m || !m[4].trim()) return false;
  return isOrdered(m[2]) ? parseInt(m[2], 10) === 1 : true; // only "1." may interrupt a paragraph
}

function parseBlocks(lines: string[], depth: number): Block[] {
  const out: Block[] = [];
  const n = lines.length;
  let i = 0;
  while (i < n) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (depth > MAX_DEPTH) {
      out.push({ t: "p", c: [{ t: "text", v: lines.slice(i).join(" ").replace(/\s+/g, " ").trim() }] });
      break;
    }

    let m: RegExpExecArray | null;

    if ((m = FENCE_RE.exec(line))) {
      const fence = m[1];
      const body: string[] = [];
      i++;
      while (i < n) {
        const t = lines[i].trim();
        if (t.length >= fence.length && [...t].every((c) => c === fence[0])) {
          i++;
          break;
        }
        body.push(lines[i]);
        i++;
      }
      out.push({ t: "code", v: body.join("\n"), lang: m[2] });
      continue;
    }

    if (HR_RE.test(line)) {
      out.push({ t: "hr" });
      i++;
      continue;
    }

    if ((m = HEADING_RE.exec(line))) {
      const text = (m[2] ?? "").trim();
      if (text) out.push({ t: "heading", level: m[1].length, c: parseInline(text) });
      i++;
      continue;
    }

    if (QUOTE_RE.test(line)) {
      const inner: string[] = [];
      while (i < n) {
        const q = QUOTE_RE.exec(lines[i]);
        if (q) {
          inner.push(q[1]);
          i++;
        } else if (lines[i].trim() && inner.length && inner[inner.length - 1].trim() && !interrupts(lines[i])) {
          inner.push(lines[i]); // lazy continuation of the quoted paragraph
          i++;
        } else break;
      }
      out.push({ t: "quote", c: parseBlocks(inner, depth + 1) });
      continue;
    }

    if ((m = LIST_RE.exec(line))) {
      const ordered = isOrdered(m[2]);
      const start = ordered ? parseInt(m[2], 10) : 1;
      const items: Block[][] = [];
      while (i < n) {
        const mm = LIST_RE.exec(lines[i]);
        if (!mm || isOrdered(mm[2]) !== ordered || HR_RE.test(lines[i])) break;
        const gap = mm[3].length;
        const contentIndent = mm[1].length + mm[2].length + (gap === 0 || gap > 4 ? 1 : gap);
        const itemLines = [mm[4]];
        i++;
        while (i < n) {
          const l = lines[i];
          if (!l.trim()) {
            let j = i;
            while (j < n && !lines[j].trim()) j++;
            if (j < n && indentOf(lines[j]) >= contentIndent) {
              for (; i < j; i++) itemLines.push("");
              continue;
            }
            break;
          }
          if (indentOf(l) >= contentIndent) {
            itemLines.push(l.slice(contentIndent));
            i++;
          } else if (itemLines[itemLines.length - 1].trim() && !interrupts(l) && !LIST_RE.test(l)) {
            itemLines.push(l.trimStart()); // lazy continuation of the item's paragraph
            i++;
          } else break;
        }
        items.push(parseBlocks(itemLines, depth + 1));
        // a blank line between items does not end the list
        let j = i;
        while (j < n && !lines[j].trim()) j++;
        if (j > i && j < n) {
          const next = LIST_RE.exec(lines[j]);
          if (next && isOrdered(next[2]) === ordered && !HR_RE.test(lines[j])) i = j;
        }
      }
      out.push({ t: "list", ordered, start, items });
      continue;
    }

    const para = [line.trimStart()];
    i++;
    while (i < n && lines[i].trim() && !interrupts(lines[i])) {
      para.push(lines[i].trimStart());
      i++;
    }
    out.push({ t: "p", c: parseInline(para.join("\n").replace(/\s+$/, "")) });
  }
  return out;
}

export function parseMarkdown(src: string | null | undefined): Block[] {
  if (!src) return [];
  const text = src.replace(/^﻿/, "").replace(/\0/g, "").replace(/\r\n?/g, "\n").replace(/\t/g, "    ");
  return parseBlocks(text.split("\n"), 0);
}

// ------------------------------------------------------------------------------------------------ plain text (JSON-LD, previews)
export function inlineToPlain(nodes: Inline[]): string {
  return nodes.map((n) => (n.t === "text" || n.t === "code" ? n.v : n.t === "br" ? " " : n.t === "link" || n.t === "strong" || n.t === "em" ? inlineToPlain(n.c) : "")).join("");
}

export function blocksToPlain(blocks: Block[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    if (b.t === "p" || b.t === "heading") parts.push(inlineToPlain(b.c));
    else if (b.t === "quote") parts.push(blocksToPlain(b.c));
    else if (b.t === "code") parts.push(b.v);
    else if (b.t === "list") b.items.forEach((item, k) => parts.push(`${b.ordered ? `${b.start + k}.` : "-"} ${blocksToPlain(item).replace(/\n+/g, " ")}`));
  }
  return parts.filter((p) => p.trim()).join("\n");
}

export function markdownToPlain(src: string | null | undefined): string {
  return blocksToPlain(parseMarkdown(src)).trim();
}

/**
 * The list items under the first heading whose text matches `title` (up to the next heading of the same or higher level).
 * Used to read a recipe's real "Ingredients" and "Method" lists. Returns null when the section or its lists are absent.
 */
export function sectionListItems(blocks: Block[], title: RegExp): string[] | null {
  const at = blocks.findIndex((b) => b.t === "heading" && title.test(inlineToPlain(b.c).trim()));
  if (at === -1) return null;
  const level = (blocks[at] as Extract<Block, { t: "heading" }>).level;
  const items: string[] = [];
  for (let k = at + 1; k < blocks.length; k++) {
    const b = blocks[k];
    if (b.t === "heading" && b.level <= level) break;
    if (b.t === "list") for (const item of b.items) items.push(blocksToPlain(item).replace(/\s+/g, " ").trim());
  }
  const clean = items.filter(Boolean);
  return clean.length ? clean : null;
}
