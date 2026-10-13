import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CreateStaffDialog } from "@/components/admin/staff/staff-dialogs";
import { apiError, mockApi, perms, renderAdmin } from "../finance/helpers";

afterEach(() => vi.unstubAllGlobals());

async function fill(user: ReturnType<typeof userEvent.setup>, over: { email?: string; name?: string; role?: string } = {}) {
  await user.type(screen.getByLabelText(/email address/i), over.email ?? "new.person@example.com");
  await user.type(screen.getByLabelText(/full name/i), over.name ?? "New Person");
  await user.selectOptions(screen.getByLabelText(/^role/i), over.role ?? "STORE_MANAGER");
}

describe("CreateStaffDialog", () => {
  it("asks for the obvious required fields before calling the API", async () => {
    const api = mockApi({});
    const user = userEvent.setup();
    renderAdmin(<CreateStaffDialog onClose={() => {}} />);
    await user.click(screen.getByRole("button", { name: /create account and send invite/i }));
    expect(await screen.findByText(/enter their work email/i)).toBeInTheDocument();
    expect(screen.getByText(/enter the person's full name/i)).toBeInTheDocument();
    expect(screen.getByText("Choose a role.")).toBeInTheDocument();
    expect(api.calls).toHaveLength(0);
  });

  it("shows the capabilities of the chosen role (from the reference matrix) and explains store assignment", async () => {
    const user = userEvent.setup();
    renderAdmin(<CreateStaffDialog onClose={() => {}} />);
    await user.selectOptions(screen.getByLabelText(/^role/i), "FULFILMENT_STAFF");
    expect(screen.getByText(/what a fulfilment staff can do/i)).toBeInTheDocument();
    expect(screen.getByText("read, fulfil")).toBeInTheDocument(); // orders
    expect(screen.getByRole("group", { name: /assigned stores/i })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText(/^role/i), "ADMIN");
    expect(screen.getByText(/can see and work in every store/i)).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /assigned stores/i })).not.toBeInTheDocument();
  });

  it("sends the new account without any password, then closes", async () => {
    const onClose = vi.fn();
    const api = mockApi({ "POST /admin/staff/": { status: 201, json: { id: 9, email: "new.person@example.com", invite_email_queued: true } } });
    const user = userEvent.setup();
    renderAdmin(<CreateStaffDialog onClose={onClose} />);
    await fill(user);
    await user.click(screen.getByLabelText("Central (CEN)"));
    await user.click(screen.getByRole("button", { name: /create account and send invite/i }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.of("POST /admin/staff/")[0].body).toEqual({
      email: "new.person@example.com", full_name: "New Person", phone: "", role: "STORE_MANAGER", all_branches: false, branches: [1],
    });
  });

  it("puts a server field error on that field and keeps what was typed", async () => {
    mockApi({ "POST /admin/staff/": apiError(400, "VALIDATION_ERROR", "Please correct the highlighted fields.", { email: ["An account with this email already exists."] }) });
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderAdmin(<CreateStaffDialog onClose={onClose} />);
    await fill(user);
    await user.click(screen.getByRole("button", { name: /create account and send invite/i }));
    const message = await screen.findByText("An account with this email already exists.");
    const email = screen.getByLabelText(/email address/i);
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email.getAttribute("aria-describedby")).toBe(message.id);
    expect(email).toHaveValue("new.person@example.com");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows the server's sentence when a rule refuses the request (403)", async () => {
    mockApi({ "POST /admin/staff/": apiError(403, "FORBIDDEN", "Only a super admin can create or change admin and super admin accounts.") });
    const user = userEvent.setup();
    renderAdmin(<CreateStaffDialog onClose={() => {}} />, perms({ role: "ADMIN" }));
    await fill(user);
    await user.click(screen.getByRole("button", { name: /create account and send invite/i }));
    expect(await screen.findByText(/only a super admin can create or change admin/i, { selector: "div" })).toBeInTheDocument();
  });

  it("an admin can't pick the admin roles: they are disabled and labelled", () => {
    renderAdmin(<CreateStaffDialog onClose={() => {}} />, perms({ role: "ADMIN" }));
    const select = screen.getByLabelText(/^role/i);
    expect(within(select).getByRole("option", { name: /^Super admin/ })).toBeDisabled();
    expect(within(select).getByRole("option", { name: /^Admin/ })).toBeDisabled();
    expect(within(select).getByRole("option", { name: "Store manager" })).toBeEnabled();
  });
});
