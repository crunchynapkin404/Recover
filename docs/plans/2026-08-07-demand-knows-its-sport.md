# v0.46 — Demand knows its sport: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Price a race's demand with a model that matches its sport, and make every demand figure carry a confidence, a reason, and — when it cannot be produced — a refusal loud enough to see.

**Architecture:** `races.sport` (a stored, validated enum since v0.42) becomes the dispatch key inside `eventDemand`. Cycling keeps `estimateRidingHours` untouched; running gets `estimateRunningHours` (Riegel from a threshold-pace anchor, ITRA km-effort for elevation); triathlon composes swim + bike + run from a `raceType` leg lookup. An athlete-stated finish time wins over all three. `eventDemand`'s return type changes from `EventDemand | null` to a discriminated result so the silent-fallback path cannot be written again.

**Tech Stack:** Next.js 16, React 19, TypeScript, Drizzle ORM + Postgres, Vitest, Tailwind.

**Spec:** `docs/specs/2026-08-07-demand-knows-its-sport-design.md`. Read it before Task 1.

## Global Constraints

- **The cycling path must not move by one decimal.** Every gran fondo figure the reporting athlete sees today must be byte-identical after this release. Task 4 installs the test that proves it; every later task keeps it green.
- **Never inline a constant.** New values go in `src/lib/race/demand-constants.ts` beside the existing ones, each with a source and a confidence in its doc comment. This is the rule `demand-constants.ts:1-7` already states.
- **No invented defaults.** A model that cannot find an anchor returns a refusal naming the fix. There is no default running pace and no default swim pace.
- **Swim is not a plan sport.** `PLAN_SPORTS` stays `["Bike", "Run", "Triathlon"]`. Swim is priced only as a leg inside a triathlon.
- **DB-backed tests must use `describe.skipIf(!hasDb)`.** Follow the existing convention in the file you are editing. Before pushing, run the suite once with `DATABASE_URL` **unset** — a green local run with a database proves nothing about CI.
- **Pure modules stay pure.** `src/lib/race/*.ts` (except `service.ts` and `debrief.ts`) take no I/O and no clock. All database reads live in `volume-inputs.ts`.
- **Gate before any push:** `npm run lint && npm run typecheck && npm test && npm run build`. `npm run build` is not optional — it is the only check that catches a sync export from a `"use server"` file.
- **Commit style:** conventional commits, matching `git log`. Scope with the area (`feat(race):`, `fix(volume):`, `docs(specs):`).

---

## File Structure

**Created:**

| Path                                            | Responsibility                                                                                       |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `src/lib/race/running-time.ts`                  | `estimateRunningHours` + `thresholdPaceFromPerformance`. Pure. The running twin of `riding-time.ts`. |
| `src/lib/race/running-time.test.ts`             | Unit tests for the above.                                                                            |
| `src/lib/race/swim-time.ts`                     | `estimateSwimHours`. Pure.                                                                           |
| `src/lib/race/swim-time.test.ts`                | Unit tests for the above.                                                                            |
| `src/lib/race/triathlon-legs.ts`                | `TRIATHLON_LEGS` table + `triathlonLegsFor`. Pure.                                                   |
| `src/lib/race/triathlon-legs.test.ts`           | Unit tests for the above.                                                                            |
| `src/lib/week-plan/anchors.ts`                  | `thresholdPaceFromHistory`, `swimPaceFromHistory`. Pure functions over activity rows.                |
| `src/lib/week-plan/anchors.test.ts`             | Unit tests for the above.                                                                            |
| `drizzle/0039_demand_knows_its_sport.sql`       | The two new columns.                                                                                 |
| `docs/specs/2026-08-07-race-demand-evidence.md` | Source + confidence for every new constant.                                                          |
| `scripts/demand-sweep.ts`                       | Verification sweep — prints real model output for reading, not asserting.                            |

**Modified:**

| Path                                          | Change                                                                 |
| --------------------------------------------- | ---------------------------------------------------------------------- |
| `src/lib/db/schema.ts`                        | `body_prefs.threshold_pace_sec_per_km`, `races.expected_finish_hours`. |
| `src/lib/race/demand-constants.ts`            | Running + swim constants.                                              |
| `src/lib/race/demand.ts`                      | Discriminated result, confidence, sport dispatch.                      |
| `src/lib/race/feasibility.ts`                 | `requiredLongestRideHours` → `requiredLongestSessionHours`.            |
| `src/lib/plan-sport.ts`                       | Export `normaliseRaceType`.                                            |
| `src/lib/week-plan/volume-inputs.ts`          | Sport dispatch, anchor reads, `longestSessionHoursOf`.                 |
| `src/lib/weekly-review.ts`                    | `ctlDelta` calendar-week lookback.                                     |
| `src/lib/export/import-user.ts`               | Two new columns in the `Carried<>` rows.                               |
| `src/lib/tools/get-races.ts`                  | New `races` column in the `Projected<>` literal.                       |
| `src/components/plan/event-readiness.tsx`     | Sport-aware nouns, confidence sentence.                                |
| `src/components/plan/races-section.tsx`       | Expected-finish input.                                                 |
| `src/components/settings/body-prefs-card.tsx` | Threshold-pace input.                                                  |
| `src/app/settings/body-actions.ts`            | Validate + persist threshold pace.                                     |
| `src/app/train/page.tsx`                      | Consume the discriminated result.                                      |
| `CHANGELOG.md`                                | The release entry.                                                     |

---

## Task 1: Schema, migration, and the two type guards

**Files:**

- Modify: `src/lib/db/schema.ts` (`bodyPrefs`, `races`)
- Create: `drizzle/0039_demand_knows_its_sport.sql` (generated)
- Modify: `src/lib/export/import-user.ts:518-536`
- Modify: `src/lib/tools/get-races.ts:55-75`

**Interfaces:**

- Consumes: nothing.
- Produces: `schema.bodyPrefs.thresholdPaceSecPerKm` (`integer`, nullable), `schema.races.expectedFinishHours` (`real`, nullable).

- [ ] **Step 1: Add the two columns to the schema**

In `src/lib/db/schema.ts`, inside `bodyPrefs`, directly after the `ftpWatts` line:

```ts
  ftpWatts: integer("ftp_watts"),
  /**
   * v0.46: the running anchor, the exact analogue of ftpWatts. Seconds per
   * kilometre at threshold — roughly one-hour race pace by definition, which
   * is what makes it a Riegel reference performance with no second input.
   * null = derive from history (Low confidence), then refuse.
   */
  thresholdPaceSecPerKm: integer("threshold_pace_sec_per_km"),
```

In `races`, directly after the `demandHoursOverride` line:

```ts
  /** Athlete's own weekly-hours figure; wins over the computed one. */
  demandHoursOverride: real("demand_hours_override"),
  /**
   * v0.46: the athlete's own figure for how long THE EVENT takes them.
   * Distinct from demandHoursOverride, which is how long a training WEEK
   * should be. This one enters the model where a computed totalHours would,
   * so it flows through the event-to-weekly ratio; that one is applied after
   * the ratio. Set → no anchor is needed and no leg pricing is attempted.
   */
  expectedFinishHours: real("expected_finish_hours"),
```

- [ ] **Step 2: Generate the migration**

```bash
npm run db:generate
```

Expected: a new `drizzle/0039_*.sql` containing two `ALTER TABLE ... ADD COLUMN` statements, and a new `idx: 39` entry appended to `drizzle/meta/_journal.json`.

Rename the generated file to `drizzle/0039_demand_knows_its_sport.sql` **and** update its `tag` in `drizzle/meta/_journal.json` to `0039_demand_knows_its_sport` so the two agree. A journal tag that does not match a filename makes the migration unrunnable.

- [ ] **Step 3: Verify the migration SQL is additive only**

```bash
cat drizzle/0039_demand_knows_its_sport.sql
```

Expected: exactly two `ADD COLUMN` statements, no `DROP`, no `ALTER COLUMN`. If anything else appears, the schema edit was wrong — fix it and regenerate rather than hand-editing the SQL.

- [ ] **Step 4: Run typecheck to see the two guards bite**

```bash
npm run typecheck
```

Expected: **FAIL**, with errors in `src/lib/export/import-user.ts` (the `Carried<typeof schema.races, "id">` literal is now missing `expectedFinishHours`) and `src/lib/tools/get-races.ts` (the `ProjectedRace` literal is missing it too).

This failure is the point of the step. `Carried<>` and `Projected<>` exist precisely so a new column cannot be silently dropped — v0.39 shipped the first after `import-user.ts` lost 14 columns across 5 tables, and v0.41 shipped the second after `get_races` under-reported for nineteen releases. If typecheck **passes** here, one of the two types is not covering `races` and that is a defect to report before continuing.

- [ ] **Step 5: Satisfy the export/import guard**

In `src/lib/export/import-user.ts`, in the `Carried<typeof schema.races, "id">` literal, after `demandHoursOverride`:

```ts
        demandHoursOverride: r.demandHoursOverride,
        expectedFinishHours: r.expectedFinishHours,
```

`bodyPrefs` has its own `Carried<>` literal in the same file — search for `schema.bodyPrefs` and add `thresholdPaceSecPerKm: r.thresholdPaceSecPerKm` there in the same way.

- [ ] **Step 6: Satisfy the coach-projection guard**

In `src/lib/tools/get-races.ts`, in the mapping annotated `(r): ProjectedRace =>`, after `demandHoursOverride`:

```ts
      demandHoursOverride: r.demandHoursOverride,
      expectedFinishHours: r.expectedFinishHours,
```

- [ ] **Step 7: Run typecheck to verify it passes**

```bash
npm run typecheck
```

Expected: PASS, no output.

- [ ] **Step 8: Run the export/import drill against the dev database**

```bash
npm run db:migrate
npx tsx scripts/export-import-drill.ts
```

Expected: the drill reports all 18 tables compared with no differences. The drill's port guard refuses anything but the dev database (5435); if it refuses, you are pointed at the wrong one — check `.env`, and never point it at 5434, which is live.

- [ ] **Step 9: Commit**

```bash
git add src/lib/db/schema.ts drizzle/ src/lib/export/import-user.ts src/lib/tools/get-races.ts
git commit -m "feat(schema): a running anchor and an athlete-stated finish time"
```

---

## Task 2: The running model

**Files:**

- Modify: `src/lib/race/demand-constants.ts`
- Create: `src/lib/race/running-time.ts`
- Test: `src/lib/race/running-time.test.ts`

**Interfaces:**

- Consumes: `DEMAND_CONSTANTS` from Task 2's own edit.
- Produces:
  - `estimateRunningHours(input: RunningTimeInput): number | null`
  - `thresholdPaceFromPerformance(distanceKm: number, hours: number): number | null`
  - `interface RunningTimeInput { distanceKm: number; elevationM: number; thresholdPaceSecPerKm: number }`

- [ ] **Step 1: Add the running constants**

In `src/lib/race/demand-constants.ts`, before the closing `} as const;`:

```ts
  /**
   * Riegel's endurance exponent: T2 = T1 * (D2/D1)^k.
   *
   * Riegel 1981, "Athletic Records and Human Endurance", American Scientist
   * 69(3):285-290. The running counterpart of FTP_FRACTION_ANCHORS — the same
   * job (how sustainable pace decays with duration), from a published source.
   *
   * CONFIDENCE: MEDIUM. Vickers & Vertosick 2016 (BMC Sports Sci Med Rehabil,
   * "An empirical study of race times in recreational endurance runners")
   * found the exponent varies with training volume and runs ABOVE 1.06 for
   * recreational runners — meaning this value slightly UNDERSTATES a
   * recreational athlete's marathon time. The direction of the error is known
   * and it is the safe direction: a shorter predicted race understates demand
   * rather than prescribing training nobody can absorb.
   */
  RIEGEL_EXPONENT: 1.06,
  /**
   * Metres of ascent priced as one kilometre of flat running (ITRA
   * "km-effort": km_effort = distance_km + elevation_m / 100).
   *
   * CONFIDENCE: LOW, and this is a CONVENTION, not physiology — the same
   * status v0.45 assigned the 3:1 mesocycle. A Minetti-derived metabolic
   * model (Minetti et al. 2002, J Appl Physiol, "Energy cost of walking and
   * running at extreme uphill and downhill slopes") is the rigorous
   * alternative and is deliberately NOT used: it needs a grade distribution
   * the race form does not collect, and the honest error bar on the pace
   * anchor is wider than the gap between the two models.
   */
  VERTICAL_METRES_PER_FLAT_KM: 100,
  /**
   * Sustainable pace over a triathlon swim leg, as a share of the athlete's
   * median training swim pace. Triathlon swim legs are 0.75-3.8 km, short
   * enough that within-swim decay sits inside the anchor's own error.
   *
   * CONFIDENCE: LOW. A modelling choice, not a measurement. 1.0 means "raced
   * at the same pace as trained" — chosen because open-water conditions and
   * race adrenaline pull in opposite directions and no published magnitude
   * for the net effect was found.
   */
  SWIM_RACE_PACE_FACTOR: 1.0,
```

- [ ] **Step 2: Write the failing tests**

Create `src/lib/race/running-time.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  estimateRunningHours,
  thresholdPaceFromPerformance,
} from "./running-time";

describe("estimateRunningHours", () => {
  it("prices a flat marathon for a 4:00/km threshold runner at close to 3h", () => {
    // 240 s/km threshold => a 15 km reference hour. Riegel to 42.2 km.
    const hours = estimateRunningHours({
      distanceKm: 42.2,
      elevationM: 0,
      thresholdPaceSecPerKm: 240,
    });
    expect(hours).not.toBeNull();
    expect(hours!).toBeGreaterThan(2.8);
    expect(hours!).toBeLessThan(3.2);
  });

  it("prices the same marathon slower for a slower runner", () => {
    const fast = estimateRunningHours({
      distanceKm: 42.2,
      elevationM: 0,
      thresholdPaceSecPerKm: 240,
    })!;
    const slow = estimateRunningHours({
      distanceKm: 42.2,
      elevationM: 0,
      thresholdPaceSecPerKm: 300,
    })!;
    expect(slow).toBeGreaterThan(fast);
    // 5:00/km threshold => a 12 km reference hour => roughly 3h45-3h50.
    expect(slow).toBeGreaterThan(3.6);
    expect(slow).toBeLessThan(4.0);
  });

  it("charges ascent as flat distance at 100 m per km", () => {
    const flat = estimateRunningHours({
      distanceKm: 42.2,
      elevationM: 0,
      thresholdPaceSecPerKm: 300,
    })!;
    const hilly = estimateRunningHours({
      distanceKm: 42.2,
      elevationM: 1000,
      thresholdPaceSecPerKm: 300,
    })!;
    const equivalent = estimateRunningHours({
      distanceKm: 52.2,
      elevationM: 0,
      thresholdPaceSecPerKm: 300,
    })!;
    expect(hilly).toBeGreaterThan(flat);
    // 1000 m of ascent is exactly 10 km of flat, by definition of the constant.
    expect(hilly).toBeCloseTo(equivalent, 6);
  });

  it("ignores descent rather than giving time back", () => {
    const withDescent = estimateRunningHours({
      distanceKm: 21.1,
      elevationM: -500,
      thresholdPaceSecPerKm: 270,
    })!;
    const flat = estimateRunningHours({
      distanceKm: 21.1,
      elevationM: 0,
      thresholdPaceSecPerKm: 270,
    })!;
    expect(withDescent).toBeCloseTo(flat, 6);
  });

  it("returns null rather than a fabricated duration on unusable input", () => {
    expect(
      estimateRunningHours({
        distanceKm: 0,
        elevationM: 0,
        thresholdPaceSecPerKm: 240,
      })
    ).toBeNull();
    expect(
      estimateRunningHours({
        distanceKm: 10,
        elevationM: 0,
        thresholdPaceSecPerKm: 0,
      })
    ).toBeNull();
  });
});

describe("thresholdPaceFromPerformance", () => {
  it("round-trips a one-hour performance to its own pace", () => {
    // 15 km in exactly 1 h IS the threshold reference, so the pace is 240 s/km.
    expect(thresholdPaceFromPerformance(15, 1)).toBeCloseTo(240, 6);
  });

  it("returns a threshold pace slower than the pace of a shorter effort", () => {
    // 10 km in 45 min is 270 s/km. Threshold sits at a longer distance, so
    // the threshold pace must be SLOWER (a larger number) than 270.
    const pace = thresholdPaceFromPerformance(10, 0.75);
    expect(pace).not.toBeNull();
    expect(pace!).toBeGreaterThan(270);
    expect(pace!).toBeLessThan(285);
  });

  it("is the inverse of estimateRunningHours on flat ground", () => {
    const pace = thresholdPaceFromPerformance(10, 0.75)!;
    const backToTen = estimateRunningHours({
      distanceKm: 10,
      elevationM: 0,
      thresholdPaceSecPerKm: pace,
    })!;
    expect(backToTen).toBeCloseTo(0.75, 6);
  });

  it("returns null on unusable input", () => {
    expect(thresholdPaceFromPerformance(0, 1)).toBeNull();
    expect(thresholdPaceFromPerformance(10, 0)).toBeNull();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
npx vitest run src/lib/race/running-time.test.ts
```

Expected: FAIL — `Failed to resolve import "./running-time"`.

- [ ] **Step 4: Write the implementation**

Create `src/lib/race/running-time.ts`:

```ts
/**
 * How long a running event takes this athlete — from its distance and
 * elevation, and their threshold pace.
 *
 * The running twin of `riding-time.ts`, and deliberately a different shape.
 * Cycling needs the drag equation because speed depends on power in a way no
 * single pace captures; running does not, and the published endurance model
 * for running is Riegel's, not physics. Same job, sourced to its own sport.
 *
 * Threshold pace is by definition roughly one-hour race pace, so it IS a
 * Riegel reference performance — the model needs no second input, and the
 * athlete has one number to set rather than a distance/time pair.
 *
 * Pure — no I/O, no clock.
 */
import { DEMAND_CONSTANTS as C } from "./demand-constants";

export interface RunningTimeInput {
  /** Total distance in km (summed across all days for a stage event). */
  distanceKm: number;
  /** Total elevation gain in metres. Negative values are treated as flat. */
  elevationM: number;
  /** Seconds per kilometre at threshold — roughly one-hour race pace. */
  thresholdPaceSecPerKm: number;
}

/**
 * Estimated running time in hours, or null when the inputs cannot support an
 * estimate. Null is deliberate and matches `estimateRidingHours`: a fabricated
 * duration would propagate into a training target and a feasibility verdict.
 */
export function estimateRunningHours(input: RunningTimeInput): number | null {
  const { distanceKm, thresholdPaceSecPerKm } = input;
  // Descending does not give time back in any model worth trusting — the same
  // call riding-time.ts makes, for the same reason.
  const elevationM = Math.max(0, input.elevationM);

  if (!(distanceKm > 0) || !(thresholdPaceSecPerKm > 0)) return null;

  // ITRA km-effort: ascent priced as flat distance, then the whole thing run
  // through the endurance decay as if it were flat.
  const effectiveFlatKm =
    distanceKm + elevationM / C.VERTICAL_METRES_PER_FLAT_KM;

  // The reference performance, straight out of the anchor: the distance this
  // athlete covers in one hour at threshold.
  const referenceKm = 3600 / thresholdPaceSecPerKm;

  return Math.pow(effectiveFlatKm / referenceKm, C.RIEGEL_EXPONENT);
}

/**
 * Riegel run backwards: the threshold pace implied by a performance of
 * `hours` over `distanceKm`.
 *
 * Solves `1 = hours * (D1 / distanceKm)^k` for D1 — the distance this athlete
 * would cover in one hour — then reports its pace. Used to put a
 * history-derived performance on the same footing as a stated threshold pace,
 * so the model has exactly one anchor shape rather than two.
 */
export function thresholdPaceFromPerformance(
  distanceKm: number,
  hours: number
): number | null {
  if (!(distanceKm > 0) || !(hours > 0)) return null;
  const referenceKm = distanceKm * Math.pow(1 / hours, 1 / C.RIEGEL_EXPONENT);
  if (!(referenceKm > 0)) return null;
  return 3600 / referenceKm;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run src/lib/race/running-time.test.ts
```

Expected: PASS, 9 tests.

If the marathon bounds fail, **do not widen the bounds to make them green.** Print the actual number, check it against a real marathon time for that threshold pace, and fix whichever of the two is wrong. A test loosened until it passes is one of the four vacuous guards v0.45 had to delete.

- [ ] **Step 6: Mutation-test the elevation constant**

Temporarily change `VERTICAL_METRES_PER_FLAT_KM` from `100` to `200`, then:

```bash
npx vitest run src/lib/race/running-time.test.ts
```

Expected: FAIL on "charges ascent as flat distance at 100 m per km". Revert the constant and confirm the suite is green again. A guard that survives its own constant changing is guarding nothing.

- [ ] **Step 7: Commit**

```bash
git add src/lib/race/demand-constants.ts src/lib/race/running-time.ts src/lib/race/running-time.test.ts
git commit -m "feat(race): a running event is priced by a running model"
```

---

## Task 3: The swim leg and the triathlon leg table

**Files:**

- Create: `src/lib/race/swim-time.ts`
- Test: `src/lib/race/swim-time.test.ts`
- Create: `src/lib/race/triathlon-legs.ts`
- Test: `src/lib/race/triathlon-legs.test.ts`
- Modify: `src/lib/plan-sport.ts:67` (export `normaliseRaceType`)

**Interfaces:**

- Consumes: `DEMAND_CONSTANTS.SWIM_RACE_PACE_FACTOR` (Task 2), `normaliseRaceType` (this task).
- Produces:
  - `estimateSwimHours(distanceKm: number, paceSecPer100m: number): number | null`
  - `interface TriathlonLegs { swimKm: number; bikeKm: number; runKm: number }`
  - `triathlonLegsFor(raceType: string): TriathlonLegs | null`
  - `normaliseRaceType(raceType: string): string` (now exported)

- [ ] **Step 1: Export `normaliseRaceType`**

In `src/lib/plan-sport.ts`, change line 67 from:

```ts
function normaliseRaceType(raceType: string): string {
```

to:

```ts
export function normaliseRaceType(raceType: string): string {
```

Add to its doc comment, after the existing paragraph:

```
 * Exported since v0.46: the triathlon leg table is keyed by this function's
 * output too, so free-text `races.race_type` and the plan tool's closed enum
 * must collapse onto one key or a triathlon prices as nothing at all. That is
 * what finally gives the audit's F7 real weight — before this, two spellings
 * produced only an odd plan title.
```

- [ ] **Step 2: Write the failing swim tests**

Create `src/lib/race/swim-time.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { estimateSwimHours } from "./swim-time";

describe("estimateSwimHours", () => {
  it("prices a 3.8 km Ironman swim at a 2:00/100m pace at about 1.27 h", () => {
    // 3800 m / 100 = 38 lengths of 120 s = 4560 s = 1.2667 h.
    const hours = estimateSwimHours(3.8, 120);
    expect(hours).not.toBeNull();
    expect(hours!).toBeCloseTo(1.2667, 3);
  });

  it("scales linearly with distance", () => {
    const short = estimateSwimHours(1.9, 120)!;
    const long = estimateSwimHours(3.8, 120)!;
    expect(long).toBeCloseTo(short * 2, 6);
  });

  it("scales linearly with pace", () => {
    const fast = estimateSwimHours(1.5, 100)!;
    const slow = estimateSwimHours(1.5, 200)!;
    expect(slow).toBeCloseTo(fast * 2, 6);
  });

  it("returns null rather than zero on unusable input", () => {
    expect(estimateSwimHours(0, 120)).toBeNull();
    expect(estimateSwimHours(1.5, 0)).toBeNull();
  });
});
```

- [ ] **Step 3: Run the swim tests to verify they fail**

```bash
npx vitest run src/lib/race/swim-time.test.ts
```

Expected: FAIL — `Failed to resolve import "./swim-time"`.

- [ ] **Step 4: Write the swim implementation**

Create `src/lib/race/swim-time.ts`:

```ts
/**
 * How long a swim leg takes this athlete, from its distance and their pace.
 *
 * Deliberately the simplest of the three models, and deliberately not a
 * Riegel: a triathlon swim leg is 0.75-3.8 km, so the duration range is
 * narrow enough that decay sits inside the anchor's own error. Swim is priced
 * ONLY as a leg inside a triathlon — it is not a plan sport, and there is no
 * swim branch in generateWorkouts to plan for it.
 *
 * Pure — no I/O, no clock.
 */
import { DEMAND_CONSTANTS as C } from "./demand-constants";

/**
 * Estimated swim time in hours, or null when the inputs cannot support an
 * estimate. Null rather than 0: a zero-hour leg would silently vanish from a
 * triathlon's total and understate the whole event.
 */
export function estimateSwimHours(
  distanceKm: number,
  paceSecPer100m: number
): number | null {
  if (!(distanceKm > 0) || !(paceSecPer100m > 0)) return null;
  const hundreds = (distanceKm * 1000) / 100;
  const seconds = hundreds * paceSecPer100m * C.SWIM_RACE_PACE_FACTOR;
  return seconds / 3600;
}
```

- [ ] **Step 5: Run the swim tests to verify they pass**

```bash
npx vitest run src/lib/race/swim-time.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 6: Write the failing leg-table tests**

Create `src/lib/race/triathlon-legs.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { triathlonLegsFor } from "./triathlon-legs";

describe("triathlonLegsFor", () => {
  it("knows the standard Ironman distances", () => {
    expect(triathlonLegsFor("ironman")).toEqual({
      swimKm: 3.8,
      bikeKm: 180,
      runKm: 42.2,
    });
  });

  it("collapses every spelling of the same format onto one key", () => {
    // This is F7: free text from the race form and the plan tool's closed
    // enum must reach the same row, or a triathlon prices as nothing.
    const canonical = triathlonLegsFor("70.3");
    expect(triathlonLegsFor("Half Ironman")).toEqual(canonical);
    expect(triathlonLegsFor("half_ironman")).toEqual(canonical);
    expect(triathlonLegsFor("HalfIronman")).toEqual(canonical);
  });

  it("keeps the dot in 70.3 rather than treating it as a separator", () => {
    expect(triathlonLegsFor("70.3")).not.toBeNull();
    expect(triathlonLegsFor("70.3")!.bikeKm).toBe(90);
  });

  it("knows Olympic and Sprint under both spellings", () => {
    expect(triathlonLegsFor("olympic_tri")).toEqual({
      swimKm: 1.5,
      bikeKm: 40,
      runKm: 10,
    });
    expect(triathlonLegsFor("olympic triathlon")).toEqual(
      triathlonLegsFor("olympic_tri")
    );
    expect(triathlonLegsFor("sprint_tri")).toEqual({
      swimKm: 0.75,
      bikeKm: 20,
      runKm: 5,
    });
    expect(triathlonLegsFor("sprint triathlon")).toEqual(
      triathlonLegsFor("sprint_tri")
    );
  });

  it("refuses a bare 'triathlon', which names a sport and not a distance", () => {
    expect(triathlonLegsFor("triathlon")).toBeNull();
  });

  it("refuses an unrecognised format rather than guessing one", () => {
    expect(triathlonLegsFor("club champs relay")).toBeNull();
    expect(triathlonLegsFor("")).toBeNull();
  });
});
```

- [ ] **Step 7: Run the leg-table tests to verify they fail**

```bash
npx vitest run src/lib/race/triathlon-legs.test.ts
```

Expected: FAIL — `Failed to resolve import "./triathlon-legs"`.

- [ ] **Step 8: Write the leg-table implementation**

Create `src/lib/race/triathlon-legs.ts`:

```ts
/**
 * The three legs of a standard-distance triathlon.
 *
 * A lookup table is legitimate here where it would be indefensible for a gran
 * fondo: "Ironman" FIXES the course length, while "gran fondo" tells you
 * nothing about whether it climbs 800 m or 4000 m. These distances are
 * definitional, so this is a fact table, not inference.
 *
 * It exists because `races.distance_km` holds a single TOTAL and cannot be
 * decomposed — 226 km does not split back into 3.8 / 180 / 42.2.
 *
 * Keyed by `normaliseRaceType` so the race form's free text and the plan
 * tool's closed enum reach the same row. A miss returns null and the caller
 * refuses; the athlete's stated finish time is the way through.
 *
 * Pure — no I/O, no clock.
 */
import { normaliseRaceType } from "@/lib/plan-sport";

export interface TriathlonLegs {
  swimKm: number;
  bikeKm: number;
  runKm: number;
}

/**
 * Exact lookup, keyed by `normaliseRaceType` output.
 *
 * The bare key `triathlon` is deliberately ABSENT: it names a sport, not a
 * distance, and guessing a distance from it would put an unsourced number
 * into a training target.
 */
export const TRIATHLON_LEGS: Record<string, TriathlonLegs> = {
  ironman: { swimKm: 3.8, bikeKm: 180, runKm: 42.2 },
  "70.3": { swimKm: 1.9, bikeKm: 90, runKm: 21.1 },
  halfironman: { swimKm: 1.9, bikeKm: 90, runKm: 21.1 },
  olympictri: { swimKm: 1.5, bikeKm: 40, runKm: 10 },
  olympictriathlon: { swimKm: 1.5, bikeKm: 40, runKm: 10 },
  sprinttri: { swimKm: 0.75, bikeKm: 20, runKm: 5 },
  sprinttriathlon: { swimKm: 0.75, bikeKm: 20, runKm: 5 },
};

/** The legs a race type implies, or null when it implies none. */
export function triathlonLegsFor(raceType: string): TriathlonLegs | null {
  if (!raceType) return null;
  return TRIATHLON_LEGS[normaliseRaceType(raceType)] ?? null;
}
```

- [ ] **Step 9: Run the leg-table tests to verify they pass**

```bash
npx vitest run src/lib/race/triathlon-legs.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 10: Commit**

```bash
git add src/lib/plan-sport.ts src/lib/race/swim-time.ts src/lib/race/swim-time.test.ts src/lib/race/triathlon-legs.ts src/lib/race/triathlon-legs.test.ts
git commit -m "feat(race): swim legs and the standard triathlon distances"
```

---

## Task 4: The discriminated result, with cycling frozen

This task changes `eventDemand`'s **return type only**. The arithmetic does not move. Task 5 adds the sport dispatch on top.

**Files:**

- Modify: `src/lib/race/demand.ts`
- Test: `src/lib/race/demand.test.ts`
- Modify: `src/lib/week-plan/volume-inputs.ts:190-215` (call site)
- Modify: `src/app/train/page.tsx:455-472` (call site)

**Interfaces:**

- Consumes: nothing new.
- Produces:
  - `type DemandConfidence = "high" | "medium" | "low"`
  - `type DemandUnavailableReason` (closed union, five members)
  - `DEMAND_UNAVAILABLE_COPY: Record<DemandUnavailableReason, string>`
  - `type EventDemandResult = ({ available: true } & EventDemand) | { available: false; reason: DemandUnavailableReason }`
  - `eventDemand(input: EventDemandInput): EventDemandResult`
  - `EventDemand` gains `confidence: DemandConfidence` and `confidenceReason: string`

- [ ] **Step 1: Write the freeze test**

Add to `src/lib/race/demand.test.ts`:

```ts
/**
 * v0.46 freeze. This release must not move one decimal of the cycling path —
 * the reporting athlete is a cyclist, and every figure they see today is
 * correct. These are the pre-v0.46 outputs, recorded before the refactor.
 *
 * If one of these fails, the refactor changed cycling behaviour. Do NOT
 * update the expected numbers: find what moved.
 */
describe("cycling demand is unchanged by v0.46", () => {
  const GRAN_FONDO = {
    eventDays: 1,
    distanceKm: 130,
    elevationM: 4000,
    stages: [],
    overrideWeeklyHours: null,
    ftpWatts: 310,
    massKg: 83,
  };

  it("prices a 130km/4000m fondo exactly as it did before", () => {
    const result = eventDemand({ ...GRAN_FONDO });
    expect(result.available).toBe(true);
    if (!result.available) return;
    // Recorded from main@cca6707 before the refactor — see Step 2.
    expect(result.totalHours).toBeCloseTo(EXPECTED_TOTAL_HOURS, 10);
    expect(result.weeklyHours).toBeCloseTo(EXPECTED_WEEKLY_HOURS, 10);
    expect(result.queenStageHours).toBeCloseTo(EXPECTED_QUEEN_HOURS, 10);
    expect(result.queenStageKnown).toBe(false);
    expect(result.source).toBe("computed");
  });
});
```

- [ ] **Step 2: Record the real pre-refactor numbers**

The test above will not compile with placeholder identifiers. Get the real values from the **current, unmodified** implementation:

```bash
npx tsx -e '
import { eventDemand } from "./src/lib/race/demand";
const r = eventDemand({ eventDays: 1, distanceKm: 130, elevationM: 4000, stages: [], overrideWeeklyHours: null, ftpWatts: 310, massKg: 83 });
console.log(JSON.stringify(r, null, 2));
'
```

Replace `EXPECTED_TOTAL_HOURS`, `EXPECTED_WEEKLY_HOURS` and `EXPECTED_QUEEN_HOURS` in the test with the printed values, written as literals to full precision. Do this **before** touching `demand.ts` — the whole point is that they come from the old code.

Note the current shape is `EventDemand | null`, so `result.available` will not exist yet. That is expected; the test fails to compile until Step 4.

- [ ] **Step 3: Run the test to verify it fails**

```bash
npx vitest run src/lib/race/demand.test.ts
```

Expected: FAIL — `Property 'available' does not exist on type 'EventDemand'`.

- [ ] **Step 4: Change the return type**

In `src/lib/race/demand.ts`, add above `EventDemandInput`:

```ts
/**
 * How much to trust the figure. The Domestique pattern: cap the confidence
 * and say so, rather than reporting a derived number flat.
 *
 *   high   — the athlete stated their finish time
 *   medium — modelled from an anchor the athlete set themselves
 *   low    — modelled from a synced or history-derived anchor, or from an
 *            average day rather than known stages
 */
export type DemandConfidence = "high" | "medium" | "low";

/**
 * Why no figure could be produced. A closed union, so a new refusal path
 * cannot be added without deciding what the athlete is told about it.
 */
export type DemandUnavailableReason =
  | "no_cycling_anchor"
  | "no_running_anchor"
  | "no_swim_anchor"
  | "unknown_triathlon_format"
  | "no_distance";

/**
 * One sentence per refusal, each naming the fix.
 *
 * These reach the athlete AND the coach from this one place, so the two
 * surfaces cannot say different things — the discipline assembleWeeklyTarget
 * already enforces for the hours number, applied to its provenance.
 */
export const DEMAND_UNAVAILABLE_COPY: Record<DemandUnavailableReason, string> =
  {
    no_cycling_anchor:
      "No FTP yet — set one in Settings, or add your expected finish time to this race.",
    no_running_anchor:
      "No threshold pace and not enough recent runs to derive one — set a threshold pace in Settings, or add your expected finish time to this race.",
    no_swim_anchor:
      "No recent swims to price the swim leg from — add your expected finish time to this race.",
    unknown_triathlon_format:
      "Unrecognised triathlon format, so the leg distances are unknown — add your expected finish time to this race.",
    no_distance:
      "No distance on this race yet — add one, or add your expected finish time.",
  };

/**
 * A discriminated result rather than `EventDemand | null`.
 *
 * The null return is what let F3 hide for four releases: `volume.ts` took its
 * `raceDemandHours == null` branch and reverted the entire race-driven volume
 * feature to `constraints.hoursPerWeek` without a word on any screen. A caller
 * cannot consume this type without handling the unavailable branch, which is
 * the same mechanism v0.39's `Carried<>` and v0.40's `Record<SecurityEvent,
 * true>` witness use: put the guarantee in the compiler, not in a reviewer.
 */
export type EventDemandResult =
  | ({ available: true } & EventDemand)
  | { available: false; reason: DemandUnavailableReason };
```

Add the two fields to `EventDemand`, after `source`:

```ts
  source: "computed" | "override";
  confidence: DemandConfidence;
  /** One sentence saying where the number came from. Athlete-facing. */
  confidenceReason: string;
}
```

Change the signature and every `return null` in `eventDemand`:

```ts
export function eventDemand(input: EventDemandInput): EventDemandResult {
  const ftpWatts = input.ftpWatts;
  if (ftpWatts == null || ftpWatts <= 0) {
    return { available: false, reason: "no_cycling_anchor" };
  }
```

and:

```ts
if (totalHours == null) {
  return { available: false, reason: "no_distance" };
}
```

and the final return:

```ts
return {
  available: true,
  totalHours,
  dailyRateHours,
  queenStageHours: queen,
  queenStageKnown,
  weeklyHours: useOverride ? override : computedWeekly,
  source: useOverride ? "override" : "computed",
  // Task 5 replaces this with real sport-aware provenance. Until then the
  // cycling path reports what it has always been: a modelled figure.
  confidence: "medium",
  confidenceReason: "Modelled from your FTP and the course profile.",
};
```

Leave every other line of the arithmetic untouched.

- [ ] **Step 5: Fix the two call sites**

In `src/lib/week-plan/volume-inputs.ts`, change the `demand` local and the result field. Replace:

```ts
let demand: EventDemand | null = null;
```

with:

```ts
let demand: EventDemandResult | null = null;
```

and update the import and the `VolumeInputsResult` interface field to `demand: EventDemandResult | null` (still nullable — `null` here means "no target race at all", which is a different thing from "a race we could not price").

In `src/app/train/page.tsx`, replace the `feasibility` block's guard:

```ts
const feasibility =
  volumeInputs.demand == null ||
  !volumeInputs.demand.available ||
  weeksUntilEvent == null
    ? null
    : assessFeasibility({
        requiredWeeklyHours: volumeInputs.demand.weeklyHours,
        currentWeeklyHours: volumeInputs.level.peakHours,
        queenStageHours: volumeInputs.demand.queenStageHours,
        queenStageKnown: volumeInputs.demand.queenStageKnown,
        longestRideHours: volumeInputs.longestRideHours,
        weeksUntilEvent,
      });

if (volumeInputs.targetRace && volumeInputs.demand?.available && feasibility) {
  eventReadiness = {
    raceName: volumeInputs.targetRace.name,
    feasibility,
    demand: volumeInputs.demand,
  };
}
```

Then find every other `raceDemandHours:` argument built from `demand` and route it through the `available` check — `npm run typecheck` enumerates them.

- [ ] **Step 6: Run typecheck and the full suite**

```bash
npm run typecheck && npm test
```

Expected: PASS. The freeze test from Step 1 must be green — if it is not, the refactor moved a cycling number and that must be found before continuing.

- [ ] **Step 7: Commit**

```bash
git add src/lib/race/demand.ts src/lib/race/demand.test.ts src/lib/week-plan/volume-inputs.ts src/app/train/page.tsx
git commit -m "refactor(race): demand refuses out loud instead of returning null"
```

---

## Task 5: The sport dispatch

**Files:**

- Modify: `src/lib/race/demand.ts`
- Test: `src/lib/race/demand.test.ts`

**Interfaces:**

- Consumes: `estimateRunningHours` (Task 2), `estimateSwimHours` + `triathlonLegsFor` (Task 3).
- Produces: `EventDemandInput` gains `sport`, `raceType`, `expectedFinishHours`, `runPace`, `swimPace`; `ftpWatts` becomes `ftp: { watts: number; athleteSet: boolean } | null`.

- [ ] **Step 1: Write the failing dispatch tests**

Add to `src/lib/race/demand.test.ts`:

```ts
describe("eventDemand dispatches on sport", () => {
  const RUNNER = {
    sport: "Run" as const,
    raceType: "marathon",
    eventDays: 1,
    distanceKm: 42.2,
    elevationM: 0,
    stages: [],
    overrideWeeklyHours: null,
    expectedFinishHours: null,
    ftp: { watts: 310, athleteSet: true },
    massKg: 83,
    runPace: { secPerKm: 300, athleteSet: true },
    swimPace: null,
  };

  it("prices a marathon as a run even when the athlete has an FTP", () => {
    // This is F3. Before v0.46 this returned ~1.2 h of CYCLING against a real
    // 3-4 h run — understated by a factor of three, silently.
    const result = eventDemand(RUNNER);
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.totalHours).toBeGreaterThan(3.5);
    expect(result.totalHours).toBeLessThan(4.0);
  });

  it("refuses a run with no pace anchor instead of falling back to the FTP", () => {
    const result = eventDemand({ ...RUNNER, runPace: null });
    expect(result.available).toBe(false);
    if (result.available) return;
    expect(result.reason).toBe("no_running_anchor");
  });

  it("sums three legs for a triathlon", () => {
    const result = eventDemand({
      ...RUNNER,
      sport: "Triathlon",
      raceType: "ironman",
      distanceKm: 226,
      swimPace: { secPer100m: 120, athleteSet: true },
    });
    expect(result.available).toBe(true);
    if (!result.available) return;
    // 1.27 h swim + a 180 km ride + a 42.2 km run. A sub-9 or over-17 total
    // would mean a leg was dropped or double-counted.
    expect(result.totalHours).toBeGreaterThan(9);
    expect(result.totalHours).toBeLessThan(17);
  });

  it("refuses a triathlon whose format has no known leg distances", () => {
    const result = eventDemand({
      ...RUNNER,
      sport: "Triathlon",
      raceType: "club champs relay",
      distanceKm: 100,
      swimPace: { secPer100m: 120, athleteSet: true },
    });
    expect(result.available).toBe(false);
    if (result.available) return;
    expect(result.reason).toBe("unknown_triathlon_format");
  });

  it("refuses a triathlon it cannot price the swim leg of", () => {
    // No partial pricing: a dropped leg would understate the whole event.
    const result = eventDemand({
      ...RUNNER,
      sport: "Triathlon",
      raceType: "ironman",
      distanceKm: 226,
      swimPace: null,
    });
    expect(result.available).toBe(false);
    if (result.available) return;
    expect(result.reason).toBe("no_swim_anchor");
  });

  it("attributes a triathlon's stated elevation to the bike leg", () => {
    const flat = eventDemand({
      ...RUNNER,
      sport: "Triathlon",
      raceType: "ironman",
      distanceKm: 226,
      elevationM: 0,
      swimPace: { secPer100m: 120, athleteSet: true },
    });
    const hilly = eventDemand({
      ...RUNNER,
      sport: "Triathlon",
      raceType: "ironman",
      distanceKm: 226,
      elevationM: 2000,
      swimPace: { secPer100m: 120, athleteSet: true },
    });
    expect(flat.available && hilly.available).toBe(true);
    if (!flat.available || !hilly.available) return;
    expect(hilly.totalHours).toBeGreaterThan(flat.totalHours);
  });
});

describe("eventDemand reports its confidence", () => {
  const BASE = {
    sport: "Run" as const,
    raceType: "marathon",
    eventDays: 1,
    distanceKm: 42.2,
    elevationM: 0,
    stages: [],
    overrideWeeklyHours: null,
    expectedFinishHours: null,
    ftp: null,
    massKg: 83,
    runPace: { secPerKm: 300, athleteSet: true },
    swimPace: null,
  };

  it("is high when the athlete stated their finish time", () => {
    const result = eventDemand({ ...BASE, expectedFinishHours: 3.75 });
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.confidence).toBe("high");
    expect(result.totalHours).toBe(3.75);
  });

  it("uses the stated time even with no anchor at all", () => {
    // This is the cold-start path: a first-time athlete has no history, but
    // does know what they are targeting.
    const result = eventDemand({
      ...BASE,
      runPace: null,
      expectedFinishHours: 4.5,
    });
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.totalHours).toBe(4.5);
  });

  it("is medium when every anchor used was set by the athlete", () => {
    const result = eventDemand(BASE);
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.confidence).toBe("medium");
  });

  it("is low when any anchor used was derived rather than set", () => {
    const result = eventDemand({
      ...BASE,
      runPace: { secPerKm: 300, athleteSet: false },
    });
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.confidence).toBe("low");
  });

  it("takes the weakest anchor across a triathlon's three legs", () => {
    const result = eventDemand({
      ...BASE,
      sport: "Triathlon",
      raceType: "ironman",
      distanceKm: 226,
      ftp: { watts: 310, athleteSet: true },
      runPace: { secPerKm: 300, athleteSet: true },
      swimPace: { secPer100m: 120, athleteSet: false },
    });
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.confidence).toBe("low");
  });

  it("always carries a non-empty reason sentence", () => {
    for (const input of [
      BASE,
      { ...BASE, expectedFinishHours: 3.75 },
      { ...BASE, runPace: { secPerKm: 300, athleteSet: false } },
    ]) {
      const result = eventDemand(input);
      expect(result.available).toBe(true);
      if (!result.available) continue;
      expect(result.confidenceReason.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/lib/race/demand.test.ts
```

Expected: FAIL — the new input fields do not exist on `EventDemandInput`.

- [ ] **Step 3: Widen the input type**

In `src/lib/race/demand.ts`, replace `EventDemandInput`:

Each anchor carries its own unit in its field name (`watts`, `secPerKm`,
`secPer100m`) rather than a shared generic `value`. A generic wrapper reads
worse at four call sites and buys nothing here — there are exactly three
anchors and they never vary together.

```ts
export interface EventDemandInput {
  /** The dispatch key. Stored on every race since v0.42. */
  sport: PlanSport;
  /** Free text or the plan tool's enum; normalised before use. */
  raceType: string;
  eventDays: number;
  /** TOTAL across all days. Ignored when `stages` are supplied. */
  distanceKm: number | null;
  elevationM: number | null;
  stages: EventStage[];
  overrideWeeklyHours: number | null;
  /**
   * The athlete's own figure for how long THE EVENT takes. Wins over every
   * model, needs no anchor, and skips leg pricing entirely.
   */
  expectedFinishHours: number | null;
  ftp: { watts: number; athleteSet: boolean } | null;
  massKg: number | null;
  runPace: { secPerKm: number; athleteSet: boolean } | null;
  swimPace: { secPer100m: number; athleteSet: boolean } | null;
}
```

Add the imports at the top:

```ts
import type { PlanSport } from "@/lib/plan-sport";
import { estimateRunningHours } from "./running-time";
import { estimateSwimHours } from "./swim-time";
import { triathlonLegsFor } from "./triathlon-legs";
```

- [ ] **Step 4: Extract the duration step behind a sport dispatch**

Replace the body of `eventDemand` from the `ftpWatts` guard down to `if (totalHours == null) return ...` with the following. Everything **below** that point — `dailyRateHours`, the `ratio`, the override — is unchanged.

```ts
/** What the duration step produced, plus the provenance of what it used. */
interface Priced {
  totalHours: number;
  queenStageHours: number | null;
  queenStageKnown: boolean;
  /** False as soon as any anchor used was derived rather than athlete-set. */
  allAnchorsAthleteSet: boolean;
}

/** Prices one distance/elevation pair for one sport, or says why it cannot. */
function priceLeg(
  sport: "Bike" | "Run",
  distanceKm: number,
  elevationM: number,
  input: EventDemandInput
): { hours: number } | { reason: DemandUnavailableReason } {
  if (sport === "Bike") {
    if (input.ftp == null || input.ftp.watts <= 0) {
      return { reason: "no_cycling_anchor" };
    }
    const hours = estimateRidingHours({
      distanceKm,
      elevationM,
      ftpWatts: input.ftp.watts,
      massKg: input.massKg ?? C.DEFAULT_MASS_KG,
    });
    return hours == null ? { reason: "no_distance" } : { hours };
  }
  if (input.runPace == null || input.runPace.secPerKm <= 0) {
    return { reason: "no_running_anchor" };
  }
  const hours = estimateRunningHours({
    distanceKm,
    elevationM,
    thresholdPaceSecPerKm: input.runPace.secPerKm,
  });
  return hours == null ? { reason: "no_distance" } : { hours };
}
```

- [ ] **Step 5: Write the dispatch itself**

`days` is already computed near the top of `eventDemand` and stays there,
above the dispatch — all three branches need it. Declare the three
accumulators just below it:

```ts
const days = Math.max(1, Math.floor(input.eventDays || 1));
let priced: Priced;
let confidence: DemandConfidence | null = null;
let confidenceReason = "";
```

Then the dispatch:

```ts
// 1. A stated finish time wins outright and needs no anchor. This is what
//    rescues every refusal below: an unrecognised triathlon format, a
//    missing swim history and a runner with no threshold pace are all
//    answered by one number the athlete already knows.
if (input.expectedFinishHours != null && input.expectedFinishHours > 0) {
  priced = {
    totalHours: input.expectedFinishHours,
    queenStageHours: null,
    queenStageKnown: false,
    allAnchorsAthleteSet: true,
  };
  confidence = "high";
  confidenceReason = "Your expected finish time.";
} else if (input.sport === "Triathlon") {
  // 2. Legs come from the format, not from distanceKm — a triathlon's
  //    226 km total does not decompose into 3.8 / 180 / 42.2.
  const legs = triathlonLegsFor(input.raceType);
  if (legs == null) {
    return { available: false, reason: "unknown_triathlon_format" };
  }
  if (input.swimPace == null || input.swimPace.secPer100m <= 0) {
    return { available: false, reason: "no_swim_anchor" };
  }
  const swimHours = estimateSwimHours(legs.swimKm, input.swimPace.secPer100m);
  if (swimHours == null) {
    return { available: false, reason: "no_swim_anchor" };
  }
  // A triathlon's climbing is overwhelmingly on the bike. Documented
  // approximation, not a measurement.
  const bike = priceLeg("Bike", legs.bikeKm, input.elevationM ?? 0, input);
  if ("reason" in bike) return { available: false, reason: bike.reason };
  const run = priceLeg("Run", legs.runKm, 0, input);
  if ("reason" in run) return { available: false, reason: run.reason };

  priced = {
    totalHours: swimHours + bike.hours + run.hours,
    queenStageHours: null,
    queenStageKnown: false,
    allAnchorsAthleteSet:
      input.swimPace.athleteSet &&
      (input.ftp?.athleteSet ?? false) &&
      (input.runPace?.athleteSet ?? false),
  };
} else {
  // 3. Bike and Run share the stage / average-day structure. This is the
  //    pre-v0.46 body with estimateRidingHours swapped for priceLeg, and
  //    it must stay structurally identical — the Task 4 freeze test is the
  //    proof that it did.
  const sport = input.sport; // narrowed to "Bike" | "Run" by the branch above

  // priceLeg requires distanceKm > 0 and refuses otherwise — an
  // elevation-only stage would silently `continue` past the loop below,
  // shrinking the sum's day-count without shrinking `days` (the ratio
  // divisor), understating demand. Require distance here, at the same
  // boundary, so a stage is either fully usable or fully excluded.
  const usable = input.stages.filter((s) => (s.distanceKm ?? 0) > 0);

  let totalHours: number | null = null;
  let queenStageHours: number | null = null;
  let queenStageKnown = false;

  if (usable.length > 0) {
    let sum = 0;
    let hardest = 0;
    for (const stage of usable) {
      const leg = priceLeg(
        sport,
        stage.distanceKm ?? 0,
        stage.elevationM ?? 0,
        input
      );
      // A MISSING ANCHOR refuses the whole event; only an unusable
      // DISTANCE skips a stage. Collapsing the two would let a runner with
      // no pace anchor fall through to the average-day path and refuse
      // there by luck rather than by design — and a stage race would then
      // report a total built from however many stages happened to price.
      if ("reason" in leg) {
        if (leg.reason !== "no_distance") {
          return { available: false, reason: leg.reason };
        }
        continue;
      }
      sum += leg.hours;
      hardest = Math.max(hardest, leg.hours);
    }
    if (sum > 0) {
      totalHours = sum;
      queenStageHours = hardest;
      // Only claim the hardest day is truly KNOWN when every event day
      // contributed a usable stage — unchanged from pre-v0.46, including
      // the reasoning in the comment there.
      queenStageKnown = usable.length >= days;
    }
  }

  if (totalHours == null) {
    // Without stage data, estimate the AVERAGE DAY and multiply. Pricing
    // the whole event as one continuous effort would charge an 8-day tour
    // the deep-fatigue fraction a rider earns only by riding 42 hours
    // without sleeping.
    const perDay = priceLeg(
      sport,
      (input.distanceKm ?? 0) / days,
      (input.elevationM ?? 0) / days,
      input
    );
    if ("reason" in perDay) {
      return { available: false, reason: perDay.reason };
    }
    totalHours = perDay.hours * days;
  }

  priced = {
    totalHours,
    queenStageHours,
    queenStageKnown,
    allAnchorsAthleteSet:
      sport === "Bike"
        ? (input.ftp?.athleteSet ?? false)
        : (input.runPace?.athleteSet ?? false),
  };
}
```

Below the dispatch, the ratio, the override and the return are unchanged
except that they now read from `priced`:

```ts
const dailyRateHours = priced.totalHours / days;
const queen = priced.queenStageKnown ? priced.queenStageHours! : dailyRateHours;
```

Then, after `priced` is resolved and before the ratio:

```ts
if (confidence == null) {
  confidence = priced.allAnchorsAthleteSet ? "medium" : "low";
  confidenceReason = priced.allAnchorsAthleteSet
    ? ANCHOR_SET_COPY[input.sport]
    : ANCHOR_DERIVED_COPY[input.sport];
}
```

with, near `DEMAND_UNAVAILABLE_COPY`:

```ts
const ANCHOR_SET_COPY: Record<PlanSport, string> = {
  Bike: "Modelled from your FTP and the course profile.",
  Run: "Modelled from your threshold pace and the course profile.",
  Triathlon: "Modelled from your own thresholds and the standard distances.",
};

const ANCHOR_DERIVED_COPY: Record<PlanSport, string> = {
  Bike: "Estimated from your synced FTP — set one in Settings for a sharper figure.",
  Run: "Estimated from your recent runs — set a threshold pace in Settings for a sharper figure.",
  Triathlon:
    "Estimated partly from your recent sessions — set your thresholds in Settings for a sharper figure.",
};
```

- [ ] **Step 6: Run the full demand suite**

```bash
npx vitest run src/lib/race/demand.test.ts
```

Expected: PASS, including the Task 4 freeze test. The freeze test now needs `sport: "Bike"`, `raceType: "gran_fondo"`, `ftp: { watts: 310, athleteSet: true }`, `expectedFinishHours: null`, `runPace: null`, `swimPace: null` added to its fixture — the **numbers must not change**. If any of the three frozen values moves, the Bike branch is no longer equivalent; find the difference rather than re-recording.

- [ ] **Step 7: Commit**

```bash
git add src/lib/race/demand.ts src/lib/race/demand.test.ts
git commit -m "feat(race): demand knows its sport"
```

---

## Task 6: The history-derived anchors

**Files:**

- Create: `src/lib/week-plan/anchors.ts`
- Test: `src/lib/week-plan/anchors.test.ts`

**Interfaces:**

- Consumes: `thresholdPaceFromPerformance` (Task 2), `canonicalSport` (`@/lib/canonical-sport`).
- Produces:
  - `interface AnchorActivity { sport: string; distanceM: number | null; durationS: number | null }`
  - `ANCHOR_CONSTANTS: { WINDOW_DAYS: 180; MIN_RUN_KM: 5; MIN_SWIM_M: 400 }`
  - `thresholdPaceFromHistory(activities: AnchorActivity[]): number | null`
  - `swimPaceFromHistory(activities: AnchorActivity[]): number | null`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/week-plan/anchors.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { swimPaceFromHistory, thresholdPaceFromHistory } from "./anchors";

const run = (km: number, minutes: number) => ({
  sport: "Run",
  distanceM: km * 1000,
  durationS: minutes * 60,
});

describe("thresholdPaceFromHistory", () => {
  it("uses the fastest qualifying run, not the longest", () => {
    const pace = thresholdPaceFromHistory([
      run(30, 180), // long and slow: 6:00/km
      run(10, 45), // short and fast: 4:30/km
    ]);
    const fastOnly = thresholdPaceFromHistory([run(10, 45)]);
    expect(pace).toBeCloseTo(fastOnly!, 6);
  });

  it("ignores runs below the qualifying distance", () => {
    // A 3 km parkrun is a long Riegel extrapolation to a marathon; excluded.
    expect(thresholdPaceFromHistory([run(3, 12)])).toBeNull();
  });

  it("ignores activities that are not runs", () => {
    expect(
      thresholdPaceFromHistory([
        { sport: "Ride", distanceM: 40000, durationS: 3600 },
      ])
    ).toBeNull();
  });

  it("canonicalises the provider's word for running", () => {
    expect(
      thresholdPaceFromHistory([
        { sport: "TrailRun", distanceM: 10000, durationS: 2700 },
      ])
    ).not.toBeNull();
  });

  it("returns null with no usable history rather than guessing a pace", () => {
    expect(thresholdPaceFromHistory([])).toBeNull();
    expect(
      thresholdPaceFromHistory([
        { sport: "Run", distanceM: null, durationS: 2700 },
      ])
    ).toBeNull();
  });
});

describe("swimPaceFromHistory", () => {
  const swim = (metres: number, seconds: number) => ({
    sport: "Swim",
    distanceM: metres,
    durationS: seconds,
  });

  it("takes the median rather than the fastest", () => {
    // Medians resist one lucky sprint set in a way a max does not.
    const pace = swimPaceFromHistory([
      swim(1000, 1200), // 2:00/100m
      swim(1000, 1500), // 2:30/100m
      swim(1000, 1800), // 3:00/100m
    ]);
    expect(pace).toBeCloseTo(150, 6);
  });

  it("ignores swims below the qualifying distance", () => {
    expect(swimPaceFromHistory([swim(200, 240)])).toBeNull();
  });

  it("returns null with no usable history", () => {
    expect(swimPaceFromHistory([])).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/lib/week-plan/anchors.test.ts
```

Expected: FAIL — `Failed to resolve import "./anchors"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/week-plan/anchors.ts`:

```ts
/**
 * Anchors derived from the athlete's own history, for when they have not set
 * one themselves.
 *
 * Both are LOW confidence, and the running one for a reason worth stating
 * rather than assuming: nothing in `activities` distinguishes a hard effort
 * from an easy long run, so the fastest qualifying run is a FLOOR on the
 * athlete's ability, not a measurement of it. A well-trained athlete who has
 * raced nothing recently is under-anchored — and the direction of that error
 * is known and safe: demand comes out understated, never overstated.
 * `body_prefs.threshold_pace_sec_per_km` exists so the athlete can correct it.
 *
 * Pure — the caller does the database read. See volume-inputs.ts.
 */
import { canonicalSport } from "@/lib/canonical-sport";
import { thresholdPaceFromPerformance } from "@/lib/race/running-time";

export const ANCHOR_CONSTANTS = {
  /**
   * How far back to look. Wider than LEVEL_CONSTANTS.PEAK_WINDOW_WEEKS (12
   * weeks) on purpose: a rolling volume peak should be recent, but a
   * threshold is a slower-moving property and a 12-week window would miss a
   * whole off-season.
   */
  WINDOW_DAYS: 180,
  /**
   * Shortest run that anchors a threshold. Riegel is most accurate when the
   * reference is within a few multiples of the target, and a 3 km parkrun
   * extrapolated to a marathon is not.
   */
  MIN_RUN_KM: 5,
  /** Shortest swim that anchors a pace — below this, warm-up dominates. */
  MIN_SWIM_M: 400,
} as const;

export interface AnchorActivity {
  sport: string;
  distanceM: number | null;
  durationS: number | null;
}

function usable(
  a: AnchorActivity,
  discipline: string,
  minDistanceM: number
): { km: number; hours: number } | null {
  if (canonicalSport(a.sport) !== discipline) return null;
  const metres = a.distanceM ?? 0;
  const seconds = a.durationS ?? 0;
  if (metres < minDistanceM || seconds <= 0) return null;
  return { km: metres / 1000, hours: seconds / 3600 };
}

/**
 * Threshold pace in seconds per kilometre from the fastest qualifying run,
 * Riegel-converted to a one-hour reference so it enters the model on the same
 * footing as a pace the athlete typed in.
 */
export function thresholdPaceFromHistory(
  activities: AnchorActivity[]
): number | null {
  let best: number | null = null;
  for (const a of activities) {
    const u = usable(a, "Run", ANCHOR_CONSTANTS.MIN_RUN_KM * 1000);
    if (u == null) continue;
    const pace = thresholdPaceFromPerformance(u.km, u.hours);
    if (pace == null) continue;
    // Lower seconds-per-km is faster.
    if (best == null || pace < best) best = pace;
  }
  return best;
}

/**
 * Median swim pace in seconds per 100 m.
 *
 * Median rather than fastest: unlike the running anchor, a pool session is
 * already a fair reading of sustainable pace, and a median resists one sprint
 * set in a way a maximum does not.
 */
export function swimPaceFromHistory(
  activities: AnchorActivity[]
): number | null {
  const paces: number[] = [];
  for (const a of activities) {
    const u = usable(a, "Swim", ANCHOR_CONSTANTS.MIN_SWIM_M);
    if (u == null) continue;
    paces.push((u.hours * 3600) / (u.km * 10));
  }
  if (paces.length === 0) return null;
  paces.sort((x, y) => x - y);
  const mid = Math.floor(paces.length / 2);
  return paces.length % 2 === 1
    ? paces[mid]
    : (paces[mid - 1] + paces[mid]) / 2;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/lib/week-plan/anchors.test.ts
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/week-plan/anchors.ts src/lib/week-plan/anchors.test.ts
git commit -m "feat(volume): derive a running and swim anchor from the athlete's own history"
```

---

## Task 7: Wire it up, and fix the sport-blind longest session

**Files:**

- Modify: `src/lib/week-plan/volume-inputs.ts`
- Test: `src/lib/week-plan/volume-inputs.test.ts`

**Interfaces:**

- Consumes: everything from Tasks 2–6.
- Produces: `longestSessionHoursOf(activities: HistoryActivity[], disciplines: readonly string[]): number | null`; `HistoryActivity` gains `sport: string`; `VolumeInputsResult.longestRideHours` → `longestSessionHours`.

- [ ] **Step 1: Write the failing test for the sport filter**

Add to `src/lib/week-plan/volume-inputs.test.ts`:

```ts
describe("longestSessionHoursOf", () => {
  const act = (sport: string, hours: number, day: number) => ({
    provider: "intervals_icu",
    sport,
    startDate: new Date(2026, 6, day),
    durationS: hours * 3600,
  });

  it("ignores sessions outside the race's disciplines", () => {
    // F3b: before v0.46 this returned the longest activity of ANY kind, so a
    // triathlete's marathon readiness was answered by their longest bike ride.
    const longest = longestSessionHoursOf(
      [act("Ride", 6, 1), act("Run", 2, 2)],
      ["Run"]
    );
    expect(longest).toBe(2);
  });

  it("counts every discipline of a triathlon", () => {
    expect(
      longestSessionHoursOf(
        [act("Ride", 6, 1), act("Run", 2, 2), act("Swim", 1, 3)],
        ["Swim", "Bike", "Run"]
      )
    ).toBe(6);
  });

  it("canonicalises the provider's word before comparing", () => {
    // "Bike".includes("Ride") is false for every cyclist who has ever used
    // this app — the mistake plan-sport.ts:166-173 already warns about.
    expect(longestSessionHoursOf([act("Ride", 6, 1)], ["Bike"])).toBe(6);
  });

  it("returns null when no session matches, rather than zero", () => {
    expect(longestSessionHoursOf([act("Ride", 6, 1)], ["Run"])).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/lib/week-plan/volume-inputs.test.ts
```

Expected: FAIL — `longestSessionHoursOf is not exported`.

- [ ] **Step 3: Add `sport` to `HistoryActivity` and replace the function**

In `src/lib/week-plan/volume-inputs.ts`:

```ts
export interface HistoryActivity {
  provider: string;
  sport: string;
  startDate: Date;
  durationS: number | null;
}
```

Replace `longestRideHoursOf` entirely:

```ts
/**
 * Longest single de-duplicated session in the window that counts as one of
 * `disciplines`, in hours.
 *
 * The sport filter is the whole point. Before v0.46 this took the longest
 * activity of ANY kind — it was named for a ride and computed the longest
 * anything — so a triathlete's marathon readiness was answered by their
 * longest bike ride, and a cyclist who hikes could have a long walk outrank
 * every ride they own.
 */
export function longestSessionHoursOf(
  activities: HistoryActivity[],
  disciplines: readonly string[]
): number | null {
  const wanted = new Set(disciplines);
  const unique = dedupeActivities(
    activities
      .filter((a) => wanted.has(canonicalSport(a.sport)))
      .map((a) => ({
        provider: a.provider,
        startDate: a.startDate,
        durationS: a.durationS,
        load: null,
        avgHr: null,
        avgPower: null,
      }))
  );
  let longest = 0;
  for (const a of unique)
    longest = Math.max(longest, (a.durationS ?? 0) / 3600);
  return longest > 0 ? longest : null;
}
```

Import `canonicalSport` from `@/lib/canonical-sport` and `disciplinesOf` from `@/lib/plan-sport`.

- [ ] **Step 4: Widen the history query and add the anchor query**

In `assembleVolumeInputs`, add `sport: r.sport` to the `history` mapping.

The existing `rows` query is floored at `weeks * 7` days (12 weeks = 84 days), which is **narrower than `ANCHOR_CONSTANTS.WINDOW_DAYS` (180)**. Do **not** widen the existing query — that would change `athleteLevel`'s rolling peak and move the reporting cyclist's numbers, which Global Constraints forbid. Add a second, separate query:

```ts
const anchorFloor = new Date(now);
anchorFloor.setDate(anchorFloor.getDate() - ANCHOR_CONSTANTS.WINDOW_DAYS);
```

and add a fifth entry to the `Promise.all` array, extending the destructuring
to match — the array and the destructuring are positional, so a name added to
one and not the other silently shifts every variable after it:

```ts
const [rows, wellness, prefs, races, anchorRows] = await Promise.all([
  // ...the four existing queries, unchanged...
  db.query.activities.findMany({
    where: and(
      eq(schema.activities.userId, userId),
      gte(schema.activities.startDate, anchorFloor)
    ),
    columns: { sport: true, distanceM: true, durationS: true },
  }),
]);
```

- [ ] **Step 5: Build the demand input from the race's sport**

Replace the `eventDemand({...})` call:

```ts
const runPaceSet = prefs?.thresholdPaceSecPerKm ?? null;
const runPaceDerived =
  runPaceSet == null ? thresholdPaceFromHistory(anchorRows) : null;
const swimDerived = swimPaceFromHistory(anchorRows);
const ftpSet = prefs?.ftpWatts ?? null;
const ftpSynced = latestEftp != null ? Math.round(latestEftp) : null;

demand = eventDemand({
  sport: target.sport,
  raceType: target.raceType,
  eventDays: target.eventDays ?? 1,
  distanceKm: target.distanceKm,
  elevationM: target.elevationM,
  stages: stages.map((s) => ({
    dayNumber: s.dayNumber,
    distanceKm: s.distanceKm,
    elevationM: s.elevationM,
  })),
  overrideWeeklyHours: target.demandHoursOverride,
  expectedFinishHours: target.expectedFinishHours,
  ftp:
    ftpSet != null
      ? { watts: ftpSet, athleteSet: true }
      : ftpSynced != null
        ? { watts: ftpSynced, athleteSet: false }
        : null,
  // Rider weight plus an allowance for bike and kit.
  massKg: latestWeight != null ? latestWeight + 8 : null,
  runPace:
    runPaceSet != null
      ? { secPerKm: runPaceSet, athleteSet: true }
      : runPaceDerived != null
        ? { secPerKm: runPaceDerived, athleteSet: false }
        : null,
  swimPace:
    swimDerived != null ? { secPer100m: swimDerived, athleteSet: false } : null,
});
```

Then replace the `longestRideHours` result field:

```ts
    longestSessionHours: target
      ? longestSessionHoursOf(history, disciplinesOf(target.sport))
      : null,
```

and rename the field on `VolumeInputsResult` to match.

- [ ] **Step 6: Run typecheck, then the full suite**

```bash
npm run typecheck && npm test
```

Expected: PASS. `npm run typecheck` enumerates every consumer of the renamed field — `src/app/train/page.tsx` and `src/lib/week-plan/project.ts` at minimum. Follow it until clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/week-plan/volume-inputs.ts src/lib/week-plan/volume-inputs.test.ts src/app/train/page.tsx src/lib/week-plan/project.ts
git commit -m "fix(volume): the longest session is one the race's sport counts"
```

---

## Task 8: Feasibility speaks about sessions, not rides

**Files:**

- Modify: `src/lib/race/feasibility.ts`
- Test: `src/lib/race/feasibility.test.ts`

**Interfaces:**

- Produces: `FeasibilityInput.longestSessionHours`, `Feasibility.requiredLongestSessionHours`, `Feasibility.longestSessionWeeksNeeded`.

- [ ] **Step 1: Rename the three fields**

In `src/lib/race/feasibility.ts`: `longestRideHours` → `longestSessionHours` on the input; `requiredLongestRideHours` → `requiredLongestSessionHours` and `longestRideWeeksNeeded` → `longestSessionWeeksNeeded` on the output. Update every use inside the file, including the local `const requiredLongestRideHours`.

Leave `FEASIBILITY_CONSTANTS.LONGEST_RIDE_FRACTION` **named as it is** and add to its doc comment:

```ts
  /**
   * Longest training session needed, as a share of the hardest event day.
   *
   * Named for a ride because the evidence behind it IS cycling evidence: gran
   * fondo coaching calls the long ride the biggest predictor of finishing
   * (70-80% of event distance), CTS disputes it. v0.46 applies the same
   * fraction to running and triathlon because no better number was found —
   * NOT because it was validated there. Recorded as UNVALIDATED OUTSIDE
   * CYCLING in docs/specs/2026-08-07-race-demand-evidence.md. This is why the
   * rule can only ever soften a verdict by one step and can never, by itself,
   * reach "not_realistic".
   */
  LONGEST_RIDE_FRACTION: 0.8,
```

- [ ] **Step 2: Run typecheck and follow it to every call site**

```bash
npm run typecheck
```

Expected: FAIL, listing `src/app/train/page.tsx`, `src/components/plan/event-readiness.tsx` and `src/lib/race/feasibility.test.ts`. Update each to the new names.

- [ ] **Step 3: Run the suite**

```bash
npm test
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/race/feasibility.ts src/lib/race/feasibility.test.ts src/app/train/page.tsx src/components/plan/event-readiness.tsx
git commit -m "refactor(race): feasibility speaks about sessions, not rides"
```

---

## Task 9: The athlete sees the sport, the confidence, and the refusal

**Files:**

- Modify: `src/components/plan/event-readiness.tsx`
- Test: `src/components/plan/event-readiness.test.tsx`
- Modify: `src/components/plan/races-section.tsx`
- Modify: `src/components/settings/body-prefs-card.tsx`
- Modify: `src/app/settings/body-actions.ts`
- Modify: `src/app/settings/page.tsx:510`

**Interfaces:**

- Consumes: `EventDemandResult`, `DEMAND_UNAVAILABLE_COPY`, `PlanSport`.
- Produces: `EventReadiness` takes `sport: PlanSport` and `demand: EventDemandResult`.

- [ ] **Step 1: Write the failing UI tests**

Add to `src/components/plan/event-readiness.test.tsx`:

```ts
it("says 'longest run' to a runner", () => {
  render(
    <EventReadiness
      raceName="Rotterdam Marathon"
      sport="Run"
      feasibility={{ ...feasibility }}
      demand={{ ...demand, available: true }}
    />
  );
  expect(screen.getByText(/longest run/i)).toBeInTheDocument();
  expect(screen.queryByText(/longest ride/i)).not.toBeInTheDocument();
});

it("says 'longest ride' to a cyclist, exactly as before", () => {
  render(
    <EventReadiness
      raceName="Dolomites Fondo"
      sport="Bike"
      feasibility={{ ...feasibility }}
      demand={{ ...demand, available: true }}
    />
  );
  expect(screen.getByText(/longest ride/i)).toBeInTheDocument();
});

it("shows the confidence reason for every available figure", () => {
  render(
    <EventReadiness
      raceName="Rotterdam Marathon"
      sport="Run"
      feasibility={{ ...feasibility }}
      demand={{
        ...demand,
        available: true,
        confidence: "low",
        confidenceReason: "Estimated from your recent runs.",
      }}
    />
  );
  expect(screen.getByText(/Estimated from your recent runs/i)).toBeInTheDocument();
});

it("says WHY there is no figure instead of rendering nothing", () => {
  // The whole point of v0.46: before this, an unpriceable race produced a
  // silent fallback and an empty screen.
  render(
    <EventReadiness
      raceName="Ironman Hamburg"
      sport="Triathlon"
      feasibility={null}
      demand={{ available: false, reason: "no_swim_anchor" }}
    />
  );
  expect(screen.getByText(/no recent swims/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/components/plan/event-readiness.test.tsx
```

Expected: FAIL — `sport` is not a prop, and `feasibility` is not nullable.

- [ ] **Step 3: Update the component**

In `src/components/plan/event-readiness.tsx`:

```tsx
import type { PlanSport } from "@/lib/plan-sport";
import {
  DEMAND_UNAVAILABLE_COPY,
  type EventDemandResult,
} from "@/lib/race/demand";

interface Props {
  raceName: string;
  sport: PlanSport;
  /** Null when demand is unavailable — there is no verdict without a figure. */
  feasibility: Feasibility | null;
  demand: EventDemandResult;
}

/** What the athlete calls their longest session, for this sport. */
const LONGEST_NOUN: Record<PlanSport, string> = {
  Bike: "longest ride",
  Run: "longest run",
  Triathlon: "longest bike leg",
};
```

Add an early branch before the verdict block:

```tsx
if (!demand.available) {
  return (
    <div className="glass mt-4 rounded-[1.5rem] p-5">
      <p className="label-micro mb-1">{raceName}</p>
      <p className="mb-2 text-[13px] font-bold text-amber-300">
        No demand figure yet.
      </p>
      <p className="text-[11.5px] leading-relaxed text-white/60">
        {DEMAND_UNAVAILABLE_COPY[demand.reason]}
      </p>
    </div>
  );
}
if (feasibility == null) return null;
```

Replace the hardcoded noun at line 53:

```tsx
{
  `Asks about ${fmt(demand.weeklyHours)} a week, and a ${LONGEST_NOUN[sport]} of about ${fmt(requiredLongestSessionHours)}. ${weeks(weeksUntilEvent)} to go.`;
}
```

and the one at line 58 (`"You can still ride it"` → `"You can still do it"` for non-Bike; keep "ride" for Bike). Add the confidence line before the closing `</div>`:

```tsx
<p className="mt-2 text-[11px] text-white/40">{demand.confidenceReason}</p>
```

- [ ] **Step 4: Run the UI tests to verify they pass**

```bash
npx vitest run src/components/plan/event-readiness.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Add the expected-finish input to the race form**

In `src/components/plan/races-section.tsx`, add to `DemandFields`'s props (`expectedFinishHours: number | null`, `onExpectedFinishChange: (n: number | null) => void`) and render after the elevation input, following the exact markup of the fields beside it:

```tsx
      <label className="label-micro" htmlFor={`${idPrefix}expected-finish`}>
        Expected finish time (hours, optional)
      </label>
      <input
        id={`${idPrefix}expected-finish`}
        type="number"
        min={0}
        step={0.25}
        value={expectedFinishHours ?? ""}
        onChange={(e) =>
          onExpectedFinishChange(
            e.target.value === "" ? null : Number(e.target.value)
          )
        }
        className="w-full rounded-xl bg-white/[0.06] px-3 py-2 text-sm"
      />
      <p className="mt-1 text-[11px] text-white/50">
        If you know roughly how long this takes you, this beats every estimate
        we can make.
      </p>
```

Thread it through both the add form and the edit row (both use `DemandFields`; the edit row seeds local state from the race). Extend the server action that saves demand fields to accept and persist `expectedFinishHours`.

- [ ] **Step 6: Add the threshold-pace input to settings**

In `src/components/settings/body-prefs-card.tsx`, add `thresholdPaceSecPerKm: number | null` to `Props`, a `useState` beside `ftp`, and a third field in the "Training thresholds" grid labelled `Threshold pace (sec/km)` with `min={150} max={600} placeholder="e.g. 285"`. Pass it in `setBodyPrefs`.

In `src/app/settings/body-actions.ts`, add the bound constants and the validation, mirroring the FTP block exactly:

```ts
const MIN_THRESHOLD_PACE = 150;
const MAX_THRESHOLD_PACE = 600;
```

```ts
if (
  input.thresholdPaceSecPerKm != null &&
  (!Number.isInteger(input.thresholdPaceSecPerKm) ||
    input.thresholdPaceSecPerKm < MIN_THRESHOLD_PACE ||
    input.thresholdPaceSecPerKm > MAX_THRESHOLD_PACE)
) {
  return {
    ok: false,
    message: "Threshold pace must be between 150 and 600 seconds per km.",
  };
}
```

Add `thresholdPaceSecPerKm: input.thresholdPaceSecPerKm` to `values`. Do **not** add it to the `computeDailyMetrics` recompute trigger — the native load engine does not read pace, so recomputing 90 days on a pace change would be work with no effect.

In `src/app/settings/page.tsx:510`, pass `thresholdPaceSecPerKm={bodyPrefsRow?.thresholdPaceSecPerKm ?? null}`.

- [ ] **Step 7: Run the gate**

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

Expected: all four PASS. `npm run build` is the one that catches a sync export accidentally added to a `"use server"` file.

- [ ] **Step 8: Commit**

```bash
git add src/components src/app/settings
git commit -m "feat(ui): every demand figure says where it came from, in its own sport's words"
```

---

## Task 10: The coach reads the same provenance

**Note before starting:** `get-races.ts` has **no test file today** — create it.
It also has no access to demand: `execute` calls `listRaces` and
`stagesByRaceIds` only. This task adds the `assembleVolumeInputs` dependency.
`expectedFinishHours` needs no work here — `Projected<>` put it in the coach's
view automatically in Task 1, which is the point of that type.

**Files:**

- Modify: `src/lib/tools/get-races.ts:51-72`
- Create: `src/lib/tools/get-races.test.ts`

**Interfaces:**

- Consumes: `assembleVolumeInputs` (Task 7), `DEMAND_UNAVAILABLE_COPY` (Task 4).
- Produces: `ProjectedRace` gains `demandConfidence: DemandConfidence | null` and `demandNote: string | null`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/tools/get-races.test.ts`, following the convention in
`src/lib/tools/get-week-plan.test.ts` (same `hasDb` guard, same seed/teardown
shape):

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getRacesTool } from "./get-races";

// requires Postgres; skips without DATABASE_URL.
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const USER = "test-get-races-demand-user";

describe.skipIf(!hasDb)("get_races demand provenance", () => {
  beforeAll(async () => {
    // Seed the user, a marathon 20 weeks out, and enough recent running to
    // derive a pace anchor but no body_prefs threshold pace — the "low
    // confidence" path.
  });

  afterAll(async () => {
    await db.delete(schema.races).where(eq(schema.races.userId, USER));
  });

  it("hands the coach the same sentence the athlete's screen shows", async () => {
    // One string, one source. If the coach re-derived this, the two surfaces
    // could describe the same number differently — the exact failure
    // assembleWeeklyTarget exists to prevent for the hours figure.
    const result = await getRacesTool.execute(
      { status: "upcoming" },
      { userId: USER }
    );
    const race = result.races[0];
    expect(race.demandConfidence).toBe("low");
    expect(race.demandNote).toMatch(/recent runs/i);
  });

  it("tells the coach WHY there is no figure, rather than going quiet", async () => {
    // Remove the running history so no anchor can be derived.
    const result = await getRacesTool.execute(
      { status: "upcoming" },
      { userId: USER }
    );
    const race = result.races[0];
    expect(race.demandConfidence).toBeNull();
    expect(race.demandNote).toMatch(/threshold pace/i);
  });
});
```

Fill the two seeding bodies against this repo's existing helpers — copy the
insert shapes from `get-week-plan.test.ts` rather than inventing them.

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run src/lib/tools/get-races.test.ts
```

Expected: FAIL — `demandConfidence` does not exist on `ProjectedRace`. If it
instead reports **skipped**, `DATABASE_URL` is not set; export it and re-run,
because a skipped test proves nothing at this step.

- [ ] **Step 3: Add the two fields**

In `src/lib/tools/get-races.ts`, extend the intersection:

```ts
type ProjectedRace = Projected<typeof schema.races, WithheldRaceColumn> & {
  daysToRace: number;
  stages: RaceStageDetail[];
  /**
   * Set only on the race the volume model is currently targeting — the
   * highest priority, then nearest date. Null on every other race, and null
   * when no figure could be produced; `demandNote` then says why.
   */
  demandConfidence: DemandConfidence | null;
  /**
   * One sentence: where the number came from, or what to add so it can be
   * produced. Read straight off `assembleVolumeInputs` and never re-derived,
   * so the coach and the athlete's screen cannot disagree.
   */
  demandNote: string | null;
};
```

In `execute`, before the map:

```ts
const volume = await assembleVolumeInputs(ctx.userId, new Date());
const targetId = volume.targetRace?.id ?? null;
```

and in the object literal:

```ts
      demandConfidence:
        r.id === targetId && volume.demand?.available
          ? volume.demand.confidence
          : null,
      demandNote:
        r.id !== targetId || volume.demand == null
          ? null
          : volume.demand.available
            ? volume.demand.confidenceReason
            : DEMAND_UNAVAILABLE_COPY[volume.demand.reason],
```

Extend the tool's `description` string to name the two new fields, matching
the style of the existing sentence about `stages`. The description is what the
model reads to know the fields exist; leaving it stale is the same defect
class as F6, where a parameter documented behaviour that did not exist.

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/lib/tools/get-races.test.ts
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tools/get-races.ts src/lib/tools/get-races.test.ts
git commit -m "feat(coach): the coach sees a figure's confidence, not just the figure"
```

---

## Task 11: One definition of "this week" (F8)

**Note before starting:** `src/lib/weekly-review.ts` has **no tests at all** —
no `weekly-review.test.ts` exists and nothing else references it from a test.
It is also a long async DB function, so testing the window choice directly
would mean seeding wellness rows either side of a week boundary for a
one-line change.

Extract the window choice into a pure function instead, test that, and have
the DB function call it. This is the shape the rest of `src/lib` already
uses — pure modules with a thin database layer — and it makes the guard cheap
enough to actually bind. Full DB coverage of `weekly-review.ts` is real debt,
but it is not this release's debt; note it and move on.

**Files:**

- Modify: `src/lib/weekly-review.ts:221-231`
- Create: `src/lib/weekly-review-window.ts`
- Create: `src/lib/weekly-review-window.test.ts`

**Interfaces:**

- Produces: `ctlBaselineYmd(weekStartYmd: string): string`

- [ ] **Step 1: Write the failing test**

Create `src/lib/weekly-review-window.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ctlBaselineYmd } from "./weekly-review-window";

describe("ctlBaselineYmd", () => {
  it("baselines on the day before the week under review", () => {
    // The review's load, sessions and readiness all cover Mon-Sun. The CTL
    // delta must span the same days, so its baseline is the Sunday before.
    expect(ctlBaselineYmd("2026-08-03")).toBe("2026-08-02");
  });

  it("crosses a month boundary correctly", () => {
    expect(ctlBaselineYmd("2026-09-01")).toBe("2026-08-31");
  });

  it("crosses a year boundary correctly", () => {
    expect(ctlBaselineYmd("2026-01-04")).toBe("2026-01-03");
  });

  it("is not a rolling seven-day lookback", () => {
    // The defect: ctlDelta used `now - 7 days` while every other figure in
    // the same sentence used the calendar week. On any day but the week's
    // first, those are different days — and the sentence at
    // weekly-review.ts:262 renders both as "this week".
    const weekStart = "2026-08-03";
    const sevenAgoFromMidWeek = "2026-07-30"; // if `now` were Thu 6 Aug
    expect(ctlBaselineYmd(weekStart)).not.toBe(sevenAgoFromMidWeek);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/lib/weekly-review-window.test.ts
```

Expected: FAIL — `Failed to resolve import "./weekly-review-window"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/weekly-review-window.ts`:

```ts
/**
 * The day a weekly review's CTL delta is measured FROM.
 *
 * The review's load, sessions and average readiness all cover one calendar
 * week, and `weekly-review.ts:262` renders all four figures in a single
 * sentence. Before v0.46 the CTL delta alone used a rolling seven-day
 * lookback from `now`, so on any day but the week's first that sentence
 * carried two different definitions of "this week".
 *
 * Pure — no I/O, no clock. The caller supplies the week start.
 */
export function ctlBaselineYmd(weekStartYmd: string): string {
  // Parse at local midnight, not bare `new Date(ymd)`, which is UTC and
  // lands on the wrong day behind UTC — the same fix already applied in
  // race/debrief.ts, race/service.ts, race/taper.ts and volume-inputs.ts.
  const d = new Date(weekStartYmd + "T00:00:00");
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/lib/weekly-review-window.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Wire it into the review**

In `src/lib/weekly-review.ts`, replace the comment and the bound:

```ts
// CTL delta over the SAME calendar week as load, sessions and readiness —
// all four are rendered in one sentence below and must mean one thing.
const prevWellness = await db.query.wellnessDaily.findFirst({
  where: and(
    eq(schema.wellnessDaily.userId, userId),
    lte(schema.wellnessDaily.date, ctlBaselineYmd(weekStartYmd))
  ),
  orderBy: desc(schema.wellnessDaily.date),
});
```

`weekStartYmd` is whatever local already holds the first day of
`thisWeekDays` — read the surrounding function and use it rather than
recomputing. If `sevenAgoYmd` has no other consumer in the file, delete it;
`npm run lint` will flag it if it is now unused.

- [ ] **Step 6: Run the gate and commit**

```bash
npm run typecheck && npm test
git add src/lib/weekly-review.ts src/lib/weekly-review-window.ts src/lib/weekly-review-window.test.ts
git commit -m "fix(weekly-review): one definition of this week, not two"
```

---

## Task 12: Evidence, the output sweep, and the changelog

**Files:**

- Create: `docs/specs/2026-08-07-race-demand-evidence.md`
- Create: `scripts/demand-sweep.ts`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Write the evidence document**

Mirror `docs/specs/2026-08-06-periodize-evidence.md`'s structure. One row per new constant: value, source, confidence, and what would change it. Cover `RIEGEL_EXPONENT` (Medium), `VERTICAL_METRES_PER_FLAT_KM` (Low, convention), `SWIM_RACE_PACE_FACTOR` (Low, modelling choice), `ANCHOR_CONSTANTS.WINDOW_DAYS` / `MIN_RUN_KM` / `MIN_SWIM_M` (Low, judgement), the `TRIATHLON_LEGS` distances (High — definitional), and `LONGEST_RIDE_FRACTION` re-rated as **unvalidated outside cycling**.

Record the two rejected alternatives and why: the Minetti gradient model, and a default swim pace.

- [ ] **Step 2: Write the sweep script**

Create `scripts/demand-sweep.ts`:

```ts
/**
 * Prints real demand output for READING, not asserting.
 *
 * Every one of v0.45's four genuine defects was code that worked, passed its
 * tests, and quietly did something else — an extra loading week per
 * mesocycle, a 12-week plan losing its peak phase entirely, a cold-start race
 * week at 20% of intended load. All four were caught by looking at
 * week-by-week output. None were caught by a test.
 *
 * Run: npx tsx scripts/demand-sweep.ts
 */
import { eventDemand } from "../src/lib/race/demand";
import { estimateRunningHours } from "../src/lib/race/running-time";
import { estimateSwimHours } from "../src/lib/race/swim-time";
import { triathlonLegsFor } from "../src/lib/race/triathlon-legs";

const hhmm = (h: number) =>
  `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;

console.log("\n=== MARATHON, by threshold pace and climbing ===");
console.log("pace(s/km)  flat    +500m   +1000m  +2000m");
for (const secPerKm of [240, 270, 300, 330]) {
  const row = [0, 500, 1000, 2000].map((elevationM) => {
    const h = estimateRunningHours({
      distanceKm: 42.2,
      elevationM,
      thresholdPaceSecPerKm: secPerKm,
    })!;
    return hhmm(h).padEnd(8);
  });
  console.log(`${String(secPerKm).padEnd(11)} ${row.join("")}`);
}

console.log("\n=== TRIATHLON, leg by leg ===");
for (const raceType of ["ironman", "70.3"]) {
  const legs = triathlonLegsFor(raceType)!;
  const swim = estimateSwimHours(legs.swimKm, 120)!;
  const run = estimateRunningHours({
    distanceKm: legs.runKm,
    elevationM: 0,
    thresholdPaceSecPerKm: 300,
  })!;
  const total = eventDemand({
    sport: "Triathlon",
    raceType,
    eventDays: 1,
    distanceKm: null,
    elevationM: 0,
    stages: [],
    overrideWeeklyHours: null,
    expectedFinishHours: null,
    ftp: { watts: 250, athleteSet: true },
    massKg: 83,
    runPace: { secPerKm: 300, athleteSet: true },
    swimPace: { secPer100m: 120, athleteSet: true },
  });
  if (!total.available) {
    console.log(`${raceType}: UNAVAILABLE (${total.reason})`);
    continue;
  }
  // Bike printed as the remainder so a dropped or double-counted leg shows.
  const bike = total.totalHours - swim - run;
  console.log(
    `${raceType.padEnd(9)} swim ${hhmm(swim)}  bike ${hhmm(bike)}  run ${hhmm(run)}  TOTAL ${hhmm(total.totalHours)}  weekly ${total.weeklyHours.toFixed(2)}h  [${total.confidence}]`
  );
}

console.log("\n=== FONDO FREEZE (must equal the Task 4 recorded values) ===");
const fondo = eventDemand({
  sport: "Bike",
  raceType: "gran_fondo",
  eventDays: 1,
  distanceKm: 130,
  elevationM: 4000,
  stages: [],
  overrideWeeklyHours: null,
  expectedFinishHours: null,
  ftp: { watts: 310, athleteSet: true },
  massKg: 83,
  runPace: null,
  swimPace: null,
});
console.log(JSON.stringify(fondo, null, 2));
```

```bash
npx tsx scripts/demand-sweep.ts
```

- [ ] **Step 3: Read the output and check it against reality**

This step is the release's real verification, and it is not optional. Every one of v0.45's four genuine defects was code that worked, passed its tests, and quietly did something else — all four were caught by reading week-by-week output, none by a test.

Check each number against something you can defend: is a 3:48 marathon right for a 5:00/km threshold runner? Is a 12-hour Ironman right for those three anchors? Does the fondo still print the frozen figures? **If a number looks wrong, it is wrong** — find out why before shipping, and do not adjust a bound to accommodate it.

- [ ] **Step 4: Run the suite with `DATABASE_URL` unset**

```bash
env -u DATABASE_URL npx vitest run
```

Expected: PASS with DB-backed files reported as **skipped**, not crashed. A file that crashes here is missing its `describe.skipIf(!hasDb)` and will take CI down.

- [ ] **Step 5: Write the changelog entry**

Follow the existing `CHANGELOG.md` format. State plainly what changed for whom: runners and triathletes get a real demand figure or an honest refusal; cyclists' numbers are unchanged. Name the known limits rather than implying coverage the release does not have — v0.39's lesson was that an overclaiming guarantee is itself a defect, and that applies to the changelog too. Say that `LONGEST_RIDE_FRACTION` is applied outside cycling without validation.

- [ ] **Step 6: Run the full gate**

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

Expected: all four PASS.

- [ ] **Step 7: Commit**

```bash
git add docs/specs/2026-08-07-race-demand-evidence.md scripts/demand-sweep.ts CHANGELOG.md
git commit -m "docs(v0.46): every new constant has a source and a confidence"
```

---

## Verification before calling it done

- [ ] A marathon for a runner with an FTP and a threshold pace prices at 3–4 h, not ~1.2 h.
- [ ] A marathon for a runner with no anchor at all refuses with `no_running_anchor`, and `/train` shows that sentence.
- [ ] An Ironman prices three legs; removing swim history makes it refuse rather than under-price.
- [ ] The 130 km/4000 m fondo prints the Task 4 freeze values, to full precision.
- [ ] `/train` says "longest run" for a Run race and "longest ride" for a Bike race.
- [ ] Every available figure on screen carries a confidence sentence.
- [ ] `env -u DATABASE_URL npx vitest run` passes with DB files skipped, not crashed.
- [ ] `npm run lint && npm run typecheck && npm test && npm run build` all pass.
