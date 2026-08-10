import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Surface wiring guard (2c condition 4). The v0.87 regression this prevents:
// RaceChip silently dropped the `capped` caveat that RaceCountdownCard
// rendered, and nothing failed, because no test asserted that the
// qualification reached the athlete.
const PAGES = ["src/app/page.tsx", "src/app/train/page.tsx"];

describe("race card surfaces", () => {
  it.each(PAGES)("%s builds its race card through raceCard()", (path) => {
    const src = readFileSync(path, "utf8");
    expect(src).toContain("raceCard(");
  });

  it.each(PAGES)("%s does not call forecastForm itself", (path) => {
    const src = readFileSync(path, "utf8");
    expect(src).not.toContain("forecastForm(");
  });
});

// v0.87 Task 7: three call sites wrote the same `demand == null ||
// !demand.available ? null : assessFeasibility({...})` guard inline and
// collapsed every failure to `null`. feasibilityFor() is the one owner now.
const FEASIBILITY_SITES = [
  "src/lib/training-plan.ts",
  "src/app/train/page.tsx",
];

describe("feasibility surfaces", () => {
  it.each(FEASIBILITY_SITES)("%s goes through feasibilityFor()", (path) => {
    const src = readFileSync(path, "utf8");
    expect(src).toContain("feasibilityFor(");
    expect(src).not.toContain("assessFeasibility(");
  });
});
