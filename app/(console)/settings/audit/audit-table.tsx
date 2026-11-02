"use client";

import { Table, TableCard } from "@your-job-search-genius/odyssey-ui/components/application/table/table";
import { Empty } from "~/app/ui/empty";

type Row = { id: string; at: string; who: string; action: string; target: string; details: string };

export function AuditTable({ rows }: { rows: Row[] }) {
  return (
    <TableCard.Root>
      <TableCard.Header title="Changes" description="Who did what, and when." />
      {rows.length === 0 ? (
        <Empty size="sm" icon="Shield01" title="Nothing recorded yet" description="Changes show up here as soon as someone makes one." />
      ) : (
        <div className="overflow-x-auto">
          <Table aria-label="Audit log">
            <Table.Header>
              <Table.Head id="action" label="Action" isRowHeader />
              <Table.Head id="target" label="On" />
              <Table.Head id="who" label="By" className="hidden md:table-cell" />
              <Table.Head id="at" label="When" />
              <Table.Head id="details" label="Details" className="hidden lg:table-cell" />
            </Table.Header>
            <Table.Body items={rows}>
              {(r) => (
                <Table.Row id={r.id}>
                  <Table.Cell>{r.action}</Table.Cell>
                  <Table.Cell>{r.target}</Table.Cell>
                  <Table.Cell className="hidden md:table-cell">{r.who}</Table.Cell>
                  <Table.Cell>{new Date(r.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" })}</Table.Cell>
                  <Table.Cell className="hidden lg:table-cell">
                    <span className="text-sm text-tertiary wrap-anywhere">{r.details}</span>
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
