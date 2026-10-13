"use client";

import { UserPlus } from "lucide-react";
import * as React from "react";
import { useStoreDateTime } from "@/components/admin/finance/format";
import { AdminPage, DataTable, FilterBar, FilterSelect, Pager, SearchField, useDebouncedValue, type Column } from "@/components/admin/kit";
import { RequireCapability } from "@/components/admin/shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { useAdmin, useAdminList } from "@/lib/admin";
import { CreateStaffDialog, StaffDrawer } from "./staff-dialogs";
import { STAFF_ROLES } from "./roles";
import { storesSummary, type StaffRow } from "./staff-model";

export function StaffPage() {
  return (
    <RequireCapability any={["staff.manage"]}>
      <StaffInner />
    </RequireCapability>
  );
}

function StaffInner() {
  const { perms, branchName } = useAdmin();
  const when = useStoreDateTime({ compact: true });
  const [search, setSearch] = React.useState("");
  const [role, setRole] = React.useState("");
  const [active, setActive] = React.useState("");
  const [ordering, setOrdering] = React.useState("full_name");
  const [page, setPage] = React.useState(1);
  const [creating, setCreating] = React.useState(false);
  const [openId, setOpenId] = React.useState<number | null>(null);
  const q = useDebouncedValue(search.trim());
  const list = useAdminList<StaffRow>("/staff/", { search: q, role, is_active: active, ordering, page });
  const filtered = !!(search || role || active);
  const reset = () => { setSearch(""); setRole(""); setActive(""); setPage(1); };
  const nameOf = (id: number) => { const n = branchName(id); return n === "—" ? `Store #${id}` : n; };

  const columns: Column<StaffRow>[] = [
    {
      key: "name", header: "Name", sort: "full_name",
      cell: (r) => (
        <div className="min-w-0">
          <p className="font-semibold text-ink">{r.full_name}{r.id === perms.id && <span className="ml-2 text-xs font-medium text-ink-3">(you)</span>}</p>
          <p className="break-all text-xs text-ink-3">{r.email}</p>
        </div>
      ),
    },
    { key: "role", header: "Role", sort: "role", cell: (r) => <span className="whitespace-nowrap">{r.role_label}</span> },
    { key: "stores", header: "Stores", hideBelow: "md", cell: (r) => <span className="max-w-60">{storesSummary(r, nameOf)}</span> },
    { key: "status", header: "Status", cell: (r) => (r.is_active ? <Badge tone="ok">Active</Badge> : <Badge tone="bad">Deactivated</Badge>) },
    { key: "login", header: "Last sign-in", sort: "last_login", hideBelow: "lg", cell: (r) => (r.last_login ? <span className="whitespace-nowrap">{when(r.last_login)}</span> : <span className="text-ink-3">{r.has_password ? "Never" : "Invite pending"}</span>) },
    { key: "open", header: "Manage", cell: (r) => <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setOpenId(r.id); }} aria-label={`Manage ${r.full_name}`}>Manage</Button> },
  ];

  return (
    <AdminPage
      title="Staff & roles"
      description="Who can sign in to this dashboard, what their role lets them do, and which stores they work in. Changes take effect on their next request, and every change is recorded in the audit log."
      actions={<Button onClick={() => setCreating(true)}><UserPlus className="size-4" aria-hidden /> Invite staff member</Button>}
    >
      <FilterBar>
        <SearchField value={search} onChange={(v) => { setSearch(v); setPage(1); }} label="Search staff" placeholder="Name, email or phone" />
        <FilterSelect label="Role" value={role} onChange={(v) => { setRole(v); setPage(1); }} options={STAFF_ROLES.map((r) => [r.value, r.label])} allLabel="All roles" />
        <FilterSelect label="Status" value={active} onChange={(v) => { setActive(v); setPage(1); }} options={[["true", "Active"], ["false", "Deactivated"]]} allLabel="All" />
        {filtered && <Button variant="ghost" size="sm" onClick={reset}>Clear filters</Button>}
      </FilterBar>

      <DataTable
        caption="Staff accounts"
        columns={columns}
        rows={list.rows}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        onRowClick={(r) => setOpenId(r.id)}
        ordering={ordering}
        onOrdering={(o) => { setOrdering(o); setPage(1); }}
        empty={filtered
          ? <EmptyState title="No staff match" action={<Button variant="secondary" onClick={reset}>Clear filters</Button>}>Try a different search, role or status.</EmptyState>
          : <EmptyState title="No staff accounts">Invite the first staff member to get started.</EmptyState>}
      />
      {!list.error && !list.isLoading && <Pager page={list.page} totalPages={list.totalPages} count={list.count} onPage={setPage} label="staff accounts" />}

      {creating && <CreateStaffDialog onClose={() => setCreating(false)} />}
      <StaffDrawer staffId={openId} onClose={() => setOpenId(null)} />
    </AdminPage>
  );
}
