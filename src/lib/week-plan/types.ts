import type { PlannedWorkout } from "@/lib/training-plan";
import type { Band } from "@/lib/readiness";
import type { AvailabilityBlock } from "@/lib/availability/types";
import { blockMins } from "@/lib/availability/types";

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
  "scaled" | "moved" | "swapped" | "dropped" | "redistributed";

export interface AdjustmentRecord {
  date: string; // the day the adjustment applies to
  trigger: AdjustmentTrigger;
  action: AdjustmentAction;
  before: DaySlot[];
  after: DaySlot[];
  reason: string; // deterministic, human-readable
}

export type { Band };

/** Quality sessions never sit on consecutive days and get readiness care. */
export const QUALITY_TYPES = ["Intervals", "Tempo", "Brick"] as const;
export function isQuality(w: PlannedWorkout | null | undefined): boolean {
  return w != null && (QUALITY_TYPES as readonly string[]).includes(w.type);
}

// ── materializeWeek constants ───────────────────────────────────────────
/** Week-over-week load may move at most this fraction vs previous actual. */
export const RAMP_CLAMP_PCT = 0.2;
/** Below this adherence, next week builds on actual load, not the skeleton. */
export const LOW_ADHERENCE_PCT = 70;
/** Multiplier on previous actual load when adherence was low. */
export const LOW_ADHERENCE_BUMP = 1.1;
/** ≥ this many amber-or-worse days in the last 7 = suppressed trend. */
export const SUPPRESSED_READINESS_DAYS = 4;
/** Target reduction when the readiness trend is suppressed. */
export const SUPPRESSED_REDUCTION = 0.85;
/** A fully missed week (actual 0) restarts at this fraction of skeleton. */
export const MISSED_WEEK_RESTART = 0.6;
/**
 * How far generateWorkouts' own duration caps (long session 240min/180min
 * for runs, filler sessions 90min/60min for runs — see training-plan.ts) may
 * fall short of the week's target before materializeWeek must say so. Raising
 * those caps to close the gap is explicitly out of scope: it would change
 * every existing user's prescribed workouts as a side effect of a legibility
 * branch, and the generator rewrite is separately scoped Phase 2 work. This
 * threshold exists so the deficit is at least explained, not silent.
 */
export const GENERATOR_CAP_SHORTFALL_PCT = 0.1;

// ── adaptDay constants ──────────────────────────────────────────────────
/** Redistribution may add at most this fraction to a day's load. */
export const DAY_REDISTRIBUTE_CAP_PCT = 0.25;
/** Red readiness: endurance duration multiplier. */
export const RED_ENDURANCE_SCALE = 0.7;
/** Amber readiness: duration multiplier (with one intensity step down). */
export const AMBER_SCALE = 0.85;
/** Red readiness replacement session duration (mins); less room = rest. */
export const RED_RECOVERY_MINS = 30;
/** One intensity step down. Endurance stays endurance (duration handles it). */
export const STEP_DOWN: Record<string, string> = {
  Intervals: "Tempo",
  Tempo: "Endurance",
  Brick: "Endurance",
};
