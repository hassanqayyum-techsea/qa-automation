"use client";

import { Input } from "@your-job-search-genius/odyssey-ui/components/base/input/input";
import { Select } from "@your-job-search-genius/odyssey-ui/components/base/select/select";
import { Badge } from "@your-job-search-genius/odyssey-ui/components/base/badges/badges";
import { Table, TableCard } from "@your-job-search-genius/odyssey-ui/components/application/table/table";
import { Button } from "@your-job-search-genius/odyssey-ui/components/base/buttons/button";
import { useRouter } from "next/navigation";

export const ENV = {
  dev: { color: "gray", label: "Dev" },
  staging: { color: "warning", label: "Staging" },
  production: { color: "error", label: "Production" },
} as const;
export type Env = keyof typeof ENV;

export const RUN = {
  queued: { color: "gray", label: "Queued" },
  running: { color: "blue", label: "Running" },
  passed: { color: "success", label: "Passed" },
  failed: { color: "error", label: "Failed" },
  stopped: { color: "warning", label: "Stopped" },
} as const;
export type RunState = keyof typeof RUN;

export const EnvBadge = ({ env }: { env: Env }) => <Badge size="sm" color={ENV[env].color}>{ENV[env].label}</Badge>;
export const RunBadge = ({ status }: { status: RunState }) => <Badge size="sm" color={RUN[status].color}>{RUN[status].label}</Badge>;

const ENV_ITEMS = (Object.keys(ENV) as Env[]).map((id) => ({ id, label: ENV[id].label }));

/** Fields shared by "Add app" and "Edit app". The saved password is never sent to the browser. */
export function AppFields({ app }: { app?: { id: string; name: string; baseUrl: string; environment: Env; loginEmail: string; hasPassword: boolean } }) {
  return (
    <>
      <Input name="name" label="Name" defaultValue={app?.name} placeholder="AI Job Expert (dev)" isRequired />
      <Input name="baseUrl" type="url" label="Root URL" defaultValue={app?.baseUrl} placeholder="https://app.aijobexpert.com" isRequired />
      <Select name="environment" label="Environment" items={ENV_ITEMS} defaultSelectedKey={app?.environment ?? "dev"} isRequired>
        {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
      </Select>
      <Input
        name="loginEmail"
        type="email"
        label="Test account email"
        defaultValue={app?.loginEmail}
        hint="Optional. Tests use it as {{email}}. Use a test account, not a real person's."
        autoComplete="off"
      />
      <Input
        name="loginPassword"
        type="password"
        label="Test account password"
        hint={app?.hasPassword ? "Leave empty to keep the saved password. Tests use it as {{password}}." : "Tests use it as {{password}}. Stored encrypted."}
        autoComplete="new-password"
      />
    </>
  );
}

type AppRow = { id: string; name: string; baseUrl: string; environment: Env; tests: number; lastRun: RunState | null };

export function AppsTable({ rows }: { rows: AppRow[] }) {
  const router = useRouter();
  return (
    <TableCard.Root>
      <TableCard.Header title="Apps under test" description="Select an app to see and run its tests." />
      <div className="overflow-x-auto">
        <Table aria-label="Apps under test" onRowAction={(id) => router.push(`/apps/${id}`)}>
          <Table.Header>
            <Table.Head id="name" label="App" isRowHeader />
            <Table.Head id="env" label="Environment" />
            <Table.Head id="url" label="Root URL" className="hidden md:table-cell" />
            <Table.Head id="tests" label="Tests" />
            <Table.Head id="last" label="Latest run" className="hidden md:table-cell" />
          </Table.Header>
          <Table.Body items={rows}>
            {(a) => (
              <Table.Row id={a.id}>
                <Table.Cell>
                  <Button color="link-gray" href={`/apps/${a.id}`}>{a.name}</Button>
                </Table.Cell>
                <Table.Cell><EnvBadge env={a.environment} /></Table.Cell>
                <Table.Cell className="hidden md:table-cell">{a.baseUrl}</Table.Cell>
                <Table.Cell>{a.tests}</Table.Cell>
                <Table.Cell className="hidden md:table-cell">{a.lastRun ? <RunBadge status={a.lastRun} /> : "Never run"}</Table.Cell>
              </Table.Row>
            )}
          </Table.Body>
        </Table>
      </div>
    </TableCard.Root>
  );
}
