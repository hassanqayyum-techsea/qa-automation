"use client";

import { LineChart } from "@your-job-search-genius/odyssey-ui/components/application/charts/line-chart";

type Point = { date: string; commits: number; additions: number; deletions: number };

const label = (bucket: "day" | "week") => (d: unknown) => {
  const s = new Date(`${String(d)}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  return bucket === "week" ? `Week of ${s}` : s;
};

export function ActivityCharts({ data, bucket }: { data: Point[]; bucket: "day" | "week" }) {
  const per = bucket === "week" ? "per week" : "per day";
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <LineChart
        label={`Commits ${per}`}
        title={`Commits ${per}`}
        data={data}
        xKey="date"
        xFormatter={label(bucket)}
        series={[{ key: "commits", name: "Commits" }]}
        variant="area"
        emptyMessage="No commits in this period."
      />
      <LineChart
        label={`Lines added and removed ${per}`}
        title={`Lines changed ${per}`}
        subtitle="Merge commits excluded"
        data={data}
        xKey="date"
        xFormatter={label(bucket)}
        series={[
          { key: "additions", name: "Added" },
          { key: "deletions", name: "Removed" },
        ]}
        emptyMessage="No line changes in this period."
      />
    </div>
  );
}
