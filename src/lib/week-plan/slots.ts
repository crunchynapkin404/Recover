// Placement primitives. A slot is one opportunity to train — a single
// block on a single day — which is why nothing here reads a daily sum.
import {
  blockMins,
  ENERGY_CEILING,
  MAX_SESSIONS_PER_DAY,
  PURPOSE_FLOORS,
  SUBSTITUTE_TO,
  type Energy,
  type Purpose,
} from "@/lib/availability/types";
import { withPurpose, type PlannedWorkout } from "@/lib/training-plan";
import { isQuality, type DaySlot } from "./types";

export interface Slot {
  dayIdx: number;
  blockIdx: number;
  mins: number;
  energy: Energy;
  sports: string[] | null;
}

export function slotKey(s: Slot): string {
  return `${s.dayIdx}:${s.blockIdx}`;
}

/** Every opportunity in the week, roomiest first; ties are deterministic. */
export function buildSlots(days: DaySlot[]): Slot[] {
  const slots: Slot[] = [];
  days.forEach((d, dayIdx) => {
    d.availableBlocks.forEach((b, blockIdx) => {
      slots.push({
        dayIdx,
        blockIdx,
        mins: blockMins(b),
        energy: b.energy,
        sports: b.sports,
      });
    });
  });
  return slots.sort(
    (a, b) => b.mins - a.mins || a.dayIdx - b.dayIdx || a.blockIdx - b.blockIdx
  );
}

/** Whether this session may occupy this slot, given the week around it. */
export function admits(
  slot: Slot,
  w: PlannedWorkout,
  days: DaySlot[],
  taken: Set<string>
): boolean {
  if (taken.has(slotKey(slot))) return false;
  if (slot.mins < w.durationMins) return false;
  if (slot.sports !== null && !slot.sports.includes(w.sport)) return false;
  if (!ENERGY_CEILING[slot.energy].includes(w.purpose)) return false;

  const day = days[slot.dayIdx];
  if (day.workouts.length >= MAX_SESSIONS_PER_DAY) return false;

  // Two strength sessions never share a day. Deliberately separate from
  // the QUALITY_TYPES adjacency rule below: strength stays OUT of
  // QUALITY_TYPES (Task 3) so it inherits no adjacent-day spacing, but the
  // spec's 2x/week cadence means two DIFFERENT days, never both lifts
  // back-to-back on one day just because MAX_SESSIONS_PER_DAY allows two
  // sessions total.
  if (
    w.sport === "Strength" &&
    day.workouts.some((x) => x.sport === "Strength")
  ) {
    return false;
  }

  if (isQuality(w)) {
    // Never two quality sessions on one day, nor on adjacent days.
    if (day.workouts.some((x) => isQuality(x))) return false;
    const neighbours = [days[slot.dayIdx - 1], days[slot.dayIdx + 1]];
    if (neighbours.some((n) => n?.workouts.some((x) => isQuality(x))))
      return false;
  }
  return true;
}

/**
 * The block on `dayIdx` that should hold this session, or null when none
 * admits it. Deterministic: candidates are tried roomiest-first, then by
 * block index, exactly as buildSlots orders them.
 */
export function findBlockFor(
  days: DaySlot[],
  dayIdx: number,
  w: PlannedWorkout,
  taken: Set<string>
): number | null {
  const slot = buildSlots(days)
    .filter((s) => s.dayIdx === dayIdx)
    .find((s) => admits(s, w, days, taken));
  return slot ? slot.blockIdx : null;
}

/** The display label a substituted purpose is shown under. */
export const TYPE_BY_PURPOSE: Record<
  Purpose,
  { type: string; intensity: string }
> = {
  recovery: { type: "Recovery", intensity: "Recovery" },
  aerobic_base: { type: "Endurance", intensity: "Z1-Z2" },
  long: { type: "Long", intensity: "Z1-Z2" },
  threshold: { type: "Tempo", intensity: "Z3" },
  vo2max: { type: "Intervals", intensity: "Z4-Z5" },
  brick: { type: "Brick", intensity: "Z3" },
  /**
   * Required by the exhaustive Record, never selected at runtime: fill.ts
   * refuses every purpose except aerobic_base/long, and fitToBlock's
   * substitution path reads the SUBSTITUTE target's entry (strength
   * substitutes to recovery), never strength's own. A synthesized strength
   * session would have no prescription, which is why nothing may synthesize
   * one.
   */
  strength: { type: "Strength", intensity: "" },
};

/**
 * Fit a session into `roomMins`: keep it whole, shorten it within its own
 * purpose, or replace it with the nearest lesser stimulus that still works
 * at that length. Null when nothing does — not even a recovery spin.
 *
 * A session is never returned below its own floor, which is the rule that
 * replaces the old truncate-to-fit behaviour.
 */
export function fitToBlock(
  w: PlannedWorkout,
  roomMins: number
): {
  workout: PlannedWorkout;
  how: "whole" | "compressed" | "substituted";
} | null {
  if (roomMins <= 0) return null;
  if (roomMins >= w.durationMins) return { workout: w, how: "whole" };
  if (roomMins >= PURPOSE_FLOORS[w.purpose]) {
    return { workout: { ...w, durationMins: roomMins }, how: "compressed" };
  }

  let purpose: Purpose | undefined = SUBSTITUTE_TO[w.purpose];
  while (purpose && PURPOSE_FLOORS[purpose] > roomMins) {
    purpose = SUBSTITUTE_TO[purpose];
  }
  if (!purpose) return null;

  const label = TYPE_BY_PURPOSE[purpose];
  return {
    workout: withPurpose({
      day: w.day,
      sport: w.sport,
      type: label.type,
      durationMins: roomMins,
      intensity: label.intensity,
      description: `${label.type} — replaces ${w.type}, which needs ${PURPOSE_FLOORS[w.purpose]}min to be worth doing`,
    }),
    how: "substituted",
  };
}
