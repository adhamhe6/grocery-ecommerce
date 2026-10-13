import { describe, expect, it } from "vitest";
import { mailtoHref, topicLabel } from "@/components/admin/marketing/newsletter-model";

describe("mailtoHref", () => {
  const msg = { email: "ann@example.com", name: "Ann Smith", topic: "ORDER", message: "Where is my order?\nIt is late.", order_number: "OR-261012-ABCDE", created_at: "2026-10-12T09:00:00Z" };
  it("starts a reply to the sender, quoting what they wrote", () => {
    const href = mailtoHref(msg, "Orchard Row", "Mon 12 Oct, 9:00 AM");
    expect(href.startsWith("mailto:ann@example.com?")).toBe(true);
    const params = new URLSearchParams(href.split("?")[1]);
    expect(params.get("subject")).toBe("Re: your message to Orchard Row (order OR-261012-ABCDE)");
    const body = params.get("body")!;
    expect(body).toContain("Hi Ann,");
    expect(body).toContain("> Where is my order?\n> It is late.");
    expect(body).toContain("about “An order”");
  });
  it("leaves the order out of the subject when there is none, and encodes odd characters in the address", () => {
    const href = mailtoHref({ ...msg, order_number: "", email: "a+b@example.com" }, "Orchard Row", "today");
    expect(href).toContain("mailto:a%2Bb@example.com?");
    expect(new URLSearchParams(href.split("?")[1]).get("subject")).toBe("Re: your message to Orchard Row");
  });
  it("labels topics", () => {
    expect(topicLabel("REFUND")).toBe("Refund or payment");
    expect(topicLabel("UNKNOWN")).toBe("UNKNOWN");
  });
});
