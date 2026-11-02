import { can, requirePermission } from "~/lib/auth";
import { col } from "~/lib/db";
import { PageHeader } from "~/app/ui/page-header";
import { Empty } from "~/app/ui/empty";
import { FormModal } from "~/app/ui/dialogs";
import { saveApp } from "./actions";
import { AppFields, AppsTable } from "./app-ui";

export const metadata = { title: "Tests" };

export default async function AppsPage() {
  const user = await requirePermission("tests:view");
  const [apps, testCounts, lastRuns] = await Promise.all([
    col.apps.find().sort({ name: 1 }).toArray(),
    col.tests.aggregate<{ _id: string; n: number }>([{ $group: { _id: { $toString: "$appId" }, n: { $sum: 1 } } }]).toArray(),
    col.runs
      .aggregate<{ _id: string; status: "queued" | "running" | "passed" | "failed" | "stopped" }>([
        { $sort: { createdAt: -1 } },
        { $group: { _id: { $toString: "$appId" }, status: { $first: "$status" } } },
      ])
      .toArray(),
  ]);
  const tests = new Map(testCounts.map((t) => [t._id, t.n]));
  const last = new Map(lastRuns.map((r) => [r._id, r.status]));

  const add = can(user, "apps:manage") && (
    <FormModal trigger={{ label: "Add app" }} title="Add an app to test" description="Tests run in a real phone browser on the server, so the app doesn't need any changes." action={saveApp.bind(null, null)} submitLabel="Add app" pendingLabel="Adding…">
      <AppFields />
    </FormModal>
  );

  return (
    <div className="flex flex-col gap-8 px-4 py-8 md:px-8">
      <PageHeader
        title="Tests"
        description="Write tests as Markdown steps, run them in a phone browser on the server, and watch every step live."
        actions={add}
      />
      {apps.length === 0 ? (
        <Empty
          icon="ClipboardCheck"
          title="No apps yet"
          description={can(user, "apps:manage") ? "Add the app you want to test, like your dev environment's root URL." : "Ask an Admin to add an app to test."}
          actions={add}
        />
      ) : (
        <AppsTable
          rows={apps.map((a) => ({
            id: a._id.toString(),
            name: a.name,
            baseUrl: a.baseUrl,
            environment: a.environment,
            tests: tests.get(a._id.toString()) ?? 0,
            lastRun: last.get(a._id.toString()) ?? null,
          }))}
        />
      )}
    </div>
  );
}
