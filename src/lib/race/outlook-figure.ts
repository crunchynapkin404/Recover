// src/lib/race/outlook-figure.ts — pure ForecastResult → RaceOutlook mapping.
//
// Split out of outlook.ts in v0.87's final review: a test importing
// `@/lib/race/outlook` transitively pulls `./service` → `@/lib/db`, which
// forces DB-gating (`describe.skipIf(!hasDb)`). CI runs the suite without a
// database, so outlook.test.ts's coverage of this exact mapping — including
// the `capped`/`CAPPED_WHY` caveat that is this release's headline fix —
// never executed in CI. This module has no DB reach (only `./forecast` and
// `@/lib/uncertainty`, both pure), so its own test file runs un-gated.
import { Figure } from "@/lib/uncertainty";
import type { ForecastResult, ScenarioEnd } from "./forecast";

export type RaceOutlook = Figure<{
  full: ScenarioEnd;
  adherence: ScenarioEnd | null;
  capped: boolean;
}>;

export const CAPPED_WHY =
  "Projection ends at plan end, before race day — it is not a race-day figure.";

export const FULL_WHY =
  "Form outlook only: TSB from planned load, not readiness.";

/**
 * `raceCard()` and `simulateRaceForm()` (outlook.ts) both need this exact
 * mapping — a `ForecastResult` becomes an honest `RaceOutlook`, capped
 * projections carry their caveat, and an insufficient one reports what's
 * missing rather than fabricating a number.
 */
export function raceOutlook(f: ForecastResult): RaceOutlook {
  return f.insufficient
    ? Figure.missingInput("training-load history")
    : Figure.available(
        { full: f.full, adherence: f.adherence, capped: f.capped },
        "low",
        f.capped ? CAPPED_WHY : FULL_WHY
      );
}
