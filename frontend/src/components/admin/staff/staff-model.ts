// Pure helpers for the staff screens: form <-> API payloads, validation and the "which stores" summary.
import { isGlobalRole } from "./roles";

export interface StaffRow {
  id: number;
  email: string;
  full_name: string;
  phone: string;
  role: string;
  role_label: string;
  is_active: boolean;
  all_branches: boolean;
  branches: number[];
  has_password: boolean;
  last_login: string | null;
  created_at: string;
  /** Present only on create. */
  invite_email_queued?: boolean;
}

export interface StaffForm { email: string; full_name: string; phone: string; role: string; all_branches: boolean; branches: number[] }

export const EMPTY_STAFF_FORM: StaffForm = { email: "", full_name: "", phone: "", role: "", all_branches: false, branches: [] };

export function formFromStaff(row: StaffRow): StaffForm {
  return { email: row.email, full_name: row.full_name, phone: row.phone ?? "", role: row.role, all_branches: row.all_branches, branches: [...row.branches] };
}

const sortedIds = (ids: number[]) => [...ids].sort((a, b) => a - b);
const sameIds = (a: number[], b: number[]) => a.length === b.length && sortedIds(a).every((v, i) => v === sortedIds(b)[i]);

/** Body of POST /staff/. No password is ever chosen here: the person gets an invite link to set their own. */
export function buildStaffCreate(form: StaffForm) {
  return {
    email: form.email.trim(),
    full_name: form.full_name.trim(),
    phone: form.phone.trim(),
    role: form.role,
    all_branches: form.all_branches,
    branches: sortedIds(form.branches),
  };
}

/** Body of PATCH /staff/{id}/: only the fields that changed. The email is never sent (the API refuses to change it). */
export function buildStaffPatch(initial: StaffForm, current: StaffForm): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (current.full_name.trim() !== initial.full_name.trim()) patch.full_name = current.full_name.trim();
  if (current.phone.trim() !== initial.phone.trim()) patch.phone = current.phone.trim();
  if (current.role !== initial.role) patch.role = current.role;
  if (current.all_branches !== initial.all_branches) patch.all_branches = current.all_branches;
  if (!sameIds(current.branches, initial.branches)) patch.branches = sortedIds(current.branches);
  return patch;
}

/** Obvious-required checks only; the server remains the judge of everything else. */
export function validateStaffForm(form: StaffForm, mode: "create" | "edit"): Record<string, string> {
  const errors: Record<string, string> = {};
  if (mode === "create") {
    if (!form.email.trim()) errors.email = "Enter their work email address.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errors.email = "That doesn't look like an email address.";
  }
  if (form.full_name.trim().length < 2) errors.full_name = "Enter the person's full name.";
  if (!form.role) errors.role = "Choose a role.";
  return errors;
}

/** "All stores", the assigned store names, or "No stores assigned" (which means they see nothing store-specific). */
export function storesSummary(row: Pick<StaffRow, "role" | "all_branches" | "branches">, nameOf: (id: number) => string): string {
  if (isGlobalRole(row.role) || row.all_branches) return "All stores";
  if (row.branches.length === 0) return "No stores assigned";
  return row.branches.map(nameOf).join(", ");
}

/** Changes whenever anything the form shows changes on the server, so the drawer's form can re-initialise. */
export const staffSignature = (r: StaffRow) => [r.id, r.full_name, r.phone, r.role, r.is_active, r.all_branches, sortedIds(r.branches).join(","), r.has_password].join("|");
