/**
 * Reproduction for the live defect: runDailyAdaptation is not idempotent on
 * an amber day. adapt-day.ts gates the readiness block on
 * `tWorkout && (band === "red" || band === "amber")` only — it sets
 * `status = "adapted"` but never reads it back — so every run re-applies
 * AMBER_SCALE to the ALREADY-scaled duration.
 *
 * Live evidence (athlete's own week, 2026-07-28): five identical
 * "readiness amber — one step down, duration ×0.85" adjustments on one day,
 * and 0.85^5 x 137min = 60.8min, which is the "Long · 60 min" on screen.
 * The prior week reached "Long 8m".
 */
import { describe, expect, it } from "vitest";
import { adaptDay } from "@/lib/week-plan/adapt-day";
import { AMBER_SCALE, dayMins } from "@/lib/week-plan/types";
import type {
  DaySlot,
  ScheduledWorkout,
  WeekState,
} from "@/lib/week-plan/types";
import { withPurpose } from "@/lib/training-plan";

function blocksFor(mins: number): DaySlot["availableBlocks"] {
  return mins > 0
    ? [{ start: null, end: null, mins, energy: "full", sports: null }]
    : [];
}

const D = (
  date: string,
  mins: number,
  workout: Partial<ScheduledWorkout> | null,
  status: DaySlot["status"] = workout ? "planned" : "rest"
): DaySlot => {
  const availableBlocks = blocksFor(mins);
  return {
    date,
    availableBlocks,
    availableMins: dayMins({ availableBlocks }),
    workouts: workout
      ? [
          withPurpose({
            day: 0,
            sport: "Bike",
            type: "Endurance",
            durationMins: 137,
            intensity: "Z1-Z2",
            description: "Long ride",
            blockIdx: 0,
            ...workout,
          }),
        ]
      : [],
    status,
  };
};

const week = (days: DaySlot[]): WeekState => ({
  weekStart: days[0].date,
  skeletonWeek: 4,
  days,
});

function build(): WeekState {
  return week([
    D("2026-07-27", 300, { type: "Long", durationMins: 137 }),
    D("2026-07-28", 300, null),
    D("2026-07-29", 300, null),
    D("2026-07-30", 300, null),
    D("2026-07-31", 300, null),
    D("2026-08-01", 300, null),
    D("2026-08-02", 300, null),
  ]);
}

const durationOf = (w: WeekState) => w.days[0].workouts[0]?.durationMins ?? 0;

describe("adaptDay amber idempotency", () => {
  it("does not shrink an already-adapted session on a second run", () => {
    let w = build();
    expect(durationOf(w)).toBe(137);

    const first = adaptDay({
      week: w,
      today: "2026-07-27",
      band: "amber",
      yesterdayCompleted: null,
    });
    w = first.week;
    const afterOne = durationOf(w);

    // Same day, same amber band, adaptation simply runs again.
    const second = adaptDay({
      week: w,
      today: "2026-07-27",
      band: "amber",
      yesterdayCompleted: null,
    });
    const afterTwo = durationOf(second.week);

    console.log(
      `137 -> ${afterOne} -> ${afterTwo}  (second run adjustments: ${second.adjustments.length})`
    );

    expect(afterTwo).toBe(afterOne);
    expect(second.adjustments).toHaveLength(0);
  });

  it("reproduces the athlete's 137 -> 60 over five runs", () => {
    let w = build();
    for (let i = 0; i < 5; i++) {
      w = adaptDay({
        week: w,
        today: "2026-07-27",
        band: "amber",
        yesterdayCompleted: null,
      }).week;
    }
    console.log(`after 5 amber runs: ${durationOf(w)}min (screen showed 60)`);
    // NOTE: this originally asserted `toBe(137)` — i.e. that five identical
    // amber runs leave the session completely untouched. That can't be the
    // fix: amber is meant to have a real, lasting effect (it's not a no-op),
    // it just must not COMPOUND. The correct invariant, matching this file's
    // own first test (afterTwo === afterOne, not the pristine original) and
    // adapt-day.test.ts's "applies amber once, however many times it runs",
    // is that five identical runs land exactly where ONE run does —
    // AMBER_SCALE applied once, then stable — never back at the untouched
    // 137, and never compounded down toward the 60 the bug produced.
    expect(durationOf(w)).toBe(Math.round(137 * AMBER_SCALE));
  });
});
