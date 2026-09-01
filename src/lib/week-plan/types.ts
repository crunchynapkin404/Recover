import type { PlannedWorkout } from "@/lib/training-plan";
import type { WorkoutPin } from "@/lib/interval/pin";
import type { Band } from "@/lib/readiness";
import type { AvailabilityBlock } from "@/lib/availability/types";
import type { PlanStyle } from "@/lib/plan-style/types";
import { blockMins } from "@/lib/availability/types";

export interface MaterializationStyleMeta {
  effectiveStyle: PlanStyle;
}

export type DayStatus =
  "planned" | "completed" | "adapted" | "moved" | "missed" | "rest" | "race";

/**
 * A session that has actually been placed. `blockIdx` says which of its
 * day's availableBlocks it occupies — a template from generateWorkouts has
 * no such answer, which is why this is a distinct type: placing a session
 * without saying where is a compile error, not a silent wrong week.
 */
export interface ScheduledWorkout extends PlannedWorkout {
  /** Index into its day's availableBlocks. The block this session occupies. */
  blockIdx: number;
  /**
   * Set ONLY when the athlete has exported this session's structured workout
   * to their intervals.icu calendar — the one moment the workout leaves
   * Recover and can reach a head unit, and therefore the one moment pinning is
   * genuine. Everything else about a library workout is derived on read.
   *
   * It lives HERE, on the session, and not on the DaySlot: `purpose` and
   * `durationMins` are properties of a session, a day holds up to
   * MAX_SESSIONS_PER_DAY of them, and a day-level pin could not say which one
   * it pinned. `service.ts:818` already refuses day-addressed session moves for
   * exactly that reason. Living on the session also means it dies with the
   * session — the red-readiness swap rebuilds the day's workouts and takes the
   * pin with them, the same way it clears `exercises`.
   */
  pin?: WorkoutPin;
}

export interface DaySlot {
  date: string; // YYYY-MM-DD
  /** Resolved availability for this date. Empty = unavailable. */
  availableBlocks: AvailabilityBlock[];
  /** Up to MAX_SESSIONS_PER_DAY sessions. Empty = rest. */
  workouts: ScheduledWorkout[];
  /**
   * Derived sum, kept only so existing displays and the race forecast keep
   * working. Placement logic must never read it — a day of 45m + 60m is
   * two opportunities, not one 105-minute one.
   */
  availableMins: number;
  status: DayStatus;
  /** Set when a workout was moved here from another day (its original date). */
  movedFrom?: string;
  activityId?: string;
  actualLoad?: number;
  /** Load from work the plan did not ask for. Never triggers a replan. */
  unplannedLoad?: number;
  /** Set on race-day slots (status "race"): the race's display name. */
  raceName?: string;
  /**
   * Set ONLY where the engine deliberately leaves a day empty, as opposed to
   * a day that merely ended up with nothing on it. The fill rung
   * (`fill.ts`) refuses to place a session on a day carrying this.
   *
   * `status: "rest"` cannot serve this purpose: `materializeWeek` starts all
   * seven days at "rest" before placing anything, and both `replanWeek` and
   * `moveOrDropWorkout` set it when a day's last session leaves. Those days
   * are legitimately fillable — a day emptied by the drop rung is precisely
   * where returning time should go.
   *
   * Written as a single-member union so a future producer has to extend it
   * deliberately. Low readiness is deliberately NOT one: `adaptDay` never
   * empties a day for a red band — it substitutes a recovery session, or
   * moves the session, or drops it when there is no room.
   *
   * Optional so every stored week deserializes unchanged.
   */
  restIntent?: "pre_race";
  /**
   * The session as it stood BEFORE any readiness adaptation today, with the
   * band and date that adaptation was computed for.
   *
   * The readiness adaptation is a function of the ORIGINAL session and
   * today's band. Without this it was a function of its own previous
   * output: `onWellnessDataChanged` re-runs the adaptation on every
   * wellness event (five call sites, one of them an hourly Apple Health
   * push), and each run multiplied the ALREADY-scaled duration again. A
   * real athlete's 137-minute long ride reached 60 minutes in five runs and
   * 8 minutes in twelve.
   *
   * Absent on days that have never been readiness-adapted, so existing
   * stored weeks deserialize unchanged.
   */
  readinessBase?: {
    date: string;
    band: Band;
    workouts: ScheduledWorkout[];
  };
}

/** The day's total available minutes, from its blocks. */
export function dayMins(d: Pick<DaySlot, "availableBlocks">): number {
  return d.availableBlocks.reduce((s, b) => s + blockMins(b), 0);
}

/**
 * Whether the SPECIFIC block at this index can hold a session this long.
 * Never "does some block on this day work?" — a session judged against a
 * roomier sibling block it doesn't actually occupy is exactly the defect
 * this replaces: a day's biggest block excusing every session on it.
 */
export function blockFits(
  d: Pick<DaySlot, "availableBlocks">,
  blockIdx: number,
  mins: number
): boolean {
  const block = d.availableBlocks[blockIdx];
  return block != null && blockMins(block) >= mins;
}

export interface WeekState {
  weekStart: string; // Monday, YYYY-MM-DD
  skeletonWeek: number;
  days: DaySlot[]; // always exactly 7, Monday first
}

export type AdjustmentTrigger =
  | "low_readiness"
  | "no_time"
  | "missed_workout"
  | "availability_change"
  | "weekly_rollover"
  | "race";

export type AdjustmentAction =
  "scaled" | "moved" | "swapped" | "dropped" | "redistributed" | "added";

export interface AdjustmentRecord {
  date: string; // the day the adjustment applies to
  trigger: AdjustmentTrigger;
  action: AdjustmentAction;
  before: DaySlot[];
  after: DaySlot[];
  reason: string; // deterministic, human-readable
  /** Stable code for machines; optional for legacy rows. */
  reasonCode?: string;
  /** Structured context so coach text and logs can share one payload shape. */
  context?: Record<string, string | number | boolean | null>;
}

export type { Band };

/** Quality sessions never sit on consecutive days and get readiness care. */
export const QUALITY_TYPES = ["Intervals", "Tempo", "Brick"] as const;
export function isQuality(w: PlannedWorkout | null | undefined): boolean {
  return w != null && (QUALITY_TYPES as readonly string[]).includes(w.type);
}

// ── materializeWeek constants ───────────────────────────────────────────
/**
 * Week-over-week load may move at most this fraction vs previous actual.
 * Previously justified as the acute:chronic workload ratio's week-over-week
 * brake and rated High — that anchor does not hold (see HEADROOM's comment
 * in athlete-level.ts for the full correction; the same ACWR critique
 * applies here, and this was never an ACWR calculation either).
 * Source: Empirical brake on week-over-week change, calibrated against one
 * athlete — not a validated injury threshold.
 * Confidence: Low (downgraded from High — see
 * docs/specs/2026-07-28-training-volume-evidence.md §1, corrected
 * 2026-08-06).
 */
export const RAMP_CLAMP_PCT = 0.2;
/**
 * Below this adherence, next week builds on actual load, not the skeleton.
 * Source: Invented — a design threshold for "meaningfully off-plan," not
 * evidence-based.
 * Confidence: Low.
 */
export const LOW_ADHERENCE_PCT = 70;
/**
 * Multiplier on previous actual load when adherence was low.
 * Source: Invented.
 * Confidence: Low.
 */
export const LOW_ADHERENCE_BUMP = 1.1;
/**
 * ≥ this many amber-or-worse days in the last 7 = suppressed trend.
 * Source: Invented — a majority-of-week heuristic (4 of 7 days), not
 * evidence-based.
 * Confidence: Low.
 */
export const SUPPRESSED_READINESS_DAYS = 4;
/**
 * Target reduction when the readiness trend is suppressed.
 * Source: Invented.
 * Confidence: Low.
 */
export const SUPPRESSED_REDUCTION = 0.85;
/**
 * A fully missed week (actual 0) restarts at this fraction of skeleton.
 * Exists to avoid a degenerate case: the ±20% ramp clamp (RAMP_CLAMP_PCT)
 * divides by the previous week's actual load, which is undefined at zero
 * (see docs/plans/2026-07-17-v0.9.2-adaptive-week.md's spec-deviation
 * note). 0.6 matches MAINTENANCE_FLOOR's value (athlete-level.ts) for
 * consistency, not because the same research backs both.
 * Source: Invented (design workaround for a zero-load edge case).
 * Confidence: Low.
 */
export const MISSED_WEEK_RESTART = 0.6;
/**
 * How far generateWorkouts' own duration caps (long session 240min/180min
 * for runs, filler sessions 90min/60min for runs — see training-plan.ts) may
 * fall short of the week's target before materializeWeek must say so. Raising
 * those caps to close the gap is explicitly out of scope: it would change
 * every existing user's prescribed workouts as a side effect of a legibility
 * branch, and the generator rewrite is separately scoped Phase 2 work. This
 * threshold exists so the deficit is at least explained, not silent.
 * Source: Invented — a reporting threshold, not a claim about the athlete.
 * Confidence: Low.
 */
export const GENERATOR_CAP_SHORTFALL_PCT = 0.1;

// ── adaptDay constants ──────────────────────────────────────────────────
/**
 * Redistribution may add at most this fraction to a day's load.
 * Source: Invented.
 * Confidence: Low.
 */
export const DAY_REDISTRIBUTE_CAP_PCT = 0.25;
/**
 * Red readiness: endurance duration multiplier.
 * Source: Invented.
 * Confidence: Low.
 */
export const RED_ENDURANCE_SCALE = 0.7;
/**
 * Amber readiness: duration multiplier (with one intensity step down).
 * Source: Invented.
 * Confidence: Low.
 */
export const AMBER_SCALE = 0.85;
/**
 * Red readiness replacement session duration (mins); less room = rest.
 * Source: Invented — a round, convenient number, not evidence-based.
 * Confidence: Low.
 */
export const RED_RECOVERY_MINS = 30;
/** One intensity step down. Endurance stays endurance (duration handles it). */
export const STEP_DOWN: Record<string, string> = {
  Intervals: "Tempo",
  Tempo: "Endurance",
  Brick: "Endurance",
};

/**
 * What the athlete actually did on a date, summed across its activities.
 *
 * Lives here rather than in `actuals.ts` to keep the shape next to `DaySlot`,
 * which it describes the realised half of, and so the component layer imports
 * it from the same module it already takes `DaySlot` from.
 */
export interface DayActuals {
  count: number;
  secs: number;
  load: number;
  /**
   * That day's most recent activity. A day can hold several; nothing
   * downstream reads more than one, and this is the one the rest/race
   * branch already stored before v0.44.
   */
  activityId: string;
}
