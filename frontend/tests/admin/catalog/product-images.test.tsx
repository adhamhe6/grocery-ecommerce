import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProductImages } from "@/components/admin/catalog/product-images";
import { ApiError } from "@/lib/api";
import { mockApi, renderAdmin } from "./helpers";

const upload = vi.hoisted(() => ({ uploadMultipart: vi.fn() }));
vi.mock("@/components/admin/catalog/upload", async (orig) => ({ ...(await orig<typeof import("@/components/admin/catalog/upload")>()), uploadMultipart: upload.uploadMultipart }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); upload.uploadMultipart.mockReset(); });

const img = (id: number, order: number, alt: string) => ({ id, alt_text: alt, sort_order: order, urls: { original: `/media/${id}.webp`, "320": `/media/${id}-w320.webp` }, created_at: "x" });
const file = (name = "apple.jpg", type = "image/jpeg") => new File([new Uint8Array([1, 2, 3])], name, { type });

describe("ProductImages", () => {
  it("marks the first picture primary, reorders with buttons through the order endpoint, and deletes after confirming", async () => {
    const api = mockApi({
      "PATCH /admin/products/9/images/order/": { json: [] },
      "DELETE /admin/products/9/images/12/": { status: 204 },
    });
    const user = userEvent.setup({ delay: null });
    renderAdmin(<ProductImages productId={9} images={[img(11, 0, "Front"), img(12, 1, "Side"), img(13, 2, "Back")]} canWrite />);
    expect(screen.getByText("Primary")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move image 1 up" })).toBeDisabled();

    await user.click(screen.getAllByRole("button", { name: "Make primary" })[1]); // the third picture
    await waitFor(() => expect(api.calls.find((c) => c.key === "PATCH /admin/products/9/images/order/")?.body).toEqual({ ids: [13, 11, 12] }));

    await user.click(screen.getByRole("button", { name: "Move image 2 down" }));
    await waitFor(() => expect(api.calls.filter((c) => c.key === "PATCH /admin/products/9/images/order/").at(-1)?.body).toEqual({ ids: [11, 13, 12] }));

    await user.click(screen.getByRole("button", { name: "Delete image 2" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete this picture?" });
    expect(api.calls.some((c) => c.key === "DELETE /admin/products/9/images/12/")).toBe(false); // nothing happens until confirmed
    await user.click(within(dialog).getByRole("button", { name: "Delete picture" }));
    await waitFor(() => expect(api.calls.some((c) => c.key === "DELETE /admin/products/9/images/12/")).toBe(true));
  });

  it("needs a file and alt text before uploading", async () => {
    mockApi({});
    const user = userEvent.setup({ delay: null });
    renderAdmin(<ProductImages productId={9} images={[]} canWrite />);
    expect(screen.getByText(/No pictures yet/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Upload picture" }));
    expect(await screen.findByText("Choose a JPEG, PNG or WebP picture.")).toBeInTheDocument();
    expect(screen.getByText("Describe the picture for people using screen readers.", { selector: "p[role=alert]" })).toBeInTheDocument();
    expect(screen.getByLabelText(/Alt text for this picture/)).toHaveAttribute("aria-invalid", "true");
    expect(upload.uploadMultipart).not.toHaveBeenCalled();
  });

  it("uploads with the right fields and reports progress, then clears the form", async () => {
    upload.uploadMultipart.mockImplementation(async (_path: string, _form: FormData, opts: { onProgress?: (n: number) => void }) => { opts.onProgress?.(40); return { id: 20 }; });
    mockApi({});
    const user = userEvent.setup({ delay: null });
    renderAdmin(<ProductImages productId={9} images={[]} canWrite />);
    await user.upload(screen.getByLabelText(/Picture file/), file());
    await user.type(screen.getByLabelText(/Alt text for this picture/), "A bowl of apples");
    await user.click(screen.getByRole("button", { name: "Upload picture" }));
    await waitFor(() => expect(upload.uploadMultipart).toHaveBeenCalledTimes(1));
    const [path, form] = upload.uploadMultipart.mock.calls[0] as [string, FormData];
    expect(path).toBe("/products/9/images/");
    expect(form.get("alt_text")).toBe("A bowl of apples");
    expect((form.get("image") as File).name).toBe("apple.jpg");
    await waitFor(() => expect(screen.getByLabelText(/Alt text for this picture/)).toHaveValue(""));
  });

  it("shows the server's validation message for a rejected file under the file field", async () => {
    upload.uploadMultipart.mockRejectedValue(new ApiError(400, "VALIDATION_ERROR", "Please correct the highlighted fields.", { image: ["Only JPEG, PNG or WebP images are accepted."] }));
    mockApi({});
    const user = userEvent.setup({ delay: null, applyAccept: false }); // a browser's "All files" option lets a wrong type through; the server has the last word
    renderAdmin(<ProductImages productId={9} images={[]} canWrite />);
    await user.upload(screen.getByLabelText(/Picture file/), file("logo.svg", "image/svg+xml"));
    await user.type(screen.getByLabelText(/Alt text for this picture/), "Logo");
    await user.click(screen.getByRole("button", { name: "Upload picture" }));
    const input = screen.getByLabelText(/Picture file/);
    await waitFor(() => expect(input).toHaveAttribute("aria-invalid", "true"));
    expect(document.getElementById(input.getAttribute("aria-describedby")!)).toHaveTextContent("Only JPEG, PNG or WebP images are accepted.");
  });

  it("stops at the eight-picture limit and is read-only without catalog.write", async () => {
    mockApi({});
    const eight = Array.from({ length: 8 }, (_, i) => img(i + 1, i, `Photo ${i + 1}`));
    const { unmount } = renderAdmin(<ProductImages productId={9} images={eight} canWrite />);
    expect(screen.getByLabelText(/Picture file/)).toBeDisabled();
    expect(screen.getByText(/The limit of 8 pictures is reached/)).toBeInTheDocument();
    unmount();
    renderAdmin(<ProductImages productId={9} images={eight} canWrite={false} />);
    expect(screen.queryByRole("button", { name: "Upload picture" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delete image/ })).not.toBeInTheDocument();
  });
});
