import { notFound } from "next/navigation";
import { Breadcrumbs } from "@your-job-search-genius/odyssey-ui/components/application/breadcrumbs/breadcrumbs";
import { requirePermission } from "~/lib/auth";
import { col, oid } from "~/lib/db";
import { PageHeader } from "~/app/ui/page-header";
import { RunBadge } from "../../apps/app-ui";
import { RunView } from "./run-view";
import { shapeOf } from "~/lib/devices";

export default async function RunPage({ params }: PageProps<"/runs/[runId]">) {
  await requirePermission("tests:view");
  const run = await col.runs.findOne({ _id: oid((await params).runId) ?? undefined });
  if (!run) notFound();
  const app = await col.apps.findOne({ _id: run.appId });
  const started = run.startedAt ?? run.createdAt;
  const duration = run.finishedAt && run.startedAt ? `${((run.finishedAt.getTime() - run.startedAt.getTime()) / 1000).toFixed(1)}s` : "—";

  return (
    <div className="flex flex-col gap-8 px-4 py-8 md:px-8">
      <Breadcrumbs
        items={[
          { id: "tests", label: "Tests", href: "/apps" },
          ...(app ? [{ id: "app", label: app.name, href: `/apps/${app._id}` }] : []),
          { id: "test", label: run.testName, href: app ? `/apps/${app._id}/tests/${run.testId}` : undefined },
          { id: "run", label: "Run" },
        ]}
      />
      <title>{`Run of ${run.testName} · QA Automation`}</title>
      <PageHeader
        title={`Run of “${run.testName}”`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <RunBadge status={run.status} />
            {`${started.toLocaleString()} · ${run.device} · by ${run.by}`}
          </span>
        }
      />
      <RunView
        shape={shapeOf(run.device)}
        error={run.error ?? null}
        stopped={run.status === "stopped"}
        app={app ? `${app.name} (${app.baseUrl})` : "Deleted app"}
        duration={duration}
        values={run.values}
        steps={run.steps}
      />
    </div>
  );
}
