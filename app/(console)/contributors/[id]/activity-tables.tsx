"use client";

import { Table, TableCard } from "@your-job-search-genius/odyssey-ui/components/application/table/table";
import { Badge } from "@your-job-search-genius/odyssey-ui/components/base/badges/badges";
import { Button } from "@your-job-search-genius/odyssey-ui/components/base/buttons/button";
import { Empty } from "~/app/ui/empty";

const n = new Intl.NumberFormat();
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

type CommitRow = { id: string; sha: string; message: string; repo: string; date: string; additions: number; deletions: number; isMerge: boolean; url: string };
type PullRow = { id: string; number: number; title: string; repo: string; state: "OPEN" | "CLOSED" | "MERGED"; date: string; additions: number; deletions: number; commits: number; url: string };

const STATE = {
  OPEN: { color: "success", label: "Open" },
  MERGED: { color: "purple", label: "Merged" },
  CLOSED: { color: "gray", label: "Closed" },
} as const;

export function CommitTable({ rows }: { rows: CommitRow[] }) {
  return (
    <TableCard.Root>
      <TableCard.Header title="Commits" description="Newest first, up to 100 in this period. Lines are per commit." />
      {rows.length === 0 ? (
        <Empty size="sm" icon="SearchLg" title="No commits in this period" description="Pick a longer time period to see older work." />
      ) : (
        <div className="overflow-x-auto">
          <Table aria-label="Commits">
            <Table.Header>
              <Table.Head id="message" label="Commit" isRowHeader />
              <Table.Head id="repo" label="Repository" className="hidden md:table-cell" />
              <Table.Head id="date" label="Date" />
              <Table.Head id="lines" label="Added / removed" />
            </Table.Header>
            <Table.Body items={rows}>
              {(c) => (
                <Table.Row id={c.id}>
                  <Table.Cell>
                    <div className="flex min-w-0 flex-col gap-1">
                      <Button color="link-gray" href={c.url} target="_blank" rel="noreferrer" className="justify-start whitespace-normal text-left">
                        {c.message || "(no message)"}
                      </Button>
                      <span className="flex items-center gap-2 text-xs text-tertiary">
                        {c.sha}
                        {c.isMerge && <Badge size="sm" color="gray">Merge commit, not counted in totals</Badge>}
                      </span>
                    </div>
                  </Table.Cell>
                  <Table.Cell className="hidden md:table-cell">{c.repo}</Table.Cell>
                  <Table.Cell>{day(c.date)}</Table.Cell>
                  <Table.Cell>
                    +{n.format(c.additions)} / −{n.format(c.deletions)}
                  </Table.Cell>
                </Table.Row>
              )}
            </Table.Body>
          </Table>
        </div>
      )}
    </TableCard.Root>
  );
}

export function PullTable({ rows }: { rows: PullRow[] }) {
  return (
    <TableCard.Root>
      <TableCard.Header title="Pull requests" description="Opened in this period, newest first. Lines are the pull request's full diff." />
      {rows.length === 0 ? (
        <Empty size="sm" icon="SearchLg" title="No pull requests in this period" description="Pick a longer time period to see older pull requests." />
      ) : (
        <div className="overflow-x-auto">
          <Table aria-label="Pull requests">
            <Table.Header>
              <Table.Head id="title" label="Pull request" isRowHeader />
              <Table.Head id="state" label="State" />
              <Table.Head id="repo" label="Repository" className="hidden md:table-cell" />
              <Table.Head id="date" label="Opened" className="hidden md:table-cell" />
              <Table.Head id="lines" label="Added / removed" />
              <Table.Head id="commits" label="Commits" className="hidden lg:table-cell" />
            </Table.Header>
            <Table.Body items={rows}>
              {(p) => (
                <Table.Row id={p.id}>
                  <Table.Cell>
                    <Button color="link-gray" href={p.url} target="_blank" rel="noreferrer" className="justify-start whitespace-normal text-left">
                      {`#${p.number} ${p.title}`}
                    </Button>
                  </Table.Cell>
                  <Table.Cell>
                    <Badge size="sm" color={STATE[p.state].color}>{STATE[p.state].label}</Badge>
                  </Table.Cell>
                  <Table.Cell className="hidden md:table-cell">{p.repo}</Table.Cell>
                  <Table.Cell className="hidden md:table-cell">{day(p.date)}</Table.Cell>
                  <Table.Cell>
                    +{n.format(p.additions)} / −{n.format(p.deletions)}
                  </Table.Cell>
                  <Table.Cell className="hidden lg:table-cell">{n.format(p.commits)}</Table.Cell>
                </Table.Row>
              )}
            </Table.Body>
          </Table>
        </div>
      )}
    </TableCard.Root>
  );
}
