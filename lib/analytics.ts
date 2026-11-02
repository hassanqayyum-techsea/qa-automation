import "server-only";
import { col, type ObjectId } from "./db";
import { can, type SessionUser } from "./auth";

export type Range = { from: Date; to: Date; key: string; bucket: "day" | "week" };
const PRESETS: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90, "1y": 365 };

/** ?range=30d, or ?from=YYYY-MM-DD&to=YYYY-MM-DD (inclusive). Defaults to the last 30 days. */
export function parseRange(sp: { range?: string; from?: string; to?: string }): Range {
  const day = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00Z`) : null);
  const from = day(sp.from);
  const to = day(sp.to);
  let r: { from: Date; to: Date; key: string };
  if (from && to && from <= to) {
    r = { from, to: new Date(to.getTime() + 864e5), key: "custom" };
  } else {
    const key = sp.range && PRESETS[sp.range] ? sp.range : "30d";
    const end = new Date();
    r = { from: new Date(end.getTime() - PRESETS[key] * 864e5), to: end, key };
  }
  const days = (r.to.getTime() - r.from.getTime()) / 864e5;
  return { ...r, bucket: days > 120 ? "week" : "day" };
}

/**
 * The single place visibility is decided: enabled repos in enabled orgs, minus hidden ones unless
 * the user holds hidden:view. Every analytics query filters by this list.
 */
export async function visibleRepoIds(user: SessionUser): Promise<ObjectId[]> {
  const notHidden = can(user, "hidden:view") ? {} : { hidden: false };
  const orgs = await col.orgs.find({ enabled: true, ...notHidden }, { projection: { _id: 1 } }).toArray();
  const repos = await col.repos
    .find({ orgId: { $in: orgs.map((o) => o._id) }, enabled: true, ...notHidden }, { projection: { _id: 1 } })
    .toArray();
  return repos.map((r) => r._id);
}

const lineSum = (field: "additions" | "deletions") => ({ $sum: { $cond: ["$isMerge", 0, `$${field}`] } });

export async function overview(user: SessionUser, range: Range, contributorId?: string) {
  const repoIds = await visibleRepoIds(user);
  const who = contributorId ? { contributorId } : {};
  const commitMatch = { repoId: { $in: repoIds }, committedAt: { $gte: range.from, $lt: range.to }, ...who };

  const [totals] = await col.commits
    .aggregate<{ commits: number; additions: number; deletions: number; contributors: number }>([
      { $match: commitMatch },
      {
        $group: {
          _id: null,
          commits: { $sum: 1 },
          additions: lineSum("additions"),
          deletions: lineSum("deletions"),
          people: { $addToSet: "$contributorId" },
        },
      },
      { $project: { _id: 0, commits: 1, additions: 1, deletions: 1, contributors: { $size: "$people" } } },
    ])
    .toArray();

  const series = await col.commits
    .aggregate<{ _id: Date; commits: number; additions: number; deletions: number }>([
      { $match: commitMatch },
      {
        $group: {
          _id: { $dateTrunc: { date: "$committedAt", unit: range.bucket, startOfWeek: "monday" } },
          commits: { $sum: 1 },
          additions: lineSum("additions"),
          deletions: lineSum("deletions"),
        },
      },
      { $sort: { _id: 1 } },
    ])
    .toArray();

  const prBase = { repoId: { $in: repoIds }, ...who };
  const [prsOpened, prsMerged] = await Promise.all([
    col.pulls.countDocuments({ ...prBase, createdAt: { $gte: range.from, $lt: range.to } }),
    col.pulls.countDocuments({ ...prBase, mergedAt: { $gte: range.from, $lt: range.to } }),
  ]);

  return {
    commits: totals?.commits ?? 0,
    additions: totals?.additions ?? 0,
    deletions: totals?.deletions ?? 0,
    contributors: totals?.contributors ?? 0,
    prsOpened,
    prsMerged,
    series: fillSeries(series, range),
    repoCount: repoIds.length,
  };
}

/** Zero-fill empty days/weeks so the chart's x axis is continuous. */
function fillSeries(rows: { _id: Date; commits: number; additions: number; deletions: number }[], range: Range) {
  const byKey = new Map(rows.map((r) => [r._id.toISOString().slice(0, 10), r]));
  const out: { date: string; commits: number; additions: number; deletions: number }[] = [];
  const step = range.bucket === "week" ? 7 : 1;
  const start = new Date(Date.UTC(range.from.getUTCFullYear(), range.from.getUTCMonth(), range.from.getUTCDate()));
  if (range.bucket === "week") start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7)); // back to Monday
  for (let d = start; d < range.to; d = new Date(d.getTime() + step * 864e5)) {
    const key = d.toISOString().slice(0, 10);
    const r = byKey.get(key);
    out.push({ date: key, commits: r?.commits ?? 0, additions: r?.additions ?? 0, deletions: r?.deletions ?? 0 });
  }
  return out;
}

export type LeaderRow = {
  id: string;
  name: string;
  login?: string;
  avatarUrl?: string;
  commits: number;
  additions: number;
  deletions: number;
  prsOpened: number;
  prsMerged: number;
};
export const LEADER_SORTS = ["lines", "commits", "additions", "deletions", "prs"] as const;
export type LeaderSort = (typeof LEADER_SORTS)[number];

export async function leaderboard(user: SessionUser, range: Range, sort: LeaderSort, limit = 100): Promise<LeaderRow[]> {
  const repoIds = await visibleRepoIds(user);
  const window = { $gte: range.from, $lt: range.to };
  const [commitRows, opened, merged] = await Promise.all([
    col.commits
      .aggregate<{ _id: string; commits: number; additions: number; deletions: number }>([
        { $match: { repoId: { $in: repoIds }, committedAt: window } },
        { $group: { _id: "$contributorId", commits: { $sum: 1 }, additions: lineSum("additions"), deletions: lineSum("deletions") } },
      ])
      .toArray(),
    col.pulls.aggregate<{ _id: string; n: number }>([
      { $match: { repoId: { $in: repoIds }, createdAt: window } },
      { $group: { _id: "$contributorId", n: { $sum: 1 } } },
    ]).toArray(),
    col.pulls.aggregate<{ _id: string; n: number }>([
      { $match: { repoId: { $in: repoIds }, mergedAt: window } },
      { $group: { _id: "$contributorId", n: { $sum: 1 } } },
    ]).toArray(),
  ]);

  const rows = new Map<string, Omit<LeaderRow, "name">>();
  const row = (id: string) => {
    let r = rows.get(id);
    if (!r) rows.set(id, (r = { id, commits: 0, additions: 0, deletions: 0, prsOpened: 0, prsMerged: 0 }));
    return r;
  };
  for (const c of commitRows) Object.assign(row(c._id), { commits: c.commits, additions: c.additions, deletions: c.deletions });
  for (const p of opened) row(p._id).prsOpened = p.n;
  for (const p of merged) row(p._id).prsMerged = p.n;

  const score: Record<LeaderSort, (r: Omit<LeaderRow, "name">) => number> = {
    lines: (r) => r.additions + r.deletions,
    commits: (r) => r.commits,
    additions: (r) => r.additions,
    deletions: (r) => r.deletions,
    prs: (r) => r.prsMerged * 1000 + r.prsOpened,
  };
  const top = [...rows.values()].sort((a, b) => score[sort](b) - score[sort](a)).slice(0, limit);
  const people = new Map(
    (await col.contributors.find({ _id: { $in: top.map((r) => r.id) } }).toArray()).map((c) => [c._id, c]),
  );
  return top.map((r) => {
    const p = people.get(r.id);
    return { ...r, name: p?.name || p?.login || r.id, login: p?.login, avatarUrl: p?.avatarUrl };
  });
}

export async function contributorActivity(user: SessionUser, id: string, range: Range) {
  const repoIds = await visibleRepoIds(user);
  const [person, commits, pulls, repos] = await Promise.all([
    col.contributors.findOne({ _id: id }),
    col.commits
      .find({ contributorId: id, repoId: { $in: repoIds }, committedAt: { $gte: range.from, $lt: range.to } })
      .sort({ committedAt: -1 })
      .limit(100)
      .toArray(),
    col.pulls
      .find({ contributorId: id, repoId: { $in: repoIds }, createdAt: { $gte: range.from, $lt: range.to } })
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray(),
    col.repos.find({ _id: { $in: repoIds } }, { projection: { fullName: 1 } }).toArray(),
  ]);
  const repoName = new Map(repos.map((r) => [r._id.toString(), r.fullName]));
  return { person, commits, pulls, repoName };
}
