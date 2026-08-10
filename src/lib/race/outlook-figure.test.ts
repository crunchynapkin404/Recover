// src/lib/race/outlook-figure.test.ts — un-gated coverage for the pure
// ForecastResult → RaceOutlook mapping. Unlike outlook.test.ts (which
// imports outlook.ts → ./service → @/lib/db and is DB-gated), this file has
// no DB reach, so it runs in CI without a database. That gap is exactly what
// let a mutation hard-coding `capped: false` and deleting CAPPED_WHY inside
// outlook.ts leave the full CI suite green — see outlook.ts's history and
// tests/race-card-surfaces.test.ts's limitation note.
import { describe, expect, it } from "vitest";
import { Figure } from "@/lib/uncertainty";
import { raceOutlook, CAPPED_WHY, FULL_WHY } from "./outlook-figure";
import type { ForecastResult } from "./forecast";

const SCENARIO = { tsb: 5, band: "green" as const };

function result(capped: boolean): ForecastResult {
  return {
    insufficient: false,
    days: [],
    endDate: "2026-08-27",
    capped,
    full: SCENARIO,
    adherence: null,
  };
}

describe("raceOutlook", () => {
  it("marks a capped result and carries the plan-end caveat", () => {
    const outlook = raceOutlook(result(true));
    expect(outlook.available).toBe(true);
    if (!outlook.available) return;
    expect(outlook.value.capped).toBe(true);
    expect(outlook.why).toContain("plan end");
    expect(outlook.why).toBe(CAPPED_WHY);
    expect(outlook.confidence).toBe("low");
  });

  it("marks an uncapped result with the non-capped why", () => {
    const outlook = raceOutlook(result(false));
    expect(outlook.available).toBe(true);
    if (!outlook.available) return;
    expect(outlook.value.capped).toBe(false);
    expect(outlook.why).toBe(FULL_WHY);
    expect(outlook.why).not.toContain("plan end");
    expect(outlook.confidence).toBe("low");
  });

  it("reports missing training-load history for an insufficient result, not a fabricated figure", () => {
    const outlook = raceOutlook({ insufficient: true });
    expect(outlook).toEqual(Figure.missingInput("training-load history"));
  });
});
