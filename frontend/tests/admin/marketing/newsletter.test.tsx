import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NewsletterAndMessages } from "@/components/admin/marketing/newsletter";
import { apiError, mockApi, renderAdmin } from "../catalog/helpers";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }), usePathname: () => "/admin/newsletter" }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
beforeEach(() => { window.history.replaceState(null, "", "/admin/newsletter"); });

const page = (rows: unknown[], count = rows.length) => ({ count, page: 1, page_size: 25, total_pages: 1, next: null, previous: null, results: rows });
const sub = (id: number, email: string, status: string) => ({ id, email, status, created_at: "2026-10-01T10:00:00Z", confirmed_at: status === "PENDING" ? null : "2026-10-01T10:05:00Z", unsubscribed_at: status === "UNSUBSCRIBED" ? "2026-10-08T10:00:00Z" : null });
const msg = (over: Record<string, unknown> = {}) => ({ id: 1, name: "Ann Smith", email: "ann@example.com", topic: "ORDER", message: "Where is my order?", order_number: "OR-261012-ABCDE", status: "NEW", handled_by: null, handled_at: null, staff_note: "", created_at: "2026-10-12T09:00:00Z", ...over });

describe("Newsletter subscribers", () => {
  it("shows counts per status and an export link for confirmed addresses only", async () => {
    mockApi({
      "GET /admin/newsletter/": ({ url }) => {
        const s = url.searchParams.get("status");
        const rows = [sub(1, "yes@example.com", "CONFIRMED"), sub(2, "wait@example.com", "PENDING"), sub(3, "gone@example.com", "UNSUBSCRIBED")];
        if (url.searchParams.get("page_size") === "1") return { json: page([], s === "CONFIRMED" ? 120 : s === "PENDING" ? 7 : s === "UNSUBSCRIBED" ? 15 : 142) };
        return { json: page(rows) };
      },
    });
    renderAdmin(<NewsletterAndMessages />, ["content.manage"]);
    expect(await screen.findByText("yes@example.com")).toBeInTheDocument();
    const counts = screen.getByRole("region", { name: "Subscriber counts" });
    await waitFor(() => expect(within(counts).getByText("120")).toBeInTheDocument());
    expect(within(counts).getByText("7")).toBeInTheDocument();
    expect(within(counts).getByText("142")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Export confirmed addresses/ });
    expect(link).toHaveAttribute("href", "/api/v1/admin/newsletter/export/");
    expect(screen.getByText("Waiting for confirmation", { selector: "span" })).toBeInTheDocument();
    // a marketing role has no customer access, so the inbox tab is not offered
    expect(screen.queryByRole("tab", { name: "Contact messages" })).not.toBeInTheDocument();
  });
});

describe("Contact messages", () => {
  const routes = () => ({
    "GET /admin/newsletter/": { json: page([]) },
    "GET /admin/contact-messages/": ({ url }: { url: URL }) => ({ json: page(url.searchParams.get("page_size") === "1" ? [msg()] : [msg(), msg({ id: 2, name: "Bob", email: "bob@example.com", topic: "FEEDBACK", message: "Lovely strawberries", order_number: "" })]) }),
  });

  it("offers a prepared mailto reply and marks a message handled with a note", async () => {
    const api = mockApi({ ...routes(), "POST /admin/contact-messages/1/handle/": { json: msg({ status: "HANDLED", handled_by: "me@example.com", handled_at: "2026-10-12T10:00:00Z", staff_note: "Called back" }) } });
    const user = userEvent.setup({ delay: null });
    renderAdmin(<NewsletterAndMessages />, ["content.manage", "customers.read"]);
    await user.click(await screen.findByRole("tab", { name: "Contact messages" }));
    const reply = await screen.findByRole("link", { name: /Reply by email to Ann Smith/ });
    expect(reply.getAttribute("href")).toMatch(/^mailto:ann@example\.com\?subject=Re%3A%20your%20message%20to%20Orchard%20Row%20\(order%20OR-261012-ABCDE\)/);
    await user.click(screen.getByRole("button", { name: /Mark handled message from Ann Smith/ }));
    const dialog = await screen.findByRole("dialog", { name: "Mark this message as handled?" });
    await user.type(within(dialog).getByRole("textbox", { name: /Note/ }), "Called back");
    await user.click(within(dialog).getByRole("button", { name: "Mark handled" }));
    await waitFor(() => expect(api.calls.find((c) => c.key === "POST /admin/contact-messages/1/handle/")?.body).toEqual({ note: "Called back" }));
  });

  it("shows the server's message when it was already handled elsewhere", async () => {
    mockApi({ ...routes(), "POST /admin/contact-messages/1/handle/": apiError(409, "INVALID_STATE", "This message has already been handled.") });
    const user = userEvent.setup({ delay: null });
    renderAdmin(<NewsletterAndMessages />, ["content.manage", "customers.read"]);
    await user.click(await screen.findByRole("tab", { name: "Contact messages" }));
    await user.click(await screen.findByRole("button", { name: /Mark handled message from Ann Smith/ }));
    const dialog = await screen.findByRole("dialog", { name: "Mark this message as handled?" });
    await user.click(within(dialog).getByRole("button", { name: "Mark handled" }));
    expect(await screen.findByText("This message has already been handled.")).toBeInTheDocument();
  });
});
