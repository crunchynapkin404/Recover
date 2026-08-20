// tests/today-state-pin-guard.test.ts
//
// Every Today surface that stands in for a TodayState must pin that state in
// its URL. `assertBlockOrder` checks the rendered blocks against
// BLOCK_ORDER[TODAY_STATE_BY_SURFACE[surface]], but a bare `/` renders
// whatever resolveTodayState() derives from the wall clock — and EVENING_HOUR
// is 18.
//
// So `today: "/"` passed before 18:00 local and failed after it, and made
// `today` byte-identical to `today-evening`, which assertTodayStatesDiffer
// refuses to report as a pass. It went unnoticed while the script was only run
// by a person during the working day; making the capture a blocking CI gate in
// v0.115.0 turned it into a job that failed every evening. Found at 18:20 UTC
// on a docs-only pull request that changed nothing (run 32401663053).
//
// Scanned from source text rather than imported: verify-surfaces.ts launches a
// browser and reads SCREENSHOT_BASE_URL at module scope, so it cannot be
// imported into a test process.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = readFileSync(
  join(process.cwd(), "scripts", "verify-surfaces.ts"),
  "utf8"
);

function block(name: string): string {
  const start = SOURCE.indexOf(name);
  expect(start, `${name} not found in verify-surfaces.ts`).toBeGreaterThan(-1);
  const open = SOURCE.indexOf("{", start);
  const close = SOURCE.indexOf("\n};", open);
  return SOURCE.slice(open, close);
}

describe("Today surfaces pin their state", () => {
  it("every surface in TODAY_STATE_BY_SURFACE pins ?state= in SURFACES", () => {
    const stateBlock = block("const TODAY_STATE_BY_SURFACE");
    const surfaceBlock = block("const SURFACES");

    const stated = [...stateBlock.matchAll(/^\s*"?([a-z0-9-]+)"?:\s*"/gm)].map(
      (m) => m[1]
    );
    expect(stated.length).toBeGreaterThan(0);

    for (const surface of stated) {
      const entry = new RegExp(`^\\s*"?${surface}"?:\\s*"([^"]+)"`, "m").exec(
        surfaceBlock
      );
      expect(
        entry,
        `${surface} is in TODAY_STATE_BY_SURFACE but not SURFACES`
      ).not.toBeNull();
      expect(
        entry![1],
        `SURFACES["${surface}"] is "${entry![1]}", which does not pin ?state=. ` +
          `assertBlockOrder will compare it against a fixed BLOCK_ORDER row ` +
          `while the page renders whatever the wall clock says — passing ` +
          `before EVENING_HOUR (18) and failing after it.`
      ).toContain("?state=");
    }
  });
});
