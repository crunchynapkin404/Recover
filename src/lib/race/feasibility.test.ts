import { describe, expect, it } from "vitest";
import {
  assessFeasibility,
  FEASIBILITY_CONSTANTS,
  feasibilityFor,
  type Feasibility,
} from "./feasibility";
import type { EventDemandResult } from "@/lib/race/demand";

const base = {
  requiredWeeklyHours: 11,
  currentWeeklyHours: 8.9,
  queenStageHours: 7,
  queenStageKnown: true,
  longestSessionHours: 5,
  weeksUntilEvent: 8,
};

describe("assessFeasibility", () => {
  it("says ready when both requirements are already met", () => {
    const r = assessFeasibility({
      ...base,
      currentWeeklyHours: 12,
      longestSessionHours: 7,
    })!;
    expect(r.verdict).toBe("ready");
  });

  it("says on track when the plan closes both gaps in time", () => {
    const r = assessFeasibility(base)!;
    expect(r.verdict).toBe("on_track");
    expect(r.volumeWeeksNeeded).toBeGreaterThan(0);
  });

  it("says not realistic when the gap cannot close in time", () => {
    const r = assessFeasibility({
      ...base,
      currentWeeklyHours: 2,
      longestSessionHours: 1,
      weeksUntilEvent: 3,
    })!;
    expect(r.verdict).toBe("not_realistic");
  });

  it("says tight when it closes with no margin", () => {
    // Needs exactly the weeks available, within the tight band.
    const r = assessFeasibility({
      ...base,
      currentWeeklyHours: 6,
      longestSessionHours: 3.6,
      weeksUntilEvent: 4,
    })!;
    expect(["tight", "not_realistic"]).toContain(r.verdict);
  });

  it("judges longest ride separately from volume", () => {
    // Volume is already satisfied (14h against 11h required), so the ONLY
    // thing in deficit is the longest ride. That softens the verdict one
    // step, from "ready" to "on_track" -- it does not condemn the event.
    // LONGEST_RIDE_FRACTION is the weakest constant in this feature and the
    // sources flatly contradict each other, so it is deliberately not allowed
    // to produce "not_realistic" on its own. See spec §1.6.
    const r = assessFeasibility({
      ...base,
      currentWeeklyHours: 14,
      longestSessionHours: 1.5,
      weeksUntilEvent: 2,
    })!;
    expect(r.verdict).toBe("on_track");
    expect(r.longestSessionWeeksNeeded).toBeGreaterThan(r.weeksUntilEvent);
  });

  it("requires only a fraction of the queen stage, not all of it", () => {
    const r = assessFeasibility(base)!;
    expect(r.requiredLongestSessionHours).toBeCloseTo(
      7 * FEASIBILITY_CONSTANTS.LONGEST_RIDE_FRACTION,
      5
    );
  });

  it("flags reasoning from an average day when stages are unknown", () => {
    const r = assessFeasibility({ ...base, queenStageKnown: false })!;
    expect(r.fromAverageDay).toBe(true);
  });

  it("returns null rather than a verdict without measured history", () => {
    expect(
      assessFeasibility({
        ...base,
        currentWeeklyHours: null,
        longestSessionHours: null,
      })
    ).toBeNull();
  });

  it("does not divide by zero when the event is this week", () => {
    const r = assessFeasibility({ ...base, weeksUntilEvent: 0 })!;
    expect(Number.isFinite(r.volumeWeeksNeeded)).toBe(true);
  });

  it("floors ride-gap softening at tight, even from an already-tight verdict", () => {
    // The one case where the floor actually does anything. Both the other
    // ride-gap tests start from "ready", where capping at "tight" versus
    // allowing "not_realistic" makes no observable difference — so removing
    // the cap passes them both. Volume here is genuinely tight AND the ride
    // gap is severe; only volume may reach the worst rung.
    const f = assessFeasibility({
      ...base,
      currentWeeklyHours: 6,
      longestSessionHours: 0.1,
      weeksUntilEvent: 4,
    })!;
    expect(f.verdict).toBe("tight");
    expect(f.longestSessionWeeksNeeded).toBeGreaterThan(f.weeksUntilEvent);
  });

  it("never lets a longest-ride gap alone condemn an event", () => {
    // Volume fully satisfied, longest ride absurdly short. Even at the
    // extreme, a contested rule must not reach the worst rung by itself.
    const r = assessFeasibility({
      ...base,
      requiredWeeklyHours: 8,
      currentWeeklyHours: 20,
      queenStageHours: 9,
      queenStageKnown: true,
      longestSessionHours: 0.5,
      weeksUntilEvent: 1,
    })!;
    expect(r.verdict).not.toBe("not_realistic");
  });
});

const OK_DEMAND = {
  available: true as const,
  weeklyHours: 10,
  queenStageHours: 5,
  queenStageKnown: true,
  totalHours: 8,
  dailyRateHours: 5,
  source: "computed" as const,
  confidence: "medium" as const,
  confidenceReason: "modelled",
};

describe("feasibilityFor", () => {
  it("says which input is missing when there is no usable demand", () => {
    const f = feasibilityFor({
      demand: null,
      currentWeeklyHours: 8,
      longestSessionHours: 3,
      weeksUntilEvent: 12,
    });
    expect(f.available).toBe(false);
    if (f.available) return;
    expect(f.kind).toBe("missing_input");
    if (f.kind !== "missing_input") return;
    expect(f.needs).toContain("demand");
  });

  it("distinguishes a missing race date from missing demand", () => {
    const f = feasibilityFor({
      demand: OK_DEMAND,
      currentWeeklyHours: 8,
      longestSessionHours: 3,
      weeksUntilEvent: null,
    });
    expect(f.available).toBe(false);
    if (f.available) return;
    expect(f.kind).toBe("missing_input");
    if (f.kind !== "missing_input") return;
    expect(f.needs).toContain("race date");
  });

  it("distinguishes missing training history from both of the above", () => {
    const f = feasibilityFor({
      demand: OK_DEMAND,
      currentWeeklyHours: null,
      longestSessionHours: 3,
      weeksUntilEvent: 12,
    });
    expect(f.available).toBe(false);
    if (f.available) return;
    expect(f.kind).toBe("missing_input");
    if (f.kind !== "missing_input") return;
    expect(f.needs).toContain("training history");
  });

  it("returns the verdict with low confidence when everything is present", () => {
    const f = feasibilityFor({
      demand: OK_DEMAND,
      currentWeeklyHours: 8,
      longestSessionHours: 3,
      weeksUntilEvent: 12,
    });
    expect(f.available).toBe(true);
    if (!f.available) return;
    expect(f.confidence).toBe("low");
    expect(f.value.weeksUntilEvent).toBe(12);
  });
});

// ---------------------------------------------------------------------------
// Permanent pin: feasibilityFor() must never disagree with the three inline
// guards it replaced. Commit 191d3aa moved training-plan.ts's two call sites
// (previewTrainingPlan, previewFromDraft) and train/page.tsx's one call site
// (WeekTab) onto feasibilityFor(), on the promise that this was pure plumbing
// and no verdict would change value for a real athlete.
//
// That commit's own review caught two problems with how it had proven itself
// safe. First, the equivalence test it actually ran was written, run, and
// then DELETED before committing -- so nothing in the tree demonstrates the
// claim once the branch is read again later. Second, the report describing
// that deleted test contradicted its own numbers ("10 input cases per site"
// times 3 sites is 30, not the "21 test cases total" the same paragraph
// claims), which is reason enough not to trust the count even as history.
// What survived into the permanent suite was tests/race-card-surfaces.test.ts
// asserting the source TEXT of each call site contains the string
// "feasibilityFor(" and does not contain "assessFeasibility(". That proves
// the call was made. It proves nothing about what was passed to it -- a
// future edit that swapped two fields of the assessFeasibility input (say,
// requiredWeeklyHours and currentWeeklyHours) would still contain that
// string, still pass that guard, and still quietly change verdicts for real
// athletes.
//
// This block is the durable replacement. It reconstructs each pre-migration
// guard verbatim from `git show 6044ac4:src/lib/training-plan.ts` and
// `git show 6044ac4:src/app/train/page.tsx` -- read from the actual
// pre-migration commit, not from memory of what it looked like -- and
// asserts feasibilityFor() produces exactly the same answer, case for case,
// permanently. These are pure functions: no database, no clock, nothing to
// gate. It belongs in the default suite, where a broken field mapping fails
// the build rather than waiting for an athlete to notice their verdict
// changed.
//
// Deliberately out of scope here: the Infinity-weeks-needed edge case and
// weeksUntilEvent = 0 are already pinned above, against assessFeasibility
// directly ("does not divide by zero...", "floors ride-gap softening...").
// Repeating them through both old guards here would test the same arithmetic
// a second time without covering any additional migration risk.
// ---------------------------------------------------------------------------
describe("feasibilityFor agrees with the inline guards it replaced", () => {
  /**
   * Reconstructed from `git show 6044ac4:src/lib/training-plan.ts`.
   * `previewTrainingPlan` and `previewFromDraft` wrote this exact guard --
   * identical shape, identical field mapping -- differing only in which
   * local variable (`weeksTotal` vs. `weeksUntilRace`) fed `weeksUntilEvent`,
   * which is irrelevant to the guard's behaviour, so one reconstruction
   * covers both call sites. Neither call site could ever pass a null
   * `weeksUntilEvent`: both compute it synchronously as a week count before
   * this guard runs, which is why -- unlike the Train guard below -- it
   * never carried a null check for it. The parameter type below says so
   * directly: `weeksUntilEvent: number`, not `number | null`.
   */
  function oldTrainingPlanGuard(input: {
    demand: EventDemandResult | null;
    currentWeeklyHours: number | null;
    longestSessionHours: number | null;
    weeksUntilEvent: number;
  }): Feasibility | null {
    const { demand } = input;
    return demand == null || !demand.available
      ? null
      : assessFeasibility({
          requiredWeeklyHours: demand.weeklyHours,
          currentWeeklyHours: input.currentWeeklyHours,
          queenStageHours: demand.queenStageHours,
          queenStageKnown: demand.queenStageKnown,
          longestSessionHours: input.longestSessionHours,
          weeksUntilEvent: input.weeksUntilEvent,
        });
  }

  /**
   * Reconstructed from `git show 6044ac4:src/app/train/page.tsx` (`WeekTab`).
   * The one call site where `weeksUntilEvent` really could be null -- Train
   * can render a target race that has no date yet -- so this is the only one
   * of the three original guards with a third OR clause, and the only one
   * whose parameter type allows `weeksUntilEvent: number | null`.
   */
  function oldTrainPageGuard(input: {
    demand: EventDemandResult | null;
    currentWeeklyHours: number | null;
    longestSessionHours: number | null;
    weeksUntilEvent: number | null;
  }): Feasibility | null {
    const { demand, weeksUntilEvent } = input;
    return demand == null || !demand.available || weeksUntilEvent == null
      ? null
      : assessFeasibility({
          requiredWeeklyHours: demand.weeklyHours,
          currentWeeklyHours: input.currentWeeklyHours,
          queenStageHours: demand.queenStageHours,
          queenStageKnown: demand.queenStageKnown,
          longestSessionHours: input.longestSessionHours,
          weeksUntilEvent,
        });
  }

  /**
   * Every pre-migration call site collapsed the old guard's result to plain
   * `Feasibility | null` -- and two of them (both in training-plan.ts) still
   * do, immediately after calling feasibilityFor(); only Train itself keeps
   * the Figure to render a stated reason. Mirroring that same collapse here
   * is what makes `toNullable(feasibilityFor(x))` comparable to
   * `oldTrainingPlanGuard(x)` / `oldTrainPageGuard(x)` at all.
   */
  function toNullable(
    figure: ReturnType<typeof feasibilityFor>
  ): Feasibility | null {
    return figure.available ? figure.value : null;
  }

  /** A demand fixture varying only the two fields assessFeasibility actually
   *  reads off it (weeklyHours, queenStageHours) -- the rest exist only to
   *  satisfy EventDemandResult's shape and have no bearing on the verdict. */
  function demandOf(
    weeklyHours: number,
    queenStageHours: number
  ): EventDemandResult {
    return {
      available: true,
      weeklyHours,
      queenStageHours,
      queenStageKnown: true,
      totalHours: weeklyHours,
      dailyRateHours: queenStageHours,
      source: "computed",
      confidence: "medium",
      confidenceReason: "test fixture",
    };
  }

  const UNAVAILABLE_DEMAND: EventDemandResult = {
    available: false,
    reason: "no_cycling_anchor",
  };

  // One case per rung. Each is chosen so volume alone drives the verdict --
  // no longest-session softening in play -- and so the rung is unambiguous:
  // unlike this file's own "tight" example under assessFeasibility above
  // (which deliberately accepts either "tight" or "not_realistic"), each of
  // these lands on exactly one named rung, checked against the real formula
  // by hand before being written down here, not eyeballed.
  const READY_CASE = {
    demand: demandOf(10, 6),
    currentWeeklyHours: 12,
    longestSessionHours: 6,
    weeksUntilEvent: 10,
  };
  // Same numbers as this file's own `base` fixture above, which is already
  // known (by the existing "on track" test) to land on "on_track". Reused
  // again, unchanged, as the field-mapping-swap case further down: current
  // (8.9h) sits safely below required (11h), which is exactly what makes it
  // sensitive to the two being swapped.
  const ON_TRACK_CASE = {
    demand: demandOf(11, 7),
    currentWeeklyHours: 8.9,
    longestSessionHours: 5,
    weeksUntilEvent: 8,
  };
  const TIGHT_CASE = {
    demand: demandOf(11, 5),
    currentWeeklyHours: 7,
    longestSessionHours: 5,
    weeksUntilEvent: 4,
  };
  const NOT_REALISTIC_CASE = {
    demand: demandOf(11, 7),
    currentWeeklyHours: 2,
    longestSessionHours: 1,
    weeksUntilEvent: 3,
  };

  it("agrees on 'ready' with both old guards", () => {
    const viaFeasibilityFor = toNullable(feasibilityFor(READY_CASE));
    expect(viaFeasibilityFor?.verdict).toBe("ready");
    expect(viaFeasibilityFor).toEqual(oldTrainingPlanGuard(READY_CASE));
    expect(viaFeasibilityFor).toEqual(oldTrainPageGuard(READY_CASE));
  });

  it("agrees on 'on_track' with both old guards", () => {
    const viaFeasibilityFor = toNullable(feasibilityFor(ON_TRACK_CASE));
    expect(viaFeasibilityFor?.verdict).toBe("on_track");
    expect(viaFeasibilityFor).toEqual(oldTrainingPlanGuard(ON_TRACK_CASE));
    expect(viaFeasibilityFor).toEqual(oldTrainPageGuard(ON_TRACK_CASE));
  });

  it("agrees on 'tight' with both old guards", () => {
    const viaFeasibilityFor = toNullable(feasibilityFor(TIGHT_CASE));
    expect(viaFeasibilityFor?.verdict).toBe("tight");
    expect(viaFeasibilityFor).toEqual(oldTrainingPlanGuard(TIGHT_CASE));
    expect(viaFeasibilityFor).toEqual(oldTrainPageGuard(TIGHT_CASE));
  });

  it("agrees on 'not_realistic' with both old guards", () => {
    const viaFeasibilityFor = toNullable(feasibilityFor(NOT_REALISTIC_CASE));
    expect(viaFeasibilityFor?.verdict).toBe("not_realistic");
    expect(viaFeasibilityFor).toEqual(oldTrainingPlanGuard(NOT_REALISTIC_CASE));
    expect(viaFeasibilityFor).toEqual(oldTrainPageGuard(NOT_REALISTIC_CASE));
  });

  // The three ways a verdict can be missing. Each is its own named reason in
  // feasibilityFor's Figure today; all three collapsed to the same `null`
  // before commit 191d3aa. All three old call sites agreed on that `null` --
  // feasibilityFor must still agree with them once its Figure is unwrapped.
  it("agrees there is no verdict when there is no demand at all", () => {
    const input = {
      demand: null,
      currentWeeklyHours: 8,
      longestSessionHours: 4,
      weeksUntilEvent: 10,
    };
    expect(toNullable(feasibilityFor(input))).toBeNull();
    expect(oldTrainingPlanGuard(input)).toBeNull();
    expect(oldTrainPageGuard(input)).toBeNull();
  });

  it("agrees there is no verdict when demand exists but refused to price", () => {
    const input = {
      demand: UNAVAILABLE_DEMAND,
      currentWeeklyHours: 8,
      longestSessionHours: 4,
      weeksUntilEvent: 10,
    };
    expect(toNullable(feasibilityFor(input))).toBeNull();
    expect(oldTrainingPlanGuard(input)).toBeNull();
    expect(oldTrainPageGuard(input)).toBeNull();
  });

  it("agrees there is no verdict when there is demand but no race date -- Train's own extra clause", () => {
    // Only ever exercised at the Train call site: previewTrainingPlan and
    // previewFromDraft always compute a real week count before reaching this
    // guard, so there is no oldTrainingPlanGuard comparison in this one case
    // -- that function's own parameter type (`weeksUntilEvent: number`, not
    // `number | null`) reflects that it was never asked this question, and
    // passing null to it here would not even typecheck.
    const input = {
      demand: demandOf(11, 7),
      currentWeeklyHours: 8,
      longestSessionHours: 4,
      weeksUntilEvent: null,
    };
    expect(toNullable(feasibilityFor(input))).toBeNull();
    expect(oldTrainPageGuard(input)).toBeNull();
  });

  it("agrees there is no verdict when there is demand and a date but no measured training history", () => {
    const input = {
      demand: demandOf(11, 7),
      currentWeeklyHours: null,
      longestSessionHours: null,
      weeksUntilEvent: 8,
    };
    expect(toNullable(feasibilityFor(input))).toBeNull();
    expect(oldTrainingPlanGuard(input)).toBeNull();
    expect(oldTrainPageGuard(input)).toBeNull();
  });

  // The field-mapping case this whole block exists for. Everything above
  // proves feasibilityFor agrees with the old guards for a spread of
  // realistic values -- but agreement alone does not prove the test would
  // actually CATCH a mapping mistake. If requiredWeeklyHours and
  // currentWeeklyHours happened to be equal in every case above, swapping
  // the two would be invisible to every assertion here, and this whole block
  // would be exactly as blind as the lexical `toContain("feasibilityFor(")`
  // check it exists to replace.
  //
  // ON_TRACK_CASE is deliberately not that: currentWeeklyHours (8.9) sits
  // below requiredWeeklyHours (11), so a mapping bug that swapped the two
  // arguments inside feasibilityFor's call to assessFeasibility would change
  // the verdict from "on_track" (needs to grow into the requirement) to
  // "ready" (already exceeds it, read backwards). Confirmed by hand, not
  // just argued: temporarily swapping `requiredWeeklyHours:
  // input.demand.weeklyHours` and `currentWeeklyHours:
  // input.currentWeeklyHours` inside feasibilityFor (src/lib/race/feasibility.ts)
  // made this exact assertion fail, then the swap was reverted -- see the
  // v0.87 fix report (.superpowers/sdd/v087/task-7-report.md) for the
  // transcript. This is the test that would actually catch that mistake;
  // tests/race-card-surfaces.test.ts's source-text check would not.
  it("would fail if feasibilityFor ever swapped requiredWeeklyHours and currentWeeklyHours", () => {
    const viaFeasibilityFor = toNullable(feasibilityFor(ON_TRACK_CASE));
    expect(viaFeasibilityFor?.verdict).toBe("on_track");
    expect(viaFeasibilityFor).toEqual(oldTrainingPlanGuard(ON_TRACK_CASE));
    expect(viaFeasibilityFor).toEqual(oldTrainPageGuard(ON_TRACK_CASE));
  });
});
