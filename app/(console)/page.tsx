import { StatTile, StatTileGroup } from "@your-job-search-genius/odyssey-ui/components/application/charts/stat-tile";
import { Button } from "@your-job-search-genius/odyssey-ui/components/base/buttons/button";
import { Empty } from "~/app/ui/empty";
import { can, requirePermission } from "~/lib/auth";
import { leaderboard, overview, parseRange } from "~/lib/analytics";
import { PageHeader, isoDay } from "~/app/ui/page-header";
import { RangeControl } from "./range-control";
import { ActivityCharts } from "./charts";
import { LeaderboardTable } from "./leaderboard-table";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage({ searchParams }: PageProps<"/">) {
  const user = await requirePermission("analytics:view");
  const sp = (await searchParams) as Record<string, string | undefined>;
  const range = parseRange(sp);
  const [stats, top] = await Promise.all([overview(user, range), leaderboard(user, range, "lines", 5)]);
  const rangeLabel = `${range.from.toLocaleDateString()} – ${new Date(range.to.getTime() - 1).toLocaleDateString()}`;

  return (
    <div className="flex flex-col gap-8 px-4 py-8 md:px-8">
      <PageHeader
        title="Dashboard"
        description={`${stats.repoCount} visible ${stats.repoCount === 1 ? "repository" : "repositories"} · ${rangeLabel}`}
        actions={<RangeControl rangeKey={range.key} from={isoDay(range.from)} to={isoDay(new Date(range.to.getTime() - 1))} />}
      />

      {stats.repoCount === 0 ? (
        <Empty
          icon="GitBranch01"
          title="No repositories to show yet"
          description={
            can(user, "token:manage")
              ? "Connect a GitHub organization with a read-only token. Its repositories sync automatically."
              : "Ask an Owner to connect a GitHub organization, or an Admin to enable one."
          }
          actions={can(user, "token:manage") && <Button href="/repos" size="md">Connect an organization</Button>}
        />
      ) : (
        <>
          <StatTileGroup columns={3}>
            <StatTile label="Commits" value={stats.commits} description="On default branches" />
            <StatTile label="Pull requests opened" value={stats.prsOpened} />
            <StatTile label="Pull requests merged" value={stats.prsMerged} />
            <StatTile label="Lines added" value={stats.additions} description="Merge commits excluded" />
            <StatTile label="Lines removed" value={stats.deletions} description="Merge commits excluded" />
            <StatTile label="Active contributors" value={stats.contributors} description="Committed at least once" />
          </StatTileGroup>
          <ActivityCharts data={stats.series} bucket={range.bucket} />
          <LeaderboardTable
            rows={top}
            sort="lines"
            sortable={false}
            title="Top performers"
            description="Ranked by lines changed in this period"
            trailing={<Button href="/contributors" color="secondary" size="sm">See all contributors</Button>}
          />
        </>
      )}
    </div>
  );
}
