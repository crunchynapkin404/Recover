import type { PlannedWorkout } from "@/lib/training-plan";
import type { Band } from "@/lib/readiness";

export type DayStatus =
  "planned" | "completed" | "adapted" | "moved" | "missed" | "rest";

export interface DaySlot {
  date: string; // YYYY-MM-DD
  availableMins: number; // 0 = rest day by availability
  workout: PlannedWorkout | null;
  status: DayStatus;
  /** Set when a workout was moved here from another day (its original date). */
  movedFrom?: string;
  activityId?: string;
  actualLoad?: number;
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
  | "weekly_rollover";

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
export function isQuality(w: PlannedWorkout | null): boolean {
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

// ── availability prefill constants ──────────────────────────────────────
/** A day with at least this many busy calendar minutes halves its prefill. */
export const BUSY_DAY_MINS = 480;
