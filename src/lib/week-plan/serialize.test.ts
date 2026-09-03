import { describe, it, expect } from "vitest";
import { normalizeDays, serializeDays } from "./serialize";
import type { DaySlot } from "./types";
import { athletePlacement } from "./placement";

/** A day exactly as v0.135.0 and earlier wrote it into week_plans.days. */
const legacyRow = [
  {
    date: "2026-09-07",
    availableBlocks: [],
    workouts: [
      {
        day: 0,
        sport: "Cycling",
        type: "Endurance",
        durationMins: 60,
        intensity: "Z1-Z2",
        description: "",
        purpose: "aerobic_base",
        minEffectiveMins: 30,
        blockIdx: 1,
      },
    ],
    availableMins: 0,
    status: "planned",
  },
];

describe("normalizeDays", () => {
  it("lifts a legacy blockIdx onto a placement", () => {
    const days = normalizeDays(legacyRow);
    expect(days[0].workouts[0].placement).toEqual({
      kind: "block",
      blockIdx: 1,
    });
  });

  it("drops the legacy top-level field once lifted", () => {
    const days = normalizeDays(legacyRow) as unknown as {
      workouts: Record<string, unknown>[];
    }[];
    expect(days[0].workouts[0].blockIdx).toBeUndefined();
  });

  it("leaves a day with no workouts alone", () => {
    expect(
      normalizeDays([{ ...legacyRow[0], workouts: [] }])[0].workouts
    ).toEqual([]);
  });

  it("survives a day whose workouts key is missing entirely", () => {
    const { workouts: _omitted, ...noWorkouts } = legacyRow[0];
    expect(normalizeDays([noWorkouts])[0].workouts).toEqual([]);
  });
});

describe("serializeDays", () => {
  it("dual-writes a top-level blockIdx for a block placement", () => {
    // Rollback safety: v0.135.0 code reading this row still finds its index.
    const days = normalizeDays(legacyRow);
    const out = serializeDays(days) as {
      workouts: Record<string, unknown>[];
    }[];
    expect(out[0].workouts[0].blockIdx).toBe(1);
    expect(out[0].workouts[0].placement).toEqual({
      kind: "block",
      blockIdx: 1,
    });
  });

  it("writes no legacy blockIdx for an athlete placement", () => {
    // There is no honest index for a session that occupies no block, and
    // inventing one is the sentinel this design exists to refuse.
    const days = normalizeDays(legacyRow);
    days[0].workouts[0].placement = athletePlacement({
      workoutId: "thr-4x8",
      chosenAt: "2026-09-03T07:00:00.000Z",
    });
    const out = serializeDays(days) as {
      workouts: Record<string, unknown>[];
    }[];
    expect(out[0].workouts[0].blockIdx).toBeUndefined();
    expect(out[0].workouts[0].placement).toEqual({
      kind: "athlete",
      choice: { workoutId: "thr-4x8", chosenAt: "2026-09-03T07:00:00.000Z" },
    });
  });

  it("round-trips a mixed day", () => {
    const days: DaySlot[] = normalizeDays(legacyRow);
    days[0].workouts.push({
      ...days[0].workouts[0],
      placement: athletePlacement({
        workoutId: "vo2-5x5",
        chosenAt: "2026-09-03T07:00:00.000Z",
      }),
    });
    expect(normalizeDays(serializeDays(days))).toEqual(days);
  });
});
