import { Input } from "@your-job-search-genius/odyssey-ui/components/base/input/input";
import { can, requirePermission } from "~/lib/auth";
import { col } from "~/lib/db";
import { writeScopesOf } from "~/lib/github";
import { PageHeader } from "~/app/ui/page-header";
import { Empty } from "~/app/ui/empty";
import { FormModal } from "~/app/ui/dialogs";
import { connectOrg } from "./actions";
import { OrgCard, type OrgView } from "./org-card";

export const metadata = { title: "Repositories" };

export default async function ReposPage() {
  const user = await requirePermission("analytics:view");
  const manage = can(user, "scope:manage");
  const seeHidden = can(user, "hidden:view");
  // People who can't manage scope only see what dashboards include: enabled, and visible to them.
  const scope = manage ? {} : { enabled: true, ...(seeHidden ? {} : { hidden: false }) };

  const orgs = await col.orgs.find(scope, { projection: { token: 0, webhookSecret: 0 } }).sort({ login: 1 }).toArray();
  const repos = await col.repos.find({ orgId: { $in: orgs.map((o) => o._id) }, ...scope }).sort({ name: 1 }).toArray();
  const counts = new Map(
    (
      await col.commits
        .aggregate<{ _id: string; n: number }>([
          { $match: { repoId: { $in: repos.map((r) => r._id) } } },
          { $group: { _id: { $toString: "$repoId" }, n: { $sum: 1 } } },
        ])
        .toArray()
    ).map((c) => [c._id, c.n]),
  );

  const views: OrgView[] = orgs.map((o) => ({
    id: o._id.toString(),
    login: o.login,
    enabled: o.enabled,
    hidden: o.hidden,
    lastSyncAt: o.lastSyncAt?.toISOString() ?? null,
    syncError: o.syncError ?? null,
    writeScopes: writeScopesOf(o.tokenScopes),
    repos: repos
      .filter((r) => r.orgId.equals(o._id))
      .map((r) => ({
        id: r._id.toString(),
        name: r.name,
        isPrivate: r.isPrivate,
        isArchived: r.isArchived,
        enabled: r.enabled,
        hidden: r.hidden,
        lastSyncAt: r.lastSyncAt?.toISOString() ?? null,
        syncError: r.syncError ?? null,
        commits: counts.get(r._id.toString()) ?? 0,
      })),
  }));

  const connect = can(user, "token:manage") && (
    <FormModal
      trigger={{ label: "Connect organization" }}
      title="Connect a GitHub organization"
      description="Use a fine-grained token whose resource owner is the organization, with read-only access to Contents, Metadata and Pull requests. The token is encrypted and never shown again."
      action={connectOrg}
      submitLabel="Check and connect"
      pendingLabel="Checking token…"
    >
      <Input name="org" label="Organization login" placeholder="acme-inc" isRequired autoComplete="off" />
      <Input name="token" type="password" label="Read-only token" placeholder="github_pat_…" isRequired autoComplete="off" />
    </FormModal>
  );

  return (
    <div className="flex flex-col gap-8 px-4 py-8 md:px-8">
      <PageHeader
        title="Repositories"
        description={
          manage
            ? "Turn organizations and repositories on to sync them. Hidden ones keep syncing but stay out of dashboards for people without the hidden permission."
            : "Repositories included in your dashboards."
        }
        actions={connect}
      />
      {views.length === 0 ? (
        <Empty
          icon="GitBranch01"
          title="No organizations connected"
          description={can(user, "token:manage") ? "Connect an organization with a read-only GitHub token to start syncing." : "Ask an Owner to connect a GitHub organization."}
          actions={connect}
        />
      ) : (
        views.map((o) => (
          <OrgCard
            key={o.id}
            org={o}
            can={{ manage, sync: can(user, "sync:run"), token: can(user, "token:manage") }}
          />
        ))
      )}
    </div>
  );
}
