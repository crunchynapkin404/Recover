# Strength Training Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an athlete record per-lift 1RMs and have the planner schedule
structured, periodization-aware strength sessions into the week alongside
endurance work — while stopping the existing silent miscount that books
synced lifting sessions as endurance load.

**Architecture:** One canonical exported `PlanPhase` (replacing four
independently-drifting copies of the same union). Four new nullable
`bodyPrefs` columns. One new pure `strengthPrescription(phase, oneRms)`
keyed on that phase. `Purpose` gains `"strength"`, so the existing
`PURPOSE_FLOORS`/`ENERGY_CEILING`/`SUBSTITUTE_TO` machinery gates strength
exactly as it gates every other session type — no bespoke adaptation branch.
Strength sessions are **appended** to the endurance week rather than
dispatched through `generateWorkouts`, because the plan's sport is decided by
the race and strength is not a `PlanSport`.

**Tech Stack:** TypeScript, vitest, drizzle-kit (migration), Next.js server
actions (Settings UI).

**Spec:** `docs/specs/2026-08-24-strength-training-design.md`

## Global Constraints

- **Additive only.** Four new nullable `body_prefs` columns, no backfill, no
  renames of existing columns. Safe to roll an image back past this release.
- **Big-4 lifts only:** `Squat`, `Bench`, `Deadlift`, `OverheadPress`. No
  accessory lifts, no exercise selection, no bodyweight movements.
- **Strength load NEVER merges with endurance CTL/ATL.** This is the single
  highest-risk correctness property in the plan. `activityLoad()` returns
  `null` for a strength activity, and strength contributes nothing to
  `weekActuals`' `actualLoad`/`unplannedLoad` sums — which feed
  `effectiveWeekLoad` and therefore next week's endurance target. A strength
  session that inflates next week's endurance volume is a defect, not a
  rounding difference.
- **Strength sessions must not consume the endurance session budget.**
  `materialize.ts:643` caps generated workouts with `.slice(0, sessions)`
  against `skeleton.targetSessions`. Strength is appended _after_ that cap,
  never inside it — otherwise every strength session silently deletes an
  endurance one.
- **Refuse, never fabricate.** A lift with no 1RM set renders sets/reps and a
  link to Settings — never an invented kg figure. Per-lift, not per-session:
  one unset lift must not blank the whole prescription.
- **Every new bound gets a mutation check** (`docs/RELEASING.md` step 3):
  break the thing the test names, confirm a test fails, revert. A surviving
  mutation is a finding — fix the test and say so in the release notes.
- **`npm run typecheck` is the exhaustive checklist** after any step touching
  a shared type (`Purpose`, `LoadActivity`, `PlannedWorkout`). Run it; read
  the errors; don't guess at the blast radius.

---

## Corrections to the spec, found by reading the code

The spec was written before these four facts were verified. **Where this plan
and the spec disagree, this plan is right** — each item below was read out of
the file that implements it.

1. **`Block` is not exported** (`src/lib/training-plan.ts:240` — `interface
Block`, no `export`). The spec's "keyed on the exact same `Block["phase"]`
   union" is not directly expressible. Worse, that union is currently written
   out **four times**: `training-plan.ts:242`, `materialize.ts:120` (aliased
   to a local, unexported `PlanPhase` at `:187`), `plan-preview.ts:18` (exported
   as `PlanPhase`), and `schema.ts:836`'s `trainingBlocks.phase` enum. Task 1
   exports one canonical `PlanPhase` and points the first two at it; `plan-preview.ts`
   now re-exports it — the same "one resolver, not two" cleanup
   `resolveFtpAnchor()` did for FTP in v0.118.0.
2. **`LoadActivity` has no `sport` field** (`training-load.ts:77-88`).
   `activityLoad()` structurally _cannot_ filter by sport today. Task 6 adds
   it and threads it through both callers (`metrics.ts:92`,
   `week-plan/start-state.ts:55`). The spec's "side effect of giving strength
   its own recognized sport" understates this — it is a real signature change.
3. **Strength is not a `PlanSport`** and must not become one. `PLAN_SPORTS`
   is `["Bike", "Run", "Triathlon"]` and its doc comment is explicit that the
   set is "exactly the three branches `generateWorkouts` has";
   `requirePlanSport` throws on anything else. Strength sessions are appended
   alongside the endurance week, not dispatched through `generateWorkouts`.
4. **`STRENGTH_SESSION_LOAD` is display-only — and, as it turned out, never
   displayed.** The spec called it `actualLoad`. It cannot be, without
   leaking into `effectiveWeekLoad`'s feedback loop (`actuals.ts:95-96` sums
   `actualLoad + unplannedLoad`). Task 6 makes strength contribute `null`
   load. **Corrected post-implementation:** no task ever wired
   `STRENGTH_SESSION_LOAD` into a UI surface — Task 9 renders a completed
   strength day's sets/reps/kg prescription, not a load figure of any kind.
   The final whole-branch review found the constant dead (its only readers
   were its own doc comment and a tautological test) and deleted it rather
   than build the display it was never given: a completed strength day reads
   "Completed," with no load number attached, exactly the spec's own
   restraint about not claiming more than the provider payload supports.

---

## File Structure

| Path                                               | Responsibility                                                         |
| -------------------------------------------------- | ---------------------------------------------------------------------- |
| `src/lib/plan-phase.ts` (new)                      | Canonical `PlanPhase` union + `PLAN_PHASES`.                           |
| `src/lib/training-plan.ts`                         | `Block.phase` → `PlanPhase`; `PlannedWorkout.exercises`; strength gen. |
| `src/lib/week-plan/materialize.ts`                 | Local `PlanPhase` alias → shared import; strength append step.         |
| `src/lib/db/schema.ts`                             | Four `bodyPrefs` 1RM columns.                                          |
| `drizzle/*.sql` (generated)                        | Additive migration.                                                    |
| `src/lib/availability/types.ts`                    | `Purpose` + `"strength"`; floors, ceilings, substitution.              |
| `src/lib/strength/prescription.ts` (new)           | `strengthPrescription()`, the phase table, `STRENGTH_SESSION_LOAD`.    |
| `src/lib/strength/prescription.test.ts` (new)      | Phase-table unit tests, per-lift refuse-state.                         |
| `src/lib/canonical-sport.ts`                       | `weighttraining → Strength` bucket.                                    |
| `src/lib/training-load.ts`                         | `LoadActivity.sport`; strength returns `null` load.                    |
| `src/lib/metrics.ts`                               | Adds `sport: true` to its columns allowlist.                           |
| `src/lib/week-plan/start-state.ts`                 | `toLoadActivity` stops dropping `sport`.                               |
| `src/components/settings/body-prefs-card.tsx`      | Strength-maxes field group.                                            |
| `src/app/settings/body-actions.ts`                 | Four fields in input + validation + `values`.                          |
| `src/app/settings/page.tsx:498`                    | Passes the four props.                                                 |
| `src/components/train/week-day-list.tsx`           | Strength exercise line on the day row.                                 |
| `src/lib/tools/get-strength-prescription.ts` (new) | MCP tool.                                                              |
| `src/lib/tools/registry.ts`                        | Registers it.                                                          |
| `src/lib/tools/__tests__/frozen-tools.test.ts`     | Count 58 → 59, snapshot update.                                        |
| `docs/API-STABILITY.md`                            | Frozen-surface count.                                                  |
| `src/lib/export/import-user.ts`                    | Round-trips four columns.                                              |
| `scripts/export-import-drill.ts:199`               | `Carried<>` seed fixture gains four fields.                            |
| `CHANGELOG.md`, `docs/ROADMAP.md`, `package.json`  | Release bookkeeping.                                                   |

---

### Task 1: Canonical `PlanPhase`

Pure refactor, no behavior change. Done first because Tasks 4 and 7 key off
this type, and because doing it later means editing the same lines twice.

**Files:**

- Create: `src/lib/plan-phase.ts`
- Modify: `src/lib/training-plan.ts:242`
- Modify: `src/lib/week-plan/materialize.ts:120`, `:187`

**Interfaces:**

- Produces: `export type PlanPhase = "base" | "build" | "peak" | "taper" |
"recovery";` and `export const PLAN_PHASES: readonly PlanPhase[]`.
  **Tasks 4 and 7 import this exact name from `@/lib/plan-phase`.**

- [ ] **Step 1: Create the module**

```ts
/**
 * The periodization phase vocabulary, in one place.
 *
 * This union was written out three times before v0.119: `Block.phase`
 * (training-plan.ts), `MaterializeInput["skeleton"]["phase"]`
 * (materialize.ts, aliased to a local `PlanPhase`), and
 * `trainingBlocks.phase`'s enum (db/schema.ts). Three copies of one
 * vocabulary is the drift shape `resolveFtpAnchor()` was built to close for
 * FTP in v0.118.0 — a phase added to one copy and missed in another would
 * typecheck on both sides of the gap.
 *
 * The schema's enum is deliberately NOT re-pointed here: drizzle needs a
 * literal array at that call site, and a drifting fourth copy is caught by
 * plan-phase.test.ts asserting the two lists match.
 *
 * Pure and dependency-free, so schema, planner and UI can all import it.
 */
export const PLAN_PHASES = [
  "base",
  "build",
  "peak",
  "taper",
  "recovery",
] as const;

export type PlanPhase = (typeof PLAN_PHASES)[number];
```

- [ ] **Step 2: Write the drift guard**

Create `src/lib/plan-phase.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PLAN_PHASES } from "./plan-phase";
import { trainingBlocks } from "./db/schema";

describe("PlanPhase", () => {
  it("matches the schema enum exactly", () => {
    // The one copy that cannot import the union (drizzle needs a literal
    // array at the pgTable call site). If someone adds a phase to either
    // list and not the other, this fails.
    const schemaEnum = trainingBlocks.phase.enumValues;
    expect([...schemaEnum].sort()).toEqual([...PLAN_PHASES].sort());
  });
});
```

- [ ] **Step 3: Run it, confirm it passes**

```bash
npx vitest run src/lib/plan-phase.test.ts
```

Expected: PASS. If it fails, the schema enum and the new constant disagree —
fix the constant to match the schema (the schema is the deployed truth), not
the other way round.

- [ ] **Step 4: Point `training-plan.ts` at it**

Add to the imports at the top of `src/lib/training-plan.ts`:

```ts
import type { PlanPhase } from "@/lib/plan-phase";
```

Replace line 242 inside `interface Block`:

```ts
phase: PlanPhase;
```

- [ ] **Step 5: Point `materialize.ts` at it**

In `src/lib/week-plan/materialize.ts`, add to the imports:

```ts
import type { PlanPhase } from "@/lib/plan-phase";
```

Replace line 120 (inside `MaterializeInput["skeleton"]`):

```ts
phase: PlanPhase;
```

Delete line 187 entirely (`type PlanPhase = MaterializeInput["skeleton"]["phase"];`)
— the imported type now supplies that name, and every existing use of
`PlanPhase` in the file (lines 190, 207) resolves to it unchanged.

- [ ] **Step 6: Typecheck and run the affected suites**

```bash
npm run typecheck && npx vitest run src/lib/week-plan/materialize.test.ts
```

Expected: PASS both. This task changes no runtime behavior — the union's
members are identical, only its definition site moved. If any test's
behavior changed, something was mistyped; re-read Steps 4-5.

- [ ] **Step 7: Commit**

```bash
git add src/lib/plan-phase.ts src/lib/plan-phase.test.ts \
  src/lib/training-plan.ts src/lib/week-plan/materialize.ts
git commit -m "refactor(plan): one canonical PlanPhase, not three copies

Pure refactor, no behavior change. Prerequisite for strength
periodization, which keys off this union."
```

---

### Task 2: Schema and migration

**Files:**

- Modify: `src/lib/db/schema.ts:602` (inside `bodyPrefs`, after `thresholdPaceSecPerKm`)
- Create: `drizzle/*.sql` (generated)

**Interfaces:**

- Produces: `bodyPrefs.squatOneRmKg`, `.benchOneRmKg`, `.deadliftOneRmKg`,
  `.overheadPressOneRmKg`, each `number | null`. **Tasks 4, 8, 10 and 11
  depend on these exact names.**

- [ ] **Step 1: Add the columns**

In `src/lib/db/schema.ts`, immediately after line 602
(`thresholdPaceSecPerKm: integer("threshold_pace_sec_per_km"),`):

```ts
  /**
   * v0.119: per-lift one-rep maxima, in kilograms. null = not set, which
   * makes that ONE lift refuse a load target — the other lifts in the same
   * session still prescribe normally. The resistance-training analogue of
   * ftpWatts/thresholdPaceSecPerKm: an athlete-set anchor, never derived.
   * See docs/specs/2026-08-24-strength-training-design.md.
   */
  squatOneRmKg: integer("squat_one_rm_kg"),
  benchOneRmKg: integer("bench_one_rm_kg"),
  deadliftOneRmKg: integer("deadlift_one_rm_kg"),
  overheadPressOneRmKg: integer("overhead_press_one_rm_kg"),
```

- [ ] **Step 2: Generate the migration**

```bash
npm run db:generate
```

Expect a new `drizzle/NNNN_<slug>.sql` containing exactly four
`ALTER TABLE "body_prefs" ADD COLUMN ... integer;` statements and nothing
else. Anything else means the schema file had a prior uncommitted change —
stop and re-check Step 1.

- [ ] **Step 3: Verify it applies**

Start a scratch database if one isn't already running:

```bash
docker run -d --name scratch-db -e POSTGRES_USER=ci -e POSTGRES_PASSWORD=ci \
  -e POSTGRES_DB=ci -p 55432:5432 postgres:16-alpine
```

Then:

```bash
DATABASE_URL=postgres://ci:ci@localhost:55432/ci DATABASE_DRIVER=pg \
  node scripts/migrate.mjs
```

Expected: migrations applied, no errors.

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: **FAIL**, in `scripts/export-import-drill.ts:199`. Its seed fixture
is typed `Carried<typeof schema.bodyPrefs, "id">`, which requires every
column except `id` to be explicitly present — this is the type doing its job.
Task 11 fixes it. Note the error and continue; do not fix it here, and do not
weaken the type to make it quiet.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/schema.ts drizzle/
git commit -m "feat(schema): add bodyPrefs per-lift 1RM columns

Four additive nullable columns, no consumer yet. export-import-drill.ts's
Carried<> fixture does not typecheck until the task that updates it -
expected, that type exists to page exactly this way."
```

---

### Task 3: `Purpose` gains `"strength"`

**Files:**

- Modify: `src/lib/availability/types.ts:5-6`, `:28-32`, `:40-47`, `:50-56`
- Modify: `src/lib/availability/types.test.ts` (or create if absent)

**Interfaces:**

- Produces: `"strength"` as a `Purpose` member, `PURPOSE_FLOORS.strength =
20`, absent from `ENERGY_CEILING.easy`, present in `.normal`/`.full`,
  `SUBSTITUTE_TO.strength = "recovery"`. **Task 7 depends on all four.**

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/availability/types.test.ts` (create the file with the imports
below if it does not exist):

```ts
import { describe, expect, it } from "vitest";
import { ENERGY_CEILING, PURPOSE_FLOORS, SUBSTITUTE_TO } from "./types";

describe("strength as a Purpose", () => {
  it("has a floor of 20 minutes", () => {
    expect(PURPOSE_FLOORS.strength).toBe(20);
  });

  it("is not admitted on an easy day", () => {
    // A fixed-load lift under low expected energy is closer to threshold/
    // vo2max risk than to aerobic_base — excluded for the same reason those
    // are. This is the whole readiness-gating mechanism for strength; there
    // is deliberately no bespoke intensity-scaling branch anywhere.
    expect(ENERGY_CEILING.easy).not.toContain("strength");
  });

  it("is admitted on normal and full days", () => {
    expect(ENERGY_CEILING.normal).toContain("strength");
    expect(ENERGY_CEILING.full).toContain("strength");
  });

  it("degrades to recovery rather than to a lighter lift", () => {
    // There is no "lighter strength" tier to fall back to, so the honest
    // substitution is out of the sport entirely.
    expect(SUBSTITUTE_TO.strength).toBe("recovery");
  });
});
```

- [ ] **Step 2: Run them, confirm they fail**

```bash
npx vitest run src/lib/availability/types.test.ts -t "strength as a Purpose"
```

Expected: FAIL — `PURPOSE_FLOORS.strength` is `undefined` (and TypeScript
rejects `"strength"` as a `Purpose`).

- [ ] **Step 3: Extend the union and its three tables**

In `src/lib/availability/types.ts`, replace lines 5-6:

```ts
export type Purpose =
  | "recovery"
  | "aerobic_base"
  | "threshold"
  | "vo2max"
  | "brick"
  | "long"
  | "strength";
```

Replace `ENERGY_CEILING` (lines 28-32) — note `easy` is unchanged:

```ts
/** Which purposes an expected energy level admits. */
export const ENERGY_CEILING: Record<Energy, Purpose[]> = {
  easy: ["recovery", "aerobic_base", "long"],
  normal: ["recovery", "aerobic_base", "long", "threshold", "strength"],
  full: [
    "recovery",
    "aerobic_base",
    "long",
    "threshold",
    "vo2max",
    "brick",
    "strength",
  ],
};
```

Add to `PURPOSE_FLOORS` (line 46, after `long: 90,`):

```ts
  /**
   * Below this a strength session is not worth changing clothes for. Matches
   * `recovery`'s floor — the shortest big-4 session that still delivers a
   * stimulus. Coaching judgment, not literature-cited. Confidence: Low.
   */
  strength: 20,
```

Add to `SUBSTITUTE_TO` (line 55, after `aerobic_base: "recovery",`):

```ts
  strength: "recovery",
```

- [ ] **Step 4: Run the tests, confirm they pass**

```bash
npx vitest run src/lib/availability/types.test.ts
```

Expected: PASS.

- [ ] **Step 5: Typecheck — find every exhaustive switch**

```bash
npm run typecheck
```

Expected: possible failures anywhere a `Record<Purpose, ...>` or an
exhaustive `switch` over `Purpose` exists (`PURPOSE_FLOORS` and
`ENERGY_CEILING` are both `Record<...>` and are handled above). **Read the
errors and fix each one explicitly** — a `Purpose` added to the union but
missing from a `Record` is exactly what this compiler check exists to catch.
Do not add a catch-all default branch to silence it.

- [ ] **Step 6: Run the week-plan suites**

```bash
npx vitest run src/lib/week-plan/
```

Expected: PASS. No strength session exists yet, so behavior is unchanged —
this confirms widening the union broke nothing.

- [ ] **Step 7: Commit**

```bash
git add src/lib/availability/types.ts src/lib/availability/types.test.ts
git commit -m "feat(availability): strength is a Purpose

Readiness gating and duration floors reuse the existing
ENERGY_CEILING/SUBSTITUTE_TO machinery rather than a bespoke branch."
```

---

### Task 4: `strengthPrescription()`

**Files:**

- Create: `src/lib/strength/prescription.ts`
- Create: `src/lib/strength/prescription.test.ts`

**Interfaces:**

- Consumes: `PlanPhase` from `@/lib/plan-phase` (Task 1).
- Produces:

```ts
export type Lift = "Squat" | "Bench" | "Deadlift" | "OverheadPress";
export interface StrengthExercise {
  lift: Lift;
  sets: number;
  reps: number;
  pctOneRm: number;
  targetLoadKg: number | null;
}
export interface OneRepMaxes {
  squatOneRmKg: number | null;
  benchOneRmKg: number | null;
  deadliftOneRmKg: number | null;
  overheadPressOneRmKg: number | null;
}
export function strengthPrescription(
  phase: PlanPhase,
  oneRms: OneRepMaxes | null
): StrengthExercise[];
export const STRENGTH_SESSION_LOAD: number;
export const STRENGTH_SESSIONS_PER_WEEK: number;
export const STRENGTH_SESSIONS_PER_WEEK_TAPER: number;
export const STRENGTH_SESSION_MINS: number;
```

**Tasks 7, 9 and 10 depend on all of these exact names.**

- [ ] **Step 1: Write the failing tests**

Create `src/lib/strength/prescription.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PLAN_PHASES } from "@/lib/plan-phase";
import {
  STRENGTH_SESSION_LOAD,
  strengthPrescription,
  type OneRepMaxes,
} from "./prescription";

const ALL_SET: OneRepMaxes = {
  squatOneRmKg: 200,
  benchOneRmKg: 100,
  deadliftOneRmKg: 240,
  overheadPressOneRmKg: 60,
};

describe("strengthPrescription", () => {
  // Each phase asserted on its OWN row, not "returns something" — the phase
  // table is the whole feature, and a test that cannot tell base from peak
  // does not pin it. Fixtures differ per row so a swapped table is caught.
  it("prescribes volume in base: 4x8 at 65%", () => {
    const rx = strengthPrescription("base", ALL_SET);
    const squat = rx.find((e) => e.lift === "Squat")!;
    expect(squat.sets).toBe(4);
    expect(squat.reps).toBe(8);
    expect(squat.pctOneRm).toBe(0.65);
    expect(squat.targetLoadKg).toBe(130); // 200 * 0.65
  });

  it("prescribes 4x5 at 75% in build", () => {
    const squat = strengthPrescription("build", ALL_SET).find(
      (e) => e.lift === "Squat"
    )!;
    expect(squat.sets).toBe(4);
    expect(squat.reps).toBe(5);
    expect(squat.pctOneRm).toBe(0.75);
    expect(squat.targetLoadKg).toBe(150);
  });

  it("prescribes low-volume 3x3 at 82% in peak", () => {
    const squat = strengthPrescription("peak", ALL_SET).find(
      (e) => e.lift === "Squat"
    )!;
    expect(squat.sets).toBe(3);
    expect(squat.reps).toBe(3);
    expect(squat.pctOneRm).toBe(0.82);
    expect(squat.targetLoadKg).toBe(164);
  });

  it("prescribes maintenance 2x3 at 78% in taper", () => {
    const squat = strengthPrescription("taper", ALL_SET).find(
      (e) => e.lift === "Squat"
    )!;
    expect(squat.sets).toBe(2);
    expect(squat.reps).toBe(3);
    expect(squat.pctOneRm).toBe(0.78);
    expect(squat.targetLoadKg).toBe(156);
  });

  it("deloads to 2x8 at 55% in recovery", () => {
    const squat = strengthPrescription("recovery", ALL_SET).find(
      (e) => e.lift === "Squat"
    )!;
    expect(squat.sets).toBe(2);
    expect(squat.reps).toBe(8);
    expect(squat.pctOneRm).toBe(0.55);
    expect(squat.targetLoadKg).toBe(110);
  });

  it("covers all four lifts in every phase", () => {
    for (const phase of PLAN_PHASES) {
      const rx = strengthPrescription(phase, ALL_SET);
      expect(rx.map((e) => e.lift).sort()).toEqual([
        "Bench",
        "Deadlift",
        "OverheadPress",
        "Squat",
      ]);
    }
  });

  it("refuses a load per-lift, not per-session, when a 1RM is unset", () => {
    // The whole point of the refuse-state: one missing max must not blank
    // the other three lifts' targets.
    const rx = strengthPrescription("base", {
      ...ALL_SET,
      benchOneRmKg: null,
    });
    expect(rx.find((e) => e.lift === "Bench")!.targetLoadKg).toBeNull();
    expect(rx.find((e) => e.lift === "Squat")!.targetLoadKg).toBe(130);
  });

  it("still prescribes sets and reps for a lift with no 1RM", () => {
    const bench = strengthPrescription("base", {
      ...ALL_SET,
      benchOneRmKg: null,
    }).find((e) => e.lift === "Bench")!;
    expect(bench.sets).toBe(4);
    expect(bench.reps).toBe(8);
  });

  it("returns every lift unloaded when no maxes are set at all", () => {
    const rx = strengthPrescription("base", null);
    expect(rx).toHaveLength(4);
    expect(rx.every((e) => e.targetLoadKg === null)).toBe(true);
  });

  it("keeps strength load below the endurance duration rung", () => {
    // 30 < DURATION_TSS_PER_HOUR (40). This figure must never read as
    // commensurate with an endurance TSS.
    expect(STRENGTH_SESSION_LOAD).toBe(30);
  });
});
```

- [ ] **Step 2: Run them, confirm they fail**

```bash
npx vitest run src/lib/strength/prescription.test.ts
```

Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement**

Create `src/lib/strength/prescription.ts`:

```ts
/**
 * What to lift this week, given the plan's phase and the athlete's maxima.
 *
 * Pure — no db, no clock — the same shape as readiness.ts and
 * training-load.ts, so tests and the MCP tool can both call it directly.
 *
 * Every constant here is coaching convention with no comparative evidence
 * behind the specific numbers, labeled the same way plan-constants.ts labels
 * its own phase shares. See
 * docs/specs/2026-08-24-strength-training-design.md.
 */
import type { PlanPhase } from "@/lib/plan-phase";

export type Lift = "Squat" | "Bench" | "Deadlift" | "OverheadPress";

/** The big four. Deliberately fixed for v1 — see the spec's non-goals. */
export const LIFTS: readonly Lift[] = [
  "Squat",
  "Bench",
  "Deadlift",
  "OverheadPress",
];

export interface StrengthExercise {
  lift: Lift;
  sets: number;
  reps: number;
  /** Fraction of the athlete's 1RM, e.g. 0.65. */
  pctOneRm: number;
  /** pctOneRm x that lift's 1RM, rounded. null = that 1RM is unset. */
  targetLoadKg: number | null;
}

export interface OneRepMaxes {
  squatOneRmKg: number | null;
  benchOneRmKg: number | null;
  deadliftOneRmKg: number | null;
  overheadPressOneRmKg: number | null;
}

interface PhaseRx {
  sets: number;
  reps: number;
  pctOneRm: number;
}

/**
 * Linear periodization: volume in base, intensity toward peak, maintenance
 * through taper, deload in recovery. Traditional coaching convention with no
 * head-to-head evidence for these exact figures over any others.
 * Confidence: Low.
 */
const PHASE_TABLE: Record<PlanPhase, PhaseRx> = {
  base: { sets: 4, reps: 8, pctOneRm: 0.65 },
  build: { sets: 4, reps: 5, pctOneRm: 0.75 },
  peak: { sets: 3, reps: 3, pctOneRm: 0.82 },
  taper: { sets: 2, reps: 3, pctOneRm: 0.78 },
  recovery: { sets: 2, reps: 8, pctOneRm: 0.55 },
};

/**
 * A completed strength session's load, for DISPLAY only.
 *
 * Deliberately below DURATION_TSS_PER_HOUR (40): a lift session is shorter
 * than the duration rung's hour, and this number must never read as
 * commensurate with an endurance TSS. It is never summed into CTL/ATL — see
 * training-load.ts, which returns null load for a strength activity.
 * Invented. Confidence: Low.
 */
export const STRENGTH_SESSION_LOAD = 30;

/**
 * How many strength sessions a week carries. Drops in taper so race-week
 * freshness is not spent in the gym. Coaching convention. Confidence: Low.
 */
export const STRENGTH_SESSIONS_PER_WEEK = 2;
export const STRENGTH_SESSIONS_PER_WEEK_TAPER = 1;

/**
 * Nominal duration of a big-4 session, for placement against availability
 * blocks. Matches the four lifts at working-set rest intervals. Invented.
 * Confidence: Low.
 */
export const STRENGTH_SESSION_MINS = 45;

const ONE_RM_BY_LIFT: Record<Lift, keyof OneRepMaxes> = {
  Squat: "squatOneRmKg",
  Bench: "benchOneRmKg",
  Deadlift: "deadliftOneRmKg",
  OverheadPress: "overheadPressOneRmKg",
};

/**
 * The week's prescription. Always returns all four lifts: a missing 1RM
 * refuses that lift's LOAD, not its sets and reps, and never the other
 * three lifts' targets.
 */
export function strengthPrescription(
  phase: PlanPhase,
  oneRms: OneRepMaxes | null
): StrengthExercise[] {
  const rx = PHASE_TABLE[phase];
  return LIFTS.map((lift) => {
    const max = oneRms?.[ONE_RM_BY_LIFT[lift]] ?? null;
    return {
      lift,
      sets: rx.sets,
      reps: rx.reps,
      pctOneRm: rx.pctOneRm,
      targetLoadKg: max != null ? Math.round(max * rx.pctOneRm) : null,
    };
  });
}
```

- [ ] **Step 4: Run the tests, confirm they pass**

```bash
npx vitest run src/lib/strength/prescription.test.ts
```

Expected: PASS, all 10 tests.

- [ ] **Step 5: Mutation-check the phase table**

Per `docs/RELEASING.md` step 3. Swap `PHASE_TABLE.base` and
`PHASE_TABLE.peak`'s values, re-run the suite, and confirm **at least the
base and peak tests fail**. Revert. If they pass with the table swapped, the
fixtures cannot distinguish the rows and the tests are decorative — fix them
before continuing.

- [ ] **Step 6: Commit**

```bash
git add src/lib/strength/prescription.ts src/lib/strength/prescription.test.ts
git commit -m "feat(strength): periodization-aware prescription table

Pure function keyed on PlanPhase. Per-lift refusal when a 1RM is unset."
```

---

### Task 5: `canonicalSport` recognizes strength

**Files:**

- Modify: `src/lib/canonical-sport.ts` (the `CANONICAL` table)
- Modify: `src/lib/canonical-sport.test.ts`

**Interfaces:**

- Produces: `canonicalSport("WeightTraining") === "Strength"`, and
  `providerSportAliases("Strength")` returning the aliases. **Task 6 depends
  on the `"Strength"` spelling.**

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/canonical-sport.test.ts`:

```ts
describe("strength", () => {
  it("maps WeightTraining to Strength", () => {
    expect(canonicalSport("WeightTraining")).toBe("Strength");
    expect(canonicalSport("weighttraining")).toBe("Strength");
  });

  it("completes a planned strength session", () => {
    expect(sportMatches("Strength", "WeightTraining")).toBe(true);
  });

  it("does not claim Strava's generic Workout as strength", () => {
    // "Workout" is Strava's catch-all for anything it cannot classify.
    // Claiming all of it as lifting would book yoga, tennis and rowing as
    // strength sessions. Unmapped is the honest outcome, exactly as this
    // module's own doc comment argues for Tennis.
    expect(canonicalSport("Workout")).toBe("Workout");
    expect(sportMatches("Strength", "Workout")).toBe(false);
  });

  it("never completes an endurance session with a lift", () => {
    expect(sportMatches("Bike", "WeightTraining")).toBe(false);
    expect(sportMatches("Run", "WeightTraining")).toBe(false);
  });

  it("lists its provider aliases for the SQL filter", () => {
    expect(providerSportAliases("Strength")).toContain("weighttraining");
  });
});
```

Add `providerSportAliases` to the file's existing import from
`./canonical-sport` if it is not already there.

- [ ] **Step 2: Run them, confirm they fail**

```bash
npx vitest run src/lib/canonical-sport.test.ts -t "strength"
```

Expected: FAIL — `canonicalSport("WeightTraining")` returns
`"WeightTraining"` (pass-through), not `"Strength"`.

- [ ] **Step 3: Add the bucket**

In `src/lib/canonical-sport.ts`, add to the `CANONICAL` table after the
swimming entries:

```ts
  // Strength. `workout` is deliberately absent: it is Strava's catch-all for
  // anything it could not classify (yoga, rowing, tennis all land there), so
  // claiming it would book non-lifting as lifting. An unmapped discipline
  // simply never matches a planned session, which is the honest outcome.
  weighttraining: "Strength",
  strengthtraining: "Strength",
  strength: "Strength",
```

- [ ] **Step 4: Run the tests, confirm they pass**

```bash
npx vitest run src/lib/canonical-sport.test.ts
```

Expected: PASS, full file — including every pre-existing test (this is a
pure addition to the table; no existing key changes meaning).

- [ ] **Step 5: Commit**

```bash
git add src/lib/canonical-sport.ts src/lib/canonical-sport.test.ts
git commit -m "feat(sport): recognize strength as its own canonical sport

Strava's generic Workout is deliberately left unmapped."
```

---

### Task 6: Stop the endurance load miscount

The correctness half of the feature. Today a synced lifting session with no
power or HR data falls through `activityLoad()`'s duration rung and is booked
as 40 TSS/hour of endurance load, silently inflating CTL/ATL.

**Files:**

- Modify: `src/lib/training-load.ts:77-88` (`LoadActivity`), `:108-149` (`activityLoad`)
- Modify: `src/lib/metrics.ts:82-92` (columns allowlist)
- Modify: `src/lib/week-plan/start-state.ts:55-75` (`toLoadActivity`)
- Modify: `src/lib/training-load.test.ts`

**Interfaces:**

- Consumes: `canonicalSport` from `@/lib/canonical-sport` (Task 5).
- Produces: `LoadActivity.sport?: string | null`; `activityLoad()` returns
  `null` for any activity whose canonical sport is `"Strength"`.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/training-load.test.ts`:

```ts
describe("strength activities and endurance load", () => {
  const athlete = { ftpWatts: 250, maxHr: 185, restingHr: 50 };

  it("contributes no load for a lifting session with no power or HR", () => {
    // Before this, the duration rung booked 45 min of lifting as 30 TSS of
    // endurance work, straight into CTL/ATL. A strength session is real
    // training, but it is not endurance training, and there is no honest
    // TSS for it.
    const result = activityLoad(
      {
        provider: "strava",
        sport: "WeightTraining",
        startDate: new Date("2026-08-01T10:00:00Z"),
        durationS: 2700,
        load: null,
        avgHr: null,
        avgPower: null,
      },
      athlete
    );
    expect(result).toBeNull();
  });

  it("contributes no load even when the provider sent one", () => {
    // A provider load for a lift is on a scale this engine does not share.
    const result = activityLoad(
      {
        provider: "intervals_icu",
        sport: "WeightTraining",
        startDate: new Date("2026-08-01T10:00:00Z"),
        durationS: 2700,
        load: 55,
        avgHr: null,
        avgPower: null,
      },
      athlete
    );
    expect(result).toBeNull();
  });

  it("contributes no load even when HR was recorded", () => {
    const result = activityLoad(
      {
        provider: "strava",
        sport: "WeightTraining",
        startDate: new Date("2026-08-01T10:00:00Z"),
        durationS: 2700,
        load: null,
        avgHr: 130,
        avgPower: null,
      },
      athlete
    );
    expect(result).toBeNull();
  });

  it("still books an ordinary ride normally", () => {
    const result = activityLoad(
      {
        provider: "strava",
        sport: "Ride",
        startDate: new Date("2026-08-01T10:00:00Z"),
        durationS: 3600,
        load: null,
        avgHr: null,
        avgPower: 200,
      },
      athlete
    );
    expect(result?.source).toBe("power");
  });

  it("still books an activity with no sport at all", () => {
    // Every existing caller that omits sport must behave exactly as before.
    const result = activityLoad(
      {
        provider: "strava",
        startDate: new Date("2026-08-01T10:00:00Z"),
        durationS: 3600,
        load: null,
        avgHr: null,
        avgPower: null,
      },
      athlete
    );
    expect(result?.source).toBe("duration");
  });
});
```

- [ ] **Step 2: Run them, confirm they fail**

```bash
npx vitest run src/lib/training-load.test.ts -t "strength activities"
```

Expected: FAIL — the first three return a load instead of `null`.

- [ ] **Step 3: Add `sport` to `LoadActivity` and the guard**

In `src/lib/training-load.ts`, add the import at the top:

```ts
import { canonicalSport } from "@/lib/canonical-sport";
```

Add to `LoadActivity` (after `startDateLocal`, line 83):

```ts
  /**
   * The provider's discipline string. Optional so existing callers that
   * never set it keep their exact prior behavior — only a recognized
   * STRENGTH sport changes any outcome.
   */
  sport?: string | null;
```

At the very top of `activityLoad()`, before the provider-load rung
(currently line 111):

```ts
// Strength work has no honest TSS. Every rung below this line measures
// endurance stimulus: the power rung divides by FTP, the HR rung by
// heart-rate reserve, and the duration rung assumes an easy zone-2 hour.
// A lift satisfies none of those, so booking it as any of them inflates
// CTL/ATL with work that is real but not endurance. Refusing is the
// honest outcome; the session is still tracked and displayed, at a flat
// figure of its own (STRENGTH_SESSION_LOAD) that never enters this series.
if (canonicalSport(activity.sport) === "Strength") return null;
```

- [ ] **Step 4: Run them, confirm they pass**

```bash
npx vitest run src/lib/training-load.test.ts
```

Expected: PASS, full file.

- [ ] **Step 5: Thread `sport` through both callers**

`src/lib/metrics.ts` — add to the `columns` allowlist (after `avgPower: true,`,
line 88):

```ts
      sport: true,
```

That is the only change needed there; line 92's
`const activities: LoadActivity[] = activityRows;` now carries `sport`
structurally.

`src/lib/week-plan/start-state.ts` — `toLoadActivity` already **receives**
`sport: string` in its input rows (line 63) and drops it. Add it to the
mapped object (after `avgPower: r.avgPower,`, line 74):

```ts
    sport: r.sport,
```

- [ ] **Step 6: Typecheck and run the full affected suites**

```bash
npm run typecheck && npx vitest run src/lib/training-load.test.ts \
  src/lib/week-plan/start-state.test.ts
```

Expected: PASS.

- [ ] **Step 7: Verify against a real database**

The miscount is a data-shaped bug, so confirm the fix end to end:

```bash
DATABASE_URL=postgres://ci:ci@localhost:55432/ci DATABASE_DRIVER=pg \
  ENCRYPTION_KEY=$(printf '0%.0s' {1..64}) \
  BETTER_AUTH_SECRET=0123456789abcdef0123456789abcdef0123456789abcdef \
  BETTER_AUTH_URL=http://localhost:3200 \
  npx vitest run src/lib/metrics.test.ts src/lib/week-plan/
```

Expected: PASS. Any pre-existing fixture that seeded a `WeightTraining`
activity and asserted a non-zero load was asserting the bug — update it and
say so in the commit message.

- [ ] **Step 8: Mutation-check the guard**

Delete the `canonicalSport(...) === "Strength"` line, run
`npx vitest run src/lib/training-load.test.ts`, confirm the three new
`toBeNull()` tests fail, then restore it.

- [ ] **Step 9: Commit**

```bash
git add src/lib/training-load.ts src/lib/training-load.test.ts \
  src/lib/metrics.ts src/lib/week-plan/start-state.ts
git commit -m "fix(training-load): strength sessions no longer book endurance load

A synced lift with no power/HR fell through the duration rung and was
counted as 40 TSS/hour of zone-2 work, straight into CTL/ATL."
```

---

### Task 7: Generate and place strength sessions

The largest task. Read the Global Constraints on session budget and load
leakage before starting.

**Files:**

- Modify: `src/lib/training-plan.ts:74-85` (`PlannedWorkout`), `:87-94` (`PURPOSE_BY_TYPE`)
- Modify: `src/lib/week-plan/materialize.ts` (append step after the session cap)
- Modify: `src/lib/week-plan/materialize.test.ts`

**Interfaces:**

- Consumes: `strengthPrescription`, `STRENGTH_SESSIONS_PER_WEEK`,
  `STRENGTH_SESSIONS_PER_WEEK_TAPER`, `STRENGTH_SESSION_MINS`,
  `StrengthExercise` from `@/lib/strength/prescription` (Task 4);
  `OneRepMaxes` for the new `MaterializeInput` field.
- Produces: `PlannedWorkout.exercises?: StrengthExercise[]`;
  `MaterializeInput.oneRms?: OneRepMaxes | null`. **Task 9 reads
  `exercises`.**

- [ ] **Step 1: Extend `PlannedWorkout` and the purpose map**

In `src/lib/training-plan.ts`, add to `PlannedWorkout` (after
`minEffectiveMins`, line 84):

```ts
  /**
   * Present only when `sport === "Strength"`. The structured prescription
   * behind `description`'s human-readable line — what the MCP tool and any
   * future coach reason about, rather than re-parsing prose.
   */
  exercises?: StrengthExercise[];
```

Add the type-only import at the top of the file:

```ts
import type { StrengthExercise } from "@/lib/strength/prescription";
```

Add to `PURPOSE_BY_TYPE` (line 93, after `Brick: "brick",`):

```ts
  Strength: "strength",
```

- [ ] **Step 2: Write the failing placement tests**

Add to `src/lib/week-plan/materialize.test.ts`. Match the file's existing
`materializeWeek({...})` fixture shape — copy the nearest existing test's
input object and change only what these assertions need:

```ts
describe("strength sessions", () => {
  const ONE_RMS = {
    squatOneRmKg: 200,
    benchOneRmKg: 100,
    deadliftOneRmKg: 240,
    overheadPressOneRmKg: 60,
  };

  it("adds two strength sessions to an ordinary week", () => {
    const result = materializeWeek({
      /* ...copy the nearest existing base-phase fixture..., */
      oneRms: ONE_RMS,
    });
    const strength = result.days
      .flatMap((d) => d.workouts)
      .filter((w) => w.sport === "Strength");
    expect(strength).toHaveLength(2);
  });

  it("does not spend the endurance session budget on strength", () => {
    // The whole risk of appending: if strength counts against
    // skeleton.targetSessions, every lift silently deletes a ride.
    const input = {/* ...same fixture, targetSessions: 5... */};
    const without = materializeWeek({ ...input, oneRms: null });
    const with_ = materializeWeek({ ...input, oneRms: ONE_RMS });

    const enduranceCount = (r: typeof without) =>
      r.days.flatMap((d) => d.workouts).filter((w) => w.sport !== "Strength")
        .length;

    expect(enduranceCount(with_)).toBe(enduranceCount(without));
  });

  it("drops to one strength session in taper", () => {
    const result = materializeWeek({
      /* ...same fixture, skeleton.phase: "taper"..., */
      oneRms: ONE_RMS,
    });
    const strength = result.days
      .flatMap((d) => d.workouts)
      .filter((w) => w.sport === "Strength");
    expect(strength).toHaveLength(1);
  });

  it("carries the phase's prescription on the session", () => {
    const result = materializeWeek({
      /* ...base-phase fixture..., */
      oneRms: ONE_RMS,
    });
    const strength = result.days
      .flatMap((d) => d.workouts)
      .find((w) => w.sport === "Strength")!;
    expect(strength.exercises).toHaveLength(4);
    expect(strength.exercises![0].sets).toBe(4); // base: 4x8
  });

  it("plans no strength when the athlete has set no maxes", () => {
    // v1 treats strength as opt-in: the four Settings fields are the
    // opt-in. An athlete who has set none gets exactly today's plan.
    const result = materializeWeek({
      /* ...same fixture..., */
      oneRms: null,
    });
    expect(
      result.days
        .flatMap((d) => d.workouts)
        .filter((w) => w.sport === "Strength")
    ).toHaveLength(0);
  });

  it("never puts a strength session on an easy-energy block", () => {
    // ENERGY_CEILING.easy excludes "strength" (Task 3). This asserts the
    // placement path actually honors it, not just the table.
    const result = materializeWeek({
      /* ...fixture whose every block has energy: "easy"..., */
      oneRms: ONE_RMS,
    });
    expect(
      result.days
        .flatMap((d) => d.workouts)
        .filter((w) => w.sport === "Strength")
    ).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run them, confirm they fail**

```bash
npx vitest run src/lib/week-plan/materialize.test.ts -t "strength sessions"
```

Expected: FAIL — `oneRms` is not on `MaterializeInput`, and no strength
session is ever produced.

- [ ] **Step 4: Add the input field**

In `src/lib/week-plan/materialize.ts`, add to `MaterializeInput` (after
`queenStageHours`, wherever that sits in the interface):

```ts
  /**
   * The athlete's per-lift maxima, or null when they have set none. Strength
   * is opt-in: null means this week gets exactly the endurance plan it would
   * have had before strength existed.
   */
  oneRms?: OneRepMaxes | null;
```

Add the imports:

```ts
import {
  STRENGTH_SESSIONS_PER_WEEK,
  STRENGTH_SESSIONS_PER_WEEK_TAPER,
  STRENGTH_SESSION_MINS,
  strengthPrescription,
  type OneRepMaxes,
} from "@/lib/strength/prescription";
```

- [ ] **Step 5: Append strength after the endurance cap**

Still in `materialize.ts`, immediately **after** the block that ends with
`.slice(0, sessions)` (line 643's `workouts = generateWorkouts(...)` chain)
and **before** those workouts are placed onto days, append the strength
templates:

```ts
// Appended AFTER the endurance cap, never inside it: `.slice(0, sessions)`
// above enforces skeleton.targetSessions, which is an ENDURANCE budget.
// Counting strength against it would mean every lift silently deletes a
// ride — see this plan's Global Constraints.
//
// Strength is opt-in via the athlete's 1RMs. No maxes set means no
// strength sessions, and a week identical to the pre-strength plan.
if (input.oneRms != null) {
  const strengthCount =
    skeleton.phase === "taper"
      ? STRENGTH_SESSIONS_PER_WEEK_TAPER
      : STRENGTH_SESSIONS_PER_WEEK;
  const exercises = strengthPrescription(skeleton.phase, input.oneRms);
  for (let i = 0; i < strengthCount; i++) {
    workouts.push(
      withPurpose({
        day: 0, // placement decides the real day; this is a template
        sport: "Strength",
        type: "Strength",
        durationMins: STRENGTH_SESSION_MINS,
        intensity: `${exercises[0].sets}x${exercises[0].reps}`,
        description: exercises
          .map(
            (e) =>
              `${e.lift} ${e.sets}x${e.reps}` +
              (e.targetLoadKg != null ? ` @ ${e.targetLoadKg}kg` : "")
          )
          .join(" · "),
        exercises,
      })
    );
  }
}
```

The existing placement loop below this point already honors
`ENERGY_CEILING` (via `purpose`), `PURPOSE_FLOORS` (via `minEffectiveMins`,
which `withPurpose` stamps as 20 for `"strength"`), `blockFits` and
`MAX_SESSIONS_PER_DAY` — strength needs no bespoke placement logic, which is
the entire reason `Purpose` gained a member in Task 3 rather than the
scheduler gaining a branch.

- [ ] **Step 6: Run the tests, confirm they pass**

```bash
npx vitest run src/lib/week-plan/materialize.test.ts
```

Expected: PASS, including every pre-existing test. **A regression in an
existing test here is the signal that strength is consuming the endurance
budget** — re-read Step 5's placement point before adjusting any existing
assertion.

- [ ] **Step 7: Find and fix `materializeWeek`'s callers**

```bash
npm run typecheck && grep -rn "materializeWeek(" src/ --include=*.ts | grep -v test
```

`oneRms` is optional, so callers compile unchanged — but a caller that never
passes it can never schedule strength. Add the `bodyPrefs` read and pass
`oneRms` at each production call site found above (the row is already
fetched in most of them; reuse the existing `prefs` variable where present
rather than adding a second query).

- [ ] **Step 8: Full week-plan suite against a database**

```bash
DATABASE_URL=postgres://ci:ci@localhost:55432/ci DATABASE_DRIVER=pg \
  ENCRYPTION_KEY=$(printf '0%.0s' {1..64}) \
  BETTER_AUTH_SECRET=0123456789abcdef0123456789abcdef0123456789abcdef \
  BETTER_AUTH_URL=http://localhost:3200 \
  npx vitest run src/lib/week-plan/
```

Expected: PASS.

- [ ] **Step 9: Mutation-check the session budget**

The highest-value mutation in this plan. Move the strength append to
**before** `.slice(0, sessions)`, re-run
`npx vitest run src/lib/week-plan/materialize.test.ts`, and confirm the
"does not spend the endurance session budget" test fails. Revert. If it
passes, that test is not pinning the constraint it names — fix it now, not
in review.

- [ ] **Step 10: Commit**

```bash
git add src/lib/training-plan.ts src/lib/week-plan/materialize.ts \
  src/lib/week-plan/materialize.test.ts
git commit -m "feat(week-plan): schedule periodized strength sessions

Appended after the endurance session cap, never inside it. Placement,
readiness gating and duration floors all reuse the existing Purpose
machinery."
```

---

### Task 8: Settings — strength maxes

**Files:**

- Modify: `src/components/settings/body-prefs-card.tsx`
- Modify: `src/app/settings/body-actions.ts:22-28`, `:90-96`
- Modify: `src/app/settings/page.tsx:498-509`

**Interfaces:**

- Produces: an athlete can set/clear four 1RMs from Settings, validated,
  persisted to the Task 2 columns.

- [ ] **Step 1: `body-actions.ts` — input, validation, persistence**

Add to `setBodyPrefs`'s input type (after `thresholdPaceSecPerKm`, line 27):

```ts
squatOneRmKg: number | null;
benchOneRmKg: number | null;
deadliftOneRmKg: number | null;
overheadPressOneRmKg: number | null;
```

Add the bounds near the existing `MIN_FTP`/`MAX_FTP` (line 14):

```ts
/**
 * Human lift bounds, wide on purpose: the point is to reject a typo or a
 * unit mix-up (a 500kg squat, a 2kg deadlift), not to judge the athlete.
 */
const MIN_ONE_RM_KG = 10;
const MAX_ONE_RM_KG = 400;
```

Add one validation block after the threshold-pace one (line 79), covering
all four fields at once:

```ts
const oneRms = {
  squatOneRmKg: input.squatOneRmKg,
  benchOneRmKg: input.benchOneRmKg,
  deadliftOneRmKg: input.deadliftOneRmKg,
  overheadPressOneRmKg: input.overheadPressOneRmKg,
};
for (const [field, value] of Object.entries(oneRms)) {
  if (
    value != null &&
    (!Number.isInteger(value) || value < MIN_ONE_RM_KG || value > MAX_ONE_RM_KG)
  ) {
    return {
      ok: false,
      message: `${field.replace(/OneRmKg$/, "")} 1RM must be between ${MIN_ONE_RM_KG} and ${MAX_ONE_RM_KG} kg.`,
    };
  }
}
```

Add to the `values` object (line 96, after `thresholdPaceSecPerKm`):

```ts
    ...oneRms,
```

Do **not** add these to the `computeDailyMetrics` recompute trigger — 1RMs
do not participate in `training-load.ts`'s per-activity intensity, and Task 6
made strength contribute no load at all.

- [ ] **Step 2: `body-prefs-card.tsx` — the field group**

Add to `Props` (after `thresholdPaceSecPerKm`, line 12):

```ts
squatOneRmKg: number | null;
benchOneRmKg: number | null;
deadliftOneRmKg: number | null;
overheadPressOneRmKg: number | null;
```

Add them to the destructured parameter list (line 23) and add four state
hooks after `thresholdPace` (line 32):

```ts
const [squat, setSquat] = useState(squatOneRmKg?.toString() ?? "");
const [bench, setBench] = useState(benchOneRmKg?.toString() ?? "");
const [deadlift, setDeadlift] = useState(deadliftOneRmKg?.toString() ?? "");
const [ohp, setOhp] = useState(overheadPressOneRmKg?.toString() ?? "");
```

Add to `save()`'s `setBodyPrefs({...})` call, after the existing fields:

```ts
        squatOneRmKg: squat.trim() ? Number(squat) : null,
        benchOneRmKg: bench.trim() ? Number(bench) : null,
        deadliftOneRmKg: deadlift.trim() ? Number(deadlift) : null,
        overheadPressOneRmKg: ohp.trim() ? Number(ohp) : null,
```

After the existing `grid-cols-3` block closes (the one holding Max HR / FTP /
threshold pace), add a new labeled group. Match the surrounding card's
existing heading + helper-text pattern rather than inventing one — copy the
markup shape of the "Training thresholds" heading already in this file:

```tsx
<div className="mt-6">
  <span className="label-micro mb-1 block">Strength maxes</span>
  <p className="mb-3 text-caption text-ink-muted">
    Your one-rep max per lift, in kilograms. Setting these turns on planned
    strength sessions; a lift you leave blank still gets sets and reps, just no
    weight target.
  </p>
  <div className="grid grid-cols-3 gap-4">
    <label className="block">
      <span className="label-micro mb-1 block">Squat 1RM (kg)</span>
      <input
        type="number"
        min={10}
        max={400}
        value={squat}
        onChange={(e) => setSquat(e.target.value)}
        placeholder="e.g. 120"
        className={inputClass}
      />
    </label>
    <label className="block">
      <span className="label-micro mb-1 block">Bench 1RM (kg)</span>
      <input
        type="number"
        min={10}
        max={400}
        value={bench}
        onChange={(e) => setBench(e.target.value)}
        placeholder="e.g. 80"
        className={inputClass}
      />
    </label>
    <label className="block">
      <span className="label-micro mb-1 block">Deadlift 1RM (kg)</span>
      <input
        type="number"
        min={10}
        max={400}
        value={deadlift}
        onChange={(e) => setDeadlift(e.target.value)}
        placeholder="e.g. 150"
        className={inputClass}
      />
    </label>
    <label className="block">
      <span className="label-micro mb-1 block">Overhead press 1RM (kg)</span>
      <input
        type="number"
        min={10}
        max={400}
        value={ohp}
        onChange={(e) => setOhp(e.target.value)}
        placeholder="e.g. 50"
        className={inputClass}
      />
    </label>
  </div>
</div>
```

- [ ] **Step 3: `settings/page.tsx` — pass the props**

Inside the `<BodyPrefsCard ... />` call (line 498), after
`thresholdPaceSecPerKm`:

```tsx
                squatOneRmKg={bodyPrefsRow?.squatOneRmKg ?? null}
                benchOneRmKg={bodyPrefsRow?.benchOneRmKg ?? null}
                deadliftOneRmKg={bodyPrefsRow?.deadliftOneRmKg ?? null}
                overheadPressOneRmKg={
                  bodyPrefsRow?.overheadPressOneRmKg ?? null
                }
```

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: PASS (except the still-outstanding `export-import-drill.ts` error
from Task 2, fixed in Task 11).

- [ ] **Step 5: Verify in a real browser**

Settings forms have no automated coverage in this repo — verify by hand
(`docs/RELEASING.md` step 4):

```bash
DATABASE_URL=postgres://ci:ci@localhost:55432/ci DATABASE_DRIVER=pg \
  ENCRYPTION_KEY=$(printf '0%.0s' {1..64}) \
  BETTER_AUTH_SECRET=0123456789abcdef0123456789abcdef0123456789abcdef \
  BETTER_AUTH_URL=http://localhost:3200 TRUSTED_ORIGINS=http://localhost:3200 \
  npx next dev -p 3200
```

Confirm: the four fields appear under "Strength maxes", each persists across
a reload, clearing one saves `null` (not `0`), and an out-of-range value
shows the validation message rather than saving.

- [ ] **Step 6: Commit**

```bash
git add src/components/settings/body-prefs-card.tsx \
  src/app/settings/body-actions.ts src/app/settings/page.tsx
git commit -m "feat(settings): per-lift 1RM fields"
```

---

### Task 9: Train UI — the strength row

**Files:**

- Modify: `src/components/train/week-day-list.tsx:77-88`
- Modify: `src/components/train/week-day-list.test.tsx`

**Interfaces:**

- Consumes: `PlannedWorkout.exercises` (Task 7).

- [ ] **Step 1: Write the failing test**

Add to `src/components/train/week-day-list.test.tsx`, matching the file's
existing render-helper and `DaySlot` fixture shape:

```ts
it("shows the lifts and loads on a strength day", () => {
  render(
    <WeekDayList
      /* ...copy the nearest existing fixture's props..., */
      days={[
        {
          /* ...a normal DaySlot..., */
          workouts: [
            {
              day: 2,
              sport: "Strength",
              type: "Strength",
              durationMins: 45,
              intensity: "4x8",
              description: "Squat 4x8 @ 130kg · Bench 4x8 @ 65kg",
              purpose: "strength",
              minEffectiveMins: 20,
              blockIdx: 0,
              exercises: [
                {
                  lift: "Squat",
                  sets: 4,
                  reps: 8,
                  pctOneRm: 0.65,
                  targetLoadKg: 130,
                },
              ],
            },
          ],
        },
      ]}
    />
  );
  expect(screen.getByText(/Squat 4x8 @ 130kg/)).toBeInTheDocument();
});

it("shows sets and reps for a lift with no weight target", () => {
  render(
    <WeekDayList
      /* ...same fixture, but targetLoadKg: null and a description
         with no "@ ...kg" fragment... */
    />
  );
  expect(screen.getByText(/Squat 4x8/)).toBeInTheDocument();
  expect(screen.queryByText(/@ NaN|@ nullkg/)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run it, confirm it fails**

```bash
npx vitest run src/components/train/week-day-list.test.tsx -t "strength"
```

Expected: FAIL — the row renders only `Strength · 45 min` and the exercise
text appears nowhere.

- [ ] **Step 3: Render the exercise line**

In `src/components/train/week-day-list.tsx`, inside the
`d.workouts.map((w, i) => ...)` block (line 78), replace the single `<p>`
with the session line plus an exercise line when present:

```tsx
<div key={i}>
  <p
    className={`truncate text-caption ${isToday ? "font-bold text-ink-primary" : "text-ink-secondary"}`}
  >
    {`${w.type} · ${provisional ? "~" : ""}${w.durationMins} min`}
    <span className="ml-1.5 font-normal text-ink-muted">{w.intensity}</span>
  </p>
  {w.exercises && w.exercises.length > 0 && (
    <p className="mt-0.5 truncate text-label text-ink-muted">{w.description}</p>
  )}
</div>
```

The `key` moves from the `<p>` to the wrapping `<div>`; nothing else in the
row changes.

- [ ] **Step 4: Run the tests, confirm they pass**

```bash
npx vitest run src/components/train/week-day-list.test.tsx
```

Expected: PASS, including every pre-existing test (an endurance workout has
no `exercises`, so its markup is byte-identical apart from the wrapper).

- [ ] **Step 5: Commit**

```bash
git add src/components/train/week-day-list.tsx \
  src/components/train/week-day-list.test.tsx
git commit -m "feat(train): render the strength prescription on the day row"
```

---

### Task 10: MCP tool

**Files:**

- Create: `src/lib/tools/get-strength-prescription.ts`
- Modify: `src/lib/tools/registry.ts:88`, `:149`
- Modify: `src/lib/tools/__tests__/frozen-tools.test.ts:22`
- Modify: `docs/API-STABILITY.md`

**Interfaces:**

- Consumes: `strengthPrescription`, `OneRepMaxes` (Task 4); the Task 2
  columns.
- Produces: tool `get_strength_prescription`, scope `read`. **Additive
  only** — no existing tool's name, scope or schema changes.

- [ ] **Step 1: Write the tool**

Create `src/lib/tools/get-strength-prescription.ts`, following
`get-race-pacing.ts`'s exact structure:

```ts
import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./registry";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { strengthPrescription } from "@/lib/strength/prescription";
import type { PlanPhase } from "@/lib/plan-phase";

const parameters = z.object({
  phase: z
    .enum(["base", "build", "peak", "taper", "recovery"])
    .describe("Which periodization phase to prescribe for."),
});

async function execute(args: z.infer<typeof parameters>, ctx: ToolContext) {
  const prefs = await db.query.bodyPrefs.findFirst({
    where: eq(schema.bodyPrefs.userId, ctx.userId),
  });

  const oneRms = prefs
    ? {
        squatOneRmKg: prefs.squatOneRmKg,
        benchOneRmKg: prefs.benchOneRmKg,
        deadliftOneRmKg: prefs.deadliftOneRmKg,
        overheadPressOneRmKg: prefs.overheadPressOneRmKg,
      }
    : null;

  const anySet = oneRms != null && Object.values(oneRms).some((v) => v != null);

  return {
    success: true,
    phase: args.phase as PlanPhase,
    exercises: strengthPrescription(args.phase, oneRms),
    // Named rather than implied: a client showing sets and reps with no
    // weights should be able to say why, not just render blanks.
    anyMaxesSet: anySet,
    note: anySet
      ? "Weight targets come from the athlete's own 1RMs. A lift with no " +
        "1RM set returns sets and reps with a null target rather than a " +
        "guessed weight."
      : "No 1RMs are set, so every weight target is null. Sets and reps " +
        "still reflect the phase.",
  };
}

export const getStrengthPrescriptionTool: ToolDefinition<typeof parameters> = {
  name: "get_strength_prescription",
  description:
    "The athlete's structured strength prescription for a given " +
    "periodization phase: sets, reps and a target weight per lift, derived " +
    "from their own one-rep maxima. Returns a null weight rather than a " +
    "guess for any lift whose 1RM is not set.",
  parameters,
  execute,
};
```

- [ ] **Step 2: Register it**

In `src/lib/tools/registry.ts`, add the import beside line 88:

```ts
import { getStrengthPrescriptionTool } from "./get-strength-prescription";
```

Add to the array beside line 149:

```ts
  getStrengthPrescriptionTool,
```

- [ ] **Step 3: Run the frozen-surface test, confirm it fails**

```bash
npx vitest run src/lib/tools/__tests__/frozen-tools.test.ts
```

Expected: FAIL on both tests — count is 59, snapshot has a new entry. This
is the freeze doing its job: an added tool must be **deliberate**, never
incidental.

- [ ] **Step 4: Accept the new surface**

Update the count at `frozen-tools.test.ts:22`:

```ts
expect(allTools.length).toBe(59);
```

Then update the snapshot:

```bash
npx vitest run src/lib/tools/__tests__/frozen-tools.test.ts -u
```

- [ ] **Step 5: Verify the diff is purely additive**

```bash
git diff src/lib/tools/__tests__/__snapshots__/frozen-tools.test.ts.snap
```

Expected: **only** additions, all under a new `get_strength_prescription`
key. **A modification or deletion of any existing tool's entry is a
breaking change to a frozen surface** — stop and fix the cause rather than
accepting the snapshot.

- [ ] **Step 6: Update the stability doc**

In `docs/API-STABILITY.md`, update the frozen tool count sentence (line 12)
to include 59 in the same style as its existing "**54** when the freeze
landed, **56**..." progression, and add `get_strength_prescription` to the
tool listing wherever the file enumerates them.

- [ ] **Step 7: Run the full tools suite**

```bash
npx vitest run src/lib/tools/
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/tools/get-strength-prescription.ts src/lib/tools/registry.ts \
  src/lib/tools/__tests__/ docs/API-STABILITY.md
git commit -m "feat(mcp): get_strength_prescription, additive

Tool surface 58 -> 59. No existing tool's name, scope or schema changed."
```

---

### Task 11: Export/import round-trip and the drill fixture

Fixes the typecheck failure Task 2 deliberately left standing.

**Files:**

- Modify: `scripts/export-import-drill.ts:199-210`
- Modify: `src/lib/export/import-user.ts:252`
- Modify: `src/lib/export/import-user.test.ts`

**Interfaces:**

- `export-user.ts` needs **no change** — it infers `body_prefs`'s shape from
  `schema.bodyPrefs.$inferSelect` and passes rows through, so exports already
  carry the new columns.

- [ ] **Step 1: Fix the `Carried<>` seed fixture**

In `scripts/export-import-drill.ts`, add to `bodyPrefsSeed` (after line 205's
`ftpWattsIndoor: 220,`) — real, distinct values, not zeros or nulls, so the
drill actually proves each column round-trips:

```ts
    squatOneRmKg: 180,
    benchOneRmKg: 95,
    deadliftOneRmKg: 220,
    overheadPressOneRmKg: 55,
```

- [ ] **Step 2: Typecheck — Task 2's outstanding error should clear**

```bash
npm run typecheck
```

Expected: PASS, repo-wide, for the first time since Task 2.

- [ ] **Step 3: Write the failing round-trip test**

In `src/lib/export/import-user.test.ts`, find the test covering `ftpWatts`
round-tripping and extend its fixture and assertions:

```ts
// In the export payload fixture:
squatOneRmKg: 180,
benchOneRmKg: 95,
deadliftOneRmKg: 220,
overheadPressOneRmKg: 55,
```

```ts
// In the post-import assertions:
expect(imported?.squatOneRmKg).toBe(180);
expect(imported?.benchOneRmKg).toBe(95);
expect(imported?.deadliftOneRmKg).toBe(220);
expect(imported?.overheadPressOneRmKg).toBe(55);
```

- [ ] **Step 4: Run it, confirm it fails**

```bash
DATABASE_URL=postgres://ci:ci@localhost:55432/ci DATABASE_DRIVER=pg \
  ENCRYPTION_KEY=$(printf '0%.0s' {1..64}) \
  BETTER_AUTH_SECRET=0123456789abcdef0123456789abcdef0123456789abcdef \
  BETTER_AUTH_URL=http://localhost:3200 \
  npx vitest run src/lib/export/import-user.test.ts
```

Expected: FAIL — the four fields are `undefined` after import.

- [ ] **Step 5: Add them to the import mapping**

In `src/lib/export/import-user.ts`, after line 252
(`ftpWattsIndoor: r.ftpWattsIndoor,`):

```ts
          squatOneRmKg: r.squatOneRmKg,
          benchOneRmKg: r.benchOneRmKg,
          deadliftOneRmKg: r.deadliftOneRmKg,
          overheadPressOneRmKg: r.overheadPressOneRmKg,
```

- [ ] **Step 6: Run it, confirm it passes**

```bash
DATABASE_URL=postgres://ci:ci@localhost:55432/ci DATABASE_DRIVER=pg \
  ENCRYPTION_KEY=$(printf '0%.0s' {1..64}) \
  BETTER_AUTH_SECRET=0123456789abcdef0123456789abcdef0123456789abcdef \
  BETTER_AUTH_URL=http://localhost:3200 \
  npx vitest run src/lib/export/import-user.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run the drill itself**

```bash
DATABASE_URL=postgres://ci:ci@localhost:55432/ci DATABASE_DRIVER=pg \
  ENCRYPTION_KEY=$(printf '0%.0s' {1..64}) \
  npx tsx scripts/export-import-drill.ts
```

Expected: the drill's own pass output, no diff reported on `body_prefs`.

- [ ] **Step 8: Commit**

```bash
git add scripts/export-import-drill.ts src/lib/export/import-user.ts \
  src/lib/export/import-user.test.ts
git commit -m "feat(export): round-trip the 1RM columns"
```

---

### Task 12: Release bookkeeping

Per `docs/RELEASING.md` steps 1-2 and 5-6 — in this branch, before merge.

**Files:**

- Modify: `package.json`, `CHANGELOG.md`, `docs/ROADMAP.md`

- [ ] **Step 1: Run everything CI runs**

```bash
npm run lint && npm run typecheck && node scripts/migrate.mjs \
  && npm run format:check && npm run build
```

Then the full suite against the scratch database:

```bash
DATABASE_URL=postgres://ci:ci@localhost:55432/ci DATABASE_DRIVER=pg \
  ENCRYPTION_KEY=$(printf '0%.0s' {1..64}) \
  BETTER_AUTH_SECRET=0123456789abcdef0123456789abcdef0123456789abcdef \
  BETTER_AUTH_URL=http://localhost:3200 \
  npx vitest run
```

Expected: all green, test count above the 2906 baseline. Fix anything red
before proceeding — this task is bookkeeping, not a place to find bugs.

- [ ] **Step 2: Confirm every mutation check was actually run**

Tasks 4 (Step 5), 6 (Step 8) and 7 (Step 9) each specify one. If any was
skipped, run it now. **A surviving mutation is a finding** — fix the test and
name it in the CHANGELOG.

- [ ] **Step 3: Bump the version**

Check `main`'s current version first, then set the next minor in
`package.json`:

```json
  "version": "0.119.0",
```

- [ ] **Step 4: CHANGELOG entry**

Add at the top of `CHANGELOG.md`, following the voice and structure of the
`v0.118.0`/`v0.117.0` entries (one-sentence hook, bold-lead-in sections, a
closing `### Migrations`). It must cover:

- What an athlete gets: four optional 1RM fields, and periodized strength
  sessions in the week once any is set.
- **The load miscount this fixes** (Task 6) — synced lifting sessions were
  being booked as endurance TSS and inflating CTL/ATL. This is the headline
  an athlete would actually notice, and per `docs/RELEASING.md` step 6
  ("write release notes from the diff, not from the plan") it belongs above
  the feature.
- Strength is opt-in: no 1RMs set means a plan identical to before.
- What it deliberately does not do: no accessory lifts, no RPE
  auto-regulation, no set-level completion verification (providers do not
  send reps or load — "Completed", never "as prescribed").
- The `PlanPhase` consolidation (Task 1), as a correctness note.
- `### Migrations`: **additive** — four new nullable `body_prefs` columns,
  no backfill, image rollback safe.

- [ ] **Step 5: ROADMAP entry**

In `docs/ROADMAP.md`:

- Mark the demand-map row **Strength training** as
  `Shipped (v0.119.0)` in the "Recover at" column (the table refreshed on
  2026-08-24 lists it at 155 votes).
- Add a `- [x] **Strength training — v0.119.0.**` bullet in the Phase 3
  checklist, matching the style of the neighboring indoor-FTP and race-pacing
  entries, and referencing
  `docs/specs/2026-08-24-strength-training-design.md`.

- [ ] **Step 6: Format check**

```bash
npm run format:check
```

Fix with `npx prettier --write <file>` if the CHANGELOG/ROADMAP edits fail —
markdown tables often need the second pass.

- [ ] **Step 7: Commit, push, open the PR**

```bash
git add package.json CHANGELOG.md docs/ROADMAP.md
git commit -m "chore(release): v0.119.0 — strength training"
git push -u origin <branch-name>
gh pr create --title "feat(strength): periodized strength training" --body "..."
```

- [ ] **Step 8: Wait for CI and Surfaces to go green**

Both must pass on the PR before merge. `surfaces.yml` matters more than usual
here: Task 9 changes the Train week day row's markup for every session, not
just strength ones. Open the captured `train*` PNGs and confirm ordinary
endurance rows are unchanged — the wrapper `<div>` should be invisible.

**Then follow `docs/RELEASING.md` for the actual release.** Do not hand-run
any step of it.

---

## Self-Review Notes

**Spec coverage.** D1 (four columns) → Task 2. D2 (`Purpose` + floor) →
Task 3. D3 (`ENERGY_CEILING`/`SUBSTITUTE_TO` readiness gating) → Task 3,
asserted through placement in Task 7 Step 2. D4 (`PlannedWorkout.exercises`)
→ Task 7. D5 (`strengthPrescription`, per-lift refusal) → Task 4. D6
(`canonicalSport`, `workout` left unmapped) → Task 5. D7 (flat load, never
in CTL/ATL) → Tasks 4 and 6. D8 (MCP tool, additive) → Task 10. Prescription
table → Task 4. Completion honesty boundary → Task 12 Step 4's CHANGELOG
requirement plus Task 6's load exclusion. Settings UI → Task 8. Train UI →
Task 9. Migration classification → Task 12. Testing requirements → the
mutation checks in Tasks 4, 6 and 7.

**Spec requirements with no task, and why.** The spec's "completed strength
day reads 'Completed', never 'as prescribed'" needs no code: the existing
completion matcher sets `status: "completed"` and no surface renders an
"as prescribed" claim today. Task 12 records the boundary in the CHANGELOG so
a future contributor does not add one casually.

**Four spec corrections** are documented in their own section above rather
than silently applied: `Block` not exported, `LoadActivity` having no
`sport`, strength not being a `PlanSport`, and `STRENGTH_SESSION_LOAD` being
display-only rather than `actualLoad`.

**Type consistency check.** `PlanPhase` (Task 1) is the input type for
`strengthPrescription` (Task 4), `MaterializeInput.skeleton.phase` (Task 1),
and the MCP tool's `phase` enum (Task 10) — one name, one definition site.
`OneRepMaxes` (Task 4) is the shape passed by `MaterializeInput.oneRms`
(Task 7) and built from `bodyPrefs` columns in Tasks 8 and 10 — the four
field names (`squatOneRmKg`, `benchOneRmKg`, `deadliftOneRmKg`,
`overheadPressOneRmKg`) are identical in the schema (Task 2), the interface
(Task 4), the server action (Task 8), the tool (Task 10) and the import
mapping (Task 11). `StrengthExercise` (Task 4) is produced by
`strengthPrescription`, stored on `PlannedWorkout.exercises` (Task 7), and
read by the day row (Task 9) and the tool (Task 10).

**Ordering constraint.** Task 1 must precede Tasks 4 and 7 (type). Task 2
must precede Tasks 8, 10 and 11 (columns). Task 3 must precede Task 7
(`Purpose`). Task 4 must precede Tasks 7, 9 and 10. Task 5 must precede
Task 6 (`"Strength"` spelling). Task 2 leaves `npm run typecheck` red until
Task 11 — that is deliberate and called out in both places.
