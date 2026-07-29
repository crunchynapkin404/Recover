# Adaptation Idempotency Hotfix (v0.28.1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the daily adaptation destroying the athlete's plan — it currently shrinks every session by 15% (amber) or 30% (red) on _every_ wellness event, and writes sessions off as missed before the ride has had a chance to sync.

**Architecture:** Two guards in existing pure functions plus one gate in the DB-facing caller. No schema change, no new tables. `adaptDay` becomes idempotent by remembering what it adapted _from_; `runDailyAdaptation` stops judging "missed" until activity data for that day is settled.

**Tech Stack:** TypeScript, Next.js 16, Drizzle + Postgres, Vitest.

## Global Constraints

- **The gate is all five, in this order:** `npm run format:check && npm run typecheck && npm run lint && npm test && npm run build`. Two consecutive releases each dropped a different member and each omission broke `main`.
- `@testing-library/react` is **NOT installed** — only `jsdom`. Never import `render`, `screen`, `userEvent`, or jest-dom matchers. Stateless components use `renderToString`; interactive ones use hand-rolled `react-dom/client` + `act()`.
- New Vitest files touching `@/lib/db` must open with the repo's `describe.skipIf(!hasDb)` guard.
- **If a numeric expectation does not hold, STOP and report** rather than loosening the test. On the previous branch this fired nine times and the plan was wrong every time.
- `src/app/**/actions.ts` files are `"use server"`: every export must be an async function, and only `npm run build` catches a violation.

## The evidence this fixes

From the athlete's live database, 2026-07-29:

```
ran=2026-07-28T19:22  for=2026-07-28  low_readiness/scaled  readiness amber — duration ×0.85
ran=2026-07-28T19:22  for=2026-07-28  low_readiness/scaled  readiness amber — duration ×0.85
ran=2026-07-28T19:18  for=2026-07-28  low_readiness/scaled  readiness amber — duration ×0.85
ran=2026-07-28T10:11  for=2026-07-28  low_readiness/scaled  readiness amber — duration ×0.85
ran=2026-07-28T07:30  for=2026-07-28  low_readiness/scaled  readiness amber — duration ×0.85
```

`0.85^5 = 0.4437`; the session was planned at 137 min and rendered as **60 min**. On 2026-07-24: six amber scalings then six red, `0.85^6 × 0.70^6 = 0.0445`, producing an **8-minute "Long" ride**. On 2026-07-19: ten consecutive red scalings.

```
ran=2026-07-22T04:50  for=2026-07-21  missed_workout/dropped
                      Endurance missed on 2026-07-21 — dropped
```

The athlete rode 1.94h on 2026-07-21 at 18:50. The adaptation ran at 04:50 the next morning, before any activity sync, found nothing, and dropped the session. `weekly_rollover/scaled — last week was fully missed` then fired on 2026-07-13, 2026-07-20 **and** 2026-07-27 — three consecutive weeks, each restarting the next at 60% of skeleton.

**Why it runs so often:** `onWellnessDataChanged` unconditionally calls `runDailyAdaptation`, and it has five call sites — every wellness write, every scheduler sync job, the 09:00 backstop, every Apple Health push (_"roughly hourly"_ per its own comment), and CSV import. That frequency is by design and is not being changed. It is only destructive because the adaptation is not idempotent.

---

### Task 1: Make the readiness adaptation idempotent

**Files:**

- Modify: `src/lib/week-plan/types.ts` (add `readinessBase` to `DaySlot`)
- Modify: `src/lib/week-plan/adapt-day.ts` (readiness block, ~lines 250–320)
- Test: `src/lib/week-plan/adapt-day.test.ts` (add cases)
- Move into place: `tests/repro-amber-compounding.test.ts` already exists in the working tree and **currently fails on purpose**. It is the reproduction. Keep it, and make it pass.

**Interfaces:**

- Consumes: `Band` from `./types`, `AMBER_SCALE` / `RED_ENDURANCE_SCALE` from the constants already imported by `adapt-day.ts`.
- Produces: `DaySlot.readinessBase?: { date: string; band: Band; workouts: ScheduledWorkout[] }`.

**The rule this must implement.** The readiness adaptation is a function of _the originally planned session_ and _today's band_ — never of its own previous output. Applying amber twice must equal applying it once. If the band later worsens (amber → red), the adaptation must be recomputed **from the original session**, not layered on the already-shrunk one.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/week-plan/adapt-day.test.ts`:

```ts
describe("adaptDay — readiness idempotency", () => {
  const amberWeek = () =>
    week([
      D("2026-07-20", 300, { type: "Long", durationMins: 137 }),
      D("2026-07-21", 300, null),
      D("2026-07-22", 300, null),
      D("2026-07-23", 300, null),
      D("2026-07-24", 300, null),
      D("2026-07-25", 300, null),
      D("2026-07-26", 300, null),
    ]);
  const mins = (w: WeekState) => w.days[0].workouts[0]?.durationMins ?? 0;

  it("applies amber once, however many times it runs", () => {
    let w = amberWeek();
    const first = adaptDay({
      week: w,
      today: "2026-07-20",
      band: "amber",
      yesterdayCompleted: null,
    });
    const once = mins(first.week);
    expect(once).toBe(Math.round(137 * AMBER_SCALE));

    w = first.week;
    for (let i = 0; i < 4; i++) {
      const again = adaptDay({
        week: w,
        today: "2026-07-20",
        band: "amber",
        yesterdayCompleted: null,
      });
      expect(mins(again.week)).toBe(once);
      expect(
        again.adjustments.filter((a) => a.trigger === "low_readiness")
      ).toHaveLength(0);
      w = again.week;
    }
  });

  it("recomputes from the original session when the band worsens", () => {
    // amber then red must equal red applied once — never red on top of amber.
    const amber = adaptDay({
      week: amberWeek(),
      today: "2026-07-20",
      band: "amber",
      yesterdayCompleted: null,
    });
    const thenRed = adaptDay({
      week: amber.week,
      today: "2026-07-20",
      band: "red",
      yesterdayCompleted: null,
    });
    const redOnly = adaptDay({
      week: amberWeek(),
      today: "2026-07-20",
      band: "red",
      yesterdayCompleted: null,
    });
    expect(mins(thenRed.week)).toBe(mins(redOnly.week));
    expect(thenRed.week.days[0].workouts[0]?.type).toBe(
      redOnly.week.days[0].workouts[0]?.type
    );
  });

  it("restores the original session when readiness recovers to green", () => {
    // A day scaled down at 06:00 on amber must come back if the athlete's
    // band improves later the same day — otherwise the morning's worst
    // reading silently governs the whole day.
    const amber = adaptDay({
      week: amberWeek(),
      today: "2026-07-20",
      band: "amber",
      yesterdayCompleted: null,
    });
    const recovered = adaptDay({
      week: amber.week,
      today: "2026-07-20",
      band: "green",
      yesterdayCompleted: null,
    });
    expect(mins(recovered.week)).toBe(137);
  });
});
```

Import `AMBER_SCALE` and `WeekState` in that test file if not already present.

- [ ] **Step 2: Run to verify they fail**

```bash
npx vitest run src/lib/week-plan/adapt-day.test.ts tests/repro-amber-compounding.test.ts
```

Expected: the three new cases FAIL, and both cases in `repro-amber-compounding.test.ts` FAIL.

- [ ] **Step 3: Add `readinessBase` to `DaySlot`**

In `src/lib/week-plan/types.ts`, add to the `DaySlot` interface:

```ts
  /**
   * The session as it stood BEFORE any readiness adaptation today, with the
   * band and date that adaptation was computed for.
   *
   * The readiness adaptation is a function of the ORIGINAL session and
   * today's band. Without this it was a function of its own previous
   * output: `onWellnessDataChanged` re-runs the adaptation on every
   * wellness event (five call sites, one of them an hourly Apple Health
   * push), and each run multiplied the ALREADY-scaled duration again. A
   * real athlete's 137-minute long ride reached 60 minutes in five runs and
   * 8 minutes in twelve.
   *
   * Absent on days that have never been readiness-adapted, so existing
   * stored weeks deserialize unchanged.
   */
  readinessBase?: {
    date: string;
    band: Band;
    workouts: ScheduledWorkout[];
  };
```

- [ ] **Step 4: Rewrite the readiness block in `adapt-day.ts`**

Replace the `if (tWorkout && (input.band === "red" || input.band === "amber")) {` block's opening so that it first restores the base, and skips entirely when nothing would change. The existing red/amber bodies stay as they are — they simply now always operate on the original session.

```ts
const t = week.days[todayIdx]; // may have been replaced above
// Readiness adaptation is a function of the ORIGINAL session and today's
// band — never of its own previous output. See DaySlot.readinessBase.
const priorBase = t.readinessBase;
if (priorBase && priorBase.date === input.today) {
  if (priorBase.band === input.band) {
    // Already adapted for exactly this band today. Nothing to do — and
    // critically, no adjustment: runDailyAdaptation persists whenever
    // anything changed, so a no-op here is what stops the compounding.
    return { week, adjustments };
  }
  // The band moved. Restore the original session and re-derive from it,
  // so amber-then-red equals red, and a recovery to green undoes the day.
  week.days[todayIdx] = {
    ...t,
    workouts: priorBase.workouts.map((w) => ({ ...w })),
    status: "planned",
    readinessBase: undefined,
  };
}

const day = week.days[todayIdx];
const tWorkout = day.workouts[0] ?? null;
if (tWorkout && (input.band === "red" || input.band === "amber")) {
  // Capture what we are adapting FROM before touching anything.
  const base = {
    date: input.today,
    band: input.band,
    workouts: day.workouts.map((w) => ({ ...w })),
  };
  const before = [{ ...day, workouts: day.workouts.map((w) => ({ ...w })) }];
  // …existing red / amber bodies unchanged, operating on `day`…
  // then, on every path that adapted the day, set:
  //   week.days[todayIdx] = { ...week.days[todayIdx], readinessBase: base };
}
```

Adapt the existing bodies to the local name `day` (they currently use `t`), and make sure **every** branch that mutates the day — the red quality-swap, the red endurance-scale, and the amber step-down — attaches `readinessBase: base` to the resulting day. The green-recovery path above is what makes `readinessBase` self-clearing.

- [ ] **Step 5: Run to verify they pass**

```bash
npx vitest run src/lib/week-plan/adapt-day.test.ts tests/repro-amber-compounding.test.ts src/lib/week-plan/
```

Expected: all pass, including every pre-existing `adapt-day` case. **If a pre-existing expectation now fails, STOP and report it with the old and new values** — do not adjust it.

- [ ] **Step 6: Commit**

```bash
npx prettier --write src/lib/week-plan/types.ts src/lib/week-plan/adapt-day.ts src/lib/week-plan/adapt-day.test.ts tests/repro-amber-compounding.test.ts
npm run format:check && npm run typecheck && npm run lint && npm test && npm run build
git add -A
git commit -m "fix(plan): readiness adaptation is a function of the original session, not its own output"
```

---

### Task 2: Do not judge a session missed before its ride can have synced

**Files:**

- Modify: `src/lib/week-plan/service.ts` (`runDailyAdaptation`, ~lines 376–440)
- Test: `tests/daily-adaptation-missed-gate.test.ts` (new, DB-gated)

**Interfaces:**

- Consumes: `schema.connections.lastSyncAt`, `schema.connections.provider`.
- Produces: no new exports.

**The rule.** `yesterdayCompleted` may only be set to `false` — the value that lets `adaptDay` mark a session missed and drop it — when activity data for yesterday is actually settled. Settled means: the user has at least one activity-providing connection (`intervals_icu`, `strava`) whose `lastSyncAt` is **after the end of yesterday**, or the user has no activity-providing connection at all (a manual-only athlete, whose data is as settled as it will ever be).

Otherwise leave `yesterdayCompleted` as `null`. That value already means "there was nothing to judge" and `adaptDay`'s missed-workout handling already skips on it — the mechanism exists, it simply was not being used for this case.

Readiness adaptation is unaffected and must still run: it depends on wellness data, not on activities.

- [ ] **Step 1: Write the failing test**

Create `tests/daily-adaptation-missed-gate.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

/**
 * The athlete rode 1.94h on 2026-07-21 at 18:50. runDailyAdaptation ran at
 * 04:50 the next morning — before any activity sync — found nothing, and
 * dropped the session as missed. Three consecutive weeks then closed as
 * "fully missed", each restarting the next at 60% of skeleton.
 */
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";
const USER = "test-missed-gate-user";

vi.mock("@/lib/session", () => ({
  requireUser: async () => ({ id: USER, name: "GateUser" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

describe.skipIf(!hasDb)("runDailyAdaptation missed gate", () => {
  // Seed a user with an open week holding a planned session yesterday, an
  // intervals_icu connection, and NO activity for yesterday.
  // Full seeding follows tests/week-plans.test.ts's existing fixtures.

  it("does not mark yesterday missed when no activity sync has run since", async () => {
    // connections.lastSyncAt set to BEFORE yesterday ended.
    // Expect: the day keeps its session; no missed_workout adjustment.
  });

  it("marks yesterday missed once an activity sync has run since", async () => {
    // connections.lastSyncAt set to AFTER yesterday ended, still no activity.
    // Expect: the missed_workout path runs exactly as before.
  });

  it("still judges a manual-only athlete with no activity connection", async () => {
    // No rows in connections for an activity provider at all.
    // Expect: missed judgement runs — nothing will ever sync for them.
  });
});
```

Fill in the seeding and assertions by following the fixtures in `tests/week-plans.test.ts`. Each `it` must genuinely exercise `runDailyAdaptation` against the DB, not a stub.

- [ ] **Step 2: Run to verify it fails**

```bash
set -a; . ./.env; set +a
npx vitest run tests/daily-adaptation-missed-gate.test.ts
```

Expected: the first case FAILS — today's code marks it missed regardless.

- [ ] **Step 3: Add the gate**

In `runDailyAdaptation`, before the yesterday-matching block, determine whether activity data is settled:

```ts
// A session may only be written off as missed once the ride has had a
// chance to arrive. onWellnessDataChanged re-runs this on every wellness
// event — including an hourly Apple Health push at 04:50 — and an
// activity sync has usually not run yet at that hour. Judging "missed"
// there wrote off rides the athlete had actually done: three consecutive
// weeks closed as "fully missed", each cutting the next to 60%.
const ACTIVITY_PROVIDERS = ["intervals_icu", "strava"] as const;
const activityConns = await db.query.connections.findMany({
  where: and(
    eq(schema.connections.userId, userId),
    inArray(schema.connections.provider, [...ACTIVITY_PROVIDERS])
  ),
});
const dayEnd = new Date(today + "T00:00:00"); // local midnight = end of yesterday
const activitiesSettled =
  activityConns.length === 0 ||
  activityConns.some((c) => c.lastSyncAt != null && c.lastSyncAt >= dayEnd);
```

Then, in the branch that currently sets `yesterdayCompleted = false`, only do so when settled:

```ts
if (activity) {
  yesterdayCompleted = true;
  matched = { id: activity.id, load: activity.load };
} else if (activitiesSettled) {
  yesterdayCompleted = false;
}
// else: leave null — nothing to judge yet, so adaptDay's missed-workout
// handling does not run and the session stays put.
```

`matched` and the readiness path are untouched: a session found is still booked, and readiness still adapts.

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run tests/daily-adaptation-missed-gate.test.ts src/lib/week-plan/
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/lib/week-plan/service.ts tests/daily-adaptation-missed-gate.test.ts
npm run format:check && npm run typecheck && npm run lint && npm test && npm run build
git add -A
git commit -m "fix(plan): do not write off a session as missed before its ride can have synced"
```

---

### Task 3: Stop a no-op availability change triggering a replan

**Files:**

- Modify: `src/lib/week-plan/service.ts` (`applyResolvedAvailability`)
- Test: `src/lib/week-plan/service.test.ts` (add a case)

**The evidence:** `availability_change/redistributed — availability updated: 19.2h→19.2h`, logged three times on 2026-07-27, plus `12.2h→12.2h` twice on 2026-07-25. An unchanged availability total is re-running the replan and writing an adjustment each time.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/week-plan/service.test.ts`, inside its existing `describe.skipIf(!hasDb)` block:

```ts
it("does not replan or log when resolved availability is unchanged", async () => {
  // Apply the same availability twice; the second call must be a no-op.
  const first = await applyResolvedAvailability(TEST_USER);
  const before = await db.query.planAdjustments.findMany({
    where: eq(schema.planAdjustments.weekPlanId /* the open week's id */),
  });
  const second = await applyResolvedAvailability(TEST_USER);
  const after = await db.query.planAdjustments.findMany({
    where: eq(schema.planAdjustments.weekPlanId /* the open week's id */),
  });
  expect(after).toHaveLength(before.length);
  expect(second).toBe("skipped");
});
```

Follow the file's existing fixtures for `TEST_USER` and the open week's id; adjust the return-value assertion to whatever `applyResolvedAvailability` actually returns.

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/lib/week-plan/service.test.ts
```

- [ ] **Step 3: Add the guard**

In `applyResolvedAvailability`, compare the newly resolved `availableBlocks` against what the stored week already holds, and return early when they are identical. Compare the blocks themselves, not just the hour total — two different block shapes can sum to the same number of hours and genuinely need a replan.

- [ ] **Step 4: Run to verify it passes, then commit**

```bash
npx vitest run src/lib/week-plan/
npx prettier --write src/lib/week-plan/service.ts src/lib/week-plan/service.test.ts
npm run format:check && npm run typecheck && npm run lint && npm test && npm run build
git add -A
git commit -m "fix(plan): an unchanged availability resolution no longer replans"
```

---

### Task 4: Release v0.28.1

- [ ] Delete the scratch diagnostic `scripts/diagnose-missed-week.ts` (it was read-only investigation, not shipping code). Keep `tests/repro-amber-compounding.test.ts` — it is now a regression test.
- [ ] Bump `version` in `package.json` to `0.28.1`.
- [ ] Add the `CHANGELOG.md` entry, in the established voice: what broke, what it cost the athlete, and what changed. Include the real numbers — 137 min to 60 min in five runs, 8 minutes in twelve, three consecutive weeks wrongly closed as fully missed.
- [ ] Full gate, then merge to `main`, confirm CI green, tag `v0.28.1`.

**Not in this release, deliberately:** reconciling a week whose load arrives after it closed; stale open weeks and multiple `status='active'` plans; the replan "fill" rung that lets added availability produce training. Each needs design work, and the fill rung in particular would have been actively dangerous while sessions were being written off as missed.

---
