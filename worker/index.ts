// Background worker: GitHub sync, webhook hooks, and browser test runs.
// Run: npm run worker   (separate process from `next dev`/`next start`)
import { Worker } from "bullmq";
import { col, dbReady, ObjectId, type HookEvent } from "../lib/db";
import { LIVE, publish, queues, redis, type SyncJob } from "../lib/redis";
import { syncOrg } from "../lib/github";
import { runTest } from "../lib/runner";

/**
 * Runs for every accepted push / pull_request webhook.
 * Placeholder on purpose: replace the body with real behaviour (e.g. trigger a repo sync or a test run).
 */
async function runHook(event: HookEvent) {
  console.log(`[hook] ${event.type}${event.action ? `.${event.action}` : ""}: ${event.summary}`);
}

async function main() {
  await dbReady();

  // A run left "running" by a crashed worker would otherwise look alive forever.
  await col.runs.updateMany(
    { status: { $in: ["running"] } },
    { $set: { status: "failed", error: "The worker restarted during this run.", finishedAt: new Date() } },
  );

  const sync = new Worker<SyncJob>(
    "sync",
    async (job) => {
      const ids = "orgId" in job.data
        ? [new ObjectId(job.data.orgId)]
        : (await col.orgs.find({ enabled: true }, { projection: { _id: 1 } }).toArray()).map((o) => o._id);
      for (const id of ids) {
        const org = await syncOrg(id).catch((e) => {
          console.error(`[sync] org ${id}:`, e instanceof Error ? e.message : e);
          return null;
        });
        if (org) await publish(LIVE, { type: "sync.done", orgId: id.toString(), org: org.login });
      }
    },
    { connection: redis, concurrency: 1 },
  );

  const hooks = new Worker<{ eventId: string }>(
    "hooks",
    async (job) => {
      const event = await col.hookEvents.findOne({ _id: new ObjectId(job.data.eventId) });
      if (!event) return;
      try {
        await runHook(event);
        await col.hookEvents.updateOne({ _id: event._id }, { $set: { status: "done", processedAt: new Date() }, $unset: { error: "" } });
      } catch (e) {
        await col.hookEvents.updateOne({ _id: event._id }, { $set: { status: "failed", error: String(e) } });
        throw e; // let BullMQ retry with backoff
      }
      const repo = event.repoId ? await col.repos.findOne({ _id: event.repoId }) : null;
      await publish(LIVE, { type: "hook.fired", event: event.type, repo: repo?.fullName });
    },
    { connection: redis, concurrency: 5 },
  );

  const tests = new Worker<{ runId: string }>("tests", (job) => runTest(job.data.runId), {
    connection: redis,
    concurrency: 2, // each run is a full Chromium; raise with the machine's memory
    lockDuration: 10 * 60_000,
  });

  await queues.sync.upsertJobScheduler("sync-all", { every: 15 * 60_000 }, { name: "all", data: { all: true } });

  for (const w of [sync, hooks, tests]) w.on("failed", (job, err) => console.error(`[${w.name}] job ${job?.id} failed:`, err.message));
  console.log("Worker ready: sync every 15 min, hooks, tests (2 at a time).");

  const shutdown = async () => {
    // Give running jobs 10s to finish, then exit anyway; BullMQ re-queues a job whose lock lapses.
    setTimeout(() => process.exit(1), 10_000).unref();
    await Promise.all([sync.close(), hooks.close(), tests.close()]);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
