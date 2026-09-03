// src/lib/week-plan/immunity.test.ts
//
// The spec's engine contract in one sentence: the engine READS athlete-placed
// sessions and never WRITES them. These are the guards for "never writes".
// Fixtures copy adapt-day.test.ts's D/week helpers deliberately — a fixture
// that cannot distinguish two rules tests neither.
import { describe, expect, it } from "vitest";
import { adaptDay } from "./adapt-day";
import { replanWeek } from "./replan";
import { fillWeek } from "./fill";
import { dayMins } from "./types";
import type { DaySlot, ScheduledWorkout, WeekState } from "./types";
import { withPurpose } from "@/lib/training-plan";
import { athletePlacement, blockPlacement, isAthleteChosen } from "./placement";
import type { AvailabilityBlock } from "@/lib/availability/types";

function blocksFor(mins: number): DaySlot["availableBlocks"] {
  return mins > 0
    ? [{ start: null, end: null, mins, energy: "full", sports: null }]
    : [];
}

const CHOICE = { workoutId: "vo2-5x5", chosenAt: "2026-09-03T07:00:00.000Z" };

const D = (
  date: string,
  mins: number,
  workouts: Partial<ScheduledWorkout>[],
  status: DaySlot["status"] = workouts.length ? "planned" : "rest"
): DaySlot => {
  const availableBlocks = blocksFor(mins);
  return {
    date,
    availableBlocks,
    availableMins: dayMins({ availableBlocks }),
    workouts: workouts.map((w) =>
      withPurpose({
        day: 0,
        sport: "Bike",
        type: "Endurance",
        durationMins: 45,
        intensity: "Z1-Z2",
        description: "Easy ride",
        placement: blockPlacement(0),
        ...w,
      })
    ),
    status,
  };
};

const week = (days: DaySlot[]): WeekState => ({
  weekStart: days[0].date,
  skeletonWeek: 5,
  days,
});

/** An athlete's own pick: quality, and occupying no availability block. */
const chosen = (durationMins = 75): Partial<ScheduledWorkout> => ({
  type: "Intervals",
  intensity: "Z4-Z5",
  durationMins,
  placement: athletePlacement(CHOICE),
});

/** No resolved availability anywhere — the week the drop rung would empty. */
const noAvailability = (): Map<string, AvailabilityBlock[]> => new Map();

describe("the fill rung never grows an athlete-chosen session", () => {
  it("leaves it at the length the athlete set, even under a week target", () => {
    // No explicit isAthleteChosen guard is needed in fill's growth loop: the
    // session occupies no block, so `if (!block) continue` already skips it.
    // This test pins that BEHAVIOUR so the protection survives any future
    // refactor of how the growth loop resolves its block — a redundant guard
    // would be dead code, but the behaviour it protects is load-bearing.
    const d = [
      {
        date: "2026-08-03",
        availableBlocks: [
          {
            start: null,
            end: null,
            mins: 240,
            energy: "full" as const,
            sports: null,
          },
        ],
        availableMins: 240,
        workouts: [
          // Endurance deliberately: fillCeilingMins returns null for
          // vo2max, so a quality pick would be skipped by the ceiling check
          // before ever reaching the block check this test is about.
          withPurpose({
            day: 0,
            sport: "Bike",
            type: "Endurance",
            durationMins: 75,
            intensity: "Z1-Z2",
            description: "",
            placement: athletePlacement({
              workoutId: "end-2h",
              chosenAt: "2026-09-03T07:00:00.000Z",
            }),
          }),
        ],
        status: "planned" as const,
      },
    ];
    const out = fillWeek(d, {
      targetMins: 600,
      queenStageHours: null,
      today: "2026-08-03",
    });
    expect(out.days[0].workouts[0].durationMins).toBe(75);
  });
});

describe("athlete-chosen sessions are immune to every mutating rung", () => {
  it("keeps its duration when redistribution would have starved it to zero", () => {
    // THE DEFECT THIS GUARDS: a session with no block resolves to
    // blockCapacity 0, and Math.min(cap, Math.min(0, …)) sets durationMins
    // to 0 — the athlete's ride silently erased by the evening.
    const w = week([
      D("2026-07-20", 60, [{ type: "Endurance", durationMins: 60 }]),
      D("2026-07-21", 0, [chosen(75)]),
      D("2026-07-22", 90, [{ durationMins: 60 }]),
    ]);
    const r = adaptDay({
      week: w,
      today: "2026-07-21",
      band: "green",
      yesterdayCompleted: false,
    });
    const survivor = r.week.days[1].workouts.find(isAthleteChosen);
    expect(survivor).toBeDefined();
    expect(survivor!.durationMins).toBe(75);
  });

  it("is not dropped by a replan that can find no slot for it", () => {
    // It occupies no block by construction, so the displacement pre-pass
    // would resolve it to a null slot and hand it to the drop rung.
    const before = week([
      D("2026-07-20", 0, [chosen(75)]),
      D("2026-07-21", 0, []),
      D("2026-07-22", 0, []),
    ]);
    const r = replanWeek(before, noAvailability(), "2026-07-20", null);
    const all = r.week.days.flatMap((d) => d.workouts);
    expect(all.filter(isAthleteChosen)).toHaveLength(1);
    expect(all.find(isAthleteChosen)!.durationMins).toBe(75);
  });

  it("is not scaled down by a red readiness band", () => {
    // Recover states its disagreement (kept-note) and leaves it standing.
    const w = week([
      D("2026-07-20", 60, [{ durationMins: 60 }]),
      D("2026-07-21", 0, [chosen(75)]),
      D("2026-07-22", 60, [{ durationMins: 60 }]),
    ]);
    const r = adaptDay({
      week: w,
      today: "2026-07-21",
      band: "red",
      yesterdayCompleted: null,
    });
    const survivor = r.week.days[1].workouts.find(isAthleteChosen);
    expect(survivor).toBeDefined();
    expect(survivor!.durationMins).toBe(75);
    expect(survivor!.type).toBe("Intervals");
  });

  it("an engine-placed session on the SAME day is still adapted normally", () => {
    // Immunity is per session, never per day. A day-level lock would
    // silently cost the athlete the engine's own second session.
    const w = week([
      D("2026-07-20", 60, [{ durationMins: 60 }]),
      D("2026-07-21", 30, [chosen(75), { durationMins: 90 }]),
      D("2026-07-22", 60, [{ durationMins: 60 }]),
    ]);
    const r = adaptDay({
      week: w,
      today: "2026-07-21",
      band: "green",
      yesterdayCompleted: null,
    });
    const day = r.week.days[1];
    const engineSession = day.workouts.find((x) => !isAthleteChosen(x));
    expect(engineSession).toBeDefined();
    // Its own 30-minute block cannot hold 90 minutes; the engine may shrink,
    // move or drop it — what it may NOT do is leave it untouched at 90.
    const stillFull =
      engineSession != null && engineSession.durationMins === 90;
    expect(stillFull).toBe(false);
    expect(day.workouts.find(isAthleteChosen)!.durationMins).toBe(75);
  });
});
