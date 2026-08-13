import { formatChartValue, type WeeklyLoad } from "@/lib/charts";

export function WeeklyLoadBars({ data }: { data: WeeklyLoad[] }) {
  const max = Math.max(...data.map((d) => d.load), 1);
  return (
    <div className="glass rounded-[2rem] p-6">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-caption font-bold">Weekly load</h3>
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
            // justify-end is load-bearing: the column is h-full, so the
            // parent's items-end cannot reach the bar inside it. Without
            // this the bars hang DOWNWARD from a shared top edge and the
            // chart reads upside-down — found by opening the capture, not
            // by any test.
            className="group flex h-full flex-1 flex-col items-center justify-end gap-1"
          >
            <div
              // chart-2 is the "good" tone, the same token CTL and TSB use
              // one panel up — this bar was the last raw Tailwind palette
              // colour on the surface. No guard tracks this category:
              // ADHOC_INK matches white/black alphas only, and the colour-
              // literal ledger counts hex/rgb, not palette class names.
              className="w-full rounded-t bg-chart-2/60 transition-colors group-hover:bg-chart-2"
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
