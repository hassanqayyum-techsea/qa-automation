import { requirePermission } from "~/lib/auth";
import { col } from "~/lib/db";
import { PageHeader } from "~/app/ui/page-header";
import { AddUser, UsersTable } from "../settings-ui";

export const metadata = { title: "Users" };

export default async function UsersPage() {
  const me = await requirePermission("users:manage");
  const [users, roles] = await Promise.all([
    col.users.find({}, { projection: { passwordHash: 0 } }).sort({ name: 1 }).toArray(),
    col.roles.find().sort({ name: 1 }).toArray(),
  ]);
  const roleOpts = roles.map((r) => ({ id: r._id.toString(), name: r.name }));
  const roleName = new Map(roleOpts.map((r) => [r.id, r.name]));

  return (
    <div className="flex flex-col gap-8 px-4 py-8 md:px-8">
      <PageHeader title="Users" description="Create accounts, change roles, reset passwords or disable access." actions={<AddUser roles={roleOpts} />} />
      <UsersTable
        roles={roleOpts}
        rows={users.map((u) => ({
          id: u._id.toString(),
          name: u.name,
          email: u.email,
          roleId: u.roleId.toString(),
          role: roleName.get(u.roleId.toString()) ?? "No role",
          disabled: !!u.disabled,
          createdAt: u.createdAt.toISOString(),
          isSelf: u._id.toString() === me.id,
        }))}
      />
    </div>
  );
}
