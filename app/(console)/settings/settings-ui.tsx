"use client";

import { useId } from "react";
import { Table, TableCard } from "@your-job-search-genius/odyssey-ui/components/application/table/table";
import { Input } from "@your-job-search-genius/odyssey-ui/components/base/input/input";
import { Select } from "@your-job-search-genius/odyssey-ui/components/base/select/select";
import { Checkbox } from "@your-job-search-genius/odyssey-ui/components/base/checkbox/checkbox";
import { Badge } from "@your-job-search-genius/odyssey-ui/components/base/badges/badges";
import { ConfirmButton, FormModal } from "~/app/ui/dialogs";
import { PERMISSIONS, type Permission } from "~/lib/permissions";
import { createUser, deleteRole, saveRole, updateUser } from "./actions";

type RoleOpt = { id: string; name: string };
type UserRow = { id: string; name: string; email: string; roleId: string; role: string; disabled: boolean; createdAt: string; isSelf: boolean };

const RoleSelect = ({ roles, value }: { roles: RoleOpt[]; value?: string }) => (
  <Select name="roleId" label="Role" items={roles.map((r) => ({ id: r.id, label: r.name }))} defaultSelectedKey={value} placeholder="Pick a role" isRequired>
    {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
  </Select>
);

export function AddUser({ roles }: { roles: RoleOpt[] }) {
  return (
    <FormModal trigger={{ label: "Add user" }} title="Add a user" description="They sign in with this email and password. There's no invite email, so share the password with them privately." action={createUser} submitLabel="Add user">
      <Input name="name" label="Name" isRequired autoComplete="off" />
      <Input name="email" type="email" label="Email" isRequired autoComplete="off" />
      <RoleSelect roles={roles} />
      <Input name="password" type="password" label="Temporary password" hint="At least 12 characters." isRequired autoComplete="new-password" />
    </FormModal>
  );
}

export function UsersTable({ rows, roles }: { rows: UserRow[]; roles: RoleOpt[] }) {
  return (
    <TableCard.Root>
      <TableCard.Header title="Users" description="Everyone who can sign in. Roles decide what each person sees and can change." />
      <div className="overflow-x-auto">
        <Table aria-label="Users">
          <Table.Header>
            <Table.Head id="name" label="Person" isRowHeader />
            <Table.Head id="role" label="Role" />
            <Table.Head id="status" label="Status" className="hidden md:table-cell" />
            <Table.Head id="actions" label="Actions" />
          </Table.Header>
          <Table.Body items={rows}>
            {(u) => (
              <Table.Row id={u.id}>
                <Table.Cell>
                  <span className="flex min-w-0 flex-col">
                    <span className="font-medium text-primary">{u.isSelf ? `${u.name} (you)` : u.name}</span>
                    <span className="text-sm text-tertiary">{u.email}</span>
                  </span>
                </Table.Cell>
                <Table.Cell>{u.role}</Table.Cell>
                <Table.Cell className="hidden md:table-cell">
                  {u.disabled ? <Badge size="sm" color="gray">Disabled</Badge> : <Badge size="sm" color="success">Active</Badge>}
                </Table.Cell>
                <Table.Cell>
                  <FormModal
                    trigger={{ label: "Edit", color: "secondary", size: "sm" }}
                    title={`Edit ${u.name}`}
                    action={updateUser.bind(null, u.id)}
                    submitLabel="Save changes"
                  >
                    <Input name="name" label="Name" defaultValue={u.name} isRequired />
                    <RoleSelect roles={roles} value={u.roleId} />
                    <Input name="password" type="password" label="New password" hint="Leave empty to keep the current password." autoComplete="new-password" />
                    {!u.isSelf && <Checkbox name="disabled" defaultSelected={u.disabled} label="Disable this account" hint="They're signed out on their next request." />}
                  </FormModal>
                </Table.Cell>
              </Table.Row>
            )}
          </Table.Body>
        </Table>
      </div>
    </TableCard.Root>
  );
}

function PermissionFields({ selected }: { selected?: Permission[] }) {
  const id = useId();
  // No checkbox-group component in Odyssey, so the group gets its name the plain ARIA way.
  return (
    <div role="group" aria-labelledby={id} className="flex flex-col gap-3">
      <span id={id} className="text-sm font-medium text-secondary">Permissions</span>
      {(Object.keys(PERMISSIONS) as Permission[]).map((p) => (
        <Checkbox key={p} name="permissions" value={p} defaultSelected={selected?.includes(p)} label={p} hint={PERMISSIONS[p]} />
      ))}
    </div>
  );
}

export function AddRole() {
  return (
    <FormModal trigger={{ label: "New role" }} title="New role" description="Pick exactly what people with this role can see and do." action={saveRole.bind(null, null)} submitLabel="Create role">
      <Input name="name" label="Role name" placeholder="Team lead" isRequired />
      <PermissionFields />
    </FormModal>
  );
}

type RoleRow = { id: string; name: string; permissions: Permission[]; builtIn: boolean; users: number };

export function RolesTable({ rows }: { rows: RoleRow[] }) {
  return (
    <TableCard.Root>
      <TableCard.Header title="Roles" description="Built-in roles are fixed. Create custom roles for anything in between." />
      <div className="overflow-x-auto">
        <Table aria-label="Roles">
          <Table.Header>
            <Table.Head id="name" label="Role" isRowHeader />
            <Table.Head id="perms" label="Permissions" />
            <Table.Head id="users" label="Users" />
            <Table.Head id="actions" label="Actions" />
          </Table.Header>
          <Table.Body items={rows}>
            {(r) => (
              <Table.Row id={r.id}>
                <Table.Cell>
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-primary">{r.name}</span>
                    {r.builtIn && <Badge size="sm" color="gray">Built-in</Badge>}
                  </span>
                </Table.Cell>
                <Table.Cell>
                  <span className="text-sm wrap-anywhere">{r.permissions.join(", ")}</span>
                </Table.Cell>
                <Table.Cell>{r.users}</Table.Cell>
                <Table.Cell>
                  {r.builtIn ? (
                    "Read-only"
                  ) : (
                    <span className="flex flex-wrap gap-2">
                      <FormModal trigger={{ label: "Edit", color: "secondary", size: "sm" }} title={`Edit ${r.name}`} action={saveRole.bind(null, r.id)} submitLabel="Save role">
                        <Input name="name" label="Role name" defaultValue={r.name} isRequired />
                        <PermissionFields selected={r.permissions} />
                      </FormModal>
                      <ConfirmButton
                        trigger={{ label: "Delete", destructive: true }}
                        title={`Delete the ${r.name} role?`}
                        description="Only roles nobody has can be deleted."
                        confirmLabel="Delete role"
                        onConfirm={() => deleteRole(r.id)}
                      />
                    </span>
                  )}
                </Table.Cell>
              </Table.Row>
            )}
          </Table.Body>
        </Table>
      </div>
    </TableCard.Root>
  );
}
