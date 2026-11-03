import { getUser } from "~/lib/auth";
import { col, oid } from "~/lib/db";
import { runChannel } from "~/lib/redis";
import { sseFromChannel } from "~/lib/sse";

/** Live frames, step updates and status for one test run. First message is the run as stored. */
export async function GET(req: Request, { params }: RouteContext<"/api/runs/[id]/stream">) {
  const user = await getUser();
  if (!user) return new Response("Sign in first.", { status: 401 });
  if (!user.permissions.includes("tests:view")) return new Response("Your role can't view test runs.", { status: 403 });
  const { id } = await params;
  const _id = oid(id);
  if (!_id) return new Response("Unknown run.", { status: 404 });

  return sseFromChannel(
    req,
    runChannel(id),
    async () => {
      const run = await col.runs.findOne({ _id }, { projection: { "steps.screenshot": 0 } });
      return run
        ? { t: "snapshot", status: run.status, steps: run.steps, values: run.values, error: run.error ?? null }
        : { t: "status", status: "failed", error: "This run was deleted." };
    },
    // The run is over once a snapshot or status says passed/failed/stopped; frames never match this cheap check.
    (raw) => /^\{"t":"(status|snapshot)","status":"(passed|failed|stopped)"/.test(raw),
  );
}
