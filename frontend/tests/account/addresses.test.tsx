import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddressesView } from "@/components/account/addresses-view";
import { apiError, mockApi, renderWithProviders } from "./helpers";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), usePathname: () => "/account/addresses", useSearchParams: () => new URLSearchParams() }));
afterEach(() => vi.unstubAllGlobals());

const home = { id: 1, label: "Home", recipient_name: "Ada Lovelace", phone: "555 010 2030", line1: "1 Orchard Row", line2: "", city: "Springfield", area: "Old Town", postal_code: "12345", instructions: "Ring twice", is_default: true };
const work = { ...home, id: 2, label: "Work", line1: "9 Market St", instructions: "", is_default: false };

async function fillNew() {
  await userEvent.type(screen.getByLabelText(/^Recipient name/), "Ada Lovelace");
  await userEvent.type(screen.getByLabelText(/^Phone number/), "555 010 2030");
  await userEvent.type(screen.getByLabelText(/^Address line 1/), "1 Orchard Row");
  await userEvent.type(screen.getByLabelText(/^Town or city/), "Springfield");
}

describe("AddressesView", () => {
  it("shows saved addresses with the default marked", async () => {
    mockApi({ "GET /addresses/": { json: [home, work] } });
    renderWithProviders(<AddressesView />);
    expect(await screen.findByText("1 Orchard Row")).toBeInTheDocument();
    expect(screen.getByText("Default")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Make Work my default address" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Make Home my default address" })).not.toBeInTheDocument();
  });

  it("has an empty state that opens the form; the first address becomes the default", async () => {
    const api = mockApi({ "GET /addresses/": { json: [] }, "POST /addresses/": { status: 201, json: { ...home } } });
    renderWithProviders(<AddressesView />);
    await userEvent.click(await screen.findByRole("button", { name: /Add an address/ }));
    const dialog = await screen.findByRole("dialog", { name: "Add an address" });
    expect(within(dialog).getByText(/will be your default address/)).toBeInTheDocument();
    await fillNew();
    await userEvent.click(within(dialog).getByRole("button", { name: "Save address" }));
    await waitFor(() => expect(api.calls.some((c) => c.key === "POST /addresses/")).toBe(true));
    expect(api.calls.find((c) => c.key === "POST /addresses/")?.body).toMatchObject({ recipient_name: "Ada Lovelace", phone: "555 010 2030", line1: "1 Orchard Row", city: "Springfield", is_default: true });
  });

  it("checks the phone number like the API does before sending", async () => {
    const api = mockApi({ "GET /addresses/": { json: [] } });
    renderWithProviders(<AddressesView />);
    await userEvent.click(await screen.findByRole("button", { name: /Add an address/ }));
    await fillNew();
    await userEvent.clear(screen.getByLabelText(/^Phone number/));
    await userEvent.type(screen.getByLabelText(/^Phone number/), "12-34");
    await userEvent.click(screen.getByRole("button", { name: "Save address" }));
    expect(await screen.findByText("Enter a phone number we can reach you on.")).toBeInTheDocument();
    expect(api.calls.some((c) => c.key === "POST /addresses/")).toBe(false);
  });

  it("shows API field errors on the matching field", async () => {
    mockApi({ "GET /addresses/": { json: [] }, "POST /addresses/": apiError(400, "VALIDATION_ERROR", "Please correct the highlighted fields.", { phone: ["Enter a phone number we can reach you on."] }) });
    renderWithProviders(<AddressesView />);
    await userEvent.click(await screen.findByRole("button", { name: /Add an address/ }));
    await fillNew();
    await userEvent.click(screen.getByRole("button", { name: "Save address" }));
    await waitFor(() => expect(screen.getByLabelText(/^Phone number/)).toHaveAttribute("aria-invalid", "true"));
  });

  it("deletes only after confirmation", async () => {
    let addresses = [home, work];
    const api = mockApi({ "GET /addresses/": () => ({ json: addresses }), "DELETE /addresses/2/": () => { addresses = [home]; return { status: 204 }; } });
    renderWithProviders(<AddressesView />);
    await userEvent.click(await screen.findByRole("button", { name: "Delete address Work" }));
    const dialog = await screen.findByRole("alertdialog").catch(() => screen.findByRole("dialog", { name: "Delete this address?" }));
    expect(api.calls.some((c) => c.key === "DELETE /addresses/2/")).toBe(false);
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete address" }));
    await waitFor(() => expect(screen.queryByText("9 Market St")).not.toBeInTheDocument());
    expect(api.calls.filter((c) => c.key === "DELETE /addresses/2/")).toHaveLength(1);
  });

  it("sets a new default through the dedicated endpoint", async () => {
    const api = mockApi({ "GET /addresses/": { json: [home, work] }, "POST /addresses/2/make-default/": { json: { ...work, is_default: true } } });
    renderWithProviders(<AddressesView />);
    await userEvent.click(await screen.findByRole("button", { name: "Make Work my default address" }));
    await waitFor(() => expect(api.calls.some((c) => c.key === "POST /addresses/2/make-default/")).toBe(true));
  });
});
