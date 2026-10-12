import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContactForm } from "@/components/forms/contact-form";
import { TokenAction } from "@/components/forms/token-action";
import { TrackForm } from "@/components/forms/track-form";
import { DeliveryCheck } from "@/components/stores/delivery-check";
import { StoreProvider, makeQueryClient } from "@/lib/hooks";
import type { OrderDetail, StoreConfig } from "@/lib/types";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: push, prefetch: vi.fn() }) }));

const store = { name: "Orchard Row", currency: "USD", locale: "en-US", timezone: "America/New_York" } as StoreConfig;

function wrap(ui: React.ReactElement) {
  const client = makeQueryClient();
  client.setDefaultOptions({ queries: { retry: false }, mutations: { retry: false } });
  return render(<StoreProvider store={store}><QueryClientProvider client={client}>{ui}</QueryClientProvider></StoreProvider>);
}

const json = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
const apiError = (status: number, code: string, message: string, details: Record<string, unknown> = {}) => json(status, { error: { code, message, details } });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  document.cookie = "csrftoken=test-csrf"; // lets the API client skip its CSRF round trip
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  push.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const calls = () => fetchMock.mock.calls.map(([url, init]) => ({ url: String(url), method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body) : undefined, headers: init?.headers }));

describe("TokenAction (newsletter confirm / unsubscribe)", () => {
  it("sends nothing until the visitor presses the button", async () => {
    wrap(<TokenAction endpoint="/newsletter/confirm/" token="abc123" label="Confirm subscription" />);
    await new Promise((r) => setTimeout(r, 30));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Confirm subscription" })).toBeEnabled();
  });

  it("POSTs the token once on click and shows the API's message", async () => {
    fetchMock.mockImplementation(() => json(200, { detail: "You're subscribed. Thank you!" }));
    wrap(<TokenAction endpoint="/newsletter/confirm/" token="abc123" label="Confirm subscription" after={<a href="/shop">Start shopping</a>} />);
    await userEvent.click(screen.getByRole("button", { name: "Confirm subscription" }));
    expect(await screen.findByText("You're subscribed. Thank you!")).toBeInTheDocument();
    expect(calls()).toHaveLength(1);
    expect(calls()[0]).toMatchObject({ url: "/api/v1/newsletter/confirm/", method: "POST", body: { token: "abc123" } });
    expect((calls()[0].headers as Record<string, string>)["X-CSRFToken"]).toBe("test-csrf");
    expect(screen.queryByRole("button", { name: "Confirm subscription" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start shopping" })).toBeInTheDocument();
  });

  it("shows the API's error and lets the visitor try again", async () => {
    fetchMock.mockImplementationOnce(() => apiError(400, "INVALID_TOKEN", "This confirmation link isn't valid any more. Please subscribe again."));
    wrap(<TokenAction endpoint="/newsletter/unsubscribe/" token="stale" label="Unsubscribe me" />);
    await userEvent.click(screen.getByRole("button", { name: "Unsubscribe me" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This confirmation link isn't valid any more.");
    expect(screen.getByRole("button", { name: "Unsubscribe me" })).toBeEnabled();
  });
});

describe("ContactForm", () => {
  const fill = async (over: Partial<Record<"name" | "email" | "message" | "order", string>> = {}) => {
    await userEvent.type(screen.getByLabelText(/your name/i), over.name ?? "Sam Rivera");
    await userEvent.type(screen.getByLabelText(/email address/i), over.email ?? "sam@example.com");
    await userEvent.type(screen.getByLabelText(/your message/i), over.message ?? "My delivery arrived without the eggs.");
    if (over.order) await userEvent.type(screen.getByLabelText(/order number/i), over.order);
  };

  it("lists the model's topics and defaults to 'Something else'", () => {
    wrap(<ContactForm />);
    const select = screen.getByLabelText(/what is it about/i) as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(["ORDER", "DELIVERY", "PRODUCT", "REFUND", "ACCOUNT", "FEEDBACK", "OTHER"]);
    expect(select.value).toBe("OTHER");
    expect(screen.getByText(/replies come by email/i)).toBeInTheDocument();
  });

  it("validates before sending and focuses the first problem", async () => {
    wrap(<ContactForm />);
    await userEvent.click(screen.getByRole("button", { name: /send message/i }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await screen.findByText("Please tell us your name.")).toBeInTheDocument();
    expect(screen.getByText("Enter your email address so we can reply.")).toBeInTheDocument();
    expect(screen.getByText(/at least 10 characters/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText(/your name/i)).toHaveFocus());
    expect(screen.getByLabelText(/your name/i)).toHaveAttribute("aria-invalid", "true");
  });

  it("posts the form and confirms with the API's message", async () => {
    fetchMock.mockImplementation(() => json(201, { detail: "Thanks for getting in touch. We've received your message and will reply by email." }));
    wrap(<ContactForm />);
    await fill({ order: "or-260101-abcde" });
    await userEvent.selectOptions(screen.getByLabelText(/what is it about/i), "DELIVERY");
    await userEvent.click(screen.getByRole("button", { name: /send message/i }));
    expect(await screen.findByRole("heading", { name: /message sent/i })).toBeInTheDocument();
    expect(screen.getByText(/we've received your message and will reply by email/i)).toBeInTheDocument();
    expect(calls()).toHaveLength(1);
    expect(calls()[0]).toMatchObject({ url: "/api/v1/contact/", method: "POST", body: { name: "Sam Rivera", email: "sam@example.com", topic: "DELIVERY", message: "My delivery arrived without the eggs.", order_number: "or-260101-abcde" } });
  });

  it("shows the API's field errors next to the fields", async () => {
    fetchMock.mockImplementation(() => apiError(400, "VALIDATION_ERROR", "Please correct the highlighted fields.", { email: ["Enter a valid email address."], message: ["Ensure this field has no more than 3000 characters."] }));
    wrap(<ContactForm />);
    await fill();
    await userEvent.click(screen.getByRole("button", { name: /send message/i }));
    expect(await screen.findByText("Enter a valid email address.")).toBeInTheDocument();
    expect(screen.getByText(/no more than 3000 characters/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email address/i)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(/correct the highlighted fields/i)).toBeInTheDocument();
  });

  it("explains a rate limit and keeps what was typed", async () => {
    fetchMock.mockImplementation(() => apiError(429, "RATE_LIMITED", "Too many requests. Please wait a moment and try again."));
    wrap(<ContactForm />);
    await fill();
    await userEvent.click(screen.getByRole("button", { name: /send message/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many requests");
    expect(screen.getByLabelText(/your message/i)).toHaveValue("My delivery arrived without the eggs.");
  });
});

describe("TrackForm", () => {
  const order = (over: Partial<OrderDetail> = {}) => ({ number: "OR-260101-ABCDE", status: "PICKING", status_label: "Being picked", status_summary: "Our team is picking your groceries.", timeline: [{ status: "PLACED", label: "Order placed", at: "2026-01-01T10:00:00Z" }], tracking_token: "tok_123-abc", ...over }) as OrderDetail;
  const submit = async () => {
    await userEvent.type(screen.getByLabelText(/order number/i), "or-260101-abcde");
    await userEvent.type(screen.getByLabelText(/email address/i), "sam@example.com");
    await userEvent.click(screen.getByRole("button", { name: /find my order/i }));
  };

  it("looks the order up with number + email and opens it with its tracking token", async () => {
    fetchMock.mockImplementation(() => json(200, order()));
    wrap(<TrackForm />);
    await submit();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/orders/OR-260101-ABCDE?token=tok_123-abc"));
    expect(calls()[0]).toMatchObject({ url: "/api/v1/orders/track/", method: "POST", body: { number: "or-260101-abcde", email: "sam@example.com" } });
  });

  it("says plainly when nothing matches, and does not navigate", async () => {
    fetchMock.mockImplementation(() => apiError(404, "NOT_FOUND", "We couldn't find an order with those details."));
    wrap(<TrackForm />);
    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't find an order with those details.");
    expect(push).not.toHaveBeenCalled();
  });

  it("validates the email address before asking the server", async () => {
    wrap(<TrackForm />);
    await userEvent.type(screen.getByLabelText(/order number/i), "OR-1");
    await userEvent.type(screen.getByLabelText(/email address/i), "not-an-email");
    await userEvent.click(screen.getByRole("button", { name: /find my order/i }));
    expect(await screen.findByText("Enter a valid email address.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to an inline status if the API ever omits the token", async () => {
    fetchMock.mockImplementation(() => json(200, order({ tracking_token: undefined })));
    wrap(<TrackForm />);
    await submit();
    expect(await screen.findByRole("heading", { name: "Being picked" })).toBeInTheDocument();
    expect(screen.getByText("Order placed")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});

describe("DeliveryCheck", () => {
  it("asks the real endpoint and lists the zone's fee, threshold and minimum", async () => {
    fetchMock.mockImplementation(() => json(200, { serviceable: true, branch: { id: 1, name: "Old Town" }, zone: { id: 3, name: "Old Town & Harbour", delivery_fee: "3.99", free_delivery_threshold: "60.00", min_order_value: "25.00" } }));
    wrap(<DeliveryCheck />);
    await userEvent.type(screen.getByLabelText(/postcode or area/i), "rw1 2ab");
    await userEvent.click(screen.getByRole("button", { name: /check delivery/i }));
    expect(await screen.findByText(/we deliver to this address/i)).toBeInTheDocument();
    expect(screen.getByText("Old Town & Harbour")).toBeInTheDocument();
    expect(screen.getByText("$3.99")).toBeInTheDocument();
    expect(screen.getByText(/\$60\.00 or more/)).toBeInTheDocument();
    expect(screen.getByText("$25.00")).toBeInTheDocument();
    const url = new URL(calls()[0].url, "http://x");
    expect(url.pathname).toBe("/api/v1/delivery/check/");
    expect(calls()[0].method).toBe("GET");
    expect(url.searchParams.get("postal_code")).toBe("rw1 2ab");
    expect(url.searchParams.get("area")).toBe("rw1 2ab");
  });

  it("shows free delivery / no minimum / no threshold as such", async () => {
    fetchMock.mockImplementation(() => json(200, { serviceable: true, branch: { id: 1, name: "Old Town" }, zone: { id: 3, name: "Core", delivery_fee: "0.00", free_delivery_threshold: null, min_order_value: "0.00" } }));
    wrap(<DeliveryCheck />);
    await userEvent.type(screen.getByLabelText(/postcode or area/i), "RW1");
    await userEvent.click(screen.getByRole("button", { name: /check delivery/i }));
    expect(await screen.findByText("Free")).toBeInTheDocument();
    expect(screen.getByText("None")).toBeInTheDocument();
    expect(screen.getByText(/no free-delivery threshold/i)).toBeInTheDocument();
  });

  it("gives a clear message when the address is not covered", async () => {
    fetchMock.mockImplementation(() => json(200, { serviceable: false, message: "We don't deliver there yet — store pickup is available." }));
    wrap(<DeliveryCheck />);
    await userEvent.type(screen.getByLabelText(/postcode or area/i), "ZZ9");
    await userEvent.click(screen.getByRole("button", { name: /check delivery/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("We don't deliver there yet");
    expect(screen.queryByText(/we deliver to this address/i)).not.toBeInTheDocument();
  });

  it("does not call the API for an empty entry", async () => {
    wrap(<DeliveryCheck />);
    await userEvent.click(screen.getByRole("button", { name: /check delivery/i }));
    expect(await screen.findByText("Enter a postcode or area to check.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
