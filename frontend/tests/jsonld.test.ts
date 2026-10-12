import { describe, expect, it } from "vitest";
import { faqJsonLd, recipeJsonLd, serializeJsonLd } from "@/lib/jsonld";
import type { ArticleDetail, FaqRow } from "@/lib/types";

const SITE = "https://shop.example";

const recipe: ArticleDetail = {
  slug: "roasted-tomato-basil-pasta",
  kind: "RECIPE",
  title: "Roasted tomato and basil pasta",
  summary: "Tomatoes roasted with garlic until soft, tossed through spaghetti.",
  image: { original: "/media/articles/pasta.webp", "640": "/media/articles/pasta-640.webp", "1024": "/media/articles/pasta-1024.webp" },
  servings: 4,
  total_minutes: 110,
  published_at: "2026-10-09T09:00:00Z",
  body: "## Ingredients\n\n- 1 kg vine tomatoes, halved\n- 4 cloves **garlic**\n\n## Method\n\n1. Heat the oven to 200 C.\n2. Roast for 25 minutes.\n",
  products: [],
};

describe("serializeJsonLd", () => {
  it("cannot be broken out of its script tag", () => {
    const out = serializeJsonLd({ a: "</script><script>alert(1)</script>", b: "<!-- x -->", c: "a & b", d: "line\u2028sep\u2029" });
    expect(out).not.toMatch(/[<>&\u2028\u2029]/);
    expect(JSON.parse(out)).toEqual({ a: "</script><script>alert(1)</script>", b: "<!-- x -->", c: "a & b", d: "line\u2028sep\u2029" });
  });
});

describe("faqJsonLd", () => {
  const rows: FaqRow[] = [
    { id: 1, topic: "Delivery", question: "How do delivery windows work?", answer: "You pick a **window** at checkout." },
    { id: 2, topic: "Refunds", question: "Can I cancel my order?", answer: "Yes, until we start picking it." },
    { id: 3, topic: "Refunds", question: "  ", answer: "No question text" },
    { id: 4, topic: "Refunds", question: "Empty answer?", answer: "   " },
  ];

  it("builds a FAQPage from the real rows only", () => {
    const ld = faqJsonLd(rows)!;
    expect(ld["@type"]).toBe("FAQPage");
    expect(ld.mainEntity).toEqual([
      { "@type": "Question", name: "How do delivery windows work?", acceptedAnswer: { "@type": "Answer", text: "You pick a window at checkout." } },
      { "@type": "Question", name: "Can I cancel my order?", acceptedAnswer: { "@type": "Answer", text: "Yes, until we start picking it." } },
    ]);
  });

  it("returns null when there is nothing to describe", () => {
    expect(faqJsonLd([])).toBeNull();
    expect(faqJsonLd([rows[2], rows[3]])).toBeNull();
  });
});

describe("recipeJsonLd", () => {
  it("is only produced for recipes", () => {
    expect(recipeJsonLd({ ...recipe, kind: "GUIDE" }, SITE)).toBeNull();
  });

  it("carries exactly the fields the article has", () => {
    const ld = recipeJsonLd(recipe, SITE)!;
    expect(ld).toMatchObject({
      "@context": "https://schema.org",
      "@type": "Recipe",
      name: "Roasted tomato and basil pasta",
      description: "Tomatoes roasted with garlic until soft, tossed through spaghetti.",
      image: ["https://shop.example/media/articles/pasta-1024.webp"],
      datePublished: "2026-10-09T09:00:00Z",
      recipeYield: "4 servings",
      totalTime: "PT1H50M",
      recipeIngredient: ["1 kg vine tomatoes, halved", "4 cloves garlic"],
      recipeInstructions: [{ "@type": "HowToStep", text: "Heat the oven to 200 C." }, { "@type": "HowToStep", text: "Roast for 25 minutes." }],
      mainEntityOfPage: "https://shop.example/guides/roasted-tomato-basil-pasta",
    });
    // Nothing the data does not support: no author, rating, nutrition or video.
    for (const invented of ["author", "aggregateRating", "nutrition", "video", "recipeCategory", "keywords"]) expect(ld).not.toHaveProperty(invented);
  });

  it("omits fields that are absent instead of guessing", () => {
    const ld = recipeJsonLd({ ...recipe, image: null, servings: null, total_minutes: null, summary: "", body: "Just a paragraph with no lists." }, SITE)!;
    const json = JSON.parse(JSON.stringify(ld));
    for (const key of ["image", "recipeYield", "totalTime", "description", "recipeIngredient", "recipeInstructions"]) expect(json, key).not.toHaveProperty(key);
    expect(json.name).toBe("Roasted tomato and basil pasta");
  });

  it("pluralises the yield correctly and formats short times", () => {
    expect(recipeJsonLd({ ...recipe, servings: 1, total_minutes: 10 }, SITE)).toMatchObject({ recipeYield: "1 serving", totalTime: "PT10M" });
    expect(recipeJsonLd({ ...recipe, total_minutes: 120 }, SITE)).toMatchObject({ totalTime: "PT2H" });
  });

  it("reads method lists under alternative headings, including grouped sub-lists", () => {
    const body = "## Ingredients\n\n### Sauce\n\n- tomatoes\n\n### Pasta\n\n- spaghetti\n\n## Instructions\n\n- Boil.\n- Toss.\n\n## Notes\n\n- not a step\n";
    expect(recipeJsonLd({ ...recipe, body }, SITE)).toMatchObject({ recipeIngredient: ["tomatoes", "spaghetti"], recipeInstructions: [{ text: "Boil." }, { text: "Toss." }] });
  });
});
