"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { RequestError } from "octokit";
import { audit, requirePermission } from "~/lib/auth";
import { col, ObjectId, oid } from "~/lib/db";
import { encrypt, randomSecret } from "~/lib/crypto";
import { checkToken } from "~/lib/github";
import { queues } from "~/lib/redis";
import { fieldErrors, type ActionResult } from "~/lib/forms";

const enqueueSync = (orgId: ObjectId) =>
  // Deduplicated until the pending job finishes: pressing "Sync now" twice adds one job, not two.
  queues.sync.add("org", { orgId: orgId.toString() }, { deduplication: { id: `org-${orgId}` } });

const connectSchema = z.object({
  org: z.string().trim().regex(/^[A-Za-z0-9-]{1,39}$/, "Enter the organization's GitHub login, e.g. acme-inc (not a URL)."),
  token: z.string().trim().regex(/^(gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}$/, "This doesn't look like a GitHub token. Fine-grained tokens start with github_pat_."),
});

export async function connectOrg(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await requirePermission("token:manage");
  const parsed = connectSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fieldErrors(parsed.error);

  let info: Awaited<ReturnType<typeof checkToken>>;
  try {
    info = await checkToken(parsed.data.token, parsed.data.org);
  } catch (e) {
    if (e instanceof RequestError && e.status === 401) return { fieldErrors: { token: "GitHub rejected this token. It may be expired or revoked." } };
    if (e instanceof RequestError && e.status === 404)
      return { fieldErrors: { org: "This token can't see that organization. Check the spelling and that the token's resource owner is this org." } };
    return { error: "GitHub couldn't be reached to check the token. Try again in a minute." };
  }

  const existing = await col.orgs.findOne({ ghId: info.ghId });
  const token = encrypt(parsed.data.token);
  let orgId: ObjectId;
  if (existing) {
    await col.orgs.updateOne({ _id: existing._id }, { $set: { token, tokenScopes: info.scopes, login: info.login, syncError: null } });
    orgId = existing._id;
  } else {
    orgId = new ObjectId();
    await col.orgs.insertOne({
      _id: orgId,
      ghId: info.ghId,
      login: info.login,
      token,
      tokenScopes: info.scopes,
      webhookSecret: encrypt(randomSecret()),
      enabled: true, // connecting an org is choosing to sync it; turn it off any time
      hidden: false,
      createdAt: new Date(),
    });
  }
  await audit(user, existing ? "org.token_replaced" : "org.connected", info.login, { scopes: info.scopes });
  await enqueueSync(orgId);
  refresh();
  const warn = info.writeScopes.length
    ? ` Warning: this classic token also has write scopes (${info.writeScopes.join(", ")}). Repo Pulse only reads, but a fine-grained read-only token is safer.`
    : "";
  return { ok: `${info.login} connected. The first sync has started.${warn}` };
}

export async function removeOrg(orgId: string): Promise<ActionResult> {
  const user = await requirePermission("token:manage");
  const _id = oid(orgId);
  const org = _id && (await col.orgs.findOne({ _id }));
  if (!org) return { error: "That organization was already removed." };
  const repoIds = (await col.repos.find({ orgId: org._id }, { projection: { _id: 1 } }).toArray()).map((r) => r._id);
  await Promise.all([
    col.commits.deleteMany({ repoId: { $in: repoIds } }),
    col.pulls.deleteMany({ repoId: { $in: repoIds } }),
    col.repos.deleteMany({ orgId: org._id }),
    col.orgs.deleteOne({ _id: org._id }),
  ]);
  await audit(user, "org.removed", org.login, { repos: repoIds.length });
  refresh();
  return { ok: `${org.login} removed, along with its synced data and token.` };
}

const FLAGS = ["enabled", "hidden"] as const;

export async function setOrgFlag(orgId: string, flag: (typeof FLAGS)[number], value: boolean): Promise<ActionResult> {
  const user = await requirePermission("scope:manage");
  const _id = oid(orgId);
  if (!_id || !FLAGS.includes(flag)) return { error: "Unknown organization or setting." };
  const org = await col.orgs.findOneAndUpdate({ _id }, { $set: { [flag]: value } });
  if (!org) return { error: "That organization no longer exists." };
  await audit(user, `org.${flag}.${value}`, org.login);
  if (flag === "enabled" && value) await enqueueSync(_id);
  refresh();
  return null;
}

export async function setRepoFlag(repoId: string, flag: (typeof FLAGS)[number], value: boolean): Promise<ActionResult> {
  const user = await requirePermission("scope:manage");
  const _id = oid(repoId);
  if (!_id || !FLAGS.includes(flag)) return { error: "Unknown repository or setting." };
  const repo = await col.repos.findOneAndUpdate({ _id }, { $set: { [flag]: value } });
  if (!repo) return { error: "That repository no longer exists." };
  await audit(user, `repo.${flag}.${value}`, repo.fullName);
  if (flag === "enabled" && value) await enqueueSync(repo.orgId);
  refresh();
  return null;
}

export async function syncNow(orgId: string): Promise<ActionResult> {
  await requirePermission("sync:run");
  const _id = oid(orgId);
  const org = _id && (await col.orgs.findOne({ _id }));
  if (!org) return { error: "That organization no longer exists." };
  if (!org.enabled) return { error: `${org.login} is turned off. Turn it on to sync it.` };
  await enqueueSync(org._id);
  return { ok: `Sync queued for ${org.login}. The page updates when it finishes.` };
}
