import { notFound } from "next/navigation";
import { StatTile, StatTileGroup } from "@your-job-search-genius/odyssey-ui/components/application/charts/stat-tile";
import { Breadcrumbs } from "@your-job-search-genius/odyssey-ui/components/application/breadcrumbs/breadcrumbs";
import { requirePermission } from "~/lib/auth";
import { contributorActivity, overview, parseRange } from "~/lib/analytics";
import { PageHeader, isoDay } from "~/app/ui/page-header";
import { RangeControl } from "../../range-control";
import { ActivityCharts } from "../../charts";
import { CommitTable, PullTable } from "./activity-tables";

export default async function ContributorPage({ params, searchParams }: PageProps<"/contributors/[id]">) {
  const user = await requirePermission("analytics:view");
  const id = decodeURIComponent((await params).id);
  const range = parseRange((await searchParams) as Record<string, string | undefined>);
  const [{ person, commits, pulls, repoName }, stats] = await Promise.all([
    contributorActivity(user, id, range),
    overview(user, range, id),
  ]);
  if (!person) notFound();
  const name = person.name || person.login || id;

  return (
    <div className="flex flex-col gap-8 px-4 py-8 md:px-8">
      <Breadcrumbs
        items={[
          { id: "contributors", label: "Contributors", href: "/contributors" },
          { id: "person", label: name },
        ]}
      />
      <title>{`${name} · Repo Pulse`}</title>
      <PageHeader
        title={name}
        description={person.login ? `@${person.login}` : person.emails.join(", ") || "Identified by commit email only"}
        actions={<RangeControl rangeKey={range.key} from={isoDay(range.from)} to={isoDay(new Date(range.to.getTime() - 1))} />}
      />
      <StatTileGroup columns={3}>
        <StatTile label="Commits" value={stats.commits} />
        <StatTile label="Lines added" value={stats.additions} description="Merge commits excluded" />
        <StatTile label="Lines removed" value={stats.deletions} description="Merge commits excluded" />
        <StatTile label="Pull requests opened" value={stats.prsOpened} />
        <StatTile label="Pull requests merged" value={stats.prsMerged} />
      </StatTileGroup>
      <ActivityCharts data={stats.series} bucket={range.bucket} />
      <CommitTable
        rows={commits.map((c) => ({
          id: c._id.toString(),
          sha: c.sha.slice(0, 7),
          message: c.message,
          repo: repoName.get(c.repoId.toString()) ?? "",
          date: c.committedAt.toISOString(),
          additions: c.additions,
          deletions: c.deletions,
          isMerge: c.isMerge,
          url: c.url,
        }))}
      />
      <PullTable
        rows={pulls.map((p) => ({
          id: p._id.toString(),
          number: p.number,
          title: p.title,
          repo: repoName.get(p.repoId.toString()) ?? "",
          state: p.state,
          date: p.createdAt.toISOString(),
          additions: p.additions,
          deletions: p.deletions,
          commits: p.commitCount,
          url: p.url,
        }))}
      />
    </div>
  );
}
