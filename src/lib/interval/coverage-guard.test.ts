import { describe, it, expect } from "vitest";
import { LIBRARY } from "./library";
import { flexSpanSecs } from "./flex";
import type { LibraryPurpose } from "./types";
import {
  RED_ENDURANCE_SCALE,
  AMBER_SCALE,
  RED_RECOVERY_MINS,
  QUALITY_TYPES,
  STEP_DOWN,
} from "@/lib/week-plan/types";
import { PURPOSE_FLOORS } from "@/lib/availability/types";
import {
  TRI_SPLIT,
  TRI_SECONDARY_FRACTION,
} from "@/lib/plan-distribution-constants";
import { workoutForDay } from "./for-day";
import { PURPOSE_BY_TYPE } from "@/lib/training-plan";

/**
 * How far the library is required to cover each purpose. NOT the full
 * reachable range: redistribution makes a 270-minute vo2max day and a
 * 450-minute recovery day technically reachable, and hand-authoring a
 * four-and-a-half-hour VO2max session to satisfy a guard would be the guard
 * driving the coaching. Above the ceiling the day keeps today's prose and
 * band, which the spec calls the honest path rather than a gap.
 *
 * Source: coaching convention, chosen by the athlete/owner. Confidence: Low.
 * What would raise it: nothing available — it is a judgement about what is
 * worth authoring, not a measurable quantity.
 */
const COVER: Record<LibraryPurpose, [number, number]> = {
  recovery: [20, 90],
  aerobic_base: [21, 210],
  long: [48, 300],
  threshold: [27, 120],
  vo2max: [32, 120],
};

/**
 * The size decision 2 of the spec states, asserted rather than remembered.
 * Source: the athlete/owner, in conversation, before the design. Confidence:
 * n/a — it is a decision, not a measurement.
 */
const LIBRARY_TARGET = 100;

/**
 * The lowest family count any covered minute currently has. A ratchet on what
 * was reached, not a judgement about what is enough.
 */
const FAMILY_RATCHET = 4;

/** The type each library purpose is planned as, inverted from PURPOSE_BY_TYPE. */
function typeFor(purpose: LibraryPurpose): string {
  const hit = Object.entries(PURPOSE_BY_TYPE).find(([, p]) => p === purpose);
  if (!hit) throw new Error(`no type maps to purpose ${purpose}`);
  return hit[0];
}

const isQualityPurpose = (p: LibraryPurpose): boolean =>
  (QUALITY_TYPES as readonly string[]).includes(typeFor(p));

describe("the reachable-duration model", () => {
  it("treats exactly the quality purposes as quality", () => {
    // isQuality keys off `type`, not purpose. Getting this backwards is what
    // put a 67-minute threshold day in the spec twice.
    expect(isQualityPurpose("threshold")).toBe(true);
    expect(isQualityPurpose("vo2max")).toBe(true);
    expect(isQualityPurpose("aerobic_base")).toBe(false);
    expect(isQualityPurpose("long")).toBe(false);
    expect(isQualityPurpose("recovery")).toBe(false);
  });

  it("sends every quality purpose one step down, to a purpose the library also answers", () => {
    // Amber changes the purpose as well as the length, so a stepped-down
    // session lands in ANOTHER purpose's coverage range.
    expect(PURPOSE_BY_TYPE[STEP_DOWN[typeFor("vo2max")]]).toBe("threshold");
    expect(PURPOSE_BY_TYPE[STEP_DOWN[typeFor("threshold")]]).toBe(
      "aerobic_base"
    );
  });

  it("scales only non-quality purposes on red, and replaces the rest", () => {
    // A red quality day becomes a RED_RECOVERY_MINS recovery ride; it never
    // becomes a shorter session of its own purpose.
    expect(RED_ENDURANCE_SCALE).toBeLessThan(1);
    expect(AMBER_SCALE).toBeLessThan(1);
    expect(RED_RECOVERY_MINS).toBe(30);
    expect(COVER.recovery[0]).toBeLessThanOrEqual(RED_RECOVERY_MINS);
    expect(COVER.recovery[1]).toBeGreaterThanOrEqual(RED_RECOVERY_MINS);
  });
});

describe("the availability path, which sets duration directly", () => {
  it("covers each purpose down to the floor compression respects", () => {
    // READINESS IS NOT THE ONLY THING THAT SETS A DURATION, and an earlier
    // reading of this guard implied it was. `fitToBlock` (week-plan/slots.ts)
    // compresses a session to EXACTLY the room its availability block has —
    // an arbitrary integer — whenever that room is at least the purpose's
    // floor, and substitutes down SUBSTITUTE_TO when it is not. `fill.ts`
    // grows and adds sessions the same way, refusing anything under the floor
    // (`if (mins < PURPOSE_FLOORS[purpose]) continue`).
    //
    // So every integer from a purpose's floor upward is reachable, directly,
    // without any readiness event at all — and it is probably the commonest
    // source of odd durations in practice. That makes PURPOSE_FLOORS the real
    // lower bound the library must reach, not a number typed by hand: this
    // caught COVER.recovery starting at 21 when compression can produce 20.
    for (const [purpose, [lo]] of Object.entries(COVER) as [
      LibraryPurpose,
      [number, number],
    ][]) {
      expect(
        lo,
        `${purpose} is covered from ${lo} but compression reaches ${PURPOSE_FLOORS[purpose]}`
      ).toBeLessThanOrEqual(PURPOSE_FLOORS[purpose]);
    }
  });
});

describe("a triathlon plan's bike sessions", () => {
  // THE COVERAGE MODEL WAS DERIVED FROM THE CYCLING GENERATOR ALONE, twice
  // over, and a triathlon plan sizes its bike days by entirely different
  // fractions: the Sunday long ride is round(totalMins * TRI_SPLIT.bike * 0.5)
  // and the Thursday interval day is round(... * TRI_SECONDARY_FRACTION).
  // Neither appears anywhere in the reasoning behind COVER.
  //
  // These durations are DERIVED here from the same constants the generator
  // uses, not typed in, so the day this split changes the assertion moves with
  // it. What is pinned is which volumes the library answers and which it
  // refuses — refusal being the honest path, but a silent change in WHICH days
  // fall back to prose is not something to discover from an athlete.
  const triBike = (hours: number) => {
    const bike = hours * 60 * TRI_SPLIT.bike;
    return {
      long: Math.round(bike * 0.5),
      secondary: Math.round(bike * TRI_SECONDARY_FRACTION),
    };
  };
  const answers = (purpose: "long" | "vo2max" | "aerobic_base", m: number) =>
    workoutForDay({ sport: "Bike", purpose, durationMins: m }, "2026-09-01") !==
    null;

  it("answers the long ride from 4 h/week upward", () => {
    expect(answers("long", triBike(3).long)).toBe(false); // 36 min
    for (let h = 4; h <= 20; h++) {
      expect(answers("long", triBike(h).long), `${h} h/week`).toBe(true);
    }
  });

  it("refuses the interval day at both ends, and says why here", () => {
    // Below: a 3 h/week triathlete's bike-interval day is 22 minutes, under
    // vo2max's own PURPOSE_FLOORS value of 40 — the generator does not clamp
    // to it. Above: at 17 h/week and beyond it reaches 122-144 minutes, past
    // the 120 this library covers.
    //
    // The ceiling is NOT raised to swallow those. A 144-minute session the
    // engine labels vo2max is an endurance ride with intervals in it, and
    // authoring one so a guard goes green would be the guard driving the
    // coaching — the thing the ceiling exists to prevent. Those days keep
    // today's prose and band, which the spec calls the honest path.
    expect(triBike(3).secondary).toBeLessThan(PURPOSE_FLOORS.vo2max);
    expect(answers("vo2max", triBike(3).secondary)).toBe(false);
    for (let h = 4; h <= 16; h++) {
      expect(answers("vo2max", triBike(h).secondary), `${h} h/week`).toBe(true);
    }
    for (let h = 17; h <= 20; h++) {
      expect(answers("vo2max", triBike(h).secondary), `${h} h/week`).toBe(
        false
      );
    }
  });

  it("answers that same day at every volume when it is endurance, not intervals", () => {
    // Outside build and peak the Thursday bike is Endurance, and aerobic_base
    // covers 21-210 — so the refusals above are a property of the vo2max
    // ceiling, not of the triathlon split.
    for (let h = 3; h <= 20; h++) {
      expect(answers("aerobic_base", triBike(h).secondary), `${h} h/week`).toBe(
        true
      );
    }
  });
});

describe("library coverage", () => {
  it("covers every minute of every purpose it answers, with no holes", () => {
    for (const [purpose, [lo, hi]] of Object.entries(COVER) as [
      LibraryPurpose,
      [number, number],
    ][]) {
      const mine = LIBRARY.filter((w) => w.purpose === purpose);
      if (mine.length === 0) continue; // not authored yet; Task 3 closes this
      const covered = new Set<number>();
      for (const w of mine) {
        const span = flexSpanSecs(w);
        expect(span, `${w.id} has no flexable step`).not.toBeNull();
        for (
          let m = Math.ceil(span!.lo / 60);
          m <= Math.floor(span!.hi / 60);
          m++
        ) {
          covered.add(m);
        }
      }
      const gaps: number[] = [];
      for (let m = lo; m <= hi; m++) if (!covered.has(m)) gaps.push(m);
      expect(gaps, `${purpose} has uncovered minutes`).toEqual([]);
    }
  });

  it("gives every covered minute at least two families to rotate between", () => {
    // COVERAGE IS NOT ROTATION. Thirty workouts tiled every range while
    // leaving about half the covered minutes with a single family — so
    // matchWorkout's family-first pick had nothing to choose between and the
    // same day drew the same session every time. The machinery was correct
    // and inert, which no coverage assertion could tell you.
    //
    // Two is the threshold because it is the smallest number at which the
    // pick is a choice at all. It is not a claim that two is enough variety.
    for (const [purpose, [lo, hi]] of Object.entries(COVER) as [
      LibraryPurpose,
      [number, number],
    ][]) {
      const families = new Map<number, Set<string>>();
      for (const w of LIBRARY.filter((w) => w.purpose === purpose)) {
        const span = flexSpanSecs(w)!;
        for (
          let m = Math.ceil(span.lo / 60);
          m <= Math.floor(span.hi / 60);
          m++
        ) {
          if (!families.has(m)) families.set(m, new Set());
          families.get(m)!.add(w.family);
        }
      }
      const thin: number[] = [];
      for (let m = lo; m <= hi; m++) {
        if ((families.get(m)?.size ?? 0) < 2) thin.push(m);
      }
      expect(thin, `${purpose} minutes with only one family`).toEqual([]);
    }
  });

  it("meets the library size the spec's decision 2 states", () => {
    // NOT A ROUND NUMBER SOMEONE LIKED. "A real curated library, JOIN-style,
    // 100+ hand-authored workouts" is decision 2 in
    // docs/specs/2026-08-31-structured-cycling-workouts-design.md, recorded
    // under "Decisions taken before the design, and by whom" and marked not
    // to be relitigated.
    //
    // This assertion exists because that decision was quietly missed once:
    // slice 5 was named "The library, to 100+", shipped 16 workouts to reach
    // 46, and closed. Nothing was wrong with the 46 — coverage was met and
    // guarded — but the stated target was not, and no test could tell.
    // A narrower true metric ("two families at every covered duration") had
    // been substituted for the goal, and every check anyone ran was green.
    expect(LIBRARY.length).toBeGreaterThanOrEqual(LIBRARY_TARGET);
  });

  it("does not regress the measured family floor", () => {
    // A RATCHET, not a claim that four families is enough. The test above
    // pins TWO as the principle — the smallest number at which the pick is a
    // choice at all — and this pins what the library actually reached, so
    // deleting workouts cannot quietly walk it back to that floor.
    //
    // Raise it when the library rises; never lower it to make a change pass.
    for (const [purpose, [lo, hi]] of Object.entries(COVER) as [
      LibraryPurpose,
      [number, number],
    ][]) {
      const families = new Map<number, Set<string>>();
      for (const w of LIBRARY.filter((w) => w.purpose === purpose)) {
        const span = flexSpanSecs(w)!;
        for (
          let m = Math.ceil(span.lo / 60);
          m <= Math.floor(span.hi / 60);
          m++
        ) {
          if (!families.has(m)) families.set(m, new Set());
          families.get(m)!.add(w.family);
        }
      }
      const thin: number[] = [];
      for (let m = lo; m <= hi; m++) {
        if ((families.get(m)?.size ?? 0) < FAMILY_RATCHET) thin.push(m);
      }
      expect(
        thin,
        `${purpose} minutes below the ${FAMILY_RATCHET}-family ratchet`
      ).toEqual([]);
    }
  });

  it("gives every workout a stable id and a provenance", () => {
    const ids = LIBRARY.map((w) => w.id);
    expect(new Set(ids).size, "ids must be unique").toBe(ids.length);
    for (const w of LIBRARY) {
      expect(w.source, `${w.id} has no source`).not.toBe("");
      expect(w.source, `${w.id}'s source states no confidence`).toMatch(
        /Confidence:/
      );
      expect(w.why, `${w.id} has no coaching intent`).not.toBe("");
    }
  });

  it("answers every purpose the matcher can be asked for", () => {
    // Until now the coverage test skipped an unauthored purpose. From here a
    // missing purpose is a hole, not a work-in-progress.
    const answered = new Set(LIBRARY.map((w) => w.purpose));
    expect([...answered].sort()).toEqual([
      "aerobic_base",
      "long",
      "recovery",
      "threshold",
      "vo2max",
    ]);
  });

  it("authors whole seconds only", () => {
    // The exact-duration guarantee and both renderers assume integral secs.
    for (const w of LIBRARY) {
      for (const b of w.blocks) {
        for (const s of b.steps) {
          expect(Number.isInteger(s.secs), `${w.id} has fractional secs`).toBe(
            true
          );
        }
      }
    }
  });
});
