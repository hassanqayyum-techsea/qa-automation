import IORedis from "ioredis";
import { Queue } from "bullmq";
import { env } from "./env";

const g = globalThis as unknown as { _redis?: IORedis; _queues?: ReturnType<typeof makeQueues> };

// maxRetriesPerRequest: null is required by BullMQ for blocking connections.
export const redis = (g._redis ??= new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null }));

function makeQueues() {
  const opts = { connection: redis, defaultJobOptions: { removeOnComplete: 500, removeOnFail: 1000 } };
  return {
    sync: new Queue<SyncJob>("sync", opts),
    hooks: new Queue<{ eventId: string }>("hooks", opts),
    tests: new Queue<{ runId: string }>("tests", opts),
  };
}
export type SyncJob = { orgId: string } | { all: true };
export const queues = (g._queues ??= makeQueues());

/** Channel names. "live" carries small dashboard events; "run:<id>" carries a test run's frames and steps. */
export const LIVE = "live";
export const runChannel = (runId: string) => `run:${runId}`;
export const runStopKey = (runId: string) => `run:${runId}:stop`;

export type LiveEvent =
  | { type: "sync.done"; orgId: string; org: string }
  | { type: "hook.fired"; event: string; repo?: string }
  | { type: "run.finished"; runId: string; status: string };

export const publish = (channel: string, data: unknown) => redis.publish(channel, JSON.stringify(data));

/**
 * Dedicated subscriber connection (a subscribed client can't run other commands).
 * `ready` resolves once Redis confirms the subscription, so nothing published after it is missed.
 */
export function subscribe(channel: string, onMessage: (data: string) => void) {
  const sub = redis.duplicate();
  const ready = sub.subscribe(channel).catch(() => {});
  sub.on("message", (_c, msg) => onMessage(msg));
  return { ready, close: () => void sub.quit().catch(() => sub.disconnect()) };
}
