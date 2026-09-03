/**
 * Where a session sits, and who put it there.
 *
 * `blockIdx` used to be a bare required field on ScheduledWorkout, with the
 * comment "placing a session without saying where is a compile error, not a
 * silent wrong week". That property is preserved here rather than weakened:
 * an ENGINE-placed session must still name its block. What the union adds is
 * a second, equally explicit answer — an athlete-placed session occupies no
 * availability block at all, because availability is the auto-assigner's
 * input and a session the athlete chose is not the auto-assigner's business.
 */
export interface AthleteChoice {
  /** The library workout the athlete picked. */
  workoutId: string;
  /** ISO instant. Recorded for the athlete, never compared. */
  chosenAt: string;
}

export type Placement =
  | { kind: "block"; blockIdx: number }
  | { kind: "athlete"; choice: AthleteChoice };

export function blockPlacement(blockIdx: number): Placement {
  return { kind: "block", blockIdx };
}

export function athletePlacement(choice: AthleteChoice): Placement {
  return { kind: "athlete", choice };
}

export function isAthleteChosen(w: { placement: Placement }): boolean {
  return w.placement.kind === "athlete";
}

/**
 * The block index, or null when the session occupies none.
 *
 * Returning null rather than -1 is deliberate: every caller indexes
 * `availableBlocks` with this, and `arr[-1]` is silently `undefined` while a
 * null forces the caller to say what it means. The compiler does the work.
 */
export function blockIdxOf(p: Placement): number | null {
  return p.kind === "block" ? p.blockIdx : null;
}

/**
 * `week_plans.days` is jsonb with no runtime validation, so every week stored
 * before this release carries `blockIdx: number` and no `placement`. This is
 * the read boundary's translation, and it is idempotent so it can run on
 * every read without accumulating.
 */
export function normalizePlacement(raw: unknown): Placement {
  const r = (raw ?? {}) as { placement?: Placement; blockIdx?: number };
  if (r.placement != null) return r.placement;
  if (typeof r.blockIdx === "number") return blockPlacement(r.blockIdx);
  return blockPlacement(0);
}
