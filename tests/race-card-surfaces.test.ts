import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Surface wiring guard (2c condition 4). The v0.87 regression this prevents:
// RaceChip silently dropped the `capped` caveat that RaceCountdownCard
// rendered, and nothing failed, because no test asserted that the
// qualification reached the athlete.
//
// KNOWN LIMITATION: everything in this file is a source-text substring
// match over the two page files, not a call-graph or behavioral check. It
// confirms the pages *mention* `raceCard(`/`feasibilityFor(` and don't
// *mention* `forecastForm(`/`assessFeasibility(` — it has no idea what
// either function actually returns or how the result is rendered. This was
// proven insufficient during v0.87's final review: a mutation that
// hard-coded `capped: false` and swapped out `CAPPED_WHY` inside
// outlook-figure.ts left every test in this file green, because the pages
// still called `raceCard(` exactly as before — the caveat was dead by the
// time it reached day-actions.tsx, and nothing here could see that. The
// guard that actually exercises the capped/why mapping and would catch that
// mutation is src/lib/race/outlook-figure.test.ts; treat this file as
// wiring hygiene, not as evidence the capped caveat reaches the athlete.
//
// The `not.toContain("assessFeasibility(")` assertion below shares the same
// blind spot in the other direction: it would fail if either page file ever
// merely *mentions* the string `assessFeasibility(` — inside a comment
// explaining why the direct call was removed, for instance — even though
// no call is actually made. A false failure from prose, not from code.
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
