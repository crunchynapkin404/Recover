import { describe, expect, it } from "vitest";
import {
  availableMins,
  fillCeilingMins,
  fillSport,
  fillWeek,
  plannedMins,
  resolveFillOptions,
} from "./fill";
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

describe("resolveFillOptions", () => {
  const base = {
    hasActivePlan: true,
    taperFraction: null as number | null,
    targetHours: 10,
    queenStageHours: 4 as number | null,
    today: "2026-08-03",
  };

  it("declines when there is no active plan", () => {
    expect(resolveFillOptions({ ...base, hasActivePlan: false })).toBeNull();
  });

  it("declines when there is no active plan, even with a taper fraction set too", () => {
    // Both reasons to decline present at once — the no-plan check must not
    // depend on taperFraction having already been read.
    expect(
      resolveFillOptions({ ...base, hasActivePlan: false, taperFraction: 0.45 })
    ).toBeNull();
  });

  it("declines a taper week", () => {
    expect(resolveFillOptions({ ...base, taperFraction: 0.65 })).toBeNull();
  });

  it("declines a race week", () => {
    expect(resolveFillOptions({ ...base, taperFraction: 0.45 })).toBeNull();
  });

  it("declines when taperFraction is zero — non-null, not falsy, is the test", () => {
    // 0 is a legitimate (if extreme) taper fraction. A `!input.taperFraction`
    // check would wrongly let a week with taperFraction 0 through; only
    // `!= null` may gate this.
    expect(resolveFillOptions({ ...base, taperFraction: 0 })).toBeNull();
  });

  it("returns FillOptions with an active plan and no taper", () => {
    const r = resolveFillOptions({ ...base, targetHours: 10 });
    expect(r).toEqual({
      targetMins: 600,
      queenStageHours: 4,
      today: "2026-08-03",
    });
  });

  it("converts targetHours to targetMins by rounding, not truncating or ceiling", () => {
    // 5.51h × 60 = 330.6min → rounds to 331; floor/truncate would give 330.
    expect(resolveFillOptions({ ...base, targetHours: 5.51 })?.targetMins).toBe(
      331
    );
    // 5.49h × 60 = 329.4min → rounds DOWN to 329; ceil would give 330.
    expect(resolveFillOptions({ ...base, targetHours: 5.49 })?.targetMins).toBe(
      329
    );
  });

  it("passes queenStageHours and today through unchanged, including null", () => {
    expect(
      resolveFillOptions({ ...base, queenStageHours: null })?.queenStageHours
    ).toBeNull();
    expect(resolveFillOptions({ ...base, today: "2026-12-25" })?.today).toBe(
      "2026-12-25"
    );
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

  it("excludes strength minutes from the endurance total", () => {
    // This total feeds fill's own target-hours accounting and
    // materialized_mins' load-per-minute rate — both endurance-only
    // concepts (strength carries no load, Task 6). A strength session's
    // minutes must never pad either.
    const d = days([
      {
        workouts: [
          w({ durationMins: 60 }),
          w({
            durationMins: 45,
            sport: "Strength",
            type: "Strength",
            purpose: "strength",
            minEffectiveMins: 20,
            blockIdx: 1,
          }),
        ],
      },
      { workouts: [w({ durationMins: 30 })] },
    ]);
    expect(plannedMins(d)).toBe(90);
  });

  it("is zero for a day holding only a strength session", () => {
    const d = days([
      {
        workouts: [
          w({
            durationMins: 45,
            sport: "Strength",
            type: "Strength",
            purpose: "strength",
            minEffectiveMins: 20,
          }),
        ],
      },
    ]);
    expect(plannedMins(d)).toBe(0);
  });
});

describe("availableMins", () => {
  it("sums every day's resolved availability", () => {
    const d = days([{ mins: [60, 30] }, { mins: [90] }, {}, { mins: [45] }]);
    expect(availableMins(d)).toBe(225);
  });

  it("is zero for a week with no availability", () => {
    expect(availableMins(days([{}, {}, {}]))).toBe(0);
  });

  it("counts availability independently of whether the day has sessions", () => {
    // A day can be fully available and still unplanned, or fully booked —
    // this must not accidentally read from `workouts` the way `plannedMins`
    // does.
    const d = days([{ mins: [60], workouts: [w({ durationMins: 30 })] }]);
    expect(availableMins(d)).toBe(60);
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

  it("snapshots the day at push time — an earlier adjustment's `after` is not retroactively mutated by a later grow", () => {
    // Two growable sessions on the same day, each in its own block:
    //  - session 0: 60min in a 130min block (blockIdx 0)
    //  - session 1: 80min in a 220min block (blockIdx 1)
    // queenStageHours 4 → ceiling 240, non-binding for either. targetMins
    // 350 == 130 + 220, exactly enough for BOTH sessions to fill their own
    // block completely, so both grow within this single fillWeek call —
    // session 0 first (day order), session 1 second.
    const d = days([
      {
        mins: [130, 220],
        workouts: [
          w({ durationMins: 60, blockIdx: 0 }),
          w({ durationMins: 80, blockIdx: 1 }),
        ],
      },
    ]);

    const r = fillWeek(d, {
      targetMins: 350,
      queenStageHours: 4,
      today: "2026-08-03",
    });

    // Both sessions did grow, to their own block's full size.
    expect(r.days[0].workouts[0].durationMins).toBe(130);
    expect(r.days[0].workouts[1].durationMins).toBe(220);
    expect(r.adjustments).toHaveLength(2);

    // The FIRST adjustment was pushed before session 1 grew. Its `after`
    // snapshot must still show session 1 at its ORIGINAL 80 minutes — not
    // the 220 it becomes one iteration later.
    expect(r.adjustments[0].after[0].workouts[1].durationMins).toBe(80);
  });

  it("grows a session only into the block it occupies, never a roomier sibling block", () => {
    // blockIdx 0 (70min) is deliberately the SMALLER of the day's two
    // blocks; blockIdx 1 (400min) is a big sibling the session must never
    // reach into. queenStageHours 4 → ceiling 240 (non-binding). targetMins
    // 600 leaves far more room than the OCCUPIED block can ever supply, so
    // if growth were ever judged against the day's biggest block instead of
    // the block the session actually occupies, this would grow past 70.
    const d = days([
      { mins: [70, 400], workouts: [w({ durationMins: 60, blockIdx: 0 })] },
    ]);

    const r = fillWeek(d, {
      targetMins: 600,
      queenStageHours: 4,
      today: "2026-08-03",
    });

    expect(r.days[0].workouts[0].durationMins).toBe(70);
  });
});

describe("fillWeek — 1b add one", () => {
  const opts = { targetMins: 600, queenStageHours: 4, today: "2026-08-03" };

  it("places one new session in a freed block", () => {
    const d = days([
      { mins: [90], workouts: [w({ durationMins: 90 })] },
      { mins: [180] },
    ]);

    const r = fillWeek(d, opts);

    expect(r.days[1].workouts).toHaveLength(1);
    expect(r.days[1].workouts[0].sport).toBe("Bike");
    expect(r.days[1].status).toBe("planned");
  });

  it("adds at most one session per call", () => {
    const d = days([
      { mins: [90], workouts: [w({ durationMins: 90 })] },
      { mins: [180] },
      { mins: [180] },
      { mins: [180] },
    ]);

    const r = fillWeek(d, opts);
    const added = r.days.filter(
      (x) => x.date !== d[0].date && x.workouts.length > 0
    );

    expect(added).toHaveLength(1);
  });

  it("never fills a deliberate pre-race rest day", () => {
    const d = days([
      { mins: [90], workouts: [w({ durationMins: 90 })] },
      { mins: [180] },
    ]);
    d[1] = { ...d[1], restIntent: "pre_race" };

    const r = fillWeek(d, opts);

    expect(r.days[1].workouts).toEqual([]);
  });

  it("never fills a day that has already happened", () => {
    const d = days([
      { mins: [180] },
      { mins: [90], workouts: [w({ durationMins: 90 })] },
    ]);

    const r = fillWeek(d, { ...opts, today: "2026-08-04" });

    expect(r.days[0].workouts).toEqual([]);
  });

  it("never fills a locked day", () => {
    for (const status of ["completed", "missed", "race"] as const) {
      const d = days([
        { mins: [90], workouts: [w({ durationMins: 90 })] },
        { mins: [180], status },
      ]);

      const r = fillWeek(d, opts);

      expect(r.days[1].workouts).toEqual([]);
    }
  });

  it("adds nothing when the room is below the purpose floor", () => {
    // 25 minutes cannot hold an aerobic_base session (floor 40).
    const d = days([
      { mins: [90], workouts: [w({ durationMins: 90 })] },
      { mins: [25] },
    ]);

    const r = fillWeek(d, opts);

    expect(r.days[1].workouts).toEqual([]);
  });

  it("adds nothing to a week with no endurance evidence", () => {
    const d = days([
      { mins: [90], workouts: [w({ durationMins: 90, sport: "Swim" })] },
      { mins: [180] },
    ]);

    const r = fillWeek(d, opts);

    expect(r.days[1].workouts).toEqual([]);
  });

  it("never gives a running plan a long run", () => {
    const d = days([
      { mins: [60], workouts: [w({ durationMins: 60, sport: "Run" })] },
      { mins: [300] },
    ]);

    const r = fillWeek(d, opts);

    // Bounded by EASY_RUN_CAP_MINS, and never purpose "long".
    expect(r.days[1].workouts[0].durationMins).toBeLessThanOrEqual(
      EASY_RUN_CAP_MINS
    );
    expect(r.days[1].workouts[0].purpose).toBe("aerobic_base");
  });

  it("respects a block that excludes the fill sport", () => {
    const d = days([
      { mins: [90], workouts: [w({ durationMins: 90 })] },
      { mins: [] },
    ]);
    d[1] = {
      ...d[1],
      availableBlocks: [
        { start: null, end: null, mins: 180, energy: "full", sports: ["Swim"] },
      ],
      availableMins: 180,
    };

    const r = fillWeek(d, opts);

    expect(r.days[1].workouts).toEqual([]);
  });

  it("is idempotent once the target is met", () => {
    const d = days([
      { mins: [90], workouts: [w({ durationMins: 90 })] },
      { mins: [180] },
    ]);
    const tight = { ...opts, targetMins: 200 };

    const once = fillWeek(d, tight);
    const twice = fillWeek(once.days, tight);

    expect(twice.days).toEqual(once.days);
    expect(twice.adjustments).toEqual([]);
  });

  it("keeps the taken-set key in lockstep with slotKey — an occupied block at a non-palindromic coordinate is never double-booked", () => {
    // The occupied session sits at day index 1, block index 0 — key "1:0",
    // not a palindrome. (Every other fixture in this file occupies "0:0",
    // whose transpose is itself, so a taken-set key built as
    // `${blockIdx}:${dayIdx}` instead of `${dayIdx}:${blockIdx}` would be
    // indistinguishable from the correct one there.) Block 0 (60min)
    // already holds the day's only session; block 1 (200min) is free.
    // buildSlots' tiebreak sorts same-day blocks by blockIdx ascending, so
    // block 0's slot — the OCCUPIED one — is tried first. Under a
    // correctly keyed taken set it is rejected there (60min is also below
    // the "long" floor of 90, so only "aerobic_base" even reaches the
    // taken check, and taken.has("1:0") must be true to reject it), and
    // the algorithm falls through to the free block 1. Under a transposed
    // key, taken would hold "0:1" instead — which never matches "1:0" —
    // so the occupied slot would wrongly admit a second session on TOP of
    // the existing one instead of being skipped.
    const d = days([
      { mins: [] },
      { mins: [60, 200], workouts: [w({ durationMins: 60, blockIdx: 0 })] },
    ]);

    const r = fillWeek(d, opts);

    expect(r.days[1].workouts).toHaveLength(2);
    expect(r.days[1].workouts.map((x) => x.blockIdx).sort()).toEqual([0, 1]);
    expect(r.days[1].workouts.find((x) => x.blockIdx === 0)?.durationMins).toBe(
      60
    );
    expect(r.days[1].workouts.find((x) => x.blockIdx === 1)).toBeDefined();
  });

  it("preserves a day's existing status when a second session is added to it", () => {
    // "adapted": non-locked (so 1b still considers the day) and distinct
    // from "planned" — the value a mutant that hardcoded
    // `status: "planned"` (collapsing the ternary that preserves
    // day.status when the day already had a workout) would produce
    // undetected by every other test in this file, since they only ever
    // add a session to a day that STARTED with zero workouts.
    const d = days([
      {
        mins: [60, 200],
        workouts: [w({ durationMins: 60, blockIdx: 0 })],
        status: "adapted",
      },
    ]);

    const r = fillWeek(d, opts);

    expect(r.days[0].workouts).toHaveLength(2);
    expect(r.days[0].status).toBe("adapted");
  });
});

describe("fillWeek — 1a and 1b in the same call", () => {
  // The seam between the two sub-steps: every 1a-only test above is sized so
  // the loop's `planned < opts.targetMins` guard goes false before 1b could
  // ever run, and every 1b-only test's existing session already fills its
  // block, making 1a a guaranteed no-op. Neither exercises 1a and 1b BOTH
  // mutating `planned` within one `fillWeek` call — the exact seam a
  // per-sub-step diff review cannot see.
  //
  // targetMins is 250, not a rounder number like 400. At 400 there is so
  // much headroom that BOTH sub-steps are bound by their own block/ceiling
  // caps — day 0's 120min block, day 1's 180min block — and the shared
  // target term never binds anywhere. Mutation-tested: double-counting
  // `planned` in 1a, dropping 1a's own target-clamp term, and having 1b
  // read its budget from the PRE-1a total instead of the running one all
  // survived undetected at 400, because 1b's own 180min block cap produces
  // the same 180min result no matter what `planned` actually holds when
  // there's that much slack left.
  //
  // At 250, day 0's OWN growth (1a) is STILL bound by its 120min block, not
  // by the target (60 + (250 - 60) = 250, well above the block's 120) — so
  // this fixture cannot see a bug confined entirely inside 1a's own clamp
  // (confirmed: dropping 1a's target-clamp term alone leaves this test
  // green; 1a's own clamps have dedicated single-sub-step tests above).
  // What DOES change at 250 is 1b's bound: the remaining budget after 1a
  // (250 - 120 = 130) is now TIGHTER than both day 1's 180min block and its
  // 240min ceiling, so 130 — not 180 — is what a correct implementation
  // must place, and that number is a direct readout of whatever `planned`
  // holds when 1b runs. A stale pre-1a budget (130 → 190) changes the
  // actual minutes placed (130 → 180) and the week's total (250 → 300),
  // which is what this test now pins.
  it("grows day 0's session to its block cap, then adds a new session to day 1 sized by the REMAINING budget, honouring one shared target", () => {
    const d = days([
      { mins: [120], workouts: [w({ durationMins: 60 })] },
      { mins: [180] },
    ]);

    const r = fillWeek(d, {
      targetMins: 250,
      queenStageHours: 4,
      today: "2026-08-03",
    });

    // 1a fired: day 0 grew to its block cap (bound by the 120min block, not
    // by the 250 target — see comment above).
    expect(r.days[0].workouts[0].durationMins).toBe(120);
    // 1b fired too: day 1 received a new session sized to the REMAINING
    // budget (250 - 120 = 130) — smaller than its own 180min block, so 130
    // can only come from the running total, not the block cap.
    expect(r.days[1].workouts).toHaveLength(1);
    expect(r.days[1].workouts[0].sport).toBe("Bike");
    expect(r.days[1].workouts[0].durationMins).toBe(130);

    // No double-counting and no stale pre-1a snapshot: total planned time
    // lands exactly on the shared target — not under it (a double-count
    // bug) and not over it (300 is what a stale pre-1a budget produces on
    // this exact fixture).
    expect(plannedMins(r.days)).toBe(250);

    // Both adjustments logged, each describing the day it actually touched.
    expect(r.adjustments).toHaveLength(2);
    expect(r.adjustments[0].date).toBe(d[0].date);
    expect(r.adjustments[0].action).toBe("added");
    expect(r.adjustments[1].date).toBe(d[1].date);
    expect(r.adjustments[1].action).toBe("added");

    // The first adjustment's `after` snapshot (day 0, post-grow) is not
    // retroactively touched by the second sub-step's edit to day 1.
    expect(r.adjustments[0].after[0].workouts[0].durationMins).toBe(120);
  });
});
