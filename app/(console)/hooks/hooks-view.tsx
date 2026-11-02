"use client";

import { Table, TableCard } from "@your-job-search-genius/odyssey-ui/components/application/table/table";
import { Accordion } from "@your-job-search-genius/odyssey-ui/components/application/accordion/accordion";
import { DescriptionList } from "@your-job-search-genius/odyssey-ui/components/base/description-list/description-list";
import { CodeBlock } from "@your-job-search-genius/odyssey-ui/components/base/code-block/code-block";
import { Badge } from "@your-job-search-genius/odyssey-ui/components/base/badges/badges";
import { Heading } from "@your-job-search-genius/odyssey-ui/components/base/typography/heading";
import { Body2 } from "@your-job-search-genius/odyssey-ui/components/base/typography/body-2";
import { Empty } from "~/app/ui/empty";

const STATUS = {
  queued: { color: "warning", label: "Queued" },
  done: { color: "success", label: "Ran" },
  failed: { color: "error", label: "Failed" },
} as const;

export function WebhookSetup({ payloadUrl, orgs }: { payloadUrl: string; orgs: { id: string; login: string; enabled: boolean; secret: string }[] }) {
  return (
    <section aria-labelledby="setup-heading" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Heading level={2} size={5} id="setup-heading">Set up the webhook in GitHub</Heading>
        <Body2>
          A read-only token can&apos;t create webhooks, so an organization admin adds one by hand: GitHub → organization Settings → Webhooks → Add
          webhook. Use the values below, choose &ldquo;Let me select individual events&rdquo; and tick Pushes and Pull requests.
        </Body2>
      </div>
      <Accordion allowsMultipleExpanded>
        {orgs.map((o) => (
          <Accordion.Item key={o.id} id={o.id}>
            <Accordion.Trigger>{o.enabled ? o.login : `${o.login} (turned off, events are ignored)`}</Accordion.Trigger>
            <Accordion.Panel>
            <DescriptionList layout="inline" isDivided>
              <DescriptionList.Item term="Payload URL">
                <CodeBlock code={payloadUrl} showCopy aria-label={`Payload URL for ${o.login}`} />
              </DescriptionList.Item>
              <DescriptionList.Item term="Content type">application/json</DescriptionList.Item>
              <DescriptionList.Item term="Secret">
                <CodeBlock code={o.secret} showCopy aria-label={`Webhook secret for ${o.login}`} />
              </DescriptionList.Item>
              <DescriptionList.Item term="Events">Pushes, Pull requests</DescriptionList.Item>
            </DescriptionList>
            </Accordion.Panel>
          </Accordion.Item>
        ))}
      </Accordion>
    </section>
  );
}

type EventRow = { id: string; at: string; type: string; org: string; summary: string; status: keyof typeof STATUS; error: string | null };

export function EventsTable({ rows }: { rows: EventRow[] }) {
  return (
    <TableCard.Root>
      <TableCard.Header title="Recent events" description="Newest 100. Each one ran the hook function once, even if GitHub delivered it twice." />
      {rows.length === 0 ? (
        <Empty size="sm" icon="Zap" title="No events yet" description="Once the webhook is set up, pushes and pull requests appear here within seconds." />
      ) : (
        <div className="overflow-x-auto">
          <Table aria-label="Recent webhook events">
            <Table.Header>
              <Table.Head id="summary" label="Event" isRowHeader />
              <Table.Head id="type" label="Type" className="hidden md:table-cell" />
              <Table.Head id="status" label="Hook" />
              <Table.Head id="at" label="Received" />
            </Table.Header>
            <Table.Body items={rows}>
              {(e) => (
                <Table.Row id={e.id}>
                  <Table.Cell>
                    <span className="flex min-w-0 flex-col gap-1">
                      <span className="text-primary">{e.summary}</span>
                      {e.error && <span className="text-sm text-error-primary">{e.error}</span>}
                    </span>
                  </Table.Cell>
                  <Table.Cell className="hidden md:table-cell">{e.type}</Table.Cell>
                  <Table.Cell>
                    <Badge size="sm" color={STATUS[e.status].color}>{STATUS[e.status].label}</Badge>
                  </Table.Cell>
                  <Table.Cell>{new Date(e.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" })}</Table.Cell>
                </Table.Row>
              )}
            </Table.Body>
          </Table>
        </div>
      )}
    </TableCard.Root>
  );
}
