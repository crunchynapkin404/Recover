import {
  type SeasonTimelinePoint,
  formatChartValue,
  localYmd,
} from "@/lib/charts";

function weekLabel(weekStart: string): string {
  const d = new Date(`${weekStart}T00:00:00`);
  return `${d.toLocaleDateString("en-US", { month: "short" })} ${d.getDate()}`;
}

function latestAdherencePct(points: SeasonTimelinePoint[]): number | null {
  const targetTotal = points.reduce((sum, p) => sum + (p.targetLoad ?? 0), 0);
  if (targetTotal <= 0) return null;
  const actualTotal = points.reduce((sum, p) => sum + p.actualLoad, 0);
  return Math.round((actualTotal / targetTotal) * 100);
}

function mondayYmdNow(): string {
  const d = new Date();
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  out.setDate(out.getDate() - ((out.getDay() + 6) % 7));
  return localYmd(out);
}

export function SeasonTimelineCard({ data }: { data: SeasonTimelinePoint[] }) {
  if (data.length === 0) {
    return (
      <section className="rounded-[18px] border border-white/[0.08] bg-white/[0.03] p-4">
        <h3 className="text-sm font-bold">Season progress</h3>
        <p className="mt-2 text-[11px] text-white/60">
          No week timeline yet. Materialize a plan week to start tracking target
          vs actual.
        </p>
      </section>
    );
  }

  const max = Math.max(
    ...data.flatMap((d) => [d.actualLoad, d.targetLoad ?? 0]),
    1
  );
  const latest = data[data.length - 1];
  const adherence = latestAdherencePct(data);
  const currentMonday = mondayYmdNow();
  const isCurrentWeek = latest.weekStart === currentMonday;
  const isFutureWeek = latest.weekStart > currentMonday;

  return (
    <section className="rounded-[18px] border border-white/[0.08] bg-white/[0.03] p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-bold">Season progress</h3>
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/50">
          Weekly target vs actual
        </span>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-2 text-[10px]">
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-2.5 py-2">
          <p className="text-white/50">Latest target</p>
          <p className="mt-1 font-mono text-white">
            {latest.targetLoad != null
              ? formatChartValue(latest.targetLoad)
              : "—"}
          </p>
        </div>
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-2.5 py-2">
          <p className="text-white/50">Latest actual</p>
          <p className="mt-1 font-mono text-white">
            {formatChartValue(latest.actualLoad)}
          </p>
        </div>
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-2.5 py-2">
          <p className="text-white/50">Season adherence</p>
          <p className="mt-1 font-mono text-white">
            {adherence != null ? `${adherence}%` : "—"}
          </p>
        </div>
      </div>

      <div
        className="hide-scrollbar -mx-1 overflow-x-auto px-1"
        role="img"
        aria-label="Season timeline chart showing weekly target and actual load"
      >
        <div className="flex min-w-max items-end gap-2">
          {data.map((point) => {
            const targetHeight =
              point.targetLoad != null
                ? Math.max(
                    (point.targetLoad / max) * 96,
                    point.targetLoad > 0 ? 3 : 1
                  )
                : 0;
            const actualHeight = Math.max(
              (point.actualLoad / max) * 96,
              point.actualLoad > 0 ? 3 : 1
            );

            return (
              <div key={point.weekStart} className="w-7">
                <div className="mb-1.5 flex h-24 items-end gap-0.5 rounded-md bg-white/[0.02] px-1 py-1">
                  <div
                    className="w-1.5 rounded-sm bg-white/30"
                    style={{ height: `${targetHeight}px` }}
                    title={`Target ${point.weekStart}: ${point.targetLoad ?? "unknown"}`}
                  />
                  <div
                    className="w-1.5 rounded-sm bg-emerald-400"
                    style={{ height: `${actualHeight}px` }}
                    title={`Actual ${point.weekStart}: ${formatChartValue(point.actualLoad)}`}
                  />
                </div>
                <p className="text-center text-[9px] text-white/55">
                  {weekLabel(point.weekStart)}
                </p>
                <p className="text-center text-[8px] text-white/40">
                  {point.sessions > 0 ? `${point.sessions}s` : "no"}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      <p className="mt-3 text-[10px] text-white/45">
        {isFutureWeek
          ? "Latest week is upcoming."
          : isCurrentWeek
            ? "Latest week is in progress."
            : "Latest week is complete."}{" "}
        Target stays unknown when that week has no effective target.
      </p>
    </section>
  );
}
