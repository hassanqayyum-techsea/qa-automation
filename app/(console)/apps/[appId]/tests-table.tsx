"use client";

import { useRouter } from "next/navigation";
import { Table, TableCard } from "@your-job-search-genius/odyssey-ui/components/application/table/table";
import { Button } from "@your-job-search-genius/odyssey-ui/components/base/buttons/button";
import { Badge } from "@your-job-search-genius/odyssey-ui/components/base/badges/badges";
import { RunBadge, type RunState } from "../app-ui";

type Row = {
  id: string; name: string; steps: number; problems: number; device: string;
  lastRun: RunState | null; lastRunAt: string | null; updatedAt: string; updatedBy: string;
};

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export function TestsTable({ appId, rows }: { appId: string; rows: Row[] }) {
  const router = useRouter();
  const href = (id: string) => `/apps/${appId}/tests/${id}`;
  return (
    <TableCard.Root>
      <TableCard.Header title="Tests" description="Select a test to edit it, run it and watch it live." />
      <div className="overflow-x-auto">
        <Table aria-label="Tests" onRowAction={(id) => router.push(href(String(id)))}>
          <Table.Header>
            <Table.Head id="name" label="Test" isRowHeader />
            <Table.Head id="steps" label="Steps" />
            <Table.Head id="device" label="Device" className="hidden md:table-cell" />
            <Table.Head id="last" label="Latest run" />
            <Table.Head id="updated" label="Last edited" className="hidden lg:table-cell" />
          </Table.Header>
          <Table.Body items={rows}>
            {(t) => (
              <Table.Row id={t.id}>
                <Table.Cell>
                  <Button color="link-gray" href={href(t.id)}>{t.name}</Button>
                </Table.Cell>
                <Table.Cell>
                  {t.problems ? <Badge size="sm" color="error">{`${t.problems} line(s) to fix`}</Badge> : t.steps}
                </Table.Cell>
                <Table.Cell className="hidden md:table-cell">{t.device}</Table.Cell>
                <Table.Cell>
                  {t.lastRun ? (
                    <span className="flex flex-wrap items-center gap-2">
                      <RunBadge status={t.lastRun} />
                      {t.lastRunAt && <span className="text-sm text-tertiary">{when(t.lastRunAt)}</span>}
                    </span>
                  ) : (
                    "Never run"
                  )}
                </Table.Cell>
                <Table.Cell className="hidden lg:table-cell">{`${when(t.updatedAt)} by ${t.updatedBy}`}</Table.Cell>
              </Table.Row>
            )}
          </Table.Body>
        </Table>
      </div>
    </TableCard.Root>
  );
}
