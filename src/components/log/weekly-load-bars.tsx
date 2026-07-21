import { formatChartValue, type WeeklyLoad } from "@/lib/charts";

export function WeeklyLoadBars({ data }: { data: WeeklyLoad[] }) {
  const max = Math.max(...data.map((d) => d.load), 1);
  return (
    <div className="glass rounded-[2rem] p-6">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-sm font-bold">Weekly load</h3>
        <span className="label-micro">Last {data.length} weeks</span>
      </div>
      <div
        className="flex h-24 items-end gap-1.5"
        role="img"
        aria-label={`Weekly training load over the last ${data.length} weeks`}
      >
        {data.map((w) => (
          <div
            key={w.weekStart}
            className="group flex flex-1 flex-col items-center gap-1"
          >
            <div
              className="w-full rounded-t bg-emerald-500/60 transition-colors group-hover:bg-emerald-400"
              style={{
                height: `${Math.max((w.load / max) * 100, w.load > 0 ? 4 : 1)}%`,
              }}
              title={`${w.weekStart}: ${formatChartValue(w.load)}`}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
