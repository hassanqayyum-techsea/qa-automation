import { requirePermission } from "~/lib/auth";
import { col } from "~/lib/db";
import { PageHeader } from "~/app/ui/page-header";
import { AddRole, RolesTable } from "../settings-ui";

export const metadata = { title: "Roles" };

export default async function RolesPage() {
  await requirePermission("roles:manage");
  const [roles, counts] = await Promise.all([
    col.roles.find().sort({ builtIn: -1, name: 1 }).toArray(),
    col.users.aggregate<{ _id: string; n: number }>([{ $group: { _id: { $toString: "$roleId" }, n: { $sum: 1 } } }]).toArray(),
  ]);
  const users = new Map(counts.map((c) => [c._id, c.n]));
  return (
    <div className="flex flex-col gap-8 px-4 py-8 md:px-8">
      <PageHeader title="Roles" description="A role is a set of permissions. Changes apply on each person's next click." actions={<AddRole />} />
      <RolesTable
        rows={roles.map((r) => ({
          id: r._id.toString(),
          name: r.name,
          permissions: r.permissions,
          builtIn: r.builtIn,
          users: users.get(r._id.toString()) ?? 0,
        }))}
      />
    </div>
  );
}
