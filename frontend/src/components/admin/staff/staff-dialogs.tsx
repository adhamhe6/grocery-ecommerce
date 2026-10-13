"use client";

import { UserCheck, UserX } from "lucide-react";
import * as React from "react";
import { ConfirmDialog, KeyValue } from "@/components/admin/kit";
import { useStoreDateTime } from "@/components/admin/finance/format";
import { serverFormErrors } from "@/components/admin/finance/server-errors";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, Sheet } from "@/components/ui/dialog";
import { Alert, ErrorState, Skeleton } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { adminRequest, useAdmin, useAdminAction, useAdminGet } from "@/lib/admin";
import { mayManage, roleLabel } from "./roles";
import { StaffFields } from "./staff-fields";
import { buildStaffCreate, buildStaffPatch, EMPTY_STAFF_FORM, formFromStaff, staffSignature, validateStaffForm, type StaffForm, type StaffRow } from "./staff-model";

const FIELDS = ["email", "full_name", "phone", "role", "branches", "all_branches", "is_active"] as const;
const INVALIDATE = ["/staff", "/audit"];

// ------------------------------------------------------------------------------------------------ create
export function CreateStaffDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [form, setForm] = React.useState<StaffForm>(EMPTY_STAFF_FORM);
  const [touched, setTouched] = React.useState(false);
  const create = useAdminAction(
    (body: ReturnType<typeof buildStaffCreate>) => adminRequest<StaffRow>("POST", "/staff/", body),
    {
      invalidate: INVALIDATE,
      onSuccess: (row) => {
        if (row.invite_email_queued) toast.success(`Invite sent to ${row.email}`, "They can set their password from the link in the email.");
        else toast.info("Account created, but the invite email couldn't be queued", "Open the account and choose “Resend invite” once email is available.");
        onClose();
      },
    },
  );
  const local = touched ? validateStaffForm(form, "create") : {};
  const server = serverFormErrors(create.error, FIELDS);
  const errors = { ...server.fields, ...local };
  return (
    <Dialog open onOpenChange={(o) => !o && !create.isPending && onClose()}>
      <DialogContent title="Invite a staff member" description="They receive an email with a link to set their own password. You never see or choose it." className="w-[min(94vw,40rem)]">
        <form
          noValidate
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (Object.keys(validateStaffForm(form, "create")).length === 0 && !create.isPending) create.mutate(buildStaffCreate(form));
          }}
        >
          <StaffFields idPrefix="new-staff" mode="create" values={form} onChange={(p) => { setForm((f) => ({ ...f, ...p })); create.reset(); }} errors={errors} />
          {server.form && <Alert tone="bad">{server.form}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={create.isPending}>Cancel</Button>
            <Button type="submit" loading={create.isPending}>Create account and send invite</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------------------------------------ edit drawer
export function StaffDrawer({ staffId, onClose }: { staffId: number | null; onClose: () => void }) {
  return (
    <Sheet open={staffId !== null} onOpenChange={(o) => !o && onClose()} title="Staff member" widthClass="w-[min(100vw,38rem)]">
      <div className="flex-1 overflow-y-auto p-5">{staffId !== null && <DrawerLoader staffId={staffId} />}</div>
    </Sheet>
  );
}

function DrawerLoader({ staffId }: { staffId: number }) {
  const q = useAdminGet<StaffRow>(`/staff/${staffId}/`);
  if (q.isLoading) return <div className="space-y-4" aria-busy="true"><Skeleton className="h-8 w-1/2" /><Skeleton className="h-64 w-full" /></div>;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} title="We couldn't load this person" />;
  return <EditStaff key={staffSignature(q.data)} member={q.data} />;
}

function EditStaff({ member }: { member: StaffRow }) {
  const { perms } = useAdmin();
  const toast = useToast();
  const when = useStoreDateTime();
  const initial = React.useMemo(() => formFromStaff(member), [member]);
  const [form, setForm] = React.useState<StaffForm>(initial);
  const [touched, setTouched] = React.useState(false);
  const [confirming, setConfirming] = React.useState<null | "deactivate" | "reactivate">(null);

  const isSelf = member.id === perms.id;
  const locked = !mayManage(perms.role, member.role);
  const patch = buildStaffPatch(initial, form);
  const dirty = Object.keys(patch).length > 0;

  const save = useAdminAction((body: Record<string, unknown>) => adminRequest<StaffRow>("PATCH", `/staff/${member.id}/`, body), { invalidate: INVALIDATE, success: "Changes saved" });
  const deactivate = useAdminAction(() => adminRequest<StaffRow>("DELETE", `/staff/${member.id}/`), { invalidate: INVALIDATE, success: `${member.full_name} was deactivated`, onSuccess: () => setConfirming(null) });
  const reactivate = useAdminAction(() => adminRequest<StaffRow>("PATCH", `/staff/${member.id}/`, { is_active: true }), { invalidate: INVALIDATE, success: `${member.full_name} was reactivated`, onSuccess: () => setConfirming(null) });
  const invite = useAdminAction(() => adminRequest<{ invite_email_queued: boolean }>("POST", `/staff/${member.id}/resend-invite/`), {
    invalidate: INVALIDATE,
    onSuccess: (r) => (r.invite_email_queued ? toast.success(`Invite re-sent to ${member.email}`) : toast.info("The invite couldn't be queued", "Try again in a moment.")),
  });

  const local = touched ? validateStaffForm(form, "edit") : {};
  const server = serverFormErrors(save.error, FIELDS);
  const errors = { ...server.fields, ...local };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-lg font-semibold text-ink">{member.full_name}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-ink-2">{member.email}<span className={member.is_active ? "font-semibold text-ok" : "font-semibold text-bad"}>{member.is_active ? "Active" : "Deactivated"}</span></p>
      </div>

      {isSelf && <Alert tone="info" title="This is your own account">To avoid locking yourself out you can&apos;t change your own role or deactivate your own account. Ask another super admin if that needs to change.</Alert>}
      {locked && !isSelf && <Alert tone="warn" title="Only a super admin can change this account">{roleLabel(member.role)} accounts are managed by super admins, so everything here is read-only for you.</Alert>}

      <form
        noValidate
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (Object.keys(validateStaffForm(form, "edit")).length === 0 && dirty && !save.isPending) save.mutate(patch);
        }}
      >
        <StaffFields idPrefix={`staff-${member.id}`} mode="edit" values={form} onChange={(p) => { setForm((f) => ({ ...f, ...p })); save.reset(); }} errors={errors} disabled={locked} selfEdit={isSelf} />
        {server.form && <Alert tone="bad">{server.form}</Alert>}
        {!locked && (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {dirty && <Button variant="ghost" onClick={() => { setForm(initial); save.reset(); }} disabled={save.isPending}>Discard changes</Button>}
            <Button type="submit" loading={save.isPending} disabled={!dirty}>Save changes</Button>
          </div>
        )}
      </form>

      <section aria-labelledby="staff-account" className="space-y-4 border-t border-line pt-5">
        <h3 id="staff-account" className="font-sans text-sm font-bold uppercase tracking-wide text-ink-2">Account</h3>
        <KeyValue items={[
          ["Last sign-in", member.last_login ? when(member.last_login) : "Never"],
          ["Created", when(member.created_at)],
          ["Password", member.has_password ? "Set by the person" : "Not set yet — invite pending"],
        ]} />

        {!locked && member.is_active && !member.has_password && (
          <div>
            <Button variant="secondary" loading={invite.isPending} onClick={() => invite.mutate(undefined)}>Resend invite email</Button>
            <p className="mt-1.5 text-sm text-ink-3">Sends a fresh link to set a password. People who already have a password use “Forgot password” on the sign-in page instead.</p>
          </div>
        )}

        {member.is_active ? (
          <div>
            <Button variant="danger" onClick={() => setConfirming("deactivate")} disabled={isSelf || locked}><UserX className="size-4" aria-hidden /> Deactivate account</Button>
            <p className="mt-1.5 text-sm text-ink-3">{isSelf ? "You can't deactivate your own account." : locked ? "Only a super admin can deactivate this account." : "They won't be able to sign in or use the dashboard. Their history stays on orders and in the audit log, and you can reactivate them later."}</p>
          </div>
        ) : (
          <div>
            <Button onClick={() => setConfirming("reactivate")} disabled={locked}><UserCheck className="size-4" aria-hidden /> Reactivate account</Button>
            <p className="mt-1.5 text-sm text-ink-3">They regain access with the role and stores shown above.</p>
          </div>
        )}
      </section>

      <ConfirmDialog open={confirming === "deactivate"} onOpenChange={(o) => !o && !deactivate.isPending && setConfirming(null)} danger title={`Deactivate ${member.full_name}?`}
        description="They will no longer be able to sign in or use the staff dashboard." confirmLabel="Deactivate" loading={deactivate.isPending} onConfirm={() => deactivate.mutate(undefined)}>
        {deactivate.error ? <Alert tone="bad">{serverFormErrors(deactivate.error, []).form}</Alert> : null}
      </ConfirmDialog>
      <ConfirmDialog open={confirming === "reactivate"} onOpenChange={(o) => !o && !reactivate.isPending && setConfirming(null)} title={`Reactivate ${member.full_name}?`}
        description={`They will be able to sign in again as ${roleLabel(member.role).toLowerCase()}.`} confirmLabel="Reactivate" loading={reactivate.isPending} onConfirm={() => reactivate.mutate(undefined)}>
        {reactivate.error ? <Alert tone="bad">{serverFormErrors(reactivate.error, []).form}</Alert> : null}
      </ConfirmDialog>
    </div>
  );
}
