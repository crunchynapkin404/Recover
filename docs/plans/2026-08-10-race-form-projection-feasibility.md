# Race-Day Form Projection and Feasibility Implementation Plan (v0.87.0)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the race-day form projection and the feasibility verdict one
owner each, so the four surfaces that render them stop each deciding
independently what to say when there is no figure.

**Architecture:** A new `src/lib/race/outlook.ts` holds the two DB-touching
owners (`raceCard`, `simulateRaceForm`). `feasibility.ts` gains a pure
`feasibilityFor()` returning `Figure<Feasibility>`. `readiness.ts` gains
`formScore()`, which `forecast.ts` calls instead of repeating the arithmetic.
Consumers become thin: two pages call `raceCard()`, two what-if paths serialize
`simulateRaceForm()`.

**Tech Stack:** TypeScript, Next.js App Router (server components), Drizzle,
Vitest, Postgres.

Design: `docs/specs/2026-08-10-race-form-projection-feasibility-ownership-design.md`

## Global Constraints

- **Version:** `package.json` bumps to `0.87.0` in the release task, not before.
- **Behaviour:** no number changes value. Every band, TSB and verdict this
  release renders must equal what `main` renders for the same input. The only
  athlete-visible additions are the `capped` qualification and the split
  feasibility reasons.
- **Confidence:** the projection is `"low"`. Do not raise it.
- **`insufficient` maps to `Figure.missingInput("training-load history")`** —
  the exact string the four already-migrated CTL/ATL/TSB surfaces use. Not
  `calibrating`.
- **DB-gated tests:** any test file importing `@/lib/db` (directly or through
  the module under test) MUST use
  `const hasDb = !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";`
  and `describe.skipIf(!hasDb)(...)`. A file that omits this crashes CI instead
  of skipping.
- **Before pushing:** run the suite once with `DATABASE_URL` **unset**. A green
  local gate cannot catch a missing `skipIf`, because locally the DB exists.
- **Gate before merge:** `npm test`, `npm run lint`, `npm run typecheck`,
  `npm run build`. `build` is the only check that catches a sync export added
  to a `"use server"` file.

## File Structure

| File                                          | Responsibility                                         |
| --------------------------------------------- | ------------------------------------------------------ |
| `src/lib/readiness.ts`                        | gains `formScore()` + `FORM_BAND_THRESHOLDS` (owner)   |
| `src/lib/race/forecast.ts`                    | `formOutlook()` calls `formScore()`; math unchanged    |
| `src/lib/race/feasibility.ts`                 | gains `feasibilityFor()` → `Figure<Feasibility>`       |
| `src/lib/race/outlook.ts` **(new)**           | `raceCard()`, `simulateRaceForm()`, `RaceCard` type    |
| `src/lib/race/outlook.test.ts` **(new)**      | DB-gated tests for both owners                         |
| `src/app/page.tsx`                            | one `raceCard()` call replaces ~35 lines               |
| `src/app/train/page.tsx`                      | same, plus `feasibilityFor()`                          |
| `src/app/plan/actions.ts`                     | serializes `simulateRaceForm()`; stops dropping capped |
| `src/lib/tools/simulate-plan-change.ts`       | serializes `simulateRaceForm()`                        |
| `src/lib/training-plan.ts`                    | two `assessFeasibility` sites → `feasibilityFor()`     |
| `src/components/today/race-chip.tsx`          | renders `Figure` + the capped qualification            |
| `src/components/dashboard/race-countdown.tsx` | **deleted** (+ its test)                               |

---

### Task 1: One owner for the form score

**Files:**

- Modify: `src/lib/readiness.ts` (add exports; line 167 calls the new function)
- Modify: `src/lib/race/forecast.ts:64-68`
- Test: `src/lib/readiness.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `formScore(tsb: number): number` and
  `FORM_BAND_THRESHOLDS: { green: 67; amber: 34 }`, both exported from
  `@/lib/readiness`.

- [ ] **Step 1: Write the failing test**

In `src/lib/readiness.test.ts`:

```ts
import { formScore, FORM_BAND_THRESHOLDS } from "./readiness";

describe("formScore", () => {
  it("maps TSB to the 10-90 form component score", () => {
    expect(formScore(0)).toBe(50);
    expect(formScore(10)).toBe(75);
    expect(formScore(-10)).toBe(25);
  });

  it("clamps at both ends", () => {
    expect(formScore(100)).toBe(90);
    expect(formScore(-100)).toBe(10);
  });

  it("exposes the band thresholds it is scored against", () => {
    expect(FORM_BAND_THRESHOLDS.green).toBe(67);
    expect(FORM_BAND_THRESHOLDS.amber).toBe(34);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/lib/readiness.test.ts -t formScore`
Expected: FAIL — `formScore is not a function`.

- [ ] **Step 3: Add the owner to `readiness.ts`**

Add just below the local `clamp` helper (line 80), above `computeReadiness`.

**Why this direction and not the reverse:** `readiness.ts` has **zero
imports** — it is fully pure. `forecast.ts`'s header promises the same ("pure
race-day form projection"), so it may depend on `readiness.ts` without
acquiring a DB dependency or a cycle. Moving `formScore` the other way, into
`forecast.ts`, would make the readiness engine depend on the race module,
which is backwards.

```ts
/**
 * TSB → the form component score, 10-90.
 *
 * Source: Invented. The 50-midpoint, the 2.5 slope and the 10/90 clamp are
 * an uncited design choice — a linear rescaling of TSB onto the same 0-100
 * scale the other readiness components use, so they can be weighted
 * together. No literature sets these values.
 * Confidence: Low.
 *
 * Owner: this function. `race/forecast.ts`'s `formOutlook()` calls it rather
 * than repeating the arithmetic — before v0.87 the expression was written
 * out in both files.
 */
export function formScore(tsb: number): number {
  return clamp(50 + 2.5 * tsb, 10, 90);
}

/**
 * Band cutoffs on a 0-100 score.
 *
 * Applied to two *different* scores: the composite readiness
 * (`computeReadiness`) and the form component alone
 * (`race/forecast.ts`'s `formOutlook`). That is one scale reused, not one
 * figure computed twice — a green form outlook and a green readiness are
 * different claims wearing the same colour.
 *
 * Source: Invented — uncited thresholds. Confidence: Low.
 */
export const FORM_BAND_THRESHOLDS = { green: 67, amber: 34 } as const;
```

- [ ] **Step 4: Make `computeReadiness` use them**

Replace line 167:

```ts
components.form = round1(formScore(tsb));
```

Replace lines 188-189:

```ts
const band: Band =
  readiness >= FORM_BAND_THRESHOLDS.green
    ? "green"
    : readiness >= FORM_BAND_THRESHOLDS.amber
      ? "amber"
      : "red";
```

- [ ] **Step 5: Make `forecast.ts` use them**

Replace `formOutlook` (lines 64-68):

```ts
/** TSB → the readiness engine's form component → its band thresholds. */
export function formOutlook(tsb: number): FormBand {
  const score = formScore(tsb);
  return score >= FORM_BAND_THRESHOLDS.green
    ? "green"
    : score >= FORM_BAND_THRESHOLDS.amber
      ? "amber"
      : "red";
}
```

Add to the imports at the top of `forecast.ts`:

```ts
import { formScore, FORM_BAND_THRESHOLDS } from "@/lib/readiness";
```

- [ ] **Step 6: Run the full readiness and forecast suites**

Run: `npx vitest run src/lib/readiness.test.ts src/lib/race/forecast.test.ts`
Expected: PASS, all of them. No band or score changes value — this is a
pure extraction.

- [ ] **Step 7: Mutation-check the extraction**

Temporarily change `formScore`'s slope from `2.5` to `3.5`. Run the same two
suites. Expected: failures in **both** files' tests, proving both now depend on
the one owner. Revert the change.

- [ ] **Step 8: Commit**

```bash
git add src/lib/readiness.ts src/lib/readiness.test.ts src/lib/race/forecast.ts
git commit -m "refactor(readiness): one owner for the TSB form score

clamp(50 + 2.5*tsb, 10, 90) was written out in both readiness.ts and
race/forecast.ts. Both now call formScore(); the band cutoffs get one
exported owner documented as a scale applied to two different scores.
Inline literals, so Phase 2a's exported-constant sweep never reached
them; both now carry source and confidence."
```

---

### Task 2: `feasibilityFor()` — one guard, three stated reasons

**Files:**

- Modify: `src/lib/race/feasibility.ts`
- Test: `src/lib/race/feasibility.test.ts`

**Interfaces:**

- Consumes: `formScore` is unrelated; nothing from Task 1.
- Produces:

```ts
export function feasibilityFor(input: {
  demand: EventDemandResult | null;
  currentWeeklyHours: number | null;
  longestSessionHours: number | null;
  weeksUntilEvent: number | null;
}): Figure<Feasibility>;
```

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/race/feasibility.test.ts`:

```ts
import { feasibilityFor } from "./feasibility";

const OK_DEMAND = {
  available: true as const,
  weeklyHours: 10,
  queenStageHours: 5,
  queenStageKnown: true,
  totalHours: 8,
  dailyRateHours: 5,
  source: "computed" as const,
  confidence: "medium" as const,
  confidenceReason: "modelled",
};

describe("feasibilityFor", () => {
  it("says which input is missing when there is no usable demand", () => {
    const f = feasibilityFor({
      demand: null,
      currentWeeklyHours: 8,
      longestSessionHours: 3,
      weeksUntilEvent: 12,
    });
    expect(f.available).toBe(false);
    if (f.available) return;
    expect(f.kind).toBe("missing_input");
    expect(f.needs).toContain("demand");
  });

  it("distinguishes a missing race date from missing demand", () => {
    const f = feasibilityFor({
      demand: OK_DEMAND,
      currentWeeklyHours: 8,
      longestSessionHours: 3,
      weeksUntilEvent: null,
    });
    expect(f.available).toBe(false);
    if (f.available) return;
    expect(f.kind).toBe("missing_input");
    expect(f.needs).toContain("race date");
  });

  it("distinguishes missing training history from both of the above", () => {
    const f = feasibilityFor({
      demand: OK_DEMAND,
      currentWeeklyHours: null,
      longestSessionHours: 3,
      weeksUntilEvent: 12,
    });
    expect(f.available).toBe(false);
    if (f.available) return;
    expect(f.kind).toBe("missing_input");
    expect(f.needs).toContain("training history");
  });

  it("returns the verdict with low confidence when everything is present", () => {
    const f = feasibilityFor({
      demand: OK_DEMAND,
      currentWeeklyHours: 8,
      longestSessionHours: 3,
      weeksUntilEvent: 12,
    });
    expect(f.available).toBe(true);
    if (!f.available) return;
    expect(f.confidence).toBe("low");
    expect(f.value.weeksUntilEvent).toBe(12);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run src/lib/race/feasibility.test.ts -t feasibilityFor`
Expected: FAIL — `feasibilityFor is not a function`.

- [ ] **Step 3: Implement**

Add to `src/lib/race/feasibility.ts`:

```ts
import { Figure } from "@/lib/uncertainty";
import type { EventDemandResult } from "@/lib/race/demand";

/**
 * The one way a surface asks "is this event feasible".
 *
 * Before v0.87 three call sites wrote the same guard inline and collapsed
 * every failure to `null`, so no surface could tell "no tracked race" from
 * "no measured history". Each guard now states its own reason.
 *
 * Confidence is Low for every verdict: FEASIBILITY_CONSTANTS' longest-session
 * fraction is Low and unvalidated outside cycling, and the verdict is only as
 * good as the demand figure feeding it.
 */
export function feasibilityFor(input: {
  demand: EventDemandResult | null;
  currentWeeklyHours: number | null;
  longestSessionHours: number | null;
  weeksUntilEvent: number | null;
}): Figure<Feasibility> {
  if (input.demand == null || !input.demand.available) {
    return Figure.missingInput("a tracked race with computable demand");
  }
  if (input.weeksUntilEvent == null) {
    return Figure.missingInput("a race date to count back from");
  }
  const verdict = assessFeasibility({
    requiredWeeklyHours: input.demand.weeklyHours,
    currentWeeklyHours: input.currentWeeklyHours,
    queenStageHours: input.demand.queenStageHours,
    queenStageKnown: input.demand.queenStageKnown,
    longestSessionHours: input.longestSessionHours,
    weeksUntilEvent: input.weeksUntilEvent,
  });
  if (verdict == null) {
    return Figure.missingInput("measured training history");
  }
  return Figure.available(verdict, "low");
}
```

- [ ] **Step 4: Run and confirm pass**

Run: `npx vitest run src/lib/race/feasibility.test.ts`
Expected: PASS, including the pre-existing `assessFeasibility` tests —
that function is unchanged.

- [ ] **Step 5: Mutation-check each guard**

One at a time, delete each of the three `return Figure.missingInput(...)`
lines (replacing with the next branch) and re-run. Expected: a **different**
named test fails for each. If deleting two different guards fails the same
test, the tests are not distinguishing the reasons — fix the tests. Revert.

- [ ] **Step 6: Commit**

```bash
git add src/lib/race/feasibility.ts src/lib/race/feasibility.test.ts
git commit -m "feat(race): feasibilityFor() states which input is missing

Three call sites wrote the same guard inline and collapsed every failure
to null, so no surface could tell 'no tracked race' from 'no measured
history'. assessFeasibility() is unchanged and still returns
Feasibility | null; feasibilityFor() wraps it in Figure<>."
```

---

### Task 3: `raceCard()` — the projection owner

**Files:**

- Create: `src/lib/race/outlook.ts`
- Create: `src/lib/race/outlook.test.ts`

**Interfaces:**

- Consumes: `formOutlook` (Task 1, unchanged signature),
  `assembleForecastInputs`, `nextUpcomingRace` from `@/lib/race/service`.
- Produces:

```ts
export type RaceOutlook = Figure<{
  full: ScenarioEnd;
  adherence: ScenarioEnd | null;
  capped: boolean;
}>;

export interface RaceCard {
  race: {
    name: string;
    date: string;
    priority: string;
    goalNote: string | null;
  } | null;
  daysOut: number | null;
  outlook: RaceOutlook | null;
}

export async function raceCard(
  userId: string,
  now: Date,
  preloadedWeek?: OpenWeekPlan | null
): Promise<RaceCard>;
```

- [ ] **Step 1: Write the failing test**

Create `src/lib/race/outlook.test.ts`. The `emptyWeek()` helper is copied
from `src/lib/race/service.test.ts` lines 17-40 — copy it verbatim rather than
importing, matching how the other race test files do it.

```ts
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { DaySlot } from "@/lib/week-plan/types";
import { raceCard } from "./outlook";

// requires Postgres; skips without DATABASE_URL.
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const NO_RACE = "test-outlook-no-race";
const NO_PLAN = "test-outlook-no-plan";
const NO_LOAD = "test-outlook-no-load";
const CAPPED = "test-outlook-capped";
const ALL_USERS = [NO_RACE, NO_PLAN, NO_LOAD, CAPPED];

const WEEK_START = "2026-07-20"; // Monday
const NOW = new Date("2026-07-22T09:00:00"); // Wednesday of that week

// Copied verbatim from service.test.ts lines 16-40.
function emptyWeek(weekStart: string): DaySlot[] {
  const days: DaySlot[] = [];
  const d = new Date(weekStart + "T00:00:00");
  for (let i = 0; i < 7; i++) {
    const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    days.push({
      date: ymd,
      availableBlocks: [
        { start: null, end: null, mins: 60, energy: "normal", sports: null },
      ],
      availableMins: 60,
      workouts: [],
      status: "rest",
    });
    d.setDate(d.getDate() + 1);
  }
  return days;
}

async function seedUser(id: string) {
  await db
    .insert(schema.users)
    .values({ id, name: id, email: `${id}@example.invalid` })
    .onConflictDoNothing();
}

async function seedRace(userId: string, date: string) {
  await db.insert(schema.races).values({
    userId,
    name: "Test Race",
    raceType: "marathon",
    sport: "Run",
    date,
    priority: "A",
  });
}

/** Plan + one block + an open week. Returns the plan id for teardown. */
async function seedPlan(userId: string, raceDate: string): Promise<string> {
  const [plan] = await db
    .insert(schema.trainingPlans)
    .values({
      userId,
      title: "Test Plan",
      raceType: "marathon",
      raceDate,
      startDate: "2026-07-20",
      weeksTotal: 1,
      currentWeek: 1,
      status: "active",
    })
    .returning();
  await db.insert(schema.trainingBlocks).values({
    planId: plan.id,
    weekNumber: 1,
    phase: "base",
    targetLoadTotal: 300,
    targetSessions: 4,
    workouts: [],
  });
  await db.insert(schema.weekPlans).values({
    userId,
    planId: plan.id,
    weekStart: WEEK_START,
    skeletonWeek: 1,
    days: emptyWeek(WEEK_START),
    status: "open",
    effectiveTarget: 300,
  });
  return plan.id;
}

describe.skipIf(!hasDb)("raceCard", () => {
  const planIds: string[] = [];

  beforeAll(async () => {
    for (const u of ALL_USERS) await seedUser(u);

    // NO_RACE: user only.

    // NO_PLAN: a race, but nothing planning for it.
    await seedRace(NO_PLAN, "2026-08-15");

    // NO_LOAD: race + plan + open week, but no daily_metrics row, so
    // assembleForecastInputs yields start == null.
    await seedRace(NO_LOAD, "2026-08-15");
    planIds.push(await seedPlan(NO_LOAD, "2026-08-15"));

    // CAPPED: same, plus ctl/atl, and a race date well beyond the single
    // planned week — so horizonEnd < targetDate and capped is true.
    await seedRace(CAPPED, "2026-10-01");
    planIds.push(await seedPlan(CAPPED, "2026-10-01"));
    await db
      .insert(schema.dailyMetrics)
      .values({ userId: CAPPED, date: "2026-07-21", ctl: 40, atl: 35 })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    await db
      .delete(schema.weekPlans)
      .where(inArray(schema.weekPlans.userId, ALL_USERS));
    await db
      .delete(schema.trainingBlocks)
      .where(inArray(schema.trainingBlocks.planId, planIds));
    await db
      .delete(schema.trainingPlans)
      .where(inArray(schema.trainingPlans.userId, ALL_USERS));
    await db
      .delete(schema.dailyMetrics)
      .where(inArray(schema.dailyMetrics.userId, ALL_USERS));
    await db
      .delete(schema.races)
      .where(inArray(schema.races.userId, ALL_USERS));
    await db.delete(schema.users).where(inArray(schema.users.id, ALL_USERS));
  });

  it("returns a null card when the athlete has no upcoming race", async () => {
    const card = await raceCard(NO_RACE, NOW);
    expect(card.race).toBeNull();
    expect(card.daysOut).toBeNull();
    expect(card.outlook).toBeNull();
  });

  it("reports a missing plan, not a missing figure", async () => {
    const card = await raceCard(NO_PLAN, NOW);
    expect(card.outlook?.available).toBe(false);
    if (card.outlook?.available !== false) return;
    expect(card.outlook.kind).toBe("missing_input");
    expect(card.outlook.needs).toBe("an active training plan");
  });

  it("reports missing training-load history, not a fabricated zero", async () => {
    const card = await raceCard(NO_LOAD, NOW);
    expect(card.outlook?.available).toBe(false);
    if (card.outlook?.available !== false) return;
    expect(card.outlook.kind).toBe("missing_input");
    expect(card.outlook.needs).toBe("training-load history");
  });

  it("qualifies a projection that stops before race day", async () => {
    const card = await raceCard(CAPPED, NOW);
    expect(card.outlook?.available).toBe(true);
    if (card.outlook?.available !== true) return;
    expect(card.outlook.value.capped).toBe(true);
    expect(card.outlook.why).toContain("plan end");
    expect(card.outlook.confidence).toBe("low");
  });

  it("counts days out from the date given, not wall-clock now", async () => {
    const card = await raceCard(NO_LOAD, NOW);
    // 2026-07-22 → 2026-08-15
    expect(card.daysOut).toBe(24);
  });
});
```

**Note for the implementer:** the `capped` fixture depends on `horizonEnd`
being the end of the last plan block (`service.ts` lines 355-358). The seed
above gives `CAPPED` a one-week plan and an October race, so `horizonEnd` is
2026-07-26 and `targetDate` is 2026-10-01. If the capped assertion does not
fire, check that assumption first rather than adjusting the expectation.

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run src/lib/race/outlook.test.ts`
Expected: FAIL — cannot resolve `./outlook`.

- [ ] **Step 3: Implement `outlook.ts`**

```ts
// src/lib/race/outlook.ts — what the athlete is told about their next race.
// The projection math lives in forecast.ts; this layer owns the single
// decision of what to show, including when there is nothing to show.
import { Figure } from "@/lib/uncertainty";
import type { OpenWeekPlan } from "@/lib/week-plan/service";
import { assembleForecastInputs, nextUpcomingRace } from "./service";
import { forecastForm, type ScenarioEnd } from "./forecast";
import { localYmd } from "@/lib/insights/auto-tags";

export type RaceOutlook = Figure<{
  full: ScenarioEnd;
  adherence: ScenarioEnd | null;
  capped: boolean;
}>;

export interface RaceCard {
  race: {
    name: string;
    date: string;
    priority: string;
    goalNote: string | null;
  } | null;
  daysOut: number | null;
  outlook: RaceOutlook | null;
}

const CAPPED_WHY =
  "Projection ends at plan end, before race day — it is not a race-day figure.";

const FULL_WHY = "Form outlook only: TSB from planned load, not readiness.";

/**
 * The one read path for the race card on Today and Train.
 *
 * Both pages built this inline before v0.87 — ~35 character-identical lines
 * each — so a change to one page's honesty silently diverged from the other.
 */
export async function raceCard(
  userId: string,
  now: Date,
  preloadedWeek?: OpenWeekPlan | null
): Promise<RaceCard> {
  const today = localYmd(now);
  const race = await nextUpcomingRace(userId, now);
  if (!race) return { race: null, daysOut: null, outlook: null };

  const assembled = await assembleForecastInputs(
    userId,
    race,
    now,
    preloadedWeek
  );

  let outlook: RaceOutlook;
  if (!assembled) {
    outlook = Figure.missingInput("an active training plan", {
      label: "Plan it",
      href: "/train?tab=week",
    });
  } else {
    const f = forecastForm(assembled.inputs);
    outlook = f.insufficient
      ? Figure.missingInput("training-load history")
      : Figure.available(
          { full: f.full, adherence: f.adherence, capped: f.capped },
          "low",
          f.capped ? CAPPED_WHY : FULL_WHY
        );
  }

  return {
    race: {
      name: race.name,
      date: race.date,
      priority: race.priority,
      goalNote: race.goalNote,
    },
    daysOut: Math.max(
      0,
      Math.round(
        (new Date(race.date + "T00:00:00").getTime() -
          new Date(today + "T00:00:00").getTime()) /
          86_400_000
      )
    ),
    outlook,
  };
}
```

- [ ] **Step 4: Run and confirm pass**

Run: `npx vitest run src/lib/race/outlook.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify the DB guard actually guards**

Run: `DATABASE_URL= npx vitest run src/lib/race/outlook.test.ts`
Expected: the suite **skips**, not crashes. If it crashes, the `skipIf` is
missing or misspelled.

- [ ] **Step 6: Commit**

```bash
git add src/lib/race/outlook.ts src/lib/race/outlook.test.ts
git commit -m "feat(race): raceCard() owns the race-day form outlook

One read path for Today and Train, which each built this inline. The
outlook is a Figure<> at Confidence: Low, and capped now carries a
stated reason instead of being a boolean every surface ignored."
```

---

### Task 4: Migrate both pages to `raceCard()`

**Files:**

- Modify: `src/app/page.tsx:142-190` and its `RaceCountdownProps` import
- Modify: `src/app/train/page.tsx:700-740` and its import
- Test: `tests/race-card-surfaces.test.ts` (create)

**Interfaces:**

- Consumes: `raceCard`, `RaceCard` from Task 3.
- Produces: nothing new.

- [ ] **Step 1: Write the failing surface test**

Condition 4 says assert at the surface, not the component. Create
`tests/race-card-surfaces.test.ts`:

```ts
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
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/race-card-surfaces.test.ts`
Expected: FAIL — both pages still call `forecastForm(`.

- [ ] **Step 3: Replace the block in `src/app/page.tsx`**

Delete lines 142-190 (from the `// ── Next race (v0.14) ──` comment through
the close of the `raceCard = { ... }` assignment) and replace with:

```ts
// ── Next race (v0.14) ──────────────────────────────────────────────────
// Form-only projection, never called "readiness" — HRV/RHR can't be
// forecast, so the band is an honest form outlook, not a score.
// Owner: src/lib/race/outlook.ts (v0.87).
const card = await raceCard(user.id, todayDate, weekPlan);
```

Replace the `RaceCountdownProps` import with:

```ts
import { raceCard, type RaceCard } from "@/lib/race/outlook";
```

Rename the later usages (`raceCard.race`, `raceCard.daysOut`) to `card.*`,
including the render site around line 563.

- [ ] **Step 4: Replace the block in `src/app/train/page.tsx`**

Delete lines 700-740 and replace with:

```ts
// Next race as the compact row under the week; the full list stays in the
// races section below. Owner: src/lib/race/outlook.ts (v0.87).
const card = await raceCard(userId, today, week);
```

Same import swap, and rename usages at the render site around line 846.

- [ ] **Step 5: Run the surface test and the full suite**

Run: `npx vitest run tests/race-card-surfaces.test.ts && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/page.tsx src/app/train/page.tsx tests/race-card-surfaces.test.ts
git commit -m "refactor(pages): Today and Train read the race card from its owner

Removes ~35 character-identical lines from each page. The surface test is
the guard that was missing when RaceChip dropped the capped caveat."
```

---

### Task 5: `RaceChip` renders the Figure, and the capped caveat returns

**Files:**

- Modify: `src/components/today/race-chip.tsx`
- Delete: `src/components/dashboard/race-countdown.tsx`
- Delete: `src/components/dashboard/race-countdown.test.tsx`
- Test: `src/components/today/race-chip.test.tsx` (create)

**Interfaces:**

- Consumes: `RaceCard` from Task 3.
- Produces: `RaceChip({ race, daysOut, outlook }: RaceCard)`.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Figure } from "@/lib/uncertainty";
import { RaceChip } from "./race-chip";

const RACE = {
  name: "Alpe Sportive",
  date: "2026-09-05",
  priority: "A",
  goalNote: null,
};

describe("RaceChip", () => {
  it("shows the form figure when there is a projection", () => {
    render(
      <RaceChip
        race={RACE}
        daysOut={45}
        outlook={Figure.available(
          {
            full: { tsb: 5, band: "green" },
            adherence: { tsb: 1, band: "amber" },
            capped: false,
          },
          "low",
          "Form outlook only: TSB from planned load, not readiness."
        )}
      />
    );
    expect(screen.getByText(/form \+3 ±2/)).toBeTruthy();
  });

  it("marks a projection that stops before race day", () => {
    render(
      <RaceChip
        race={RACE}
        daysOut={45}
        outlook={Figure.available(
          {
            full: { tsb: 5, band: "green" },
            adherence: null,
            capped: true,
          },
          "low",
          "Projection ends at plan end, before race day — it is not a race-day figure."
        )}
      />
    );
    expect(screen.getByText(/plan end/)).toBeTruthy();
  });

  it("says what is missing instead of dropping the clause silently", () => {
    render(
      <RaceChip
        race={RACE}
        daysOut={45}
        outlook={Figure.missingInput("training-load history")}
      />
    );
    expect(screen.getByText(/training-load history/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run src/components/today/race-chip.test.tsx`
Expected: FAIL — `RaceChip` still expects the old union.

- [ ] **Step 3: Rewrite `race-chip.tsx`**

```tsx
import Link from "next/link";
import { unavailableMessage } from "@/components/ui/unavailable";
import type { RaceCard } from "@/lib/race/outlook";

const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

/**
 * Honest form outlook only. A projection with an adherence range renders as
 * "form +5 ±4"; a single projection as "form +5"; an unavailable figure says
 * what it needs rather than dropping the clause.
 *
 * v0.87: a capped projection is marked. RaceCountdownCard used to say
 * "(projection ends at plan end)" and this component lost that when it
 * superseded it — an athlete saw a plan-end figure labelled as race-day form.
 */
function formLabel(outlook: RaceCard["outlook"]): string | null {
  if (!outlook) return null;
  if (!outlook.available) return unavailableMessage(outlook);

  const { full, adherence, capped } = outlook.value;
  const f = Math.round(full.tsb);
  const base = adherence
    ? `form ${signed(Math.round((Math.round(adherence.tsb) + f) / 2))} ±${Math.round(
        Math.abs(f - Math.round(adherence.tsb)) / 2
      )}`
    : `form ${signed(f)}`;
  return capped ? `${base} · to plan end` : base;
}

export function RaceChip({ race, daysOut, outlook }: RaceCard) {
  if (!race) return null;
  const meta = [daysOut != null ? `${daysOut} days` : null, formLabel(outlook)]
    .filter(Boolean)
    .join(" · ");
  return (
    <Link
      href="/train?tab=week"
      className="mb-6 flex items-center justify-between rounded-[14px] border bg-white/[0.03] px-3.5 py-2.5 transition-colors hover:bg-white/[0.05]"
      style={{ borderColor: "rgba(232,121,249,0.25)" }}
    >
      <span className="text-[11px] text-white/85">
        <span aria-hidden>🏁 </span>
        <strong className="font-bold text-white">{race.name}</strong>
        <span className="text-white/50"> · {race.priority} race</span>
      </span>
      {meta && (
        <span className="text-[11px] font-bold" style={{ color: "#e879f9" }}>
          {meta}
        </span>
      )}
    </Link>
  );
}
```

- [ ] **Step 4: Delete the dead component and its test**

```bash
git rm src/components/dashboard/race-countdown.tsx \
       src/components/dashboard/race-countdown.test.tsx
```

- [ ] **Step 5: Run and confirm pass**

Run: `npx vitest run src/components/today/race-chip.test.tsx && npm run typecheck`
Expected: PASS, and typecheck clean — no dangling `RaceCountdownProps` imports.

- [ ] **Step 6: Mutation-check the caveat**

Delete the `capped ? ... : base` conditional so it always returns `base`.
Run the chip test. Expected: the "marks a projection that stops before race
day" test FAILS. Revert. This is the check that would have caught the original
regression.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "fix(today): the race chip says when a projection stops at plan end

RaceCountdownCard rendered '(projection ends at plan end)'; RaceChip
dropped it when it superseded that component, so Today and Train showed a
plan-end TSB labelled as race-day form. Deletes RaceCountdownCard, which
had zero non-test render sites and only survived because it had a test."
```

---

### Task 6: `simulateRaceForm()` and its two serializers

**Files:**

- Modify: `src/lib/race/outlook.ts`
- Modify: `src/app/plan/actions.ts:695-727`
- Modify: `src/lib/tools/simulate-plan-change.ts:26-61`
- Test: `src/lib/race/outlook.test.ts`

**Interfaces:**

- Consumes: `PlanChange` from `@/lib/race/forecast`.
- Produces:

```ts
export type SimulatedRaceForm = Figure<{
  anchor: { race: string | null; date: string };
  before: ScenarioEnd;
  after: ScenarioEnd;
  deltaTsb: number;
  loadDelta: number;
  capped: boolean;
}>;

export async function simulateRaceForm(
  userId: string,
  change: PlanChange
): Promise<SimulatedRaceForm>;
```

- [ ] **Step 1: Write the failing test**

Append to `src/lib/race/outlook.test.ts`, inside the `describe.skipIf(!hasDb)`:

```ts
describe("simulateRaceForm", () => {
  it("reports missing load history rather than a fabricated comparison", async () => {
    const r = await simulateRaceForm(TEST_USER, {
      kind: "skip",
      fromDate: "2026-07-22",
    });
    expect(r.available).toBe(false);
    if (r.available) return;
    expect(r.needs).toBe("training-load history");
  });

  it("carries capped through to the caller", async () => {
    const r = await simulateRaceForm(CAPPED_USER, {
      kind: "skip",
      fromDate: "2026-07-22",
    });
    expect(r.available).toBe(true);
    if (!r.available) return;
    expect(r.value.capped).toBe(true);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run src/lib/race/outlook.test.ts -t simulateRaceForm`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement in `outlook.ts`**

```ts
export type SimulatedRaceForm = Figure<{
  anchor: { race: string | null; date: string };
  before: ScenarioEnd;
  after: ScenarioEnd;
  deltaTsb: number;
  loadDelta: number;
  capped: boolean;
}>;

/**
 * The one read path for "what would this change do to race-day form".
 *
 * Before v0.87 `plan/actions.ts` and the `simulate_plan_change` tool each ran
 * this chain and encoded the no-projection case their own way — a boolean
 * with nulled fields in one, prose in the other.
 */
export async function simulateRaceForm(
  userId: string,
  change: PlanChange
): Promise<SimulatedRaceForm> {
  const race = await nextUpcomingRace(userId);
  const assembled = await assembleForecastInputs(userId, race);
  if (!assembled) {
    return Figure.missingInput("an active training plan", {
      label: "Plan it",
      href: "/train?tab=week",
    });
  }
  const r = simulatePlanChange(assembled.inputs, change);
  if (r.before.insufficient || r.after.insufficient) {
    return Figure.missingInput("training-load history");
  }
  return Figure.available(
    {
      anchor: {
        race: assembled.race?.name ?? null,
        date: assembled.inputs.targetDate,
      },
      before: r.before.full,
      after: r.after.full,
      deltaTsb: r.deltaTsb,
      loadDelta: r.loadDelta,
      capped: r.before.capped,
    },
    "low",
    r.before.capped ? CAPPED_WHY : FULL_WHY
  );
}
```

Add `simulatePlanChange` and `type PlanChange` to the `./forecast` import.

- [ ] **Step 4: Rewrite `simulate-plan-change.ts`'s execute**

```ts
async function execute(args: z.infer<typeof parameters>, ctx: ToolContext) {
  const week = await getOpenWeekPlan(ctx.userId);
  if (!week) return { success: false, error: "no_open_week" };
  const from = week.days.find((d) => d.date === args.fromDate);
  if (!from || from.workouts.length === 0)
    return { success: false, error: "no_workout_on_from" };

  const change: PlanChange =
    args.action === "skip"
      ? { kind: "skip", fromDate: args.fromDate }
      : { kind: args.action, fromDate: args.fromDate, toDate: args.toDate! };

  const r = await simulateRaceForm(ctx.userId, change);
  if (!r.available) {
    return {
      success: true,
      available: false,
      needs: r.kind === "missing_input" ? r.needs : null,
      note: "This is a preview only; nothing was saved.",
    };
  }
  return {
    success: true,
    available: true,
    ...r.value,
    confidence: r.confidence,
    why: r.why,
    note: "Projection (form outlook from TSB only). This tool never saves — use update_training_plan to apply the change.",
  };
}
```

- [ ] **Step 5: Rewrite `plan/actions.ts`'s preview return**

Replace lines 700-727's body with:

```ts
const change: PlanChange =
  input.action === "skip"
    ? { kind: "skip", fromDate: input.fromDate }
    : { kind: input.action, fromDate: input.fromDate, toDate: input.toDate! };

const r = await simulateRaceForm(user.id, change);
if (!r.available) {
  return {
    ok: true as const,
    available: false as const,
    needs: r.kind === "missing_input" ? r.needs : null,
  };
}
return {
  ok: true as const,
  available: true as const,
  anchorDate: r.value.anchor.date,
  anchorRace: r.value.anchor.race,
  beforeTsb: r.value.before.tsb,
  afterTsb: r.value.after.tsb,
  beforeBand: r.value.before.band,
  afterBand: r.value.after.band,
  loadDelta: r.value.loadDelta,
  capped: r.value.capped,
  why: r.why,
};
```

Update the caller in the plan preview UI to read `available` instead of
`insufficient`, and to render `why` when `capped` is true.

- [ ] **Step 6: Run the full suite and build**

Run: `npm test && npm run typecheck && npm run build`
Expected: PASS. `build` matters here — `plan/actions.ts` is a `"use server"`
file and only `build` catches an illegal sync export added to one.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(race): one owner for the what-if projection

plan/actions.ts and simulate_plan_change each ran the same lookup →
assemble → simulate chain and encoded 'no projection' their own way.
Both are now serializers over simulateRaceForm(); capped reaches both."
```

---

### Task 7: Migrate the three `assessFeasibility` call sites

**Files:**

- Modify: `src/lib/training-plan.ts:1149-1159` and `:1294-1304`
- Modify: `src/app/train/page.tsx:484-496`
- Test: `tests/race-card-surfaces.test.ts` (extend)

**Interfaces:**

- Consumes: `feasibilityFor` from Task 2.
- Produces: nothing new.

- [ ] **Step 1: Extend the surface test**

```ts
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
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/race-card-surfaces.test.ts -t feasibility`
Expected: FAIL — all three sites still call `assessFeasibility(`.

- [ ] **Step 3: Replace all three call sites**

Each becomes, with the local `weeksUntilEvent` name preserved per site
(`weeksTotal`, `weeksUntilRace`, `weeksUntilEvent`):

```ts
const feasibilityFigure = feasibilityFor({
  demand,
  currentWeeklyHours: level.peakHours,
  longestSessionHours,
  weeksUntilEvent: weeksTotal,
});
const feasibility = feasibilityFigure.available
  ? feasibilityFigure.value
  : null;
```

`PlanPreview.feasibility` keeps its `Feasibility | null` shape for now; the
`Figure` is what the Train surface renders. In `train/page.tsx`, pass
`feasibilityFigure` into `eventReadiness` so `EventReadiness` can state the
reason rather than showing nothing.

- [ ] **Step 4: Run the suite**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(race): three feasibility call sites read one owner

Each wrote the same guard and input mapping inline. Train now renders the
reason a verdict is absent instead of showing nothing."
```

---

### Task 8: Release

**Files:**

- Modify: `package.json`, `CHANGELOG.md`, `docs/ROADMAP.md`

- [ ] **Step 1: Verify the DB guard from a clean environment**

Run: `DATABASE_URL= npm test`
Expected: DB-backed suites **skip**; nothing crashes. This is the check a
green local gate cannot make.

- [ ] **Step 2: Run the full gate**

Run: `npm test && npm run lint && npm run typecheck && npm run build`
Expected: all four pass.

- [ ] **Step 3: Bump the version**

`package.json`: `"version": "0.87.0"`.

- [ ] **Step 4: Write the changelog entry from the diff**

Add `## v0.87.0 — 2026-08-10 — One source of truth: race-day form and
feasibility` to `CHANGELOG.md`, written by reading `git diff main...HEAD`,
not from this plan.

- [ ] **Step 5: Tick the roadmap**

In `docs/ROADMAP.md`, change the race-day form projection item from `- [ ]`
to `- [x]` and add what shipped, following the v0.86 entry's format.

- [ ] **Step 6: Commit and open the PR**

```bash
git add -A
git commit -m "chore(release): v0.87.0 — race-day form and feasibility (Phase 2c)"
git push -u origin feat/v0.87-race-form-projection-feasibility
```

Then open the PR. **Do not tag** — tagging happens only after `main` is green,
per `docs/RELEASING.md`.

---

## Self-Review

**Spec coverage.** Every section of the design maps to a task: four renderings
→ Tasks 3-6; what-if chain → Task 6; feasibility's three sites and two nulls →
Tasks 2 and 7; `capped` → Tasks 3, 5, 6; form score duplication → Task 1; dead
component → Task 5; `Figure` migration → Tasks 2, 3, 5, 6.

**Known follow-up, deliberately out of scope.** `PlanPreview.feasibility` keeps
`Feasibility | null`. Task 7 renders the reason on Train but does not thread
the `Figure` through `plan-preview.ts`'s type. Doing so touches the plan
preview contract and belongs with the display-derived slice, not here.

**Ordering.** Task 1 is independent. Tasks 3→4→5 are strictly sequential.
Task 6 depends on Task 3. Task 7 depends on Task 2. Task 8 is last.
