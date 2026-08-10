import { describe, expect, it } from "vitest";
import {
  biologicalAge,
  bioAgeFrom,
  MIN_BIOAGE_COMPONENTS,
  MAX_OFFSET_YEARS,
  type BioAgeInputs,
  type BioAgeResult,
  type BioAgeWellnessRow,
} from "./biological-age";
import { sleepConsistency } from "./sleep-insights";

function inputs(over: Partial<BioAgeInputs>): BioAgeInputs {
  return {
    chronologicalAge: 40,
    restingHr: null,
    hrvMs: null,
    sleepConsistency: null,
    vo2max: null,
    bodyFatPct: null,
    ...over,
  };
}

function assertResult(r: ReturnType<typeof biologicalAge>): BioAgeResult {
  if ("insufficient" in r) throw new Error("expected a result");
  return r;
}

describe("biologicalAge", () => {
  it("insufficient without a birth year", () => {
    const r = biologicalAge(
      inputs({
        chronologicalAge: null,
        restingHr: 55,
        hrvMs: 70,
        sleepConsistency: 90,
      })
    );
    expect("insufficient" in r).toBe(true);
    if ("insufficient" in r) expect(r.missing).toContain("Birth year");
  });

  it("insufficient below the minimum components", () => {
    const r = biologicalAge(inputs({ restingHr: 55, hrvMs: 70 }));
    expect("insufficient" in r).toBe(true);
    if ("insufficient" in r) {
      expect(r.have.length).toBe(MIN_BIOAGE_COMPONENTS - 1);
      expect(r.missing).toContain("VO₂max");
    }
  });

  it("healthy signals lower biological age below chronological", () => {
    const r = assertResult(
      biologicalAge(
        inputs({
          restingHr: 48, // below ref 60 → younger
          hrvMs: 80, // above ref 55 → younger
          sleepConsistency: 95, // above ref 75 → younger
          vo2max: 55, // above ref 42 → younger
          bodyFatPct: 12, // below ref 18 → younger
        })
      )
    );
    expect(r.deltaYears).toBeLessThan(0);
    expect(r.bioAge).toBeLessThan(40);
    expect(r.components).toHaveLength(5);
  });

  it("poor signals raise biological age above chronological", () => {
    const r = assertResult(
      biologicalAge(
        inputs({
          restingHr: 72,
          hrvMs: 30,
          sleepConsistency: 45,
        })
      )
    );
    expect(r.deltaYears).toBeGreaterThan(0);
    expect(r.bioAge).toBeGreaterThan(40);
  });

  it("clamps the total offset to the max", () => {
    const r = assertResult(
      biologicalAge(
        inputs({
          chronologicalAge: 50,
          restingHr: 100, // way high
          hrvMs: 10,
          sleepConsistency: 0,
          vo2max: 15,
          bodyFatPct: 45,
        })
      )
    );
    expect(r.deltaYears).toBeLessThanOrEqual(MAX_OFFSET_YEARS);
    expect(r.bioAge).toBeLessThanOrEqual(50 + MAX_OFFSET_YEARS);
  });

  it("never returns a biological age below 18", () => {
    const r = assertResult(
      biologicalAge(
        inputs({
          chronologicalAge: 20,
          restingHr: 40,
          hrvMs: 120,
          sleepConsistency: 100,
          vo2max: 70,
        })
      )
    );
    expect(r.bioAge).toBeGreaterThanOrEqual(18);
  });
});

/** `base` minus `n` days, as a YYYY-MM-DD string. Test-only helper. */
function ymdOffset(base: string, n: number): string {
  const d = new Date(`${base}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function row(
  date: string,
  over: Partial<BioAgeWellnessRow> = {}
): BioAgeWellnessRow {
  return {
    date,
    restingHr: null,
    hrvMs: null,
    vo2max: null,
    bodyFatPct: null,
    sleepSecs: null,
    sleepDeepSecs: null,
    sleepRemSecs: null,
    sleepLightSecs: null,
    sleepAwakeSecs: null,
    bedStart: null,
    bedEnd: null,
    ...over,
  };
}

function nightsOf(wellness: BioAgeWellnessRow[]) {
  return wellness.map((w) => ({
    date: w.date,
    sleepSecs: w.sleepSecs,
    sleepDeepSecs: w.sleepDeepSecs,
    sleepRemSecs: w.sleepRemSecs,
    sleepLightSecs: w.sleepLightSecs,
    sleepAwakeSecs: w.sleepAwakeSecs,
    bedStart: w.bedStart,
    bedEnd: w.bedEnd,
  }));
}

function assertBioAge(r: ReturnType<typeof bioAgeFrom>): BioAgeResult {
  if ("insufficient" in r) throw new Error("expected a result");
  return r;
}

describe("bioAgeFrom (the owner: birthYear + latest-non-null + 30-day nights window)", () => {
  const TODAY = "2026-08-10"; // birthYear 1990 → chronologicalAge 36

  it("matches a hand-built biologicalAge() call over a dense history", () => {
    const bedStart = new Date(2026, 0, 1, 23, 0);
    const bedEnd = new Date(2026, 0, 2, 7, 0);
    const wellness: BioAgeWellnessRow[] = Array.from({ length: 10 }, (_, i) =>
      row(ymdOffset(TODAY, 9 - i), {
        restingHr: 52, // distinct from ref(60) and every other fixture value
        hrvMs: 68, // distinct from ref(55)
        vo2max: 50, // distinct from ref(42)
        bodyFatPct: 15, // distinct from ref(18)
        bedStart,
        bedEnd,
      })
    );
    const prefs = { birthYear: 1990 };

    const consistency = sleepConsistency(nightsOf(wellness));
    const expected = biologicalAge({
      chronologicalAge: 36,
      restingHr: 52,
      hrvMs: 68,
      sleepConsistency: consistency?.score ?? null,
      vo2max: 50,
      bodyFatPct: 15,
    });

    expect(bioAgeFrom(wellness, prefs, TODAY)).toEqual(expected);
  });

  it("picks the most recent non-null resting HR/HRV/VO2max/body-fat%, not the last row", () => {
    // Offsets 7..3 carry real signals; the most recent 3 rows (offsets
    // 2..0) are trailing nulls. A search that took the last row instead of
    // the latest non-null one would see null for all four point values.
    const bedStart = new Date(2026, 0, 1, 22, 30);
    const bedEnd = new Date(2026, 0, 2, 6, 30);
    const realRows = [7, 6, 5, 4, 3].map((offset) =>
      row(ymdOffset(TODAY, offset), {
        restingHr: 52,
        hrvMs: 68,
        vo2max: 50,
        bodyFatPct: 15,
        bedStart,
        bedEnd,
      })
    );
    const nullRows = [2, 1, 0].map((offset) => row(ymdOffset(TODAY, offset)));
    const wellness = [...realRows, ...nullRows];
    const prefs = { birthYear: 1990 };

    const consistency = sleepConsistency(nightsOf(wellness));
    const r = assertBioAge(bioAgeFrom(wellness, prefs, TODAY));
    expect(r).toEqual(
      assertBioAge(
        biologicalAge({
          chronologicalAge: 36,
          restingHr: 52,
          hrvMs: 68,
          sleepConsistency: consistency?.score ?? null,
          vo2max: 50,
          bodyFatPct: 15,
        })
      )
    );
  });

  it("excludes nights older than 30 days from the sleep-consistency window", () => {
    // 5 recent, identical bedtimes (within 30 days) → sd=0 → score 100.
    // 3 old rows (well outside 30 days, one of them inside a naive 60-day
    // window) carry scattered bedtimes: if they leaked into the window the
    // score would drop well below 100.
    const recentRows = [4, 3, 2, 1, 0].map((offset) =>
      row(ymdOffset(TODAY, offset), {
        restingHr: 52,
        hrvMs: 68,
        bedStart: new Date(2026, 0, 1, 23, 0),
        bedEnd: new Date(2026, 0, 2, 7, 0),
      })
    );
    const oldRows = [
      { offset: 45, hour: 2 },
      { offset: 60, hour: 19 },
      { offset: 75, hour: 4 },
    ].map(({ offset, hour }) =>
      row(ymdOffset(TODAY, offset), {
        bedStart: new Date(2026, 0, 1, hour, 0),
        bedEnd: new Date(2026, 0, 2, hour + 6, 0),
      })
    );
    const wellness = [...oldRows, ...recentRows];
    const prefs = { birthYear: 1990 };

    const r = assertBioAge(bioAgeFrom(wellness, prefs, TODAY));
    const sleepComponent = r.components.find(
      (c) => c.key === "sleepConsistency"
    );
    expect(sleepComponent).toBeDefined();
    // ref(75), higherIsOlder=false, perUnit=0.06 → score 100 gives offset
    // (75-100)*0.06 = -1.5.
    expect(sleepComponent?.offsetYears).toBe(-1.5);
  });

  it("prefs null produces the insufficient result rather than throwing", () => {
    const wellness = [row(TODAY, { restingHr: 52, hrvMs: 68, vo2max: 50 })];
    expect(() => bioAgeFrom(wellness, null, TODAY)).not.toThrow();
    const r = bioAgeFrom(wellness, null, TODAY);
    expect("insufficient" in r).toBe(true);
    if ("insufficient" in r) expect(r.missing).toContain("Birth year");
  });

  it("birthYear null produces the insufficient result rather than throwing", () => {
    const wellness = [row(TODAY, { restingHr: 52, hrvMs: 68, vo2max: 50 })];
    const prefs = { birthYear: null };
    expect(() => bioAgeFrom(wellness, prefs, TODAY)).not.toThrow();
    const r = bioAgeFrom(wellness, prefs, TODAY);
    expect("insufficient" in r).toBe(true);
    if ("insufficient" in r) expect(r.missing).toContain("Birth year");
  });
});
