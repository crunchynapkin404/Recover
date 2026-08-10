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
