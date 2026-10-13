import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContentManager } from "@/components/admin/content/content";
import { apiError, mockApi, renderAdmin } from "../catalog/helpers";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }), usePathname: () => "/admin/content" }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
beforeEach(() => { window.history.replaceState(null, "", "/admin/content"); });

const page = (rows: unknown[]) => ({ count: rows.length, page: 1, page_size: 50, total_pages: 1, next: null, previous: null, results: rows });
const banner = (over: Record<string, unknown> = {}) => ({ id: 1, placement: "HERO", title: "Autumn sale", subtitle: "", image: {}, cta_label: "Shop", cta_link: "/offers", starts_at: "2026-10-01T00:00:00Z", ends_at: null, sort_order: 100, is_active: true, is_live: true, created_at: "x", updated_at: "x", ...over });

describe("Banners", () => {
  it("lists banners with state and uploads a picture through the image endpoint after the banner exists", async () => {
    mockApi({
      "GET /admin/banners/": { json: page([banner(), banner({ id: 2, title: "Strip", placement: "STRIP", sort_order: 100, is_live: false, is_active: false })]) },
      "GET /admin/banners/1/": { json: banner() },
    });
    const user = userEvent.setup({ delay: null });
    renderAdmin(<ContentManager />, ["content.manage"]);
    expect(await screen.findByRole("button", { name: "Autumn sale" })).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "Banners" });
    expect(within(table).getByText("Live")).toBeInTheDocument();
    expect(within(table).getByText("Off")).toBeInTheDocument();
    expect(within(table).getAllByText("No picture")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Autumn sale" }));
    const d = within(await screen.findByRole("dialog", { name: "Edit Autumn sale" }));
    expect(d.getByLabelText(/Upload a picture/)).toBeInTheDocument();
    expect(d.getByRole("combobox", { name: "Where it appears" })).toHaveValue("HERO");
  });

  it("maps the server's link rule to the button link field", async () => {
    const api = mockApi({
      "GET /admin/banners/": { json: page([]) },
      "POST /admin/banners/": apiError(400, "VALIDATION_ERROR", "Check the highlighted fields.", { cta_link: ["Use a site path starting with a single / or an https:// URL."] }),
    });
    const user = userEvent.setup({ delay: null });
    renderAdmin(<ContentManager />, ["content.manage"]);
    await user.click(await screen.findByRole("button", { name: /New banner/ }));
    const d = within(await screen.findByRole("dialog", { name: "New banner" }));
    await user.type(d.getByRole("textbox", { name: /Headline/ }), "Sale");
    await user.type(d.getByRole("textbox", { name: "Button link" }), "//evil.example");
    await user.click(d.getByRole("button", { name: "Create banner" }));
    const link = d.getByRole("textbox", { name: "Button link" });
    await waitFor(() => expect(link).toHaveAttribute("aria-invalid", "true"));
    expect(document.getElementById(link.getAttribute("aria-describedby")!)).toHaveTextContent("single /");
    expect(api.calls.find((c) => c.key === "POST /admin/banners/")!.body).toMatchObject({ title: "Sale", cta_link: "//evil.example", placement: "HERO", is_active: true });
  });
});

describe("Pages", () => {
  const pageRow = { id: 3, slug: "returns", title: "Returns", summary: "", body: "## Returns\n\nFresh food **can't** be returned.", is_published: true, is_template: true, created_at: "x", updated_at: "2026-10-01T00:00:00Z" };

  it("previews Markdown with the shop's renderer and shows the placeholder-wording flag", async () => {
    mockApi({ "GET /admin/pages/": { json: [pageRow] } });
    const user = userEvent.setup({ delay: null });
    renderAdmin(<ContentManager />, ["content.manage"]);
    await user.click(await screen.findByRole("tab", { name: "Pages" }));
    expect(await screen.findByText("Placeholder wording")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Returns" }));
    const d = within(await screen.findByRole("dialog", { name: "Edit Returns" }));
    const preview = d.getByRole("region", { name: "Preview" });
    expect(within(preview).getByRole("heading", { name: "Returns", level: 2 })).toBeInTheDocument();
    expect(within(preview).getByText("can't").tagName).toBe("STRONG");
    await user.type(d.getByRole("textbox", { name: /Page text/ }), "\n\n<script>alert(1)</script>");
    expect(within(preview).getByText(/<script>alert\(1\)<\/script>/)).toBeInTheDocument(); // shown as text, never executed
  });

  it("surfaces the server's no-HTML rule on the body field", async () => {
    mockApi({
      "GET /admin/pages/": { json: [pageRow] },
      "PATCH /admin/pages/3/": apiError(400, "VALIDATION_ERROR", "Check the highlighted fields.", { body: ["HTML isn't allowed, use Markdown"] }),
    });
    const user = userEvent.setup({ delay: null });
    renderAdmin(<ContentManager />, ["content.manage"]);
    await user.click(await screen.findByRole("tab", { name: "Pages" }));
    await user.click(await screen.findByRole("button", { name: "Returns" }));
    const d = within(await screen.findByRole("dialog", { name: "Edit Returns" }));
    await user.type(d.getByRole("textbox", { name: /Page text/ }), " <b>x</b>");
    await user.click(d.getByRole("button", { name: "Save changes" }));
    const body = d.getByRole("textbox", { name: /Page text/ });
    await waitFor(() => expect(body).toHaveAttribute("aria-invalid", "true"));
    expect(document.getElementById(body.getAttribute("aria-describedby")!)).toHaveTextContent("HTML isn't allowed, use Markdown");
  });
});

describe("FAQs and articles", () => {
  it("reorders questions within a topic using the arrows", async () => {
    const faqs = [
      { id: 1, question: "Do you deliver?", answer: "Yes", topic: "Delivery", sort_order: 100, is_published: true },
      { id: 2, question: "What does it cost?", answer: "From $4", topic: "Delivery", sort_order: 100, is_published: true },
      { id: 3, question: "Can I pay by card?", answer: "Yes", topic: "Payment", sort_order: 100, is_published: false },
    ];
    const api = mockApi({ "GET /admin/faqs/": { json: faqs }, "PATCH /admin/faqs/1/": { json: faqs[0] }, "PATCH /admin/faqs/2/": { json: faqs[1] } });
    const user = userEvent.setup({ delay: null });
    renderAdmin(<ContentManager />, ["content.manage"]);
    await user.click(await screen.findByRole("tab", { name: "FAQs" }));
    await screen.findByRole("button", { name: "What does it cost?" });
    expect(within(screen.getByRole("table", { name: "Frequently asked questions" })).getByText("Not published")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Move What does it cost? up" }));
    await waitFor(() => expect(api.calls.filter((c) => c.key.startsWith("PATCH /admin/faqs/")).length).toBe(2));
    expect(Object.fromEntries(api.calls.filter((c) => c.key.startsWith("PATCH")).map((c) => [c.key, c.body]))).toEqual({ "PATCH /admin/faqs/2/": { sort_order: 10 }, "PATCH /admin/faqs/1/": { sort_order: 20 } });
  });

  it("builds an article body with linked products, numbers as integers and a recipe tip", async () => {
    const api = mockApi({
      "GET /admin/articles/": { json: page([]) },
      "POST /admin/articles/": { status: 201, json: { id: 9, kind: "RECIPE", slug: "tomato-pasta", title: "Tomato pasta", summary: "Quick", body: "## Method", image: {}, products: [], servings: 4, total_minutes: 20, published_at: "2026-10-12T00:00:00Z", is_published: false, is_live: false, created_at: "x", updated_at: "x" } },
      "GET /admin/articles/9/": { json: { id: 9, kind: "RECIPE", slug: "tomato-pasta", title: "Tomato pasta", summary: "Quick", body: "## Method", image: {}, products: [], servings: 4, total_minutes: 20, published_at: "2026-10-12T00:00:00Z", is_published: false, is_live: false } },
    });
    const user = userEvent.setup({ delay: null });
    renderAdmin(<ContentManager />, ["content.manage"]);
    await user.click(await screen.findByRole("tab", { name: "Articles & recipes" }));
    await user.click(await screen.findByRole("button", { name: /New article/ }));
    const d = within(await screen.findByRole("dialog", { name: "New article" }));
    expect(d.getByText("Tip for recipes")).toBeInTheDocument();
    await user.type(d.getByRole("textbox", { name: /^Title/ }), "Tomato pasta");
    await user.type(d.getByRole("textbox", { name: /^Summary/ }), "Quick");
    await user.type(d.getByRole("textbox", { name: /^Text/ }), "## Method");
    await user.type(d.getByRole("textbox", { name: "Servings" }), "4");
    await user.type(d.getByRole("textbox", { name: "Total minutes" }), "20");
    await user.click(d.getByRole("button", { name: "Create article" }));
    await waitFor(() => expect(api.calls.find((c) => c.key === "POST /admin/articles/")).toBeTruthy());
    expect(api.calls.find((c) => c.key === "POST /admin/articles/")!.body).toEqual({ kind: "RECIPE", title: "Tomato pasta", summary: "Quick", body: "## Method", products: [], servings: 4, total_minutes: 20, is_published: false });
    expect(await d.findByText("Article created")).toBeInTheDocument();
  });
});
