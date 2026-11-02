import { col, dbReady, ObjectId } from "~/lib/db";
import { decrypt, verifyGithubSignature } from "~/lib/crypto";
import { queues } from "~/lib/redis";

const HANDLED = new Set(["push", "pull_request"]);
const reply = (status: number, message: string) => Response.json({ message }, { status });

type Payload = {
  action?: string;
  ref?: string;
  commits?: unknown[];
  pusher?: { name?: string };
  sender?: { login?: string };
  organization?: { id: number };
  repository?: { id: number; full_name?: string; owner?: { id: number } };
  pull_request?: { number: number; title: string };
};

/**
 * GitHub → here → Redis queue → worker's runHook(). Answers fast (GitHub gives up after 10s);
 * the work happens in the worker.
 */
export async function POST(req: Request) {
  const body = await req.text();
  const event = req.headers.get("x-github-event") ?? "";
  const deliveryId = req.headers.get("x-github-delivery") ?? "";
  let payload: Payload;
  try {
    payload = JSON.parse(body);
  } catch {
    return reply(400, "Body must be JSON. Set the webhook content type to application/json.");
  }

  await dbReady();
  const ownerId = payload.organization?.id ?? payload.repository?.owner?.id;
  const org = ownerId ? await col.orgs.findOne({ ghId: ownerId }) : null;
  if (!org) return reply(404, "This organization isn't connected to Repo Pulse.");
  if (!verifyGithubSignature(decrypt(org.webhookSecret), body, req.headers.get("x-hub-signature-256"))) {
    return reply(401, "Signature doesn't match. Copy the secret from the Webhooks page again.");
  }
  if (event === "ping") return reply(200, "pong");
  if (!HANDLED.has(event)) return reply(202, `Ignored: ${event} events aren't used.`);
  if (!org.enabled) return reply(202, "Ignored: this organization is turned off.");

  const repo = payload.repository ? await col.repos.findOne({ ghId: payload.repository.id }) : null;
  if (repo && !repo.enabled) return reply(202, "Ignored: this repository is turned off.");

  const summary =
    event === "push"
      ? `${payload.pusher?.name ?? "Someone"} pushed ${payload.commits?.length ?? 0} commit(s) to ${payload.ref?.replace("refs/heads/", "") ?? "?"} in ${payload.repository?.full_name ?? "?"}`
      : `${payload.sender?.login ?? "Someone"} ${payload.action ?? "updated"} PR #${payload.pull_request?.number} "${payload.pull_request?.title ?? ""}" in ${payload.repository?.full_name ?? "?"}`;

  const _id = new ObjectId();
  try {
    // Unique deliveryId index: GitHub redeliveries and retries are stored and run once.
    await col.hookEvents.insertOne({
      _id,
      deliveryId: deliveryId || _id.toString(),
      type: event,
      action: payload.action,
      orgId: org._id,
      repoId: repo?._id,
      summary: summary.slice(0, 500),
      status: "queued",
      receivedAt: new Date(),
    });
  } catch (e) {
    if ((e as { code?: number }).code === 11000) return reply(200, "Already received this delivery.");
    throw e;
  }
  await queues.hooks.add("event", { eventId: _id.toString() }, { attempts: 3, backoff: { type: "exponential", delay: 5_000 } });
  return reply(202, "Queued.");
}
