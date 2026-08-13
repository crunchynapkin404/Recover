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
  // Pairwise, not zero-fill: a week with no known target contributes to
  // neither sum, so real training done during it never inflates the
  // ratio without a matching denominator — see
  // docs/specs/2026-08-10-adherence-and-completion-ownership-design.md.
  let targetTotal = 0;
  let actualTotal = 0;
  for (const p of points) {
    if (p.targetLoad == null) continue;
    targetTotal += p.targetLoad;
    actualTotal += p.actualLoad;
  }
  if (targetTotal <= 0) return null;
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
      <section className="glass rounded-[18px] p-4">
        <h3 className="text-caption font-bold">Season progress</h3>
        <p className="mt-2 text-caption text-ink-secondary">
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
    <section className="glass rounded-[18px] p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-caption font-bold">Season progress</h3>
        <span className="text-label font-semibold uppercase tracking-[0.14em] text-ink-muted">
          Weekly target vs actual
        </span>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-2 text-label">
        <div className="rounded-xl border border-hairline bg-surface-overlay px-2.5 py-2">
          <p className="text-ink-muted">Latest target</p>
          <p className="mt-1 font-numeric text-ink-primary">
            {latest.targetLoad != null
              ? formatChartValue(latest.targetLoad)
              : "—"}
          </p>
        </div>
        <div className="rounded-xl border border-hairline bg-surface-overlay px-2.5 py-2">
          <p className="text-ink-muted">Latest actual</p>
          <p className="mt-1 font-numeric text-ink-primary">
            {formatChartValue(latest.actualLoad)}
          </p>
        </div>
        <div className="rounded-xl border border-hairline bg-surface-overlay px-2.5 py-2">
          <p className="text-ink-muted">Season adherence</p>
          <p className="mt-1 font-numeric text-ink-primary">
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
              <div key={point.weekStart} className="w-8">
                <div className="mb-1.5 flex h-24 items-end gap-0.5 rounded-md bg-surface-overlay px-1 py-1">
                  <div
                    className="w-1.5 rounded-sm bg-ink-muted"
                    style={{ height: `${targetHeight}px` }}
                    title={`Target ${point.weekStart}: ${point.targetLoad ?? "unknown"}`}
                  />
                  <div
                    className="w-1.5 rounded-sm bg-chart-2"
                    style={{ height: `${actualHeight}px` }}
                    title={`Actual ${point.weekStart}: ${formatChartValue(point.actualLoad)}`}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* An axis tick every 3rd week, plus the last. Twelve independent 12px
          labels need ~500-540px — more than a phone has — so the per-bar week
          and session-count labels this replaced could not survive the floor.
          See docs/design/v0.99-train.html#collision. */}
        <div className="mt-1.5 flex min-w-max gap-2">
          {data.map((point, i) => (
            <div key={point.weekStart} className="w-8 text-center">
              {(i % 3 === 0 || i === data.length - 1) && (
                <span data-axis-tick className="text-label text-ink-muted">
                  {weekLabel(point.weekStart)}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* One always-legible readout replaces 24 always-on micro-labels. It
        names the latest week — the one the athlete opened this tab for.
        Every other week keeps the per-bar `title` it already had.

        It names the week and its session count and stops there. Target and
        actual are NOT repeated here: the "Latest target" / "Latest actual"
        tiles above render the same two figures a few inches up, and this
        page has an explicit standing rule against showing one value twice.
        The tiles won that call because they also carry season adherence,
        which this line does not and could not without inventing a figure. */}
      <p className="mt-3 text-caption text-ink-secondary">
        <span className="font-bold text-ink-primary">
          {weekLabel(latest.weekStart)}
        </span>
        {` · ${latest.sessions} session${latest.sessions === 1 ? "" : "s"}`}
      </p>

      <p className="mt-3 text-label text-ink-muted">
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
