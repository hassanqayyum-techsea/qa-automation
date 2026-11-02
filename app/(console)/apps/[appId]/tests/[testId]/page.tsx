import { notFound } from "next/navigation";
import { Breadcrumbs } from "@your-job-search-genius/odyssey-ui/components/application/breadcrumbs/breadcrumbs";
import { can, requirePermission } from "~/lib/auth";
import { col, oid } from "~/lib/db";
import { PageHeader } from "~/app/ui/page-header";
import { ConfirmButton } from "~/app/ui/dialogs";
import { deleteTest } from "../../../actions";
import { EnvBadge } from "../../../app-ui";
import { Workbench } from "./workbench";
import { aiEnabled } from "~/lib/ai";
import { DEVICE_LIST } from "~/lib/devices";
import { settingsOf } from "~/lib/plan";

export default async function TestPage({ params }: PageProps<"/apps/[appId]/tests/[testId]">) {
  const user = await requirePermission("tests:view");
  const { appId, testId } = await params;
  const test = await col.tests.findOne({ _id: oid(testId) ?? undefined, appId: oid(appId) ?? undefined });
  if (!test) notFound();
  const app = await col.apps.findOne({ _id: test.appId });
  if (!app) notFound();
  const runs = await col.runs
    .find({ testId: test._id }, { projection: { "steps.screenshot": 0 } })
    .sort({ createdAt: -1 })
    .limit(15)
    .toArray();
  const appTests = await col.tests.find({ appId: test.appId }, { projection: { name: 1 } }).sort({ name: 1 }).toArray();
  const settings = settingsOf(test, appTests);
  const versions = await col.versions.find({ testId: test._id }).sort({ at: -1 }).toArray();
  const nameOf = new Map(appTests.map((t) => [t._id.toString(), t.name]));
  const active = runs.find((r) => r.status === "queued" || r.status === "running");
  const runAllowed = can(user, app.environment === "production" ? "tests:run-production" : "tests:run");

  return (
    <div className="flex flex-col gap-8 px-4 py-8 md:px-8">
      <Breadcrumbs
        items={[
          { id: "tests", label: "Tests", href: "/apps" },
          { id: "app", label: app.name, href: `/apps/${appId}` },
          { id: "test", label: test.name },
        ]}
      />
      <title>{`${test.name} · Repo Pulse`}</title>
      <PageHeader
        title={test.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <EnvBadge env={app.environment} />
            {`Runs against ${app.baseUrl}`}
          </span>
        }
        actions={
          can(user, "tests:edit") && (
            <ConfirmButton
              trigger={{ label: "Delete test", destructive: true, size: "md" }}
              title={`Delete "${test.name}"?`}
              description="This deletes the test and all of its runs and screenshots. It can't be undone."
              confirmLabel="Delete test"
              onConfirm={deleteTest.bind(null, test._id.toString())}
            />
          )
        }
      />
      <Workbench
        testId={test._id.toString()}
        initial={{ markdown: settings.body, device: settings.device, sessionTestId: settings.sessionTestId?.toString() ?? null }}
        canEdit={can(user, "tests:edit")}
        canRun={runAllowed}
        runBlockedReason={runAllowed ? null : "Your role can't run tests against this app's environment."}
        activeRunId={active?._id.toString() ?? null}
        aiEnabled={aiEnabled()}
        devices={DEVICE_LIST}
        tests={appTests.filter((t) => !t._id.equals(test._id)).map((t) => ({ id: t._id.toString(), name: t.name }))}
        versions={versions.map((v) => ({
          id: v._id.toString(),
          at: v.at.toISOString(),
          by: v.by,
          source: v.source,
          prompt: v.prompt ?? null,
          markdown: v.markdown,
          device: v.device,
          sessionTestId: v.sessionTestId?.toString() ?? null,
          sessionName: v.sessionTestId ? (nameOf.get(v.sessionTestId.toString()) ?? "a deleted test") : null,
        }))}
        history={runs.map((r) => ({
          id: r._id.toString(),
          status: r.status,
          by: r.by,
          createdAt: r.createdAt.toISOString(),
          ms: r.finishedAt && r.startedAt ? r.finishedAt.getTime() - r.startedAt.getTime() : null,
          passed: r.steps.filter((s) => s.status === "passed").length,
          total: r.steps.length,
        }))}
      />
    </div>
  );
}
