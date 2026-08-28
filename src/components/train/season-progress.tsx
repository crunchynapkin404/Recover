/**
 * The Season tab, reduced to what it actually said. That tab was one screen
 * with zero actions (docs/2026-08-26-flow-inventory.md) — a report wearing a
 * tab's clothing. Its timeline chart moved to Fitness; these two figures are
 * what remained worth reading on Week.
 *
 * Renders nothing rather than zeroes when there is no plan: 0% is a claim
 * about the athlete, "no figure" is a claim about the data.
 */
export function SeasonProgress({
  progressPct,
  weeksToRace,
  raceName,
}: {
  progressPct: number | null;
  weeksToRace: number | null;
  raceName: string | null;
}) {
  if (progressPct == null && weeksToRace == null) return null;
  return (
    <div
      data-season-progress
      className="mb-5 flex gap-8 border-t border-hairline pt-4"
    >
      {progressPct != null && (
        <div>
          <p className="text-heading font-bold tracking-[-0.02em] tabular-nums">
            {Math.round(progressPct)}%
          </p>
          <p className="text-label font-bold uppercase tracking-[0.13em] text-ink-muted">
            Progress
          </p>
        </div>
      )}
      {weeksToRace != null && (
        <div>
          <p className="text-heading font-bold tracking-[-0.02em] tabular-nums">
            {weeksToRace}
          </p>
          <p className="text-label font-bold uppercase tracking-[0.13em] text-ink-muted">
            {raceName ? "Weeks to race" : "Weeks left"}
          </p>
        </div>
      )}
    </div>
  );
}
