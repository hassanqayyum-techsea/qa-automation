import { requirePermission } from "~/lib/auth";
import { col } from "~/lib/db";
import { PageHeader } from "~/app/ui/page-header";
import { AuditTable } from "./audit-table";

export const metadata = { title: "Audit log" };

export default async function AuditPage() {
  await requirePermission("audit:view");
  const entries = await col.audit.find().sort({ at: -1 }).limit(200).toArray();
  return (
    <div className="flex flex-col gap-8 px-4 py-8 md:px-8">
      <PageHeader title="Audit log" description="Every change to tokens, scope, users, roles, apps and test runs. Newest 200." />
      <AuditTable
        rows={entries.map((e) => ({
          id: e._id.toString(),
          at: e.at.toISOString(),
          who: e.actorEmail,
          action: e.action,
          target: e.target,
          details: e.details ? JSON.stringify(e.details) : "",
        }))}
      />
    </div>
  );
}
