import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * One definition of "the week's minutes" — for TARGET/load arithmetic.
 *
 * `materialized_mins` is written from `plannedMins`, and every consumer that
 * scales by it must count the same way. A second hand-rolled sum anywhere
 * would make the rate's numerator and denominator mean different things —
 * the exact drift this release removes. Two such sums existed in
 * `train/page.tsx` before it.
 *
 * `week-plan/day-shape.ts` is allowlisted below for a deliberately
 * different reason, not an oversight: its sum is DISPLAY minutes for the
 * week strip's bar height (strength included, unlike plannedMins), and it
 * never feeds a rate, a target, or `materialized_mins` — the exact thing
 * this guard exists to protect. A visual-only sum drifting from
 * plannedMins is not the bug this test catches; it would only be a bug if
 * the two were ever supposed to agree, and here they are not (see
 * day-shape.ts's own comment on `displayMins`).
 *
 * Deliberately source-level: a DB-backed equivalent would skip in CI and
 * enforce nothing.
 *
 * Blind spot, stated plainly: this is a lexical scan for the nested-reduce
 * shape. A sum written differently — a `for` loop, a `flatMap().reduce()`,
 * or a helper in another file — would not match it.
 */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(full) && !/\.test\.tsx?$/.test(full) ? [full] : [];
  });
}

describe("week minutes wiring", () => {
  it("has no hand-rolled sum of a week's workout minutes", () => {
    // Matches `.workouts.reduce(` — the inner half of the nested reduce both
    // former /train call sites used.
    const offenders = sourceFiles("src").filter((f) => {
      const src = readFileSync(f, "utf8");
      return (
        /\.workouts\.reduce\(/.test(src) &&
        !f.endsWith(join("week-plan", "fill.ts")) &&
        !f.endsWith(join("week-plan", "planned-loads.ts")) &&
        // DISPLAY minutes, not target minutes — see this file's doc
        // comment above for why that is a different quantity.
        !f.endsWith(join("week-plan", "day-shape.ts"))
      );
    });

    expect(offenders).toEqual([]);
  });
});
