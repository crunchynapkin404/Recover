import { describe, expect, it } from "vitest";
import { fillCeilingMins, fillSport, fillWeek, plannedMins } from "./fill";
import type { DaySlot, ScheduledWorkout } from "./types";
import type { AvailabilityBlock } from "@/lib/availability/types";
import {
  EASY_RUN_CAP_MINS,
  longRideBoundMins,
  NO_DEMAND_LONG_BOUND_MINS,
} from "@/lib/training-plan";

describe("fillCeilingMins", () => {
  // queenStageHours of 5, not 4: longRideBoundMins(4) collides with
  // NO_DEMAND_LONG_BOUND_MINS (both 240), so at 4 hours these assertions
  // could not tell a branch that genuinely calls longRideBoundMins apart
  // from one that ignores the argument and hardcodes 240. At 5 hours the
  // derived bound (300) is distinct from the fallback.
  it("bounds a bike session by the event's queen stage", () => {
    expect(fillCeilingMins("long", "Bike", 5)).toBe(300);
    expect(fillCeilingMins("aerobic_base", "Bike", 5)).toBe(300);
  });

  it("derives a queen-stage bound distinct from the no-demand fallback", () => {
    expect(fillCeilingMins("long", "Bike", 5)).not.toBe(
      fillCeilingMins("long", "Bike", null)
    );
  });

  it("falls back to the no-demand bound when there is no event", () => {
    expect(fillCeilingMins("long", "Bike", null)).toBe(
      NO_DEMAND_LONG_BOUND_MINS
    );
  });

  it("bounds an easy run by the named easy-run cap", () => {
    expect(fillCeilingMins("aerobic_base", "Run", 4)).toBe(EASY_RUN_CAP_MINS);
  });

  it("refuses a long run — that rule is athlete-relative and does not exist yet", () => {
    expect(fillCeilingMins("long", "Run", 4)).toBeNull();
  });

  it("refuses every swim, having no bound it can defend", () => {
    expect(fillCeilingMins("aerobic_base", "Swim", 4)).toBeNull();
    expect(fillCeilingMins("long", "Swim", 4)).toBeNull();
  });

  it("refuses every purpose that is not endurance", () => {
    for (const p of ["vo2max", "threshold", "brick", "recovery"] as const) {
      expect(fillCeilingMins(p, "Bike", 4)).toBeNull();
    }
  });
});

const blk = (mins: number): AvailabilityBlock => ({
  start: null,
  end: null,
  mins,
  energy: "full",
  sports: null,
});

const w = (o: Partial<ScheduledWorkout> = {}): ScheduledWorkout => ({
  day: 0,
  sport: "Bike",
  type: "Endurance",
  durationMins: 60,
  intensity: "Z1-Z2",
  description: "Aerobic endurance ride",
  purpose: "aerobic_base",
  minEffectiveMins: 40,
  blockIdx: 0,
  ...o,
});

/** Seven days from Mon 2026-08-03, each with the given blocks and sessions. */
function days(
  spec: {
    mins?: number[];
    workouts?: ScheduledWorkout[];
    status?: DaySlot["status"];
  }[]
): DaySlot[] {
  return spec.map((s, i) => {
    const availableBlocks = (s.mins ?? []).map(blk);
    return {
      date: `2026-08-${String(3 + i).padStart(2, "0")}`,
      availableBlocks,
      workouts: s.workouts ?? [],
      availableMins: availableBlocks.reduce((a, b) => a + b.mins, 0),
      status: s.status ?? ((s.workouts?.length ?? 0) > 0 ? "planned" : "rest"),
    };
  });
}

describe("plannedMins", () => {
  it("sums every session in the week, including locked days", () => {
    const d = days([
      { workouts: [w({ durationMins: 60 })], status: "completed" },
      { workouts: [w({ durationMins: 90 })] },
      {},
      {
        workouts: [
          w({ durationMins: 45 }),
          w({ durationMins: 30, blockIdx: 1 }),
        ],
      },
    ]);

    expect(plannedMins(d)).toBe(225);
  });

  it("is zero for an empty week", () => {
    expect(plannedMins(days([{}, {}, {}]))).toBe(0);
  });
});

describe("fillSport", () => {
  it("picks the sport holding the most endurance minutes", () => {
    const d = days([
      { workouts: [w({ sport: "Run", durationMins: 60 })] },
      { workouts: [w({ sport: "Bike", durationMins: 120 })] },
    ]);

    expect(fillSport(d, 4)).toBe("Bike");
  });

  it("ignores sports it cannot bound", () => {
    const d = days([
      { workouts: [w({ sport: "Swim", durationMins: 300 })] },
      { workouts: [w({ sport: "Run", durationMins: 40 })] },
    ]);

    expect(fillSport(d, 4)).toBe("Run");
  });

  it("ignores intensity when counting", () => {
    const d = days([
      {
        workouts: [
          w({
            sport: "Run",
            durationMins: 45,
            type: "Intervals",
            purpose: "vo2max",
          }),
        ],
      },
      { workouts: [w({ sport: "Bike", durationMins: 30 })] },
    ]);

    expect(fillSport(d, 4)).toBe("Bike");
  });

  it("returns null when the week offers no evidence at all", () => {
    expect(fillSport(days([{}, {}]), 4)).toBeNull();
    expect(
      fillSport(days([{ workouts: [w({ sport: "Swim" })] }]), 4)
    ).toBeNull();
  });

  // Pins that exclusion is per-workout-purpose, not per-sport: a sport can
  // hold more raw minutes and still lose, because fillCeilingMins is asked
  // about each workout's own purpose. Run here totals 150 minutes across two
  // "long" sessions — a long run has no bound yet (athlete-relative, does
  // not exist in this codebase) — against Bike's single 30-minute
  // "aerobic_base" ride, which IS bounded. If fillSport asked about a fixed
  // canary purpose (or the sport in general) instead of x.purpose, Run's 150
  // minutes would win; Bike must win instead.
  it("excludes a sport's minutes by each session's own purpose, not the sport as a whole", () => {
    const d = days([
      {
        workouts: [
          w({ sport: "Run", type: "Long", purpose: "long", durationMins: 90 }),
        ],
      },
      {
        workouts: [
          w({ sport: "Run", type: "Long", purpose: "long", durationMins: 60 }),
        ],
      },
      { workouts: [w({ sport: "Bike", durationMins: 30 })] },
    ]);

    expect(fillSport(d, 4)).toBe("Bike");
  });
});

describe("fillWeek — 1a grow in place", () => {
  it("grows an endurance session into the room its own block gained", () => {
    // 60min session in a block that now holds 120. Target 300min, planned 60.
    const d = days([{ mins: [120], workouts: [w({ durationMins: 60 })] }]);

    const r = fillWeek(d, {
      targetMins: 300,
      queenStageHours: 4,
      today: "2026-08-03",
    });

    expect(r.days[0].workouts[0].durationMins).toBe(120);
    expect(r.adjustments).toHaveLength(1);
    expect(r.adjustments[0].action).toBe("added");
  });

  it("never grows past the session's ceiling", () => {
    // queenStageHours 2 → longRideBoundMins clamps to MIN_LONG_BOUND_MINS 120.
    const d = days([{ mins: [600], workouts: [w({ durationMins: 60 })] }]);

    const r = fillWeek(d, {
      targetMins: 600,
      queenStageHours: 2,
      today: "2026-08-03",
    });

    expect(r.days[0].workouts[0].durationMins).toBe(longRideBoundMins(2));
  });

  it("never grows past the target", () => {
    // Planned 60, target 90 — 30 minutes of room, not the block's full 120.
    const d = days([{ mins: [120], workouts: [w({ durationMins: 60 })] }]);

    const r = fillWeek(d, {
      targetMins: 90,
      queenStageHours: 4,
      today: "2026-08-03",
    });

    expect(r.days[0].workouts[0].durationMins).toBe(90);
  });

  it("never grows intensity", () => {
    const d = days([
      {
        mins: [180],
        workouts: [
          w({ durationMins: 60, type: "Intervals", purpose: "vo2max" }),
        ],
      },
    ]);

    const r = fillWeek(d, {
      targetMins: 600,
      queenStageHours: 4,
      today: "2026-08-03",
    });

    expect(r.days[0].workouts[0].durationMins).toBe(60);
    expect(r.adjustments).toEqual([]);
  });

  it("never grows a session on a locked day", () => {
    for (const status of ["completed", "missed", "race"] as const) {
      const d = days([
        { mins: [180], workouts: [w({ durationMins: 60 })], status },
      ]);

      const r = fillWeek(d, {
        targetMins: 600,
        queenStageHours: 4,
        today: "2026-08-03",
      });

      expect(r.days[0].workouts[0].durationMins).toBe(60);
    }
  });

  it("does nothing when the week already meets its target", () => {
    const d = days([{ mins: [180], workouts: [w({ durationMins: 60 })] }]);

    const r = fillWeek(d, {
      targetMins: 60,
      queenStageHours: 4,
      today: "2026-08-03",
    });

    expect(r.days).toEqual(d);
    expect(r.adjustments).toEqual([]);
  });

  it("is idempotent — a second identical pass changes nothing", () => {
    const d = days([{ mins: [120], workouts: [w({ durationMins: 60 })] }]);
    const opts = { targetMins: 300, queenStageHours: 4, today: "2026-08-03" };

    const once = fillWeek(d, opts);
    const twice = fillWeek(once.days, opts);

    expect(twice.days).toEqual(once.days);
    expect(twice.adjustments).toEqual([]);
  });
});
