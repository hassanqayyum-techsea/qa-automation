// Background worker for browser test runs.
// Run: npm run worker   (separate process from `next dev`/`next start`)
import { Worker } from "bullmq";
import { col, dbReady } from "../lib/db";
import { redis } from "../lib/redis";
import { runTest } from "../lib/runner";

async function main() {
  await dbReady();

  // A run left "running" by a crashed worker would otherwise look alive forever.
  await col.runs.updateMany(
    { status: { $in: ["running"] } },
    { $set: { status: "failed", error: "The worker restarted during this run.", finishedAt: new Date() } },
  );

  const tests = new Worker<{ runId: string }>("tests", (job) => runTest(job.data.runId), {
    connection: redis,
    concurrency: 2, // each run is a full Chromium; raise with the machine's memory
    lockDuration: 10 * 60_000,
  });

  tests.on("failed", (job, err) => console.error(`[${tests.name}] job ${job?.id} failed:`, err.message));
  console.log("Worker ready: browser tests (2 at a time).");

  const shutdown = async () => {
    // Give running jobs 10s to finish, then exit anyway; BullMQ re-queues a job whose lock lapses.
    setTimeout(() => process.exit(1), 10_000).unref();
    await tests.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
