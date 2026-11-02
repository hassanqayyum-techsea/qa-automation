"use client";

import { useOptimistic, useTransition } from "react";
import { Table, TableCard } from "@your-job-search-genius/odyssey-ui/components/application/table/table";
import { Toggle } from "@your-job-search-genius/odyssey-ui/components/base/toggle/toggle";
import { Badge } from "@your-job-search-genius/odyssey-ui/components/base/badges/badges";
import { Button } from "@your-job-search-genius/odyssey-ui/components/base/buttons/button";
import { Alert, toast } from "@your-job-search-genius/odyssey-ui/components/application/alerts/alert";
import { ConfirmButton } from "~/app/ui/dialogs";
import type { ActionResult } from "~/lib/forms";
import { removeOrg, setOrgFlag, setRepoFlag, syncNow } from "./actions";

type RepoView = {
  id: string; name: string; isPrivate: boolean; isArchived: boolean; enabled: boolean; hidden: boolean;
  lastSyncAt: string | null; syncError: string | null; commits: number;
};
export type OrgView = {
  id: string; login: string; enabled: boolean; hidden: boolean; lastSyncAt: string | null;
  syncError: string | null; writeScopes: string[]; repos: RepoView[];
};

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Not synced yet");

/** Switch whose state flips immediately and rolls back if the server refuses. */
function FlagToggle({ label, visibleLabel, value, onChange, isDisabled }: { label: string; visibleLabel?: string; value: boolean; onChange: (v: boolean) => Promise<ActionResult>; isDisabled?: boolean }) {
  const [optimistic, setOptimistic] = useOptimistic(value);
  const [, start] = useTransition();
  return (
    <Toggle
      size="sm"
      aria-label={label}
      label={visibleLabel}
      isSelected={optimistic}
      isDisabled={isDisabled}
      onChange={(v: boolean) =>
        start(async () => {
          setOptimistic(v);
          const res = await onChange(v);
          if (res?.error) toast.error(res.error);
        })
      }
    />
  );
}

export function OrgCard({ org, can }: { org: OrgView; can: { manage: boolean; sync: boolean; token: boolean } }) {
  const [syncing, start] = useTransition();
  const status = org.syncError ? `Last sync failed: ${org.syncError}` : `Last synced ${when(org.lastSyncAt)}`;

  return (
    <section aria-label={`${org.login} organization`} className="flex flex-col gap-3">
      {org.writeScopes.length > 0 && can.token && (
        <Alert
          color="warning"
          autoFocus={false}
          title={`${org.login} uses a classic token with write scopes`}
          description={`Scopes: ${org.writeScopes.join(", ")}. Repo Pulse only reads, but replace it with a fine-grained read-only token to limit the damage if it ever leaks.`}
        />
      )}
      <TableCard.Root>
        <TableCard.Header
          title={org.login}
          description={`${org.repos.length} ${org.repos.length === 1 ? "repository" : "repositories"} · ${status}`}
          contentTrailing={
            <div className="flex flex-wrap items-center gap-4">
              {can.manage && (
                <>
                  <FlagToggle label={`Sync ${org.login}`} visibleLabel="Sync" value={org.enabled} onChange={(v) => setOrgFlag(org.id, "enabled", v)} />
                  <FlagToggle label={`Hidden ${org.login}`} visibleLabel="Hidden" value={org.hidden} onChange={(v) => setOrgFlag(org.id, "hidden", v)} />
                </>
              )}
              {can.sync && (
                <Button
                  size="sm"
                  color="secondary"
                  isLoading={syncing}
                  showTextWhileLoading
                  isDisabled={!org.enabled}
                  onClick={() =>
                    start(async () => {
                      const r = await syncNow(org.id);
                      if (r?.error) toast.error(r.error);
                      else if (r?.ok) toast.success(r.ok);
                    })
                  }
                >
                  Sync now
                </Button>
              )}
              {can.token && (
                <ConfirmButton
                  trigger={{ label: "Remove", destructive: true }}
                  title={`Remove ${org.login}?`}
                  description="This deletes its token, its repositories and every synced commit and pull request. Contributors stay. You can reconnect later, but the history will sync from scratch."
                  confirmLabel="Remove organization"
                  onConfirm={() => removeOrg(org.id)}
                />
              )}
            </div>
          }
        />
        {org.repos.length > 0 && (
          <div className="overflow-x-auto">
            <Table aria-label={`Repositories in ${org.login}`} size="sm">
              <Table.Header>
                <Table.Head id="name" label="Repository" isRowHeader />
                <Table.Head id="status" label="Last sync" className="hidden md:table-cell" />
                <Table.Head id="commits" label="Commits synced" />
                {can.manage ? <Table.Head id="enabled" label="Sync" /> : null}
                {can.manage ? <Table.Head id="hidden" label="Hidden" /> : null}
              </Table.Header>
              <Table.Body items={org.repos} dependencies={[can.manage, org.enabled]}>
                {(r) => (
                  <Table.Row id={r.id}>
                    <Table.Cell>
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-primary">{r.name}</span>
                        {r.isPrivate && <Badge size="sm" color="gray">Private</Badge>}
                        {r.isArchived && <Badge size="sm" color="warning">Archived</Badge>}
                        {r.hidden && <Badge size="sm" color="slate">Hidden</Badge>}
                      </span>
                    </Table.Cell>
                    <Table.Cell className="hidden md:table-cell">
                      {r.syncError ? <span className="text-error-primary">Failed: {r.syncError}</span> : when(r.lastSyncAt)}
                    </Table.Cell>
                    <Table.Cell>{r.commits.toLocaleString()}</Table.Cell>
                    {can.manage ? (
                      <Table.Cell>
                        <FlagToggle
                          label={`Sync ${r.name}`}
                          value={r.enabled}
                          isDisabled={!org.enabled}
                          onChange={(v) => setRepoFlag(r.id, "enabled", v)}
                        />
                      </Table.Cell>
                    ) : null}
                    {can.manage ? (
                      <Table.Cell>
                        <FlagToggle label={`Hidden ${r.name}`} value={r.hidden} onChange={(v) => setRepoFlag(r.id, "hidden", v)} />
                      </Table.Cell>
                    ) : null}
                  </Table.Row>
                )}
              </Table.Body>
            </Table>
          </div>
        )}
      </TableCard.Root>
    </section>
  );
}
