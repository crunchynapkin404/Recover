import type { DaySlot, ScheduledWorkout } from "./types";
import { blockIdxOf, normalizePlacement } from "./placement";

/**
 * `week_plans.days` is jsonb, and `getOpenWeekPlan` used to cast it straight
 * to `DaySlot[]` with no validation at all. Every week stored before this
 * release carries `blockIdx` and no `placement`, so that cast is now a
 * translation.
 *
 * Idempotent, because it runs on every read: a row already in the new shape
 * comes back unchanged.
 */
export function normalizeDays(raw: unknown): DaySlot[] {
  const days = (raw ?? []) as (Omit<DaySlot, "workouts"> & {
    workouts?: unknown[];
  })[];
  return days.map((d) => ({
    ...d,
    workouts: (d.workouts ?? []).map((w) => {
      // The legacy top-level field is dropped once lifted, so a day carries
      // exactly one answer to "where does this sit" in memory. serializeDays
      // puts the compatibility copy back on the way out.
      const { blockIdx: _legacy, ...rest } = w as ScheduledWorkout & {
        blockIdx?: number;
      };
      return { ...rest, placement: normalizePlacement(w) } as ScheduledWorkout;
    }),
  }));
}

/**
 * The inverse, with ONE transitional addition: a block-placed session also
 * writes a top-level `blockIdx`, so a rollback to v0.135.0 finds the index it
 * expects rather than reading `undefined` and scaling the session to zero.
 *
 * An athlete-placed session writes none. There is no honest index for a
 * session that occupies no block, and inventing one is precisely the sentinel
 * this design refuses — the rollback hazard that leaves is bounded to
 * sessions added between deploy and rollback, and is recorded in the spec
 * under "Design 3".
 *
 * Drop the dual write once scripts/backfill-placement.ts has run everywhere.
 */
export function serializeDays(days: DaySlot[]): unknown {
  return days.map((d) => ({
    ...d,
    workouts: d.workouts.map((w) => {
      const idx = blockIdxOf(w.placement);
      return idx == null ? { ...w } : { ...w, blockIdx: idx };
    }),
  }));
}
