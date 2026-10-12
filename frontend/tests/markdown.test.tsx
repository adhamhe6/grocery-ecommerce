import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RichText } from "@/components/content/rich-text";
import { blocksToPlain, markdownToPlain, parseInline, parseMarkdown, safeHref, sectionListItems, type Block, type Inline } from "@/lib/markdown";

const html = (src: string) => renderToStaticMarkup(<RichText source={src} />);
const types = (blocks: Block[]) => blocks.map((b) => b.t);

describe("safeHref", () => {
  it("allows http(s), mailto, tel, in-page and root-relative targets", () => {
    expect(safeHref("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(safeHref("http://example.com")).toBe("http://example.com");
    expect(safeHref("mailto:hello@example.com")).toBe("mailto:hello@example.com");
    expect(safeHref("tel:+15550100")).toBe("tel:+15550100");
    expect(safeHref("/p/delivery")).toBe("/p/delivery");
    expect(safeHref("#section")).toBe("#section");
  });

  it("rejects script-capable and ambiguous targets", () => {
    for (const bad of [
      "javascript:alert(1)", "JaVaScRiPt:alert(1)", " javascript:alert(1)", "java\tscript:alert(1)", "java\nscript:alert(1)", "\u0001javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>", "vbscript:msgbox(1)", "file:///etc/passwd", "//evil.example/x", "/\\evil.example", "\\\\evil.example",
      "relative/path", "?x=1", "", "#", "mailto:", "http://", "ftp://example.com",
    ]) expect(safeHref(bad), JSON.stringify(bad)).toBeNull();
  });
});

describe("parseInline", () => {
  const text = (nodes: Inline[]) => nodes.map((n) => (n.t === "text" ? n.v : `<${n.t}>`)).join("");

  it("parses bold, italic, code and links", () => {
    expect(parseInline("a **b** c")).toEqual([{ t: "text", v: "a " }, { t: "strong", c: [{ t: "text", v: "b" }] }, { t: "text", v: " c" }]);
    expect(parseInline("*x* and _y_")).toEqual([{ t: "em", c: [{ t: "text", v: "x" }] }, { t: "text", v: " and " }, { t: "em", c: [{ t: "text", v: "y" }] }]);
    expect(parseInline("run `npm i` now")).toContainEqual({ t: "code", v: "npm i" });
    expect(parseInline("[faq](/faq)")).toEqual([{ t: "link", href: "/faq", c: [{ t: "text", v: "faq" }] }]);
    expect(parseInline("***both***")).toEqual([{ t: "strong", c: [{ t: "em", c: [{ t: "text", v: "both" }] }] }]);
  });

  it("leaves literal asterisks, underscores and brackets alone", () => {
    expect(text(parseInline("5 * 3 * 2"))).toBe("5 * 3 * 2");
    expect(text(parseInline("snake_case_name"))).toBe("snake_case_name");
    expect(text(parseInline("[to be confirmed by the business]"))).toBe("[to be confirmed by the business]");
    expect(text(parseInline("**unclosed"))).toBe("**unclosed");
  });

  it("honours backslash escapes and hard breaks, and joins soft breaks with a space", () => {
    expect(text(parseInline("\\*not em\\*"))).toBe("*not em*");
    expect(parseInline("a  \nb")).toEqual([{ t: "text", v: "a" }, { t: "br" }, { t: "text", v: "b" }]);
    expect(parseInline("a\nb")).toEqual([{ t: "text", v: "a b" }]);
  });

  it("keeps the text but drops the link when the target is unsafe", () => {
    expect(parseInline("[click](javascript:alert(1))")).toEqual([{ t: "text", v: "click" }]);
    expect(parseInline("[x](data:text/html;base64,AAAA)")).toEqual([{ t: "text", v: "x" }]);
    expect(parseInline("<javascript:alert(1)>")).toEqual([{ t: "text", v: "<javascript:alert(1)>" }]);
  });

  it("does not nest links and shows image alt text instead of an image", () => {
    const hasNestedLink = (nodes: Inline[], inLink = false): boolean =>
      nodes.some((n) => (n.t === "link" ? inLink || hasNestedLink(n.c, true) : n.t === "strong" || n.t === "em" ? hasNestedLink(n.c, inLink) : false));
    expect(hasNestedLink(parseInline("[a [b](/x) c](/y)"))).toBe(false);
    expect(hasNestedLink(parseInline("[**bold [inner](/x)**](/y)"))).toBe(false);
    expect(parseInline("![diagram](/img.png)")).toEqual([{ t: "text", v: "diagram" }]);
  });
});

describe("parseMarkdown blocks", () => {
  it("handles headings, paragraphs, lists, quotes, rules and fences", () => {
    const blocks = parseMarkdown("# One\n\npara\nline two\n\n- a\n- b\n\n1. x\n2. y\n\n> quoted\n\n---\n\n```js\nconst a = 1;\n```\n");
    expect(types(blocks)).toEqual(["heading", "p", "list", "list", "quote", "hr", "code"]);
    expect(blocks[1]).toMatchObject({ t: "p", c: [{ t: "text", v: "para line two" }] });
    expect(blocks[3]).toMatchObject({ t: "list", ordered: true, start: 1 });
    expect(blocks[6]).toMatchObject({ t: "code", v: "const a = 1;", lang: "js" });
  });

  it("starts an ordered list at its first number", () => {
    expect(parseMarkdown("3. three\n4. four")[0]).toMatchObject({ t: "list", ordered: true, start: 3 });
  });

  it("reads indented continuation lines and nested lists", () => {
    const [list] = parseMarkdown("- Details such as origin appear **only when we have them**. If a detail is\n  missing the page says so.\n- Second\n  - nested one\n  - nested two\n");
    expect(list).toMatchObject({ t: "list", ordered: false });
    const items = (list as Extract<Block, { t: "list" }>).items;
    expect(items).toHaveLength(2);
    expect(blocksToPlain(items[0])).toBe("Details such as origin appear only when we have them. If a detail is missing the page says so.");
    expect(items[1].map((b) => b.t)).toEqual(["p", "list"]);
  });

  it("keeps list items together across blank lines", () => {
    const [list] = parseMarkdown("1. one\n\n2. two\n\n3. three");
    expect((list as Extract<Block, { t: "list" }>).items).toHaveLength(3);
  });

  it("does not treat #hashtags or 7 hashes as headings, and drops empty headings", () => {
    expect(types(parseMarkdown("#hashtag"))).toEqual(["p"]);
    expect(types(parseMarkdown("####### seven"))).toEqual(["p"]);
    expect(parseMarkdown("##")).toEqual([]);
  });

  it("is safe on empty and degenerate input", () => {
    expect(parseMarkdown("")).toEqual([]);
    expect(parseMarkdown(null)).toEqual([]);
    expect(parseMarkdown("\n\n   \n")).toEqual([]);
    expect(() => parseMarkdown("> ".repeat(500) + "deep")).not.toThrow();
    expect(() => parseMarkdown("- ".repeat(500) + "deep")).not.toThrow();
    expect(() => parseMarkdown("*a ".repeat(2000))).not.toThrow();
    expect(() => parseMarkdown("[".repeat(5000) + "(" + ")".repeat(5000))).not.toThrow();
  });

  it("normalises Windows line endings and tabs", () => {
    expect(types(parseMarkdown("## A\r\n\r\n- x\r\n- y\r\n"))).toEqual(["heading", "list"]);
  });
});

describe("the real store content (seed excerpts)", () => {
  const notice = "> **Template text.** This page is placeholder wording. It is not legal advice. Items in [square brackets] are blanks to fill in.";

  it("renders a template notice as a quote with bold lead-in", () => {
    const out = html(`${notice}\n\n## Who we are\n\nOrchard Row is an online grocer.\n`);
    expect(out).toContain("<blockquote");
    expect(out).toContain("<strong");
    expect(out).toContain("Template text.");
    expect(out).toContain("[square brackets]");
    expect(out).toContain("<h2");
  });

  it("renders a recipe's ingredients and method", () => {
    const body = "## Ingredients\n\n- 1 kg vine tomatoes, halved\n- 4 cloves garlic\n\n## Method\n\n1. Heat the oven to 200 C (400 F).\n2. Roast for 25 minutes.\n";
    const out = html(body);
    expect(out).toContain("<ul");
    expect(out).toContain("<ol");
    expect(out.match(/<li/g)).toHaveLength(4);
    const blocks = parseMarkdown(body);
    expect(sectionListItems(blocks, /^ingredients?$/i)).toEqual(["1 kg vine tomatoes, halved", "4 cloves garlic"]);
    expect(sectionListItems(blocks, /^(method|instructions?)$/i)).toEqual(["Heat the oven to 200 C (400 F).", "Roast for 25 minutes."]);
    expect(sectionListItems(blocks, /^nutrition$/i)).toBeNull();
  });
});

describe("RichText never lets a body inject markup", () => {
  const attacks = [
    "<script>alert(1)</script>",
    "<img src=x onerror=alert(1)>",
    "<a href=\"javascript:alert(1)\">x</a>",
    "[x](javascript:alert(1))",
    "[x](  JAVASCRIPT:alert(1)  )",
    "**<b onmouseover=alert(1)>hi</b>**",
    "`</code><script>alert(1)</script>`",
    "```\n</pre><script>alert(1)</script>\n```",
    "<iframe src=\"https://evil.example\"></iframe>",
    "# <svg onload=alert(1)>",
    "- <style>*{display:none}</style>",
    "> <form action=https://evil.example><input name=password></form>",
    "[![x](https://e.example/a.png)](javascript:alert(1))",
  ];

  const ALLOWED = ["div", "p", "h2", "h3", "h4", "strong", "em", "code", "pre", "blockquote", "ul", "ol", "li", "a", "br", "hr"];

  it.each(attacks)("escapes %j", (attack) => {
    // Inspect the real DOM the markup produces (innerHTML does not run scripts), not the string.
    const host = document.createElement("div");
    host.innerHTML = html(attack);
    for (const el of host.querySelectorAll("*")) {
      expect(ALLOWED, `unexpected <${el.tagName.toLowerCase()}>`).toContain(el.tagName.toLowerCase());
      for (const attr of el.getAttributeNames()) {
        expect(attr, `unexpected attribute on <${el.tagName.toLowerCase()}>`).toMatch(/^(class|href|rel|start)$/);
      }
      const href = el.getAttribute("href");
      if (href !== null) expect(href).toMatch(/^(https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i);
    }
  });

  it("shows hostile markup as visible text rather than dropping or running it", () => {
    const host = document.createElement("div");
    host.innerHTML = html("<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>");
    expect(host.querySelector("script, img")).toBeNull();
    expect(host.textContent).toContain("<script>alert(1)</script>");
    expect(host.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("emits only safe link attributes", () => {
    const out = html("[a](https://example.com) [b](/faq) [c](mailto:hi@example.com)");
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('href="/faq"');
    expect(out).toContain('href="mailto:hi@example.com"');
  });

  it("renders nothing for an empty body", () => {
    expect(html("")).toBe("");
    expect(html("   \n ")).toBe("");
  });
});

describe("plain text", () => {
  it("strips markup for JSON-LD answers", () => {
    expect(markdownToPlain("You **never** pay more.\n\nSee [the policy](/p/substitutions) or `ask`.")).toBe("You never pay more.\nSee the policy or ask.");
    expect(markdownToPlain("- a\n- b")).toBe("- a\n- b");
    expect(markdownToPlain("1. a\n2. b")).toBe("1. a\n2. b");
  });
});
