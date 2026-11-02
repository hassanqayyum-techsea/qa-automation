"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Table, TableCard } from "@your-job-search-genius/odyssey-ui/components/application/table/table";
import { AvatarLabelGroup } from "@your-job-search-genius/odyssey-ui/components/base/avatar/avatar-label-group";
import { Button } from "@your-job-search-genius/odyssey-ui/components/base/buttons/button";
import type { LeaderRow, LeaderSort } from "~/lib/analytics";

const n = new Intl.NumberFormat();

export function LeaderboardTable({
  rows,
  sort,
  title,
  description,
  sortable = true,
  trailing,
}: {
  rows: LeaderRow[];
  sort: LeaderSort;
  title: string;
  description?: string;
  sortable?: boolean;
  trailing?: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const query = params.toString();
  const detailHref = (id: string) => `/contributors/${encodeURIComponent(id)}${query ? `?${query}` : ""}`;

  return (
    <TableCard.Root>
      <TableCard.Header title={title} description={description} contentTrailing={trailing} />
      <div className="overflow-x-auto">
        <Table
          aria-label={title}
          sortDescriptor={{ column: sort, direction: "descending" }}
          onSortChange={(d) => {
            const p = new URLSearchParams(params);
            p.set("sort", String(d.column));
            router.push(`${pathname}?${p}`);
          }}
          onRowAction={(key) => router.push(detailHref(String(key)))}
        >
          <Table.Header>
            <Table.Head id="rank" label="#" />
            <Table.Head id="name" label="Contributor" isRowHeader />
            <Table.Head id="lines" label="Lines changed" allowsSorting={sortable} />
            <Table.Head id="additions" label="Added" allowsSorting={sortable} className="hidden md:table-cell" />
            <Table.Head id="deletions" label="Removed" allowsSorting={sortable} className="hidden md:table-cell" />
            <Table.Head id="commits" label="Commits" allowsSorting={sortable} />
            <Table.Head id="prs" label="PRs merged / opened" allowsSorting={sortable} className="hidden lg:table-cell" />
          </Table.Header>
          <Table.Body items={rows} dependencies={[query]}>
            {(r) => (
              <Table.Row id={r.id}>
                <Table.Cell>{rows.indexOf(r) + 1}</Table.Cell>
                <Table.Cell>
                  <AvatarLabelGroup
                    size="sm"
                    src={r.avatarUrl}
                    alt=""
                    initials={r.name.slice(0, 2).toUpperCase()}
                    title={
                      <Button color="link-gray" href={detailHref(r.id)}>
                        {r.name}
                      </Button>
                    }
                    subtitle={r.login ? `@${r.login}` : r.id.replace(/^email:/, "")}
                  />
                </Table.Cell>
                <Table.Cell>{n.format(r.additions + r.deletions)}</Table.Cell>
                <Table.Cell className="hidden md:table-cell">+{n.format(r.additions)}</Table.Cell>
                <Table.Cell className="hidden md:table-cell">−{n.format(r.deletions)}</Table.Cell>
                <Table.Cell>{n.format(r.commits)}</Table.Cell>
                <Table.Cell className="hidden lg:table-cell">
                  {n.format(r.prsMerged)} / {n.format(r.prsOpened)}
                </Table.Cell>
              </Table.Row>
            )}
          </Table.Body>
        </Table>
      </div>
    </TableCard.Root>
  );
}
