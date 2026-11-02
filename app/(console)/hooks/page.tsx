import { requirePermission } from "~/lib/auth";
import { col } from "~/lib/db";
import { decrypt } from "~/lib/crypto";
import { env } from "~/lib/env";
import { PageHeader } from "~/app/ui/page-header";
import { Empty } from "~/app/ui/empty";
import { EventsTable, WebhookSetup } from "./hooks-view";

export const metadata = { title: "Webhooks" };

export default async function HooksPage() {
  await requirePermission("hooks:view");
  const [orgs, events] = await Promise.all([
    col.orgs.find({}, { projection: { login: 1, webhookSecret: 1, enabled: 1 } }).sort({ login: 1 }).toArray(),
    col.hookEvents.find().sort({ receivedAt: -1 }).limit(100).toArray(),
  ]);
  const orgName = new Map(orgs.map((o) => [o._id.toString(), o.login]));

  return (
    <div className="flex flex-col gap-8 px-4 py-8 md:px-8">
      <PageHeader
        title="Webhooks"
        description="Every push and pull request from a connected organization runs the hook function in the worker. This list updates live."
      />
      {orgs.length === 0 ? (
        <Empty icon="Zap" title="No organizations connected" description="Connect an organization on the Repositories page, then add its webhook here." />
      ) : (
        <WebhookSetup
          payloadUrl={`${env.APP_URL}/api/webhooks/github`}
          orgs={orgs.map((o) => ({ id: o._id.toString(), login: o.login, enabled: o.enabled, secret: decrypt(o.webhookSecret) }))}
        />
      )}
      <EventsTable
        rows={events.map((e) => ({
          id: e._id.toString(),
          at: e.receivedAt.toISOString(),
          type: e.action ? `${e.type}.${e.action}` : e.type,
          org: orgName.get(e.orgId.toString()) ?? "Removed org",
          summary: e.summary,
          status: e.status,
          error: e.error ?? null,
        }))}
      />
    </div>
  );
}
