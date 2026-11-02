import { Octokit } from "octokit";
import type { AnyBulkWriteOperation } from "mongodb";
import { col, ObjectId, type Commit, type Contributor, type Org, type PullRequest, type Repo } from "./db";
import { decrypt } from "./crypto";

/** Classic-token scopes that grant write access. Fine-grained tokens don't report scopes at all. */
const WRITE_SCOPES = new Set([
  "repo", "public_repo", "admin:org", "write:org", "delete_repo", "workflow",
  "admin:repo_hook", "admin:org_hook", "write:packages", "write:discussion",
]);

export const writeScopesOf = (scopes: string[] | null) => (scopes ?? []).filter((s) => WRITE_SCOPES.has(s));

/** A GitHub client that physically can't write: only GET requests and GraphQL queries pass. */
export function github(token: string) {
  const o = new Octokit({
    auth: token,
    throttle: {
      onRateLimit: (_after: number, _o: unknown, _k: unknown, retryCount: number) => retryCount < 2,
      onSecondaryRateLimit: (_after: number, _o: unknown, _k: unknown, retryCount: number) => retryCount < 2,
    },
  });
  o.hook.before("request", (options) => {
    const isGraphql = options.url === "/graphql";
    const query = String((options as { query?: unknown }).query ?? "");
    if (isGraphql ? /^\s*mutation\b/.test(query) : options.method !== "GET") {
      throw new Error(`Blocked a non-read GitHub call: ${options.method} ${options.url}`);
    }
  });
  return o;
}

export async function checkToken(token: string, orgLogin: string) {
  const res = await github(token).request("GET /orgs/{org}", { org: orgLogin });
  const header = res.headers["x-oauth-scopes"];
  const scopes = typeof header === "string" ? header.split(",").map((s) => s.trim()).filter(Boolean) : null;
  return {
    ghId: res.data.id,
    login: res.data.login,
    scopes,
    writeScopes: writeScopesOf(scopes),
  };
}

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);

/** Lists the org's repos, then syncs commits and PRs for every enabled repo. */
export async function syncOrg(orgId: ObjectId) {
  const org = await col.orgs.findOne({ _id: orgId });
  if (!org?.enabled) return null;
  const o = github(decrypt(org.token));
  try {
    const repos = await o.paginate("GET /orgs/{org}/repos", { org: org.login, per_page: 100, type: "all" });
    for (const r of repos) {
      await col.repos.updateOne(
        { ghId: r.id },
        {
          $set: {
            orgId,
            name: r.name,
            fullName: r.full_name,
            isPrivate: r.private,
            isArchived: r.archived ?? false,
            defaultBranch: r.default_branch ?? null,
          },
          $setOnInsert: { enabled: true, hidden: false },
        },
        { upsert: true },
      );
    }
    for (const repo of await col.repos.find({ orgId, enabled: true }).toArray()) {
      try {
        await syncRepo(o, org, repo);
        await col.repos.updateOne({ _id: repo._id }, { $set: { lastSyncAt: new Date(), syncError: null } });
      } catch (e) {
        // One broken repo shouldn't stop the rest of the org.
        await col.repos.updateOne({ _id: repo._id }, { $set: { syncError: errorMessage(e) } });
      }
    }
    await col.orgs.updateOne({ _id: orgId }, { $set: { lastSyncAt: new Date(), syncError: null } });
    return org;
  } catch (e) {
    await col.orgs.updateOne({ _id: orgId }, { $set: { syncError: errorMessage(e) } });
    throw e;
  }
}

type GqlAuthor = { email: string | null; name: string | null; user: { databaseId: number; login: string; avatarUrl: string } | null } | null;
type CommitNode = {
  oid: string; url: string; committedDate: string; additions: number; deletions: number;
  messageHeadline: string; parents: { totalCount: number }; author: GqlAuthor;
};
type PrNode = {
  number: number; title: string; url: string; state: PullRequest["state"]; createdAt: string; updatedAt: string;
  mergedAt: string | null; additions: number; deletions: number; commits: { totalCount: number };
  author: { login: string; avatarUrl: string; databaseId?: number; name?: string | null } | null;
};

const COMMITS_QUERY = `query($owner:String!,$name:String!,$since:GitTimestamp,$after:String){
  repository(owner:$owner,name:$name){ defaultBranchRef{ target{ ... on Commit{
    history(first:50, since:$since, after:$after){
      pageInfo{ hasNextPage endCursor }
      nodes{ oid url committedDate additions deletions messageHeadline parents{ totalCount }
        author{ email name user{ databaseId login avatarUrl } } }
    } } } } } }`;

const PRS_QUERY = `query($owner:String!,$name:String!,$after:String){
  repository(owner:$owner,name:$name){
    pullRequests(first:50, after:$after, orderBy:{field:UPDATED_AT, direction:DESC}){
      pageInfo{ hasNextPage endCursor }
      nodes{ number title url state createdAt updatedAt mergedAt additions deletions commits{ totalCount }
        author{ login avatarUrl ... on User{ databaseId name } ... on Bot{ databaseId } } }
    } } }`;

function contributorFromCommit(a: GqlAuthor): Pick<Contributor, "_id" | "login" | "name" | "avatarUrl"> & { email?: string } {
  if (a?.user) return { _id: `gh:${a.user.databaseId}`, login: a.user.login, avatarUrl: a.user.avatarUrl, name: a.name ?? undefined, email: a.email ?? undefined };
  const email = (a?.email ?? "unknown").toLowerCase();
  return { _id: `email:${email}`, name: a?.name ?? email, email };
}

async function upsertContributors(list: ReturnType<typeof contributorFromCommit>[]) {
  if (!list.length) return;
  const ops: AnyBulkWriteOperation<Contributor>[] = list.map(({ _id, email, ...rest }) => {
    const set = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
    return {
      updateOne: {
        filter: { _id },
        update: email ? { $set: set, $addToSet: { emails: email } } : { $set: set, $setOnInsert: { emails: [] } },
        upsert: true,
      },
    };
  });
  await col.contributors.bulkWrite(ops, { ordered: false });
}

/** Incremental: commits since the newest one we hold (minus a day of slack), PRs updated since last sync. */
export async function syncRepo(o: Octokit, org: Org, repo: Repo) {
  const owner = org.login;
  const name = repo.name;

  if (repo.defaultBranch) {
    const since = repo.lastCommitAt ? new Date(repo.lastCommitAt.getTime() - 864e5).toISOString() : undefined;
    let after: string | null = null;
    let newest = repo.lastCommitAt ?? new Date(0);
    do {
      const res: { repository: { defaultBranchRef: { target: { history: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: CommitNode[] } } } | null } | null } =
        await o.graphql(COMMITS_QUERY, { owner, name, since, after });
      const history = res.repository?.defaultBranchRef?.target?.history;
      if (!history) break; // empty repository
      const people = history.nodes.map((n) => contributorFromCommit(n.author));
      await upsertContributors(people);
      const ops: AnyBulkWriteOperation<Commit>[] = history.nodes.map((n, i) => {
        const committedAt = new Date(n.committedDate);
        if (committedAt > newest) newest = committedAt;
        return {
          updateOne: {
            filter: { repoId: repo._id, sha: n.oid },
            update: {
              $set: {
                contributorId: people[i]._id,
                committedAt,
                additions: n.additions,
                deletions: n.deletions,
                isMerge: n.parents.totalCount > 1,
                message: n.messageHeadline,
                url: n.url,
              },
            },
            upsert: true,
          },
        };
      });
      if (ops.length) await col.commits.bulkWrite(ops, { ordered: false });
      after = history.pageInfo.hasNextPage ? history.pageInfo.endCursor : null;
    } while (after);
    await col.repos.updateOne({ _id: repo._id }, { $set: { lastCommitAt: newest } });
  }

  const cutoff = repo.lastPrUpdatedAt ?? new Date(0);
  let newestPr = cutoff;
  let after: string | null = null;
  pages: do {
    const res: { repository: { pullRequests: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: PrNode[] } } | null } =
      await o.graphql(PRS_QUERY, { owner, name, after });
    const prs = res.repository?.pullRequests;
    if (!prs) break;
    const fresh = prs.nodes.filter((p) => new Date(p.updatedAt) > cutoff);
    const people = fresh.map((p) =>
      p.author?.databaseId
        ? { _id: `gh:${p.author.databaseId}`, login: p.author.login, avatarUrl: p.author.avatarUrl, name: p.author.name ?? undefined }
        : { _id: `login:${p.author?.login ?? "ghost"}`, login: p.author?.login ?? "ghost", name: p.author?.login ?? "ghost" },
    );
    await upsertContributors(people);
    const ops: AnyBulkWriteOperation<PullRequest>[] = fresh.map((p, i) => {
      const updatedAt = new Date(p.updatedAt);
      if (updatedAt > newestPr) newestPr = updatedAt;
      return {
        updateOne: {
          filter: { repoId: repo._id, number: p.number },
          update: {
            $set: {
              title: p.title,
              url: p.url,
              contributorId: people[i]._id,
              state: p.state,
              createdAt: new Date(p.createdAt),
              updatedAt,
              mergedAt: p.mergedAt ? new Date(p.mergedAt) : null,
              additions: p.additions,
              deletions: p.deletions,
              commitCount: p.commits.totalCount,
            },
          },
          upsert: true,
        },
      };
    });
    if (ops.length) await col.pulls.bulkWrite(ops, { ordered: false });
    // Results are newest-updated first, so the first stale PR means everything after it is stale too.
    if (fresh.length < prs.nodes.length) break pages;
    after = prs.pageInfo.hasNextPage ? prs.pageInfo.endCursor : null;
  } while (after);
  await col.repos.updateOne({ _id: repo._id }, { $set: { lastPrUpdatedAt: newestPr } });
}
