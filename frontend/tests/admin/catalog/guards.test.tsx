import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Link from "next/link";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Taxonomy } from "@/components/admin/catalog/taxonomy";
import { useUnsavedGuard } from "@/components/admin/catalog/form-kit";
import { apiError, mockApi, renderAdmin } from "./helpers";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: push, prefetch: vi.fn() }), usePathname: () => "/admin/products/9" }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); push.mockClear(); });

function Harness({ dirty }: { dirty: boolean }) {
  const guard = useUnsavedGuard(dirty);
  return <div>{guard.dialog}<Link href="/admin/orders">Orders</Link><Link href="/admin/products/9#images">Jump to images</Link></div>;
}

describe("useUnsavedGuard", () => {
  it("lets links through while nothing is unsaved", async () => {
    const user = userEvent.setup({ delay: null });
    render(<Harness dirty={false} />);
    await user.click(screen.getByRole("link", { name: "Orders" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("asks before leaving with unsaved edits, and only navigates when confirmed", async () => {
    const user = userEvent.setup({ delay: null });
    render(<Harness dirty />);
    await user.click(screen.getByRole("link", { name: "Orders" }));
    const dialog = await screen.findByRole("dialog", { name: "Leave without saving?" });
    expect(push).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(push).not.toHaveBeenCalled();
    await user.click(screen.getByRole("link", { name: "Orders" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Leave page" }));
    expect(push).toHaveBeenCalledWith("/admin/orders");
  });

  it("does not interfere with in-page anchors, and registers the browser's own unload prompt", async () => {
    const user = userEvent.setup({ delay: null });
    render(<Harness dirty />);
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    window.history.replaceState(null, "", "/admin/products/9");
    await user.click(screen.getByRole("link", { name: "Jump to images" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("editor sheets", () => {
  const cat = { id: 2, parent: null, name: "Dairy", slug: "dairy", description: "", image: {}, sort_order: 100, is_active: true, show_on_home: false, product_count: 3, active_product_count: 3, children_count: 0 };

  it("asks before discarding edits when the panel is closed", async () => {
    mockApi({ "GET /admin/categories/": { json: [cat] } });
    const user = userEvent.setup({ delay: null });
    renderAdmin(<Taxonomy />, ["catalog.read", "catalog.write"]);
    await user.click(await screen.findByRole("button", { name: /Edit Dairy/ }));
    const sheet = await screen.findByRole("dialog", { name: "Edit Dairy" });
    await user.type(within(sheet).getByRole("textbox", { name: "Name" }), " products");
    await user.keyboard("{Escape}");
    const confirm = await screen.findByRole("dialog", { name: "Discard your changes?" });
    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("dialog", { name: "Edit Dairy" })).toBeInTheDocument();
    expect(within(screen.getByRole("dialog", { name: "Edit Dairy" })).getByRole("textbox", { name: "Name" })).toHaveValue("Dairy products");
  });

  it("shows the server's reason when a category can't be deleted, and keeps the panel open", async () => {
    mockApi({
      "GET /admin/categories/": { json: [cat] },
      "DELETE /admin/categories/2/": apiError(409, "INVALID_STATE", "This category still contains 3 product(s) (3 active), so it can't be deleted. Move them elsewhere first."),
    });
    const user = userEvent.setup({ delay: null });
    renderAdmin(<Taxonomy />, ["catalog.read", "catalog.write"]);
    await user.click(await screen.findByRole("button", { name: /Edit Dairy/ }));
    const sheet = await screen.findByRole("dialog", { name: "Edit Dairy" });
    await user.click(within(sheet).getByRole("button", { name: "Delete…" }));
    const confirm = await screen.findByRole("dialog", { name: "Delete Dairy?" });
    await user.click(within(confirm).getByRole("button", { name: "Delete" }));
    expect(await within(confirm).findByText(/still contains 3 product\(s\)/)).toBeInTheDocument();
    const open = screen.getAllByRole("dialog", { hidden: true });
    expect(open).toHaveLength(2); // the editor panel is still there, behind the confirmation
    expect(open[0]).toHaveTextContent("Edit Dairy");
  });
});
