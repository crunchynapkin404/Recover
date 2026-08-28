import type { ReentryStage, SeasonMode } from "@/lib/season-mode/types";

const MODE_LABEL: Record<SeasonMode, string> = {
  normal: "Normal",
  off_season: "Off-season",
};

/**
 * A segmented control, not a row of independent pills like TrainTabs/
 * ViewTabs — so it keeps its own bordered capsule rather than adopting
 * their "no shared container" shape (no restructuring, per Task 12).
 *
 * The chip trap (Task 7 shipped it once): active and inactive must differ
 * in FILL, never text colour alone. This now renders only inside the
 * "plan-setup" sheet (slice 2 task 2), whose own panel is
 * bg-surface-overlay — `bg-surface-raised` resolves to the SAME #ffffff as
 * that overlay in light mode, so the capsule claims `bg-surface-selected`
 * instead, leaving `bg-surface-overlay` free for the active segment
 * (`--surface-selected` is the token this repo built for exactly this
 * "distinct from the overlay it sits inside, in both themes" shape). That
 * is the same base → raised → overlay ladder train-tabs.tsx and
 * view-tabs.tsx use, shifted one step to selected → overlay because the
 * container this sits in now IS the raised/overlay step, adapted to a
 * shared-container shape instead of separate pills.
 */
export function SeasonModeSwitch({
  effectiveSeasonMode,
  reentryStage,
  action,
}: {
  effectiveSeasonMode: SeasonMode;
  reentryStage: ReentryStage;
  action: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <div className="flex items-center gap-1 rounded-full border border-hairline bg-surface-selected p-1">
      <span className="px-2 text-label font-semibold text-ink-secondary">
        Season
      </span>
      {(["normal", "off_season"] as const).map((seasonMode) => {
        const active = seasonMode === effectiveSeasonMode;
        return (
          <form key={seasonMode} action={action}>
            <input type="hidden" name="seasonAction" value={seasonMode} />
            <button
              type="submit"
              aria-pressed={active}
              disabled={active}
              className={`rounded-full px-2.5 py-1 text-label font-bold transition-colors ${
                active
                  ? "bg-surface-overlay text-ink-primary"
                  : "text-ink-muted hover:text-ink-secondary"
              }`}
            >
              {MODE_LABEL[seasonMode]}
            </button>
          </form>
        );
      })}
      {effectiveSeasonMode === "off_season" && reentryStage === "none" && (
        <form action={action}>
          <input type="hidden" name="seasonAction" value="begin_reentry" />
          <button
            type="submit"
            aria-pressed={false}
            className="rounded-full px-2.5 py-1 text-label font-bold text-ink-muted transition-colors hover:text-ink-secondary"
          >
            Start re-entry
          </button>
        </form>
      )}
      {reentryStage !== "none" && (
        <span className="rounded-full bg-chart-2/10 px-2.5 py-1 text-label font-bold text-chart-2">
          {reentryStage === "week_1" ? "Re-entry week 1" : "Re-entry week 2"}
        </span>
      )}
    </div>
  );
}
