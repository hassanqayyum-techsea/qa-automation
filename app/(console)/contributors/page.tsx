import { requirePermission } from "~/lib/auth";
import { LEADER_SORTS, leaderboard, parseRange, type LeaderSort } from "~/lib/analytics";
import { PageHeader, isoDay } from "~/app/ui/page-header";
import { Empty } from "~/app/ui/empty";
import { RangeControl } from "../range-control";
import { LeaderboardTable } from "../leaderboard-table";

export const metadata = { title: "Contributors" };

export default async function ContributorsPage({ searchParams }: PageProps<"/contributors">) {
  const user = await requirePermission("analytics:view");
  const sp = (await searchParams) as Record<string, string | undefined>;
  const range = parseRange(sp);
  const sort: LeaderSort = LEADER_SORTS.includes(sp.sort as LeaderSort) ? (sp.sort as LeaderSort) : "lines";
  const rows = await leaderboard(user, range, sort, 100);

  return (
    <div className="flex flex-col gap-8 px-4 py-8 md:px-8">
      <PageHeader
        title="Contributors"
        description="Everyone who committed or opened a pull request in visible repositories. Select a person to see each commit and pull request."
        actions={<RangeControl rangeKey={range.key} from={isoDay(range.from)} to={isoDay(new Date(range.to.getTime() - 1))} />}
      />
      {rows.length === 0 ? (
        <Empty
          icon="Users01"
          title="No activity in this period"
          description="Pick a longer time period, or check that repositories are enabled and synced."
        />
      ) : (
        <LeaderboardTable
          rows={rows}
          sort={sort}
          title="Leaderboard"
          description={`Top ${rows.length} by ${sort === "prs" ? "pull requests merged" : sort === "lines" ? "lines changed" : sort}. Select a column heading to re-rank.`}
        />
      )}
    </div>
  );
}
