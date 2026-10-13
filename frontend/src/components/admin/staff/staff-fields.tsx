"use client";

import * as React from "react";
import { Checkbox, Field, Input, Select, describedBy } from "@/components/ui/field";
import { Alert } from "@/components/ui/states";
import { useAdmin } from "@/lib/admin";
import { ALL_CAPABILITIES, groupCapabilities, isGlobalRole, mayAssignRole, ROLE_CAPABILITIES, roleLabel, STAFF_ROLES } from "./roles";
import type { StaffForm } from "./staff-model";

/** Read-only list of what a role can do, from the reference copy of the role matrix. */
export function RoleCapabilities({ role }: { role: string }) {
  const caps = ROLE_CAPABILITIES[role];
  if (!role || !caps) return null;
  const everything = caps.length === ALL_CAPABILITIES.length;
  return (
    <div className="rounded-md border border-line bg-paper-2/50 p-3 text-sm">
      <p className="font-semibold text-ink">What a {roleLabel(role).toLowerCase()} can do</p>
      {everything ? (
        <p className="mt-1 text-ink-2">Everything, in every store: all {caps.length} permissions, including staff, store settings and the audit log. Only a super admin can create or change admin and super admin accounts.</p>
      ) : (
        <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-[8.5rem_1fr]">
          {groupCapabilities(caps).map((g) => (
            <React.Fragment key={g.area}>
              <dt className="pt-1.5 text-ink-3 sm:pt-0">{g.label}</dt>
              <dd className="text-ink">{g.actions.join(", ")}</dd>
            </React.Fragment>
          ))}
        </dl>
      )}
      <p className="mt-2 text-xs text-ink-3">The server doesn&apos;t publish role permissions, so this is a reference copy of the role matrix; the server decides what anyone can actually do.</p>
    </div>
  );
}

export function StaffFields({
  idPrefix, mode, values, onChange, errors, disabled, selfEdit,
}: {
  idPrefix: string; mode: "create" | "edit"; values: StaffForm; onChange: (patch: Partial<StaffForm>) => void; errors: Record<string, string>; disabled?: boolean; selfEdit?: boolean;
}) {
  const { perms, branches } = useAdmin();
  const id = (n: string) => `${idPrefix}-${n}`;
  const global = isGlobalRole(values.role);
  const known = new Set(branches.map((b) => b.id));
  const unknownCount = values.branches.filter((b) => !known.has(b)).length;
  const toggleBranch = (bid: number, on: boolean) => onChange({ branches: on ? [...values.branches, bid] : values.branches.filter((b) => b !== bid) });
  const noStores = !global && !values.all_branches && values.branches.length === 0 && values.role !== "";

  return (
    <div className="space-y-4">
      <Field label="Email address" htmlFor={id("email")} required={mode === "create"} error={errors.email}
        hint={mode === "edit" ? "A staff member's email can't be changed. To use a different address, deactivate this account and invite the new one." : "They get an email invite to set their own password."}>
        <Input id={id("email")} type="email" autoComplete="off" value={values.email} onChange={(e) => onChange({ email: e.target.value })} readOnly={mode === "edit"} disabled={mode === "edit"} aria-invalid={!!errors.email} aria-describedby={describedBy(id("email"), true, !!errors.email)} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" htmlFor={id("name")} required error={errors.full_name}>
          <Input id={id("name")} autoComplete="off" value={values.full_name} onChange={(e) => onChange({ full_name: e.target.value })} disabled={disabled} aria-invalid={!!errors.full_name} aria-describedby={describedBy(id("name"), false, !!errors.full_name)} />
        </Field>
        <Field label="Phone" htmlFor={id("phone")} error={errors.phone} hint="Optional.">
          <Input id={id("phone")} type="tel" autoComplete="off" value={values.phone} onChange={(e) => onChange({ phone: e.target.value })} disabled={disabled} aria-invalid={!!errors.phone} aria-describedby={describedBy(id("phone"), true, !!errors.phone)} />
        </Field>
      </div>

      <Field label="Role" htmlFor={id("role")} required error={errors.role} hint={selfEdit ? "You can't change your own role." : perms.role !== "SUPER_ADMIN" ? "Only a super admin can create or change admin and super admin accounts." : undefined}>
        <Select id={id("role")} value={values.role} onChange={(e) => onChange({ role: e.target.value })} disabled={disabled || selfEdit} aria-invalid={!!errors.role} aria-describedby={describedBy(id("role"), true, !!errors.role)}>
          {mode === "create" && <option value="">Choose a role…</option>}
          {STAFF_ROLES.map((r) => <option key={r.value} value={r.value} disabled={!mayAssignRole(perms.role, r.value) && r.value !== values.role}>{r.label}{!mayAssignRole(perms.role, r.value) ? " (super admin only)" : ""}</option>)}
        </Select>
      </Field>
      <RoleCapabilities role={values.role} />

      <fieldset className="space-y-2" disabled={disabled}>
        <legend className="text-sm font-semibold text-ink">Stores</legend>
        {global ? (
          <p className="text-sm text-ink-2">{roleLabel(values.role)}s can see and work in every store, so store assignments don&apos;t apply.</p>
        ) : (
          <>
            <p className="text-sm text-ink-2">Everyone else only sees orders, stock and payments for the stores they are assigned to.</p>
            <Checkbox label="Can access every store" checked={values.all_branches} onChange={(e) => onChange({ all_branches: e.target.checked })} />
            <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label="Assigned stores">
              {branches.map((b) => (
                <Checkbox key={b.id} label={<>{b.name} <span className="text-ink-3">({b.code})</span></>} checked={values.all_branches || values.branches.includes(b.id)} disabled={values.all_branches} onChange={(e) => toggleBranch(b.id, e.target.checked)} />
              ))}
            </div>
            {unknownCount > 0 && <p className="text-xs text-ink-3">Also assigned to {unknownCount} {unknownCount === 1 ? "store" : "stores"} that are inactive; those assignments are kept.</p>}
            {errors.branches && <p role="alert" className="text-sm font-medium text-bad">{errors.branches}</p>}
            {noStores && <Alert tone="warn">No stores are selected, so this person won&apos;t see any store data until one is assigned.</Alert>}
          </>
        )}
      </fieldset>
    </div>
  );
}
