import {
  describe,
  expect,
  it,
  beforeAll,
  afterAll,
  afterEach,
  vi,
} from "vitest";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import * as feasibilityModule from "@/lib/race/feasibility";
import {
  generateWorkouts,
  generateCyclingWorkouts,
  withPurpose,
  PURPOSE_BY_TYPE,
  generateTrainingPlan,
  longRideBoundMins,
  distributeRemainder,
  periodize,
  EASY_RUN_CAP_MINS,
  hasBridgeRoom,
  previewTrainingPlan,
  previewFromDraft,
} from "./training-plan";
import { PLAN_CONSTANTS } from "./plan-constants";
import {
  TAPER_FRACTION_RACE_WEEK,
  TAPER_FRACTION_WEEK_1,
  TAPER_FRACTION_WEEK_2,
} from "./race/taper";
import { addDaysYmd } from "./week-plan/service";

// requires Postgres; skips without DATABASE_URL.
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

describe("workout purpose", () => {
  it("maps every generated type to a purpose one-to-one", () => {
    expect(PURPOSE_BY_TYPE).toEqual({
      Recovery: "recovery",
      Endurance: "aerobic_base",
      Long: "long",
      Tempo: "threshold",
      Intervals: "vo2max",
      Brick: "brick",
    });
  });

  it("stamps purpose and floor onto a bare workout", () => {
    const w = withPurpose({
      day: 2,
      sport: "Bike",
      type: "Intervals",
      durationMins: 90,
      intensity: "Z4-Z5",
      description: "VO2max intervals",
    });
    expect(w.purpose).toBe("vo2max");
    expect(w.minEffectiveMins).toBe(40);
  });

  it("falls back to aerobic_base for an unknown type", () => {
    const w = withPurpose({
      day: 0,
      sport: "Bike",
      type: "Mystery",
      durationMins: 60,
      intensity: "Z1-Z2",
      description: "?",
    });
    expect(w.purpose).toBe("aerobic_base");
    expect(w.minEffectiveMins).toBe(40);
  });

  it("gives every generated workout a purpose and a floor", () => {
    const ws = generateWorkouts(4, 8, "build", "Bike");
    expect(ws.length).toBeGreaterThan(0);
    for (const w of ws) {
      expect(w.purpose).toBeDefined();
      expect(w.minEffectiveMins).toBeGreaterThan(0);
    }
  });
});

describe("longRideBoundMins", () => {
  it("falls back to today's cap when there is no event demand", () => {
    // No race, or no FTP -> eventDemand returns null. Keep today's
    // behaviour rather than inventing a bound on no evidence.
    expect(longRideBoundMins(null)).toBe(240);
  });

  it("uses the event's hardest day", () => {
    // The Ride - Dolomites 2026: queenStageHours 4.897963084361944
    expect(longRideBoundMins(4.897963084361944)).toBe(294);
  });

  it("floors a very short event at a useful endurance stimulus", () => {
    // A criterium's queen stage is under an hour; a 30-minute "long ride"
    // is not an endurance session.
    expect(longRideBoundMins(0.5)).toBe(120);
  });

  it("never exceeds the absolute six-hour bound", () => {
    expect(longRideBoundMins(9)).toBe(360);
  });

  it("treats nonsense demand as no demand", () => {
    expect(longRideBoundMins(0)).toBe(240);
    expect(longRideBoundMins(-1)).toBe(240);
    expect(longRideBoundMins(Number.NaN)).toBe(240);
  });
});

describe("distributeRemainder", () => {
  it("splits the remainder evenly when everyone has headroom", () => {
    // The live case: two 90-minute endurance rides clamped from 197.
    expect(distributeRemainder([90, 90], [294, 294], 214)).toEqual([197, 197]);
  });

  it("spills onto sessions with room when one hits its bound", () => {
    // 0 can take only 20 more; the other 30 must land on 1, not vanish.
    expect(distributeRemainder([100, 50], [120, 300], 100)).toEqual([120, 130]);
  });

  it("stops when nothing has headroom, rather than looping", () => {
    expect(distributeRemainder([100], [100], 50)).toEqual([100]);
  });

  it("is a no-op for a zero or negative remainder", () => {
    expect(distributeRemainder([60, 60], [200, 200], 0)).toEqual([60, 60]);
    expect(distributeRemainder([60, 60], [200, 200], -10)).toEqual([60, 60]);
  });

  it("never exceeds any bound", () => {
    const out = distributeRemainder([10, 10, 10], [20, 20, 20], 1000);
    expect(out).toEqual([20, 20, 20]);
  });

  it("is a no-op for an empty input", () => {
    expect(distributeRemainder([], [], 50)).toEqual([]);
  });

  it("is a no-op when every bound is already below current", () => {
    // No session has headroom, so the remainder cannot be placed anywhere —
    // the loop must recognize this on the first pass and stop, not loop
    // forever or push values past bounds already violated coming in.
    expect(distributeRemainder([100, 100], [90, 90], 50)).toEqual([100, 100]);
  });
});

describe("generateCyclingWorkouts distributes the target", () => {
  function total(ws: { durationMins: number }[]): number {
    return ws.reduce((s, w) => s + w.durationMins, 0);
  }

  it("schedules the whole target — the live regression", () => {
    // Owner account, skeleton week 5, build phase: 12.5h target x the 1.03
    // build multiplier = 772.5 -> 773 min. This produced 559 min before
    // the fix (long clamped 294->240, two endurance rides clamped 197->90).
    const ws = generateCyclingWorkouts(
      4,
      12.5 * 1.03,
      "build",
      4.897963084361944
    );
    expect(total(ws)).toBe(773);
  });

  it("puts the long ride at the event's hardest day, not a constant", () => {
    const ws = generateCyclingWorkouts(
      4,
      12.5 * 1.03,
      "build",
      4.897963084361944
    );
    const long = ws.find((w) => w.type === "Long");
    expect(long?.durationMins).toBe(294);
  });

  it("leaves the intensity session out of redistribution", () => {
    // 18% of 773 = 139. It must not grow to soak up volume: duration at
    // intensity is prescribed, not filler.
    const ws = generateCyclingWorkouts(
      4,
      12.5 * 1.03,
      "build",
      4.897963084361944
    );
    const hard = ws.find((w) => w.type === "Intervals");
    expect(hard?.durationMins).toBe(139);
  });

  it("still fills the target with no event demand, using today's cap", () => {
    // periodize(9, 76.7, 4, 10, ...) week 5: 10h x 1.03 = 618 min.
    // Long = round(618 x 0.38) = 235, under the 240 no-demand bound.
    const ws = generateCyclingWorkouts(4, 10 * 1.03, "build", null);
    expect(total(ws)).toBe(618);
    expect(ws.find((w) => w.type === "Long")?.durationMins).toBe(235);
  });

  it("keeps the taper's shortened long ride", () => {
    const ws = generateCyclingWorkouts(4, 8, "taper", 4.897963084361944);
    expect(ws.find((w) => w.type === "Long")?.durationMins).toBe(90);
  });

  it("falls short only when every participating session is at its bound", () => {
    // 2 sessions against an impossible 20h target, with a criterium's queen
    // stage bounding the ride at 120. Long pins at 120 and there are no
    // endurance rides to absorb anything, so the week legitimately comes in
    // short — that is a real "these days cannot absorb this", not a
    // discarded remainder.
    //
    // Tempo is NOT bounded by longBound: it is 18% of the target by
    // prescription (round(1200 × 0.18) = 216) and is excluded from
    // redistribution, so assert only the participating sessions.
    const ws = generateCyclingWorkouts(2, 20, "base", 0.5);
    expect(total(ws)).toBeLessThan(20 * 60);

    const participating = ws.filter(
      (w) => w.type !== "Intervals" && w.type !== "Tempo"
    );
    expect(participating.length).toBeGreaterThan(0);
    for (const w of participating) {
      expect(w.durationMins).toBeLessThanOrEqual(120);
    }
    expect(ws.find((w) => w.type === "Long")?.durationMins).toBe(120);
  });

  it("never drops an easy ride below the effective floor", () => {
    const ws = generateCyclingWorkouts(5, 2, "base", null);
    for (const w of ws.filter((x) => x.type === "Endurance")) {
      expect(w.durationMins).toBeGreaterThanOrEqual(30);
    }
  });

  // The cases above all happen to leave `remainder <= 0`, because `easyMins`
  // divides by `remaining` AFTER the long ride is clamped and so absorbs the
  // clamped minutes implicitly. Redistribution only has work to do when the
  // endurance loop creates FEWER rides than `remaining` — it runs
  // `min(remaining, availDays.length)` times against 5 available days. The two
  // cases below are the ones that actually execute it; without them a
  // regression in the participant mapping, the bounds array or the write-back
  // would pass the whole suite.

  it("grows sessions with headroom instead of discarding the remainder", () => {
    // 7 sessions, 20h, recovery: totalMins 1200, long clamped to its 240
    // bound, `remaining` 6 against 5 available days, so `easyMins` is
    // round(960/6) = 160 and only five rides are created — 1040 scheduled,
    // 160 left over. The long ride is already at its bound and takes none of
    // it; the five recovery rides each gain 32.
    const ws = generateCyclingWorkouts(7, 20, "recovery", null);

    expect(total(ws)).toBe(1200);
    // 192, not the 160 they were first sized at — this is the assertion that
    // observes redistribution doing work rather than returning its input.
    for (const w of ws.filter((x) => x.type === "Recovery")) {
      expect(w.durationMins).toBe(192);
    }
    expect(ws.find((w) => w.type === "Long")?.durationMins).toBe(240);
  });

  it("holds the intensity session flat while the rest absorb the remainder", () => {
    // Same shape in build, where an Intervals session exists: totalMins 1200,
    // long 240, intervals round(1200 x 0.18) = 216, `remaining` 6 against 5
    // days -> easyMins round(744/6) = 124, 1076 scheduled, 124 left over. The
    // five endurance rides take an even 24 each, then the 4-minute leftover
    // goes out one at a time: 149/149/149/149/148.
    //
    // Unlike the earlier exclusion test, `remainder` here is non-zero and the
    // block genuinely executes, so this fails if `participants` ever stops
    // filtering intensity sessions out.
    const ws = generateCyclingWorkouts(8, 20, "build", null);

    expect(total(ws)).toBe(1200);
    expect(ws.find((w) => w.type === "Intervals")?.durationMins).toBe(216);

    const easy = ws
      .filter((w) => w.type === "Endurance")
      .map((w) => w.durationMins)
      .sort((a, b) => b - a);
    expect(easy).toEqual([149, 149, 149, 149, 148]);
  });
});

describe("periodize passes event demand to the cycling generator", () => {
  it("bounds the long ride by the event's hardest day", () => {
    const withDemand = periodize({
      weeksTotal: 9,
      startingCtl: 76.7,
      daysPerWeek: 4,
      hoursPerWeek: 12.5,
      sport: "Bike",
      queenStageHours: 4.897963084361944,
    });
    const withoutDemand = periodize({
      weeksTotal: 9,
      startingCtl: 76.7,
      daysPerWeek: 4,
      hoursPerWeek: 12.5,
      sport: "Bike",
    });

    const longOf = (blocks: ReturnType<typeof periodize>) =>
      blocks
        .find((b) => b.weekNumber === 5)!
        .workouts.find((w) => w.type === "Long")!.durationMins;

    // 12.5h x 1.03 = 773 min; 38% = 294, which the event allows and the
    // 240 no-demand fallback does not.
    expect(longOf(withDemand)).toBe(294);
    expect(longOf(withoutDemand)).toBe(240);
  });
});

describe("opening-week branching", () => {
  it("deep negative form reduces opening target load by 20%", () => {
    const neutral = periodize({
      weeksTotal: 12,
      startingCtl: 50,
      daysPerWeek: 5,
      hoursPerWeek: 8,
      sport: "Bike",
      queenStageHours: null,
      startingTsb: 0,
    });
    const deep = periodize({
      weeksTotal: 12,
      startingCtl: 50,
      daysPerWeek: 5,
      hoursPerWeek: 8,
      sport: "Bike",
      queenStageHours: null,
      startingTsb: -20,
    });
    expect(deep[0].targetLoad).toBe(Math.round(neutral[0].targetLoad * 0.8));
  });

  it("deep negative form removes threshold/VO2 work in first 72h", () => {
    const deep = periodize({
      weeksTotal: 12,
      startingCtl: 50,
      daysPerWeek: 5,
      hoursPerWeek: 8,
      sport: "Bike",
      queenStageHours: null,
      startingTsb: -21,
    });
    const firstWeek = deep[0].workouts;
    for (const w of firstWeek.filter((x) => x.day < 3)) {
      expect(w.type === "Intervals" || w.type === "Tempo").toBe(false);
    }
    const day2 = firstWeek.find((x) => x.day === 2);
    expect(day2?.type).toBe("Recovery");
    expect(day2?.purpose).toBe("recovery");
  });

  it("moderate negative keeps opening branch and downgrades day-2 intensity", () => {
    const moderate = periodize({
      weeksTotal: 12,
      startingCtl: 50,
      daysPerWeek: 5,
      hoursPerWeek: 8,
      sport: "Bike",
      queenStageHours: null,
      startingTsb: -10,
    });
    const day2 = moderate[0].workouts.find((x) => x.day === 2);
    expect(day2?.type).toBe("Endurance");
    expect(day2?.purpose).toBe("aerobic_base");
  });

  it("caps week-2 rebound after opening downscale to <= 11%", () => {
    const blocks = periodize({
      weeksTotal: 12,
      startingCtl: 55,
      daysPerWeek: 5,
      hoursPerWeek: 8,
      sport: "Bike",
      queenStageHours: null,
      startingTsb: -10,
    });
    const w1 = blocks[0];
    const w2 = blocks[1];
    expect(w1.phase).not.toBe("recovery");
    expect(w2.phase).not.toBe("recovery");
    const increase = (w2.targetLoad - w1.targetLoad) / w1.targetLoad;
    expect(increase).toBeLessThanOrEqual(0.11);
  });
});

describe("recovery cadence", () => {
  /** Longest run of consecutive non-recovery weeks in a skeleton. */
  function longestLoadingRun(blocks: ReturnType<typeof periodize>): number {
    let run = 0;
    let worst = 0;
    for (const b of blocks) {
      if (b.phase === "recovery" || b.phase === "taper") run = 0;
      else {
        run += 1;
        worst = Math.max(worst, run);
      }
    }
    return worst;
  }

  it("never exceeds the base interval, at any plan length", () => {
    for (let weeks = 4; weeks <= 52; weeks++) {
      const blocks = periodize({
        weeksTotal: weeks,
        startingCtl: 50,
        daysPerWeek: 5,
        hoursPerWeek: 8,
        sport: "Bike",
      });
      expect(
        longestLoadingRun(blocks),
        `${weeks}-week plan ran too long without recovery`
      ).toBeLessThanOrEqual(PLAN_CONSTANTS.RECOVERY_INTERVAL_BASE);
    }
  });

  it("does not restart the count at a phase boundary", () => {
    // An 8-week plan gives a 3-week base — one week short of
    // RECOVERY_INTERVAL_BASE's own 4-week cycle, so base ends without ever
    // firing a recovery of its own (the original defect: "3-week base
    // produced no recovery week at all"). The count it accumulated (3
    // loading weeks) carries into build rather than resetting to 0.
    //
    // The `weekInPhase > 1` guard (restored alongside the density fix)
    // still forces a phase's own first week to be a loading week no matter
    // how large the carried count is — recovery can never fire before a
    // phase's 2nd week — so build's 1st week (plan week baseWeeks + 1) is
    // guaranteed loading, and by build's 2nd week (baseWeeks + 2) the
    // carried count is baseWeeks + 1, already past build's own threshold
    // (RECOVERY_INTERVAL_DEFAULT - 1 = 2) for any baseWeeks >= MIN_BASE_WEEKS
    // (2) — so build's 2nd week is where recovery fires. That is the bound,
    // derived from the rule rather than read off the output.
    const blocks = periodize({
      weeksTotal: 8,
      startingCtl: 50,
      daysPerWeek: 5,
      hoursPerWeek: 8,
      sport: "Bike",
    });
    const baseWeeks = Math.max(
      PLAN_CONSTANTS.MIN_BASE_WEEKS,
      Math.round(8 * PLAN_CONSTANTS.PHASE_SHARE_BASE)
    );
    const firstRecovery = blocks.findIndex((b) => b.phase === "recovery");

    // The defect this test guards against: a 3-week base yielding ZERO
    // recovery weeks at all.
    expect(firstRecovery).toBeGreaterThanOrEqual(0);
    // The defect's other symptom: six (or more) consecutive loading weeks
    // before the first recovery. This run is 4 weeks (1..baseWeeks+1),
    // well under six.
    expect(firstRecovery).toBeLessThan(6);
    // The exact, rule-derived bound: recovery fires on build's 2nd week.
    expect(firstRecovery + 1).toBe(baseWeeks + 2);
  });
});

describe("CTL ramp bound", () => {
  // The brief's own draft used startingCtl=50 here. Verified empirically
  // (against the pre-fix code) that it does NOT reproduce the defect: base
  // and build already carry PROGRESSION_STEP_CAP (a pre-existing constant,
  // not new to this task), which caps their growth to
  // +baseLoad*0.1/week once currentLoad passes ~1.25x baseLoad. At
  // startingCtl=50, baseLoad*0.1 (350*0.1=35) is EXACTLY the CTL bound's own
  // rate (CTL_RAMP_PER_WEEK*CTL_TO_WEEKLY_LOAD = 5*7 = 35) — the two
  // trajectories run parallel forever and never diverge, at any plan length
  // up to 52 weeks (checked).
  //
  // The exact algebraic crossover (baseLoad*0.1 > 35, i.e. startingCtl > 50)
  // is only a NECESSARY condition — it says the rates cross, not that a
  // bounded-length plan lives long enough to see the gap become a full-TSS
  // violation. An exhaustive sweep (every integer startingCtl, every
  // weeksTotal from 4-52 — this app refuses anything longer — diffed against
  // the same run with the bound disabled) found the bound first changes
  // output at startingCtl=68. 80 is used below for comfortable margin above
  // that empirically-found line, not the algebraic one — a future reader
  // must not "simplify" this back toward 50 on the algebra alone, since
  // 51-67 never actually reproduces the defect within a real plan length.
  const startingCtl = 80;

  it("bounds a long plan against the CTL trajectory", () => {
    const blocks = periodize({
      weeksTotal: 30,
      startingCtl: startingCtl,
      daysPerWeek: 5,
      hoursPerWeek: 8,
      sport: "Bike",
    });
    for (const b of blocks) {
      if (b.phase === "recovery" || b.phase === "taper") continue;
      const maxLoad =
        (startingCtl + PLAN_CONSTANTS.CTL_RAMP_PER_WEEK * b.weekNumber) *
        PLAN_CONSTANTS.CTL_TO_WEEKLY_LOAD;
      expect(
        b.targetLoad,
        `week ${b.weekNumber} exceeds the CTL ramp bound`
      ).toBeLessThanOrEqual(Math.round(maxLoad));
    }
  });

  // The test above reads CTL_RAMP_PER_WEEK and CTL_TO_WEEKLY_LOAD from
  // PLAN_CONSTANTS on both sides — its own expectation and the code under
  // test — so it cannot catch either constant being swapped for a wrong
  // value; it only catches a missing or broken clamp. Pinned to a literal
  // here instead, the same fix applied to the taper ladder in Task 4
  // (race/taper.test.ts, "pinned to literal values").
  it("pins one clamped week to a literal, not the constants it guards", () => {
    const blocks = periodize({
      weeksTotal: 30,
      startingCtl: startingCtl,
      daysPerWeek: 5,
      hoursPerWeek: 8,
      sport: "Bike",
    });
    const week7 = blocks.find((b) => b.weekNumber === 7)!;
    expect(week7.phase).toBe("base");
    // (80 + 5*7) * 7 = 805 — 5 and 7 are literal here (CTL_RAMP_PER_WEEK and
    // CTL_TO_WEEKLY_LOAD), deliberately not read from PLAN_CONSTANTS. If
    // either constant's value changed, this stops matching and the test
    // fails loudly instead of moving in step with the code.
    expect(week7.targetLoad).toBe(805);
  });

  // Review finding: the week-7 pin above only exercises the PUSH-SITE clamp
  // (`Math.min(currentLoad, maxLoadForWeek(w))` at the block push) — it
  // says nothing about whether `currentLoad` itself is ALSO clamped after
  // the progression step. Deleting that second clamp still leaves every
  // base/build/peak week's pushed value correct, because the push-site
  // clamp re-applies the same bound on every loading week regardless of
  // what `currentLoad` drifted to underneath — the bound is linear and the
  // gap only widens, so the push site masks a missing second clamp forever
  // for loading weeks. The only place raw, unclamped `currentLoad` is ever
  // read is the RECOVERY branch (`Math.round(currentLoad *
  // RECOVERY_FRACTION)`) and `preTaperLoad` at taper entry — neither has a
  // push-site bound check of its own. Week 8 (recovery, immediately after
  // week 7's clamp) is where this is observable: it reads whatever
  // `currentLoad` was left at after week 7's progression AND its
  // currentLoad-clamp, with no bound check of its own.
  it("pins a recovery week to a literal, guarding the currentLoad clamp specifically", () => {
    const blocks = periodize({
      weeksTotal: 30,
      startingCtl: startingCtl,
      daysPerWeek: 5,
      hoursPerWeek: 8,
      sport: "Bike",
    });
    const week8 = blocks.find((b) => b.weekNumber === 8)!;
    expect(week8.phase).toBe("recovery");
    // Without the currentLoad clamp, week 7 leaves currentLoad at
    // min(817*1.08, 817+56) = 873 (the pre-fix, unbounded value — see the
    // before/after table for weeks=30,ctl=80 in the report), and week 8
    // would read round(873*0.6)=524. WITH the clamp, week 7's currentLoad
    // is pulled down to maxLoadForWeek(8)=840 first, so week 8 reads
    // round(840*0.6)=504 instead. 504, not 524, is the value that can only
    // be produced by the second clamp.
    expect(week8.targetLoad).toBe(504);
  });

  it("leaves a short plan the bound should not reach untouched", () => {
    // 6 weeks at 8%/week from CTL 50 stays well inside the trajectory,
    // so the bound must not quietly reshape a plan it was never meant to.
    const blocks = periodize({
      weeksTotal: 6,
      startingCtl: 50,
      daysPerWeek: 5,
      hoursPerWeek: 8,
      sport: "Bike",
    });
    const loading = blocks.filter((b) => b.phase === "base");
    expect(loading.length).toBeGreaterThan(1);
    expect(loading[1].targetLoad).toBeGreaterThan(loading[0].targetLoad);
  });

  // Found in review: without a floor, maxLoadForWeek(1) for a low CTL falls
  // BELOW MIN_WEEKLY_LOAD (e.g. CTL 0: (0 + 5*1)*7 = 35), so the ramp bound
  // would quietly cut a beginner's opening week under the minimum
  // MIN_WEEKLY_LOAD exists to guarantee — the opposite of this task's job,
  // which is to stop compounding at the top, not lower the floor at the
  // bottom. Pinned to a literal (100), not PLAN_CONSTANTS.MIN_WEEKLY_LOAD:
  // Task 4 on this branch shipped a test that divided by the same constant
  // the code multiplied by and was blind to a swapped value for exactly
  // that reason — reading the same constant on both sides of an assertion
  // proves nothing about whether the constant itself is right.
  it("never lets the ramp bound cut below MIN_WEEKLY_LOAD", () => {
    const ctl0 = periodize({
      weeksTotal: 12,
      startingCtl: 0,
      daysPerWeek: 5,
      hoursPerWeek: 8,
      sport: "Bike",
    });
    const ctl5 = periodize({
      weeksTotal: 12,
      startingCtl: 5,
      daysPerWeek: 5,
      hoursPerWeek: 8,
      sport: "Bike",
    });
    // Both would sit BELOW the floor from the ramp bound alone (35 and 70
    // respectively) if the floor were not applied — the whole point of
    // this test.
    expect(ctl0.find((b) => b.weekNumber === 1)!.targetLoad).toBe(100);
    expect(ctl5.find((b) => b.weekNumber === 1)!.targetLoad).toBe(100);
  });
});

describe("periodize is unchanged by the constants refactor", () => {
  it("produces a stable skeleton for a known input", () => {
    const blocks = periodize({
      weeksTotal: 12,
      startingCtl: 50,
      daysPerWeek: 5,
      hoursPerWeek: 8,
      sport: "Bike",
    });
    // v0.45 Task 3 carried the recovery counter across phase boundaries
    // (fixing a real defect: resetting per-phase could skip recovery
    // entirely, or restart a fresh interval right after a boundary). Two
    // corrections followed: the firing threshold is `recoveryInterval - 1`
    // loading weeks, not `recoveryInterval` (restores the original 3:1
    // base / 2:1 build-peak density), and `weekInPhase > 1` still guards a
    // phase's own first week from ever firing (restores the original rule
    // that a carried-in count cannot consume a phase whole). With both
    // restored, only ONE week in this 12-week fixture actually differs from
    // pre-Task-3:
    //
    //   - Week 4 recovery is unchanged: base's first 3 loading weeks are
    //     entirely inside base, so the boundary carry has nothing to do yet.
    //   - The second recovery moves from week 8 (pre-Task-3) to week 7.
    //     After week 4 resets the counter, week 5 (base, still loading)
    //     already counts 1 loading week toward whatever comes next; week 6
    //     (build) counts the 2nd. The guard still blocks build's OWN first
    //     week (week 6) regardless of the carried count, so recovery cannot
    //     fire there — but by build's SECOND week (week 7) the guard no
    //     longer applies, and the carried count (2) already meets build's
    //     threshold (`RECOVERY_INTERVAL_DEFAULT - 1` = 2), so week 7 fires.
    //     One week earlier than pre-Task-3's week 8, because the carry
    //     credits week 5's loading week toward build's shorter interval
    //     instead of discarding it at the boundary — but never earlier than
    //     build's own 2nd week, because of the guard.
    //   - Weeks 8-12 (build/peak/taper) match pre-Task-3 exactly: after week
    //     7 resets the counter, weeks 8-9 are build's 2 loading weeks
    //     (matching 2:1) and peak's single week (10) is protected by the
    //     guard from ever becoming a carried-in recovery week, so it stays
    //     a loading "peak" week exactly as before — the same 579 targetLoad,
    //     because the total count of progression steps by week 10 is
    //     unchanged (recovery weeks never advance `currentLoad`, so moving
    //     WHICH week is recovery between weeks 4-9 does not change the
    //     load trajectory from week 10 onward).
    //
    // Updated again in v0.45 Task 4: the taper reads race/taper.ts's ladder.
    // Weeks 1-10 are byte-identical to pre-Task-4 (verified by diffing this
    // fixture against the prior implementation directly) — Task 4 only
    // replaces the taper branch, so nothing upstream of it can move. Weeks
    // 11-12 change because the rate itself changed:
    //   - Week 11 (first taper week, one week from the race): pre-Task-4
    //     this was `Math.round(currentLoad)` where currentLoad was whatever
    //     peak's ×1.02 progression left it at (≈590.8, displaying as 591) —
    //     the SAME variable base/build/peak progress every week, taper
    //     included. Task 4 instead fixes the taper's anchor once, entering
    //     the phase (`preTaperLoad`, also ≈590.8 here — peak's last
    //     progression step still runs before taper begins, so the anchor
    //     itself is unchanged), and every taper week is now a fraction of
    //     THAT fixed anchor rather than of a running `currentLoad`. Week 11
    //     is one week out from the race, so it reads TAPER_FRACTION_WEEK_1
    //     (0.65): round(590.8 * 0.65) = 384, not 591.
    //   - Week 12 (race week) pre-Task-4 was `Math.round(590.8 * 0.75)` =
    //     443 (currentLoad after ONE ×0.75 compounding step from week 11).
    //     Now it reads TAPER_FRACTION_RACE_WEEK (0.45) off the SAME fixed
    //     anchor (590.8, not the already-decayed 591): round(590.8 * 0.45)
    //     = 266. It is no longer a fraction of week 11's own value, which
    //     is the whole point — a 2-week taper's race-week load is a step
    //     down from the load entering the taper, not a second compounding
    //     step off an already-reduced week.
    expect(blocks.map((b) => [b.weekNumber, b.phase, b.targetLoad])).toEqual([
      [1, "base", 350],
      [2, "base", 378],
      [3, "base", 408],
      [4, "recovery", 265],
      [5, "base", 441],
      [6, "build", 476],
      [7, "recovery", 306],
      [8, "build", 509],
      [9, "build", 544],
      [10, "peak", 579],
      [11, "taper", 384],
      [12, "taper", 266],
    ]);
  });
});

describe("the skeleton taper has one authority", () => {
  // The task brief's draft for this describe block asserted
  // `last.targetLoad === Math.round(preTaper.targetLoad * TAPER_FRACTION_RACE_WEEK)`
  // where `preTaper` was "the block immediately before taper starts". That
  // does not follow from the rule being implemented, for two independent
  // reasons visible in this exact 16-week fixture:
  //   1. The block immediately before taper is week 14 — a RECOVERY week.
  //      Its displayed targetLoad (384) is already reduced by
  //      RECOVERY_FRACTION; it is not the load entering the taper.
  //   2. Even when the preceding block is a genuine loading week (e.g. the
  //      12-week fixture, where it's week 10, "peak"), that block's
  //      displayed targetLoad is `currentLoad` BEFORE that week's own
  //      progression step, while the taper's anchor (`preTaperLoad`) is
  //      captured AFTER it. The two are never the same number by
  //      construction (peak week 10: displayed 579 vs actual anchor
  //      ≈590.8).
  // Confirmed empirically: running the draft assertion against the
  // finished implementation (not the old one) still failed —
  // "expected 288 to be 173" — proving the mismatch is in the test, not
  // the code. Rewritten below to test the actual rule: both taper weeks
  // derive from ONE shared anchor load, recoverable from either week.
  it("both taper weeks derive from one shared anchor load, not two independent rates", () => {
    const blocks = periodize({
      weeksTotal: 16,
      startingCtl: 50,
      daysPerWeek: 5,
      hoursPerWeek: 8,
      sport: "Bike",
    });
    const taper = blocks.filter((b) => b.phase === "taper");
    expect(taper.length).toBe(2);

    // If both weeks are `Math.round(anchor * fraction)` for the SAME
    // anchor, dividing each back out by its own ladder fraction recovers
    // that same anchor (modulo the rounding each division re-introduces).
    // Under the old rate — currentLoad compounding at a flat 0.75/week,
    // unrelated to these fractions — the two recovered "anchors" would
    // have nothing to do with each other and diverge by hundreds of TSS.
    const [week1, raceWeek] = taper;
    const impliedFromWeek1 = week1.targetLoad / TAPER_FRACTION_WEEK_1;
    const impliedFromRace = raceWeek.targetLoad / TAPER_FRACTION_RACE_WEEK;
    expect(Math.abs(impliedFromWeek1 - impliedFromRace)).toBeLessThan(3);
  });

  // The brief's draft for this test asserted only `mins > 0` — true under
  // both the old code and the new code, so it could never fail and never
  // actually checked what its own title promised. Rewritten to compare the
  // week-over-week RATIO of load against the week-over-week ratio of
  // scheduled minutes: pre-Task-4 these were governed by two unrelated
  // rates (load ×0.75, hours 0.7→0.6→0.5) and diverged — confirmed
  // empirically against the pre-Task-4 code: loadRatio ≈0.750 vs
  // hoursRatio ≈0.860, an 0.11 gap. Now both read the same ladder fraction,
  // so the ratios agree (≈0.691 vs ≈0.696 here).
  it("scales hours on the same fraction as load, so the two no longer diverge", () => {
    const blocks = periodize({
      weeksTotal: 16,
      startingCtl: 50,
      daysPerWeek: 5,
      hoursPerWeek: 8,
      sport: "Bike",
    });
    const taper = blocks.filter((b) => b.phase === "taper");
    expect(taper.length).toBe(2);
    const mins = (b: (typeof taper)[number]) =>
      b.workouts.reduce((s, w) => s + w.durationMins, 0);

    const loadRatio = taper[1].targetLoad / taper[0].targetLoad;
    const hoursRatio = mins(taper[1]) / mins(taper[0]);
    expect(hoursRatio).toBeCloseTo(loadRatio, 1);
  });

  // Review finding (Task 4 re-review): every test above uses a 12- or
  // 16-week plan, which always yields exactly a 2-week taper —
  // `taperFractionFromEnd`'s default branch (TAPER_FRACTION_WEEK_2, the
  // "2+ weeks from the race" rung) is reachable in production
  // (round(weeksTotal * 0.15) >= 3 for weeksTotal >= 17, and weeksTotal
  // goes to 52) but was never exercised by any test. A 17-week plan is the
  // shortest that reaches it: round(17 * 0.15) = 3, clearing
  // MIN_TAPER_WEEKS (2).
  it("the third rung (2+ weeks from the race) is reached and reads the ladder correctly", () => {
    const blocks = periodize({
      weeksTotal: 17,
      startingCtl: 50,
      daysPerWeek: 5,
      hoursPerWeek: 8,
      sport: "Bike",
    });
    const taper = blocks.filter((b) => b.phase === "taper");
    expect(taper.length).toBe(3);

    // Same technique as the 2-week case above, extended to all three
    // rungs: each week's targetLoad divided back out by ITS OWN ladder
    // fraction should recover the same shared anchor. If the third rung
    // read the wrong fraction — the default branch returning, say,
    // TAPER_FRACTION_WEEK_1 by mistake — the anchor implied by the first
    // taper week would disagree with the other two.
    //
    // What this does NOT catch (Task 4 re-review, Finding 1): a swapped
    // VALUE of TAPER_FRACTION_WEEK_2 itself. Production multiplies by the
    // imported constant and this test divides back out by that SAME
    // imported constant, so if the constant's value changed, both sides
    // move together and the round-trip still recovers the same anchor —
    // the test would stay green. That is pinned separately, by literal, in
    // `race/taper.test.ts` ("TAPER_FRACTION_* ladder — pinned to literal
    // values"), the only place a swapped constant is actually caught.
    const [twoOut, oneOut, raceWeek] = taper;
    const impliedFromTwoOut = twoOut.targetLoad / TAPER_FRACTION_WEEK_2;
    const impliedFromOneOut = oneOut.targetLoad / TAPER_FRACTION_WEEK_1;
    const impliedFromRace = raceWeek.targetLoad / TAPER_FRACTION_RACE_WEEK;

    expect(Math.abs(impliedFromTwoOut - impliedFromOneOut)).toBeLessThan(3);
    expect(Math.abs(impliedFromOneOut - impliedFromRace)).toBeLessThan(3);
    expect(Math.abs(impliedFromTwoOut - impliedFromRace)).toBeLessThan(3);
  });
});

describe("EASY_RUN_CAP_MINS", () => {
  it("bounds the generator's easy runs", () => {
    // 20 hours across 6 sessions is far more than the easy-run cap can hold,
    // so every easy run the fill loop places must be pinned at the cap.
    // Filtered by description, not by type: the Thursday session is also
    // typed "Endurance" outside build/peak and is deliberately NOT capped —
    // it is sized as a fraction of the week, not by the easy-run rule.
    const workouts = generateWorkouts(6, 20, "base", "Run");
    const easy = workouts.filter((w) => w.description === "Easy aerobic run");

    expect(easy.length).toBeGreaterThan(0);
    for (const w of easy) {
      expect(w.durationMins).toBe(EASY_RUN_CAP_MINS);
    }
  });
});

describe.skipIf(!hasDb)("generateTrainingPlan — availability seeding", () => {
  const FRESH_USER = "test-seed-availability-fresh";
  const CONFIGURED_USER = "test-seed-availability-configured";

  async function cleanupUser(userId: string): Promise<void> {
    await db
      .delete(schema.weekPlans)
      .where(eq(schema.weekPlans.userId, userId));
    await db
      .delete(schema.trainingPlans)
      .where(eq(schema.trainingPlans.userId, userId));
    await db.delete(schema.races).where(eq(schema.races.userId, userId));
    await db
      .delete(schema.availabilityDefaults)
      .where(eq(schema.availabilityDefaults.userId, userId));
    await db.delete(schema.users).where(eq(schema.users.id, userId));
  }

  beforeAll(async () => {
    await cleanupUser(FRESH_USER);
    await cleanupUser(CONFIGURED_USER);
    await db.insert(schema.users).values([
      {
        id: FRESH_USER,
        name: "Fresh Seed User",
        email: `${FRESH_USER}@example.invalid`,
      },
      {
        id: CONFIGURED_USER,
        name: "Configured Seed User",
        email: `${CONFIGURED_USER}@example.invalid`,
      },
    ]);
  });

  afterAll(async () => {
    await cleanupUser(FRESH_USER);
    await cleanupUser(CONFIGURED_USER);
  });

  it("seeds a standard week — spread over daysPerWeek days, totalling roughly hoursPerWeek", async () => {
    await generateTrainingPlan({
      userId: FRESH_USER,
      raceType: "marathon",
      raceDate: "2026-12-01",
      daysPerWeek: 4,
      hoursPerWeek: 6,
    });

    const rows = await db.query.availabilityDefaults.findMany({
      where: eq(schema.availabilityDefaults.userId, FRESH_USER),
    });
    expect(rows).toHaveLength(7);

    const daysWithBlocks = rows.filter(
      (r) => (r.blocks as unknown[]).length > 0
    );
    expect(daysWithBlocks).toHaveLength(4);

    const totalMins = rows.reduce(
      (sum, r) =>
        sum + (r.blocks as { mins: number }[]).reduce((s, b) => s + b.mins, 0),
      0
    );
    // hoursPerWeek=6 -> 360 minutes, rounded to the nearest 5min per day.
    expect(totalMins).toBeGreaterThanOrEqual(350);
    expect(totalMins).toBeLessThanOrEqual(370);
  });

  it("leaves a pre-existing standard week untouched when a second plan is created", async () => {
    const customBlock = {
      start: "06:00",
      end: "06:30",
      mins: 30,
      energy: "easy",
      sports: null,
    };
    // Sunday (weekday 6) — a day generateTrainingPlan's seeding would
    // otherwise populate for daysPerWeek=5.
    await db.insert(schema.availabilityDefaults).values({
      userId: CONFIGURED_USER,
      weekday: 6,
      blocks: [customBlock],
    });

    await generateTrainingPlan({
      userId: CONFIGURED_USER,
      raceType: "marathon",
      raceDate: "2026-12-15",
      daysPerWeek: 5,
      hoursPerWeek: 8,
    });

    const row = await db.query.availabilityDefaults.findFirst({
      where: and(
        eq(schema.availabilityDefaults.userId, CONFIGURED_USER),
        eq(schema.availabilityDefaults.weekday, 6)
      ),
    });
    expect(row?.blocks).toEqual([customBlock]);
  });
});

describe("generateWorkouts dispatches on sport alone", () => {
  it("builds cycling for Bike", () => {
    const w = generateWorkouts(4, 10, "base", "Bike");
    expect(w.length).toBeGreaterThan(0);
    expect(w.every((x) => x.sport === "Bike")).toBe(true);
  });

  it("builds running for Run", () => {
    const w = generateWorkouts(4, 10, "base", "Run");
    expect(w.every((x) => x.sport === "Run")).toBe(true);
  });

  it("builds triathlon — including swim — for Triathlon", () => {
    const w = generateWorkouts(5, 10, "base", "Triathlon");
    const sports = new Set(w.map((x) => x.sport));
    expect(sports.has("Swim")).toBe(true);
    expect(sports.has("Bike")).toBe(true);
    expect(sports.has("Run")).toBe(true);
  });

  it("throws on a sport it cannot build, instead of producing running", () => {
    // The v0.42 defect in one assertion: every one of these used to return
    // a running plan. `as never` because the type now forbids them — the
    // cast proves the RUNTIME guard, for callers reaching this from JSON.
    //
    // "Ride" is deliberately NOT in this list: requirePlanSport canonicalises
    // provider words, so requirePlanSport("Ride") === "Bike" by design (see
    // plan-sport.test.ts). That is load-bearing — the live rollover calls
    // requirePlanSport(constraints.sports?.[0]), and a real production plan
    // stores constraints.sports as ["Ride"]. "Completing" this list by adding
    // "Ride" back would make that plan's weekly rollover throw.
    for (const bad of ["Swim", "Tennis", "", null]) {
      expect(() => generateWorkouts(4, 10, "base", bad as never)).toThrow(
        /unsupported plan sport/
      );
    }
  });
});

describe("periodize with two races", () => {
  const base = {
    weeksTotal: 20,
    startingCtl: 50,
    daysPerWeek: 5,
    hoursPerWeek: 8,
    sport: "Run" as const,
  };

  it("numbers every week exactly once, contiguously", () => {
    const blocks = periodize({
      ...base,
      firstRace: { weekNumber: 10, raceType: "marathon" },
    });
    const nums = blocks.map((b) => b.weekNumber);
    expect(nums).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it("puts recovery weeks immediately after the first race", () => {
    const blocks = periodize({
      ...base,
      firstRace: { weekNumber: 10, raceType: "marathon" },
    });
    // raceRecoveryDays("marathon") is 14 -> ceil(14/7) = 2 weeks
    expect(blocks[10].phase).toBe("recovery");
    expect(blocks[11].phase).toBe("recovery");
    expect(blocks[12].phase).not.toBe("recovery");
  });

  it("ends the second segment in a taper", () => {
    const blocks = periodize({
      ...base,
      firstRace: { weekNumber: 10, raceType: "marathon" },
    });
    expect(blocks[blocks.length - 1].phase).toBe("taper");
  });

  // `periodize` is Block.segment's one owner (plan-preview.ts's `buildPhases`
  // groups by it rather than recomputing the boundary) -- these three pin
  // where that value comes from directly, at the source, rather than only
  // through buildPhases's own tests.
  it("stamps every week segment 1 when the plan has no firstRace", () => {
    const blocks = periodize(base);
    expect(blocks.every((b) => b.segment === 1)).toBe(true);
  });

  it("segments arc one (plus its bridging recovery) as 1 and the rebuild arc as 2", () => {
    const blocks = periodize({
      ...base,
      firstRace: { weekNumber: 10, raceType: "marathon" },
    });
    // raceRecoveryDays("marathon") is 14 -> 2 recovery weeks, so arc one
    // (weeks 1-10) plus recovery (11-12) is segment 1, and the rebuild arc
    // (13-20) is segment 2.
    const segments = blocks.map((b) => b.segment);
    expect(segments.slice(0, 12)).toEqual(Array(12).fill(1));
    expect(segments.slice(12)).toEqual(Array(8).fill(2));
  });

  it("keeps every week at segment 1 when there is no room to rebuild", () => {
    const blocks = periodize({
      ...base,
      weeksTotal: 12,
      firstRace: { weekNumber: 10, raceType: "marathon" },
    });
    // firstRaceWeek 10 + recoveryWeeks 2 = 12 = weeksTotal: no rebuildWeeks
    // left, so there is no arc two at all -- everything stays segment 1.
    expect(blocks).toHaveLength(12);
    expect(blocks.every((b) => b.segment === 1)).toBe(true);
  });

  it("is byte-identical to today when firstRace is null", () => {
    expect(periodize({ ...base, firstRace: null })).toEqual(periodize(base));
  });

  it("rebuilds from post-race fitness, not from plan-start fitness", () => {
    // startingCtl and the week count to the first race are chosen so arc 1
    // reaches a real peak and the recovery-derived basis clears
    // MIN_WEEKLY_LOAD (100) with room to spare -- otherwise the floor, not
    // the handoff, is what the assertion below would be measuring.
    const blocks = periodize({
      weeksTotal: 30,
      startingCtl: 60,
      daysPerWeek: 5,
      hoursPerWeek: 8,
      sport: "Run" as const,
      firstRace: { weekNumber: 16, raceType: "marathon" },
    });
    const peakOfArcOne = Math.max(
      ...blocks.slice(0, 16).map((b) => b.targetLoad)
    );
    const expectedRecoveryLoad = Math.round(
      peakOfArcOne * PLAN_CONSTANTS.RECOVERY_FRACTION
    );
    // Sanity check on the scenario itself: if this doesn't clear the floor,
    // the tight assertion below would pass for the wrong reason.
    expect(expectedRecoveryLoad).toBeGreaterThan(
      PLAN_CONSTANTS.MIN_WEEKLY_LOAD
    );

    // raceRecoveryDays("marathon") is 14 -> 2 recovery weeks, so the
    // rebuild's first block sits at index 16 (arc 1) + 2 (recovery) = 18.
    const firstOfRebuild = blocks[18].targetLoad;
    // Pinned to the exact value the peak-of-arc-1 handoff implies, not a
    // loose bound -- a handoff bug that reads `opts.startingCtl` (60,
    // yielding a 420 opening load here) instead of the recovery-derived CTL
    // fails this assertion, where a loose `toBeGreaterThan` would not.
    expect(firstOfRebuild).toBeCloseTo(expectedRecoveryLoad, 0);
  });
});

describe("bridgeRoom", () => {
  it("needs 35 days between two marathons", () => {
    expect(hasBridgeRoom("marathon", "marathon", 34)).toBe(false);
    expect(hasBridgeRoom("marathon", "marathon", 35)).toBe(true);
  });
  it("needs 21 days between two halves", () => {
    expect(hasBridgeRoom("half", "half", 20)).toBe(false);
    expect(hasBridgeRoom("half", "half", 21)).toBe(true);
  });
});

describe.skipIf(!hasDb)("previewTrainingPlan — two A-races", () => {
  const USER = "test-preview-two-a-races";

  function todayYmd(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  // Far enough out that every date below (plus a generous gap) still clears
  // the 52-week horizon refusal, and far enough from "today" that a slow
  // test run doesn't nudge a boundary date across a week seam.
  const FIRST_DATE = addDaysYmd(todayYmd(), 140);

  async function cleanup(): Promise<void> {
    // trainingBlocks cascades with trainingPlans; nothing else is written
    // by previewTrainingPlan (no availability seeding, no materialized week).
    await db
      .delete(schema.trainingPlans)
      .where(eq(schema.trainingPlans.userId, USER));
    await db.delete(schema.races).where(eq(schema.races.userId, USER));
  }

  beforeAll(async () => {
    await cleanup();
    await db.delete(schema.users).where(eq(schema.users.id, USER));
    await db.insert(schema.users).values({
      id: USER,
      name: "Two A-Race User",
      email: `${USER}@example.invalid`,
    });
  });

  afterEach(cleanup);

  afterAll(async () => {
    await cleanup();
    await db.delete(schema.users).where(eq(schema.users.id, USER));
  });

  async function makeRace(opts: {
    name: string;
    raceType: string;
    date: string;
    priority?: "A" | "B" | "C";
    status?: "upcoming" | "completed" | "skipped";
  }): Promise<string> {
    const [row] = await db
      .insert(schema.races)
      .values({
        userId: USER,
        name: opts.name,
        raceType: opts.raceType,
        sport: "Run",
        date: opts.date,
        priority: opts.priority ?? "A",
        status: opts.status ?? "upcoming",
      })
      .returning();
    return row.id;
  }

  it("refuses a third race", async () => {
    const a = await makeRace({
      name: "A",
      raceType: "marathon",
      date: FIRST_DATE,
    });
    const b = await makeRace({
      name: "B",
      raceType: "marathon",
      date: addDaysYmd(FIRST_DATE, 40),
    });
    const c = await makeRace({
      name: "C",
      raceType: "marathon",
      date: addDaysYmd(FIRST_DATE, 80),
    });
    const result = await previewTrainingPlan({
      userId: USER,
      raceType: "marathon",
      raceDate: addDaysYmd(FIRST_DATE, 80),
      raceIds: [a, b, c],
    });
    expect(result).toEqual({ ok: false, reason: "too_many_races" });
  });

  it("refuses race_not_found when one of the two ids does not exist", async () => {
    const a = await makeRace({
      name: "A",
      raceType: "marathon",
      date: FIRST_DATE,
    });
    const result = await previewTrainingPlan({
      userId: USER,
      raceType: "marathon",
      raceDate: FIRST_DATE,
      raceIds: [a, "00000000-0000-0000-0000-000000000000"],
    });
    expect(result).toEqual({ ok: false, reason: "race_not_found" });
  });

  it("refuses when one target race is not A-priority", async () => {
    const a = await makeRace({
      name: "A",
      raceType: "marathon",
      date: FIRST_DATE,
    });
    const laterDate = addDaysYmd(FIRST_DATE, 60);
    const b = await makeRace({
      name: "B",
      raceType: "marathon",
      date: laterDate,
      priority: "B",
    });
    const result = await previewTrainingPlan({
      userId: USER,
      raceType: "marathon",
      raceDate: laterDate,
      raceIds: [a, b],
    });
    expect(result).toEqual({ ok: false, reason: "second_race_not_a" });
  });

  it("refuses when one target race is not upcoming", async () => {
    const a = await makeRace({
      name: "A",
      raceType: "marathon",
      date: FIRST_DATE,
    });
    const laterDate = addDaysYmd(FIRST_DATE, 60);
    const b = await makeRace({
      name: "B",
      raceType: "marathon",
      date: laterDate,
      status: "completed",
    });
    const result = await previewTrainingPlan({
      userId: USER,
      raceType: "marathon",
      raceDate: laterDate,
      raceIds: [a, b],
    });
    expect(result).toEqual({ ok: false, reason: "second_race_not_a" });
  });

  it("warns no_bridge_room when two marathons leave no room to rebuild, but still builds the plan", async () => {
    const a = await makeRace({
      name: "A",
      raceType: "marathon",
      date: FIRST_DATE,
    });
    // raceRecoveryDays("marathon") + taperWindowDays("marathon") = 14 + 21 = 35.
    const finalDate = addDaysYmd(FIRST_DATE, 34);
    const b = await makeRace({
      name: "B",
      raceType: "marathon",
      date: finalDate,
    });
    const result = await previewTrainingPlan({
      userId: USER,
      raceType: "marathon",
      raceDate: finalDate,
      raceIds: [a, b],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.preview.warnings).toContain("no_bridge_room");
  });

  it("stays silent when the gap between two marathons clears the floor", async () => {
    const a = await makeRace({
      name: "A",
      raceType: "marathon",
      date: FIRST_DATE,
    });
    const finalDate = addDaysYmd(FIRST_DATE, 35);
    const b = await makeRace({
      name: "B",
      raceType: "marathon",
      date: finalDate,
    });
    const result = await previewTrainingPlan({
      userId: USER,
      raceType: "marathon",
      raceDate: finalDate,
      raceIds: [a, b],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.preview.warnings).not.toContain("no_bridge_room");
  });

  it("names the earlier date as first regardless of raceIds order, and writes it onto the draft", async () => {
    const earlierDate = FIRST_DATE;
    const laterDate = addDaysYmd(FIRST_DATE, 60);
    const a = await makeRace({
      name: "Earlier",
      raceType: "half_marathon",
      date: earlierDate,
    });
    const b = await makeRace({
      name: "Later",
      raceType: "marathon",
      date: laterDate,
    });

    // ids passed in reverse (later first) -- proves sort-by-date, not arg order.
    const result = await previewTrainingPlan({
      userId: USER,
      raceType: "marathon",
      raceDate: laterDate,
      raceIds: [b, a],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.preview.race.id).toBe(b);
    expect(result.preview.race.date).toBe(laterDate);

    const draft = await db.query.trainingPlans.findFirst({
      where: eq(schema.trainingPlans.id, result.preview.planId),
    });
    expect(draft?.firstRaceId).toBe(a);
    expect(draft?.firstRaceDate).toBe(earlierDate);
    expect(draft?.firstRaceType).toBe("half_marathon");
    expect(draft?.raceId).toBe(b);
    expect(draft?.raceDate).toBe(laterDate);
  });

  // `previewTrainingPlan`'s `phases` come from `blocks` (periodize's live
  // return value, segment included for free); `previewFromDraft`'s come from
  // persisted `training_blocks` rows, which have no `segment` column, so it
  // re-derives the boundary instead (see its comment). This proves that
  // re-derivation lands on exactly the same rows as the live computation
  // did, for a real two-arc plan -- not an approximation of it.
  it("previewFromDraft reconstructs the same per-arc phases from persisted training_blocks", async () => {
    const earlierDate = FIRST_DATE;
    const laterDate = addDaysYmd(FIRST_DATE, 200);
    const a = await makeRace({
      name: "Earlier",
      raceType: "marathon",
      date: earlierDate,
    });
    const b = await makeRace({
      name: "Later",
      raceType: "marathon",
      date: laterDate,
    });

    const result = await previewTrainingPlan({
      userId: USER,
      raceType: "marathon",
      raceDate: laterDate,
      raceIds: [a, b],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");

    // A genuine two-arc scenario, not a no-room boundary case where the
    // rebuild arc is empty -- otherwise both sides collapsing to all-segment-1
    // would pass this test for the wrong reason.
    expect(result.preview.phases.some((row) => row.segment === 2)).toBe(true);

    const draft = await db.query.trainingPlans.findFirst({
      where: eq(schema.trainingPlans.id, result.preview.planId),
    });
    expect(draft).toBeTruthy();
    if (!draft) return;

    const rehydrated = await previewFromDraft(draft);
    expect(rehydrated.phases).toEqual(result.preview.phases);
  });

  // FIX 3: `demand` (assembleWeeklyTarget -> volume-inputs.ts) resolves to
  // "highest priority, then nearest date" among the athlete's races -- race
  // ONE on a two-race plan. `weeksTotal`/`draft.raceDate` name the FINAL
  // target (race two). Scoring race one's demand against race two's
  // horizon is systematically optimistic. `feasibilityFor` is spied on
  // (not mocked -- it still runs for real) purely to inspect what
  // `weeksUntilEvent` each call site actually passed it, since neither
  // `PlanPreview.feasibility` nor its warnings surface that raw number.
  describe("feasibility horizon (FIX 3)", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("previewTrainingPlan assesses feasibility against race one's horizon on a two-race plan", async () => {
      const earlierDate = FIRST_DATE;
      const laterDate = addDaysYmd(FIRST_DATE, 200);
      const a = await makeRace({
        name: "Earlier",
        raceType: "marathon",
        date: earlierDate,
      });
      const b = await makeRace({
        name: "Later",
        raceType: "marathon",
        date: laterDate,
      });

      const spy = vi.spyOn(feasibilityModule, "feasibilityFor");
      const result = await previewTrainingPlan({
        userId: USER,
        raceType: "marathon",
        raceDate: laterDate,
        raceIds: [a, b],
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected ok");
      expect(spy).toHaveBeenCalledTimes(1);
      const weeksUntilEvent = spy.mock.calls[0][0].weeksUntilEvent as number;

      // `result.preview.weeksTotal` is the plan's own length, always
      // spanning to the FINAL target (race two, ~200 days after race one).
      // Before the fix, `weeksUntilEvent` WAS `weeksTotal` -- race two's
      // horizon. Race one is strictly earlier, so the fixed value must be
      // strictly less.
      expect(weeksUntilEvent).toBeLessThan(result.preview.weeksTotal);
      // FIRST_DATE is 140 days out (~20 weeks); pin a tolerant band around
      // that rather than the exact day count, so the assertion doesn't
      // couple to test-run time-of-day. Race two alone (~340 days, ~49
      // weeks) sits far outside this band, so this also rules out the
      // pre-fix value landing here by coincidence.
      expect(weeksUntilEvent).toBeGreaterThanOrEqual(18);
      expect(weeksUntilEvent).toBeLessThanOrEqual(22);
    });

    it("previewFromDraft assesses feasibility against race one's horizon on a two-race plan", async () => {
      const earlierDate = FIRST_DATE;
      const laterDate = addDaysYmd(FIRST_DATE, 200);
      const a = await makeRace({
        name: "Earlier",
        raceType: "marathon",
        date: earlierDate,
      });
      const b = await makeRace({
        name: "Later",
        raceType: "marathon",
        date: laterDate,
      });
      const created = await previewTrainingPlan({
        userId: USER,
        raceType: "marathon",
        raceDate: laterDate,
        raceIds: [a, b],
      });
      expect(created.ok).toBe(true);
      if (!created.ok) throw new Error("expected ok");
      const draft = await db.query.trainingPlans.findFirst({
        where: eq(schema.trainingPlans.id, created.preview.planId),
      });
      expect(draft).toBeTruthy();
      if (!draft) return;

      const spy = vi.spyOn(feasibilityModule, "feasibilityFor");
      const rehydrated = await previewFromDraft(draft);
      expect(spy).toHaveBeenCalledTimes(1);
      const weeksUntilEvent = spy.mock.calls[0][0].weeksUntilEvent as number;

      expect(weeksUntilEvent).toBeLessThan(rehydrated.weeksTotal);
      expect(weeksUntilEvent).toBeGreaterThanOrEqual(18);
      expect(weeksUntilEvent).toBeLessThanOrEqual(22);
    });

    it("FIX 3 control: a single-race plan's feasibility horizon is unaffected (previewTrainingPlan)", async () => {
      const raceDate = FIRST_DATE;
      const spy = vi.spyOn(feasibilityModule, "feasibilityFor");
      const result = await previewTrainingPlan({
        userId: USER,
        raceType: "marathon",
        raceDate,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected ok");
      expect(spy).toHaveBeenCalledTimes(1);
      const weeksUntilEvent = spy.mock.calls[0][0].weeksUntilEvent as number;
      // No first target: race one IS the final race, so this must stay
      // exactly the plan's own horizon -- byte-identical to before FIX 3.
      expect(weeksUntilEvent).toBe(result.preview.weeksTotal);
    });

    it("FIX 3 control: a single-race plan's feasibility horizon is unaffected (previewFromDraft)", async () => {
      const raceDate = FIRST_DATE;
      const created = await previewTrainingPlan({
        userId: USER,
        raceType: "marathon",
        raceDate,
      });
      expect(created.ok).toBe(true);
      if (!created.ok) throw new Error("expected ok");
      const draft = await db.query.trainingPlans.findFirst({
        where: eq(schema.trainingPlans.id, created.preview.planId),
      });
      expect(draft).toBeTruthy();
      if (!draft) return;

      const spy = vi.spyOn(feasibilityModule, "feasibilityFor");
      const rehydrated = await previewFromDraft(draft);
      expect(spy).toHaveBeenCalledTimes(1);
      const weeksUntilEvent = spy.mock.calls[0][0].weeksUntilEvent as number;
      expect(weeksUntilEvent).toBe(rehydrated.weeksTotal);
    });
  });
});

describe("periodize clamps an out-of-range firstRace.weekNumber", () => {
  it.each([-5, 0, 1, 20, 25])(
    "still produces exactly weeksTotal blocks, numbered 1..weeksTotal, for weekNumber=%i",
    (weekNumber) => {
      const blocks = periodize({
        weeksTotal: 20,
        startingCtl: 50,
        daysPerWeek: 5,
        hoursPerWeek: 8,
        sport: "Run" as const,
        firstRace: { weekNumber, raceType: "marathon" },
      });
      expect(blocks.length).toBe(20);
      expect(blocks.map((b) => b.weekNumber)).toEqual(
        Array.from({ length: 20 }, (_, i) => i + 1)
      );
    }
  );
});
