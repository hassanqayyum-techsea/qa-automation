import { notFound } from "next/navigation";
import { Breadcrumbs } from "@your-job-search-genius/odyssey-ui/components/application/breadcrumbs/breadcrumbs";
import { Input } from "@your-job-search-genius/odyssey-ui/components/base/input/input";
import { can, requirePermission } from "~/lib/auth";
import { col, oid } from "~/lib/db";
import { parseTest } from "~/lib/testdsl";
import { settingsOf } from "~/lib/plan";
import { PageHeader } from "~/app/ui/page-header";
import { Empty } from "~/app/ui/empty";
import { ConfirmButton, FormModal } from "~/app/ui/dialogs";
import { createTest, deleteApp, saveApp } from "../actions";
import { AppFields, EnvBadge } from "../app-ui";
import { TestsTable } from "./tests-table";

export default async function AppPage({ params }: PageProps<"/apps/[appId]">) {
  const user = await requirePermission("tests:view");
  const { appId } = await params;
  const app = await col.apps.findOne({ _id: oid(appId) ?? undefined });
  if (!app) notFound();
  const [tests, lastRuns] = await Promise.all([
    col.tests.find({ appId: app._id }).sort({ name: 1 }).toArray(),
    col.runs
      .aggregate<{ _id: string; status: "queued" | "running" | "passed" | "failed" | "stopped"; at: Date }>([
        { $match: { appId: app._id } },
        { $sort: { createdAt: -1 } },
        { $group: { _id: { $toString: "$testId" }, status: { $first: "$status" }, at: { $first: "$createdAt" } } },
      ])
      .toArray(),
  ]);
  const last = new Map(lastRuns.map((r) => [r._id, r]));
  const id = app._id.toString();

  const newTest = can(user, "tests:edit") && (
    <FormModal
      trigger={{ label: "New test" }}
      title="New test"
      description="It starts with an example you can edit: sign in with the app's test account, scroll and count links."
      action={createTest.bind(null, id)}
      submitLabel="Create test"
    >
      <Input name="name" label="Test name" placeholder="Login and search jobs" isRequired />
    </FormModal>
  );

  return (
    <div className="flex flex-col gap-8 px-4 py-8 md:px-8">
      <Breadcrumbs items={[{ id: "tests", label: "Tests", href: "/apps" }, { id: "app", label: app.name }]} />
      <title>{`${app.name} · Repo Pulse`}</title>
      <PageHeader
        title={app.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <EnvBadge env={app.environment} />
            {app.baseUrl}
            {app.testLogin ? ` · signs in as ${app.testLogin.email}` : " · no test account saved"}
          </span>
        }
        actions={
          <>
            {can(user, "apps:manage") && (
              <>
                <ConfirmButton
                  trigger={{ label: "Delete app", destructive: true, size: "md" }}
                  title={`Delete ${app.name}?`}
                  description="This deletes the app, its saved test account, all of its tests and every run with its screenshots. It can't be undone."
                  confirmLabel="Delete app"
                  onConfirm={deleteApp.bind(null, id)}
                />
                <FormModal trigger={{ label: "Edit app", color: "secondary" }} title={`Edit ${app.name}`} action={saveApp.bind(null, id)} submitLabel="Save changes">
                  <AppFields
                    app={{
                      id,
                      name: app.name,
                      baseUrl: app.baseUrl,
                      environment: app.environment,
                      loginEmail: app.testLogin?.email ?? "",
                      hasPassword: !!app.testLogin,
                    }}
                  />
                </FormModal>
              </>
            )}
            {newTest}
          </>
        }
      />
      {tests.length === 0 ? (
        <Empty icon="ClipboardCheck" title="No tests for this app yet" description="Create a test, then press Run to watch it in a phone browser." actions={newTest} />
      ) : (
        <TestsTable
          appId={id}
          rows={tests.map((t) => {
            const settings = settingsOf(t, tests);
            const parsed = parseTest(settings.body);
            const run = last.get(t._id.toString());
            return {
              id: t._id.toString(),
              name: t.name,
              steps: parsed.steps.length,
              problems: parsed.errors.length,
              device: settings.device,
              lastRun: run?.status ?? null,
              lastRunAt: run?.at.toISOString() ?? null,
              updatedAt: t.updatedAt.toISOString(),
              updatedBy: t.updatedBy,
            };
          })}
        />
      )}
    </div>
  );
}
