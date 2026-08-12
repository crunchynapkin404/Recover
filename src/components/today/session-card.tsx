import type { DaySlot } from "@/lib/week-plan/types";
import {
  DayActions,
  type DayActionsOtherDay,
} from "@/components/week/day-actions";
import { MarkDoneButton } from "./mark-done-button";

interface Props {
  /** The slot to render; null → render nothing. */
  slot: DaySlot | null;
  /** Latest adjustment reason, quoted verbatim; null → no note. */
  adjustmentReason: string | null;
  /** Other days in the open week, for the move/swap targets. */
  otherDays: DayActionsOtherDay[];
  /** Evening passes "Tomorrow's session". */
  heading?: string;
  /**
   * "done" is the post-session one-liner: the session the athlete has
   * already ridden, kept on the page as confirmation rather than as a
   * thing to act on. The full variant already handles a completed slot by
   * replacing its action row — this is the caller asking for less again.
   */
  variant?: "full" | "done";
  /** Off for tomorrow: a session that has not happened cannot be done. */
  allowMarkDone?: boolean;
}

const pill =
  "rounded-full border border-hairline px-3 py-1 text-label font-bold text-ink-secondary";

/**
 * A day's prescribed session. The action row is "Mark done" plus the real
 * DayActions server actions (move / swap / skip). The mockup's "Shrink"
 * still has no backing action — adaptDay owns scaling, and there is no
 * athlete-facing one — so it is intentionally not faked here.
 *
 * v0.99 slice 1: on the token scale; takes a heading so the evening state
 * can show tomorrow; gains the compact done variant.
 */
export function SessionCard({
  slot,
  adjustmentReason,
  otherDays,
  heading = "Today's session",
  variant = "full",
  allowMarkDone = true,
}: Props) {
  if (!slot) return null;
  const workouts = slot.workouts;

  if (variant === "done") {
    if (workouts.length === 0) return null;
    const w = workouts[0];
    return (
      <section className="flex items-center justify-between gap-3 rounded-[20px] border border-hairline bg-surface-raised p-4">
        <span className="min-w-0 truncate text-body font-bold text-ink-primary">
          {`${w.type} · ${w.durationMins} min`}
        </span>
        <span className="shrink-0 text-label font-bold text-chart-2">
          ✓ Done
        </span>
      </section>
    );
  }

  return (
    <section className="rounded-[20px] border border-hairline bg-surface-raised p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-label font-bold uppercase tracking-[0.14em] text-ink-muted">
          {heading}
        </span>
        {workouts.length === 1 && (
          <span className={pill}>{workouts[0].intensity}</span>
        )}
      </div>

      {workouts.length > 0 ? (
        workouts.map((w, i) => (
          <div key={i} className={i > 0 ? "mt-3" : undefined}>
            <div className="flex items-center justify-between gap-3">
              <p className="text-title font-bold text-ink-primary">
                {`${w.type} · ${w.durationMins} min`}
              </p>
              {workouts.length > 1 && (
                <span className={pill}>{w.intensity}</span>
              )}
            </div>
            {w.description && (
              <p className="mt-1 text-caption text-ink-secondary">
                {w.description}
              </p>
            )}
          </div>
        ))
      ) : (
        <p className="text-title font-bold text-ink-muted">Rest</p>
      )}

      {adjustmentReason != null && (
        <div data-adjustment className="mt-3 rounded-xl bg-surface-overlay p-2">
          <p className="text-caption leading-snug text-chart-3">
            ↻ {adjustmentReason}
          </p>
        </div>
      )}

      {workouts.length > 0 &&
        (slot.status === "completed" ? (
          <p className="mt-3 border-t border-hairline pt-3 text-label font-bold text-chart-2">
            ✓ Done
          </p>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-hairline pt-3">
            {allowMarkDone && <MarkDoneButton date={slot.date} />}
            <DayActions
              day={{ date: slot.date, workoutCount: workouts.length }}
              otherDays={otherDays}
              bare
            />
          </div>
        ))}
    </section>
  );
}
