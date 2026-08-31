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
  recovery: [21, 90],
  aerobic_base: [21, 210],
  long: [48, 300],
  threshold: [27, 120],
  vo2max: [32, 120],
};

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
