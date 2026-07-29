# Cycling Session Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `generateCyclingWorkouts` distribute the whole weekly target instead of discarding ~30% of it against unsourced constants.

**Architecture:** Two pure helpers (`longRideBoundMins`, `distributeRemainder`) carry the new rules and are tested in isolation. `generateCyclingWorkouts` then composes them: size each session under a bound derived from the event's own hardest day, and push any clamped remainder onto sessions that still have headroom instead of dropping it. `queenStageHours` threads through `generateWorkouts` and `periodize` as an optional trailing parameter, so every existing call site keeps compiling and athletes with no event keep today's behaviour exactly.

**Tech Stack:** TypeScript, Next.js 16 (App Router, RSC), Drizzle + Postgres, Vitest, Tailwind v4.

**Spec:** `docs/specs/2026-07-29-cycling-session-distribution-design.md`

## Global Constraints

- **The gate is all five, in this order:** `npm run format:check && npm run typecheck && npm run lint && npm test && npm run build`. Two consecutive releases each dropped a different member and each omission broke `main`. `docs/ROADMAP.md` needs **two** `prettier --write` passes to converge.
- **Cycling only.** `generateRunningWorkouts` and `generateTriathlonWorkouts` are **not** touched by any task in this plan. Running is next as its own spec; borrowing a rule across sports is the error that produced this defect.
- **No new return values.** `generateCyclingWorkouts`, `generateWorkouts`, `periodize` and `Block` keep their current shapes. `WeekRationale` already reports the gap via `plannedHours` vs `targetHours`.
- **Where the athlete's event gives evidence, use it; where there is none, keep today's behaviour.** A null `queenStageHours` must produce `NO_DEMAND_LONG_BOUND_MINS` (240) — never `Infinity`.
- **The taper reduction stays.** Taper weeks cap the long ride at 90 minutes; that is periodization, not a leak.
- **Intervals and Tempo never absorb remainder.** Only `Long`, `Endurance` and `Recovery` rides participate in redistribution.
- **If a numeric expectation does not hold, STOP and report** rather than loosening the test. This plan deliberately changes prescriptions, so some existing expectations WILL move — each one must be **re-derived from the new arithmetic and shown correct**, never widened to pass. An expectation you cannot re-derive is a finding.
- Every new constant carries its reason in a comment, the way `volume.ts` documents its own. No bare numbers.
- `src/lib/training-plan.ts` is 748 lines with **zero** rationale comments today. Do not restructure it; add to it in its existing style plus the comments this plan requires.
- Dates are `YYYY-MM-DD` strings. Parse as **local midnight**: `new Date(ymd + "T00:00:00")`.
- `/train` is `export const dynamic = "force-dynamic"` — **`next build` never renders it**, so a green gate proves nothing about that page. v0.29.0 shipped a page-breaking crash straight through a green gate for exactly this reason.
- Read `AGENTS.md` first: this repo runs a Next.js version with breaking changes vs your training data; consult `node_modules/next/dist/docs/` before writing framework code.

## File Structure

| File                                        | Responsibility                                                 |
| ------------------------------------------- | -------------------------------------------------------------- |
| `src/lib/training-plan.ts`                  | Constants, the two pure helpers, and `generateCyclingWorkouts` |
| `src/lib/training-plan.test.ts`             | Pure, CI-visible tests for the helpers and the generator       |
| `src/lib/week-plan/project.ts`              | Passes real `queenStageHours` into `periodize`                 |
| `src/lib/week-plan/service.ts`              | Passes real `queenStageHours` into `periodize`                 |
| `src/app/train/page.tsx`                    | Preview's planned-vs-target line                               |
| `src/lib/week-plan/rollover-volume.test.ts` | Expectations re-derived (prescriptions genuinely change)       |

---

### Task 1: The two pure rules

**Files:**

- Modify: `src/lib/training-plan.ts` (add constants + two exported functions near `withPurpose`, around line 43)
- Test: `src/lib/training-plan.test.ts` (add a new pure `describe` block; do **not** put these under the existing `describe.skipIf(!hasDb)`)

**Interfaces:**

- Produces:
  - `longRideBoundMins(queenStageHours: number | null): number`
  - `distributeRemainder(current: number[], bounds: number[], remainder: number): number[]`
  - `MIN_LONG_BOUND_MINS`, `ABSOLUTE_LONG_BOUND_MINS`, `MIN_EFFECTIVE_EASY_MINS`, `NO_DEMAND_LONG_BOUND_MINS`

**Why pure and separate:** these are the whole substance of the change and they have no I/O, so they can be fully covered in CI. The repo's DB-gated tests skip in CI (no `DATABASE_URL` there); anything that can be a pure test must be one.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/training-plan.test.ts`. Import the new names alongside the existing imports from `./training-plan`.

```ts
describe("longRideBoundMins", () => {
  it("falls back to today's cap when there is no event demand", () => {
    // No race, or no FTP -> eventDemand returns null. Keep today's
    // behaviour rather than inventing a bound on no evidence.
    expect(longRideBoundMins(null)).toBe(240);
  });

  it("uses the event's hardest day", () => {
    // The Ride - Dolomites 2026: queenStageHours 4.897963084361944
    expect(longRideBoundMins(4.897963084361944)).toBe(294);
  });

  it("floors a very short event at a useful endurance stimulus", () => {
    // A criterium's queen stage is under an hour; a 30-minute "long ride"
    // is not an endurance session.
    expect(longRideBoundMins(0.5)).toBe(120);
  });

  it("never exceeds the absolute six-hour bound", () => {
    expect(longRideBoundMins(9)).toBe(360);
  });

  it("treats nonsense demand as no demand", () => {
    expect(longRideBoundMins(0)).toBe(240);
    expect(longRideBoundMins(-1)).toBe(240);
    expect(longRideBoundMins(Number.NaN)).toBe(240);
  });
});

describe("distributeRemainder", () => {
  it("splits the remainder evenly when everyone has headroom", () => {
    // The live case: two 90-minute endurance rides clamped from 197.
    expect(distributeRemainder([90, 90], [294, 294], 214)).toEqual([197, 197]);
  });

  it("spills onto sessions with room when one hits its bound", () => {
    // 0 can take only 20 more; the other 30 must land on 1, not vanish.
    expect(distributeRemainder([100, 50], [120, 300], 100)).toEqual([120, 130]);
  });

  it("stops when nothing has headroom, rather than looping", () => {
    expect(distributeRemainder([100], [100], 50)).toEqual([100]);
  });

  it("is a no-op for a zero or negative remainder", () => {
    expect(distributeRemainder([60, 60], [200, 200], 0)).toEqual([60, 60]);
    expect(distributeRemainder([60, 60], [200, 200], -10)).toEqual([60, 60]);
  });

  it("never exceeds any bound", () => {
    const out = distributeRemainder([10, 10, 10], [20, 20, 20], 1000);
    expect(out).toEqual([20, 20, 20]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/lib/training-plan.test.ts
```

Expected: FAIL — `longRideBoundMins is not a function` / `distributeRemainder is not a function`.

- [ ] **Step 3: Implement**

Add to `src/lib/training-plan.ts`, immediately after `withPurpose` (around line 48):

```ts
/**
 * How long a single ride may be, in minutes.
 *
 * The old code capped the long ride at a flat 240 and every endurance ride
 * at 90 — numbers that arrived with this file on 2026-07-15 carrying no
 * rationale, no citation and no test. They are the reason a 12.5h target
 * produced a 9.3h week.
 *
 * Cycling has no single-session spike rule. Running does — exceeding your
 * own recent longest run by 10-30% raises injury risk 64% in a study of
 * 5,200+ runners — but that is impact loading, and a bike is not a
 * treadmill. In cycling, overuse injury follows CUMULATIVE load outrunning
 * tissue repair, which `weeklyTargetHours` already bounds upstream via the
 * ACWR ceiling and the ramp clamp. The weekly number handed to this
 * generator is therefore already the safe one.
 *
 * What remains is: how long should ONE ride be? The evidence is
 * event-relative — "for events lasting 4-5 hours, a 4-hour long ride each
 * week is sufficient", endurance rides "longer than two hours and shorter
 * than six" for a moderately experienced rider. So bound the long ride by
 * the hardest single day the athlete's event actually demands.
 */

/**
 * Floor. A criterium's queen stage is under an hour; without this the long
 * ride would collapse below a useful endurance stimulus.
 */
export const MIN_LONG_BOUND_MINS = 120;

/** Ceiling: "shorter than six hours", regardless of how long the event is. */
export const ABSOLUTE_LONG_BOUND_MINS = 360;

/** Today's floor for easy rides, retained — it makes no new claim. */
export const MIN_EFFECTIVE_EASY_MINS = 30;

/**
 * Today's cap, retained DELIBERATELY for the no-demand path. Where the
 * athlete's event gives us evidence we use it; where there is none we keep
 * today's behaviour rather than inventing a bound. `weeklyTargetHours`
 * makes the same choice for its own null ceiling, on the grounds that
 * `min(demand, ceiling ?? Infinity)` "would hand a brand-new athlete
 * ~11h/week on no evidence at all".
 */
export const NO_DEMAND_LONG_BOUND_MINS = 240;

/**
 * `queenStageHours` comes from `EventDemand` — "the hardest single day;
 * equals `dailyRateHours` when stages are unknown". When
 * `demand.queenStageKnown` is false it is an average across event days, so
 * for a mountain tour the real queen stage is harder and this bound is
 * conservative.
 */
export function longRideBoundMins(queenStageHours: number | null): number {
  if (
    queenStageHours == null ||
    !Number.isFinite(queenStageHours) ||
    queenStageHours <= 0
  ) {
    return NO_DEMAND_LONG_BOUND_MINS;
  }
  return Math.min(
    ABSOLUTE_LONG_BOUND_MINS,
    Math.max(MIN_LONG_BOUND_MINS, Math.round(queenStageHours * 60))
  );
}

/**
 * Push `remainder` minutes onto sessions that still have headroom.
 *
 * The caps were only half the defect. The other half was that whatever a
 * cap removed was simply DISCARDED — the week silently came in under its
 * own target. Here a session that reaches its bound drops out and the rest
 * absorb what is left, so minutes move rather than evaporate.
 *
 * Even split, repeated: each pass gives every session with room an equal
 * share (at least 1, so the loop always makes progress), capped at that
 * session's own bound. Terminates when the remainder is gone or nothing
 * has headroom — the latter is a real "these days cannot absorb this".
 *
 * `current` and `bounds` are parallel arrays; the return value is a new
 * array, same length, same order.
 */
export function distributeRemainder(
  current: number[],
  bounds: number[],
  remainder: number
): number[] {
  const out = [...current];
  let left = Math.max(0, Math.round(remainder));

  while (left > 0) {
    const open: number[] = [];
    for (let i = 0; i < out.length; i++) {
      if (out[i] < bounds[i]) open.push(i);
    }
    if (open.length === 0) break;

    const share = Math.max(1, Math.floor(left / open.length));
    for (const i of open) {
      if (left === 0) break;
      const add = Math.min(share, bounds[i] - out[i], left);
      out[i] += add;
      left -= add;
    }
  }

  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run src/lib/training-plan.test.ts
```

Expected: PASS, including the pre-existing `workout purpose` tests. The `describe.skipIf(!hasDb)` block will skip unless you load the env — that is expected and correct.

- [ ] **Step 5: Full gate and commit**

```bash
npx prettier --write src/lib/training-plan.ts src/lib/training-plan.test.ts
set -a; . ./.env; set +a
npm run format:check && npm run typecheck && npm run lint && npm test && npm run build
git add -A
git commit -m "feat(plan): event-relative long-ride bound and remainder redistribution"
```

---

### Task 2: `generateCyclingWorkouts` distributes the whole target

**Files:**

- Modify: `src/lib/training-plan.ts:367-444` (`generateCyclingWorkouts`)
- Test: `src/lib/training-plan.test.ts` (new pure `describe` block)
- Re-derive: `src/lib/week-plan/rollover-volume.test.ts`

**Interfaces:**

- Consumes: `longRideBoundMins`, `distributeRemainder`, `MIN_EFFECTIVE_EASY_MINS` from Task 1.
- Produces: `generateCyclingWorkouts(sessions, weekHours, phase, queenStageHours?)` — the fourth parameter is optional and defaults to `null`, so existing callers compile unchanged and take the no-demand path.

**Expect existing expectations to move.** `rollover-volume.test.ts` calls `periodize(9, 76.7, 4, 10, "century", ["Bike"])` with no demand. Its week-5 block currently totals 526 min; after this task it totals ~618 min (the full target), because the endurance fill is no longer clamped to 90. That is the fix working. **Re-derive each changed number from the new arithmetic and show your working in the report — do not widen a range to make it pass.**

- [ ] **Step 1: Write the failing test**

```ts
describe("generateCyclingWorkouts distributes the target", () => {
  function total(ws: { durationMins: number }[]): number {
    return ws.reduce((s, w) => s + w.durationMins, 0);
  }

  it("schedules the whole target — the live regression", () => {
    // Owner account, skeleton week 5, build phase: 12.5h target x the 1.03
    // build multiplier = 772.5 -> 773 min. This produced 559 min before
    // the fix (long clamped 294->240, two endurance rides clamped 197->90).
    const ws = generateCyclingWorkouts(
      4,
      12.5 * 1.03,
      "build",
      4.897963084361944
    );
    expect(total(ws)).toBe(773);
  });

  it("puts the long ride at the event's hardest day, not a constant", () => {
    const ws = generateCyclingWorkouts(
      4,
      12.5 * 1.03,
      "build",
      4.897963084361944
    );
    const long = ws.find((w) => w.type === "Long");
    expect(long?.durationMins).toBe(294);
  });

  it("leaves the intensity session out of redistribution", () => {
    // 18% of 773 = 139. It must not grow to soak up volume: duration at
    // intensity is prescribed, not filler.
    const ws = generateCyclingWorkouts(
      4,
      12.5 * 1.03,
      "build",
      4.897963084361944
    );
    const hard = ws.find((w) => w.type === "Intervals");
    expect(hard?.durationMins).toBe(139);
  });

  it("still fills the target with no event demand, using today's cap", () => {
    // periodize(9, 76.7, 4, 10, ...) week 5: 10h x 1.03 = 618 min.
    // Long = round(618 x 0.38) = 235, under the 240 no-demand bound.
    const ws = generateCyclingWorkouts(4, 10 * 1.03, "build", null);
    expect(total(ws)).toBe(618);
    expect(ws.find((w) => w.type === "Long")?.durationMins).toBe(235);
  });

  it("keeps the taper's shortened long ride", () => {
    const ws = generateCyclingWorkouts(4, 8, "taper", 4.897963084361944);
    expect(ws.find((w) => w.type === "Long")?.durationMins).toBe(90);
  });

  it("falls short only when every participating session is at its bound", () => {
    // 2 sessions against an impossible 20h target, with a criterium's queen
    // stage bounding the ride at 120. Long pins at 120 and there are no
    // endurance rides to absorb anything, so the week legitimately comes in
    // short — that is a real "these days cannot absorb this", not a
    // discarded remainder.
    //
    // Tempo is NOT bounded by longBound: it is 18% of the target by
    // prescription (round(1200 × 0.18) = 216) and is excluded from
    // redistribution, so assert only the participating sessions.
    const ws = generateCyclingWorkouts(2, 20, "base", 0.5);
    expect(total(ws)).toBeLessThan(20 * 60);

    const participating = ws.filter(
      (w) => w.type !== "Intervals" && w.type !== "Tempo"
    );
    expect(participating.length).toBeGreaterThan(0);
    for (const w of participating) {
      expect(w.durationMins).toBeLessThanOrEqual(120);
    }
    expect(ws.find((w) => w.type === "Long")?.durationMins).toBe(120);
  });

  it("never drops an easy ride below the effective floor", () => {
    const ws = generateCyclingWorkouts(5, 2, "base", null);
    for (const w of ws.filter((x) => x.type === "Endurance")) {
      expect(w.durationMins).toBeGreaterThanOrEqual(30);
    }
  });
});
```

`generateCyclingWorkouts` is currently module-private. Export it so the test can reach it directly — it is the unit under test, and testing it only through `periodize` would hide which stage lost the minutes.

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/lib/training-plan.test.ts
```

Expected: FAIL — the first case returns 559, not 773.

- [ ] **Step 3: Implement**

Replace `generateCyclingWorkouts` in `src/lib/training-plan.ts` entirely:

```ts
export function generateCyclingWorkouts(
  sessions: number,
  weekHours: number,
  phase: Block["phase"],
  queenStageHours: number | null = null
): PlannedWorkout[] {
  const totalMins = Math.round(weekHours * 60);

  // A taper deliberately shortens the long ride — that is periodization,
  // not the leak this function is being fixed for, so the taper figure is
  // untouched. Every other phase is bounded by the event's hardest day.
  const longBound = phase === "taper" ? 90 : longRideBoundMins(queenStageHours);

  const workouts: PlannedWorkout[] = [];

  // Saturday: long ride (35-40% of volume)
  workouts.push(
    withPurpose({
      day: 5,
      sport: "Bike",
      type: "Long",
      durationMins: Math.min(Math.round(totalMins * 0.38), longBound),
      intensity: "Z1-Z2",
      description:
        phase === "taper"
          ? "Reduced endurance ride"
          : "Long endurance ride — steady aerobic effort",
    })
  );

  // Midweek intensity in build/peak. Its duration is prescribed by what the
  // session IS, so it is sized here and never touched again below.
  if (phase === "build" || phase === "peak") {
    workouts.push(
      withPurpose({
        day: 2,
        sport: "Bike",
        type: "Intervals",
        durationMins: Math.round(totalMins * 0.18),
        intensity: "Z4-Z5",
        description: "VO2max intervals: 5×4min at threshold+, 3min recovery",
      })
    );
  } else if (phase !== "recovery") {
    workouts.push(
      withPurpose({
        day: 2,
        sport: "Bike",
        type: "Tempo",
        durationMins: Math.round(totalMins * 0.18),
        intensity: "Z3",
        description: "Tempo ride — steady sweetspot effort",
      })
    );
  }

  // Fill remaining with endurance rides
  const usedDays = new Set(workouts.map((w) => w.day));
  const availDays = [0, 1, 3, 4, 6].filter((d) => !usedDays.has(d));
  const remaining = sessions - workouts.length;
  const allocatedMins = workouts.reduce((s, w) => s + w.durationMins, 0);
  const easyMins = Math.round(
    (totalMins - allocatedMins) / Math.max(1, remaining)
  );

  for (let i = 0; i < remaining && i < availDays.length; i++) {
    workouts.push(
      withPurpose({
        day: availDays[i],
        sport: "Bike",
        type: phase === "recovery" ? "Recovery" : "Endurance",
        durationMins: Math.max(
          MIN_EFFECTIVE_EASY_MINS,
          Math.min(easyMins, longBound)
        ),
        intensity: phase === "recovery" ? "Recovery" : "Z1-Z2",
        description:
          phase === "recovery"
            ? "Easy recovery spin"
            : "Aerobic endurance ride",
      })
    );
  }

  // Whatever the bounds above removed is redistributed rather than
  // discarded — discarding it is precisely how a 12.5h target became a
  // 9.3h week. Intensity sessions are excluded: stretching a VO2max block
  // to absorb volume changes what the session is.
  const participants = workouts
    .map((w, i) => i)
    .filter(
      (i) => workouts[i].type !== "Intervals" && workouts[i].type !== "Tempo"
    );

  const scheduled = workouts.reduce((s, w) => s + w.durationMins, 0);
  const remainder = totalMins - scheduled;

  if (remainder > 0 && participants.length > 0) {
    const grown = distributeRemainder(
      participants.map((i) => workouts[i].durationMins),
      participants.map(() => longBound),
      remainder
    );
    participants.forEach((wi, k) => {
      workouts[wi] = { ...workouts[wi], durationMins: grown[k] };
    });
  }

  return workouts.sort((a, b) => a.day - b.day);
}
```

- [ ] **Step 4: Run the new tests, then the ones whose numbers move**

```bash
npx vitest run src/lib/training-plan.test.ts
npx vitest run src/lib/week-plan/rollover-volume.test.ts
```

`rollover-volume.test.ts` expectations will move. For **each** failure: compute the new number by hand from the arithmetic above, confirm it equals what the code produced, and only then update it — recording the derivation in your report. If a number does not reconcile, **STOP and report**.

- [ ] **Step 5: Full gate and commit**

```bash
npx prettier --write src/lib/training-plan.ts src/lib/training-plan.test.ts src/lib/week-plan/rollover-volume.test.ts
set -a; . ./.env; set +a
npm run format:check && npm run typecheck && npm run lint && npm test && npm run build
git add -A
git commit -m "fix(plan): cycling weeks schedule their whole target"
```

---

### Task 3: Thread the event's hardest day to the live call sites

**Files:**

- Modify: `src/lib/training-plan.ts` (`generateWorkouts` ~line 253, `periodize` ~line 138)
- Modify: `src/lib/week-plan/project.ts:202`
- Modify: `src/lib/week-plan/service.ts:289`
- Test: `src/lib/training-plan.test.ts`

**Interfaces:**

- Consumes: `generateCyclingWorkouts(..., queenStageHours?)` from Task 2.
- Produces:
  - `generateWorkouts(sessions, weekHours, phase, raceType, sports, queenStageHours?)`
  - `periodize(weeksTotal, startingCtl, daysPerWeek, hoursPerWeek, raceType, sports, queenStageHours?)`

Both new parameters are **optional, trailing, defaulting to `null`**, so the eight existing test call sites and the plan-creation call site compile untouched and keep the no-demand path.

`assembleVolumeInputs` already returns `demand: EventDemand | null`, and both live call sites already hold its result in a `volumeInputs` local.

- [ ] **Step 1: Write the failing test**

```ts
describe("periodize passes event demand to the cycling generator", () => {
  it("bounds the long ride by the event's hardest day", () => {
    const withDemand = periodize(
      9,
      76.7,
      4,
      12.5,
      "century",
      ["Bike"],
      4.897963084361944
    );
    const withoutDemand = periodize(9, 76.7, 4, 12.5, "century", ["Bike"]);

    const longOf = (blocks: ReturnType<typeof periodize>) =>
      blocks
        .find((b) => b.weekNumber === 5)!
        .workouts.find((w) => w.type === "Long")!.durationMins;

    // 12.5h x 1.03 = 773 min; 38% = 294, which the event allows and the
    // 240 no-demand fallback does not.
    expect(longOf(withDemand)).toBe(294);
    expect(longOf(withoutDemand)).toBe(240);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/lib/training-plan.test.ts
```

Expected: FAIL — `periodize` takes six arguments; the seventh is ignored, so both sides return 240.

- [ ] **Step 3: Implement**

In `src/lib/training-plan.ts`, add the trailing parameter to `generateWorkouts` and forward it:

```ts
export function generateWorkouts(
  sessions: number,
  weekHours: number,
  phase: Block["phase"],
  raceType: string,
  sports: string[],
  queenStageHours: number | null = null
): PlannedWorkout[] {
  if (isTriathlon(raceType)) {
    return generateTriathlonWorkouts(sessions, weekHours, phase);
  }
  if (sports[0] === "Bike") {
    return generateCyclingWorkouts(sessions, weekHours, phase, queenStageHours);
  }
  return generateRunningWorkouts(sessions, weekHours, phase, raceType);
}
```

Running and triathlon deliberately ignore it — their rules differ and are out of scope.

Add the same trailing parameter to `periodize` and pass it to **both** `generateWorkouts` calls (the recovery-week branch and the normal branch):

```ts
export function periodize(
  weeksTotal: number,
  startingCtl: number,
  daysPerWeek: number,
  hoursPerWeek: number,
  raceType: string,
  sports: string[],
  queenStageHours: number | null = null
): Block[] {
```

```ts
        workouts: generateWorkouts(
          daysPerWeek - 1,
          hoursPerWeek * 0.6,
          "recovery",
          raceType,
          sports,
          queenStageHours
        ),
```

```ts
        workouts: generateWorkouts(
          daysPerWeek,
          hoursPerWeek * loadMultiplier(phase, weekInPhase),
          phase,
          raceType,
          sports,
          queenStageHours
        ),
```

In `src/lib/week-plan/project.ts:202`, add the argument:

```ts
const derivedBlocks = periodize(
  plan.weeksTotal,
  plan.startingCtl ?? 0,
  constraints.daysPerWeek,
  target.hours,
  plan.raceType,
  constraints.sports,
  // The hardest single day this athlete's event demands — what a long
  // ride should build toward. Null when there is no race or no FTP, which
  // keeps the pre-existing 240-minute bound.
  volumeInputs.demand?.queenStageHours ?? null
);
```

In `src/lib/week-plan/service.ts:289`, make the identical change — `volumeInputs` is already in scope there too.

Leave the plan-creation call at `src/lib/training-plan.ts:659` passing nothing. It runs before any demand is assembled, and its blocks are only a seed: `project.ts` and `service.ts` both re-derive fresh, and `service.ts` says so explicitly ("Recomputed fresh, never read as authority").

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run src/lib/training-plan.test.ts src/lib/week-plan/
```

Expected: PASS. `repair.test.ts` and `project.test.ts` may move — re-derive as in Task 2, never widen.

- [ ] **Step 5: Full gate and commit**

```bash
npx prettier --write src/lib/training-plan.ts src/lib/training-plan.test.ts src/lib/week-plan/project.ts src/lib/week-plan/service.ts
set -a; . ./.env; set +a
npm run format:check && npm run typecheck && npm run lint && npm test && npm run build
git add -A
git commit -m "feat(plan): long rides build toward the event's hardest day"
```

---

### Task 4: The preview says what it planned against its target

**Files:**

- Modify: `src/app/train/page.tsx` (the next-week assumption line added in v0.29.0, ~line 658)

**Interfaces:**

- Consumes: `projectWeek`'s `ProjectedWeek` — already has `days` and `target: VolumeResult`.

**Why only here:** `WeekRationale` already renders `"{plannedHours}h planned against a {targetHours}h target."` for the open week, and `plannedHours` is already the summed `durationMins` of scheduled workouts. The open week needs nothing. The projected week has no rationale panel at all, because v0.29.0 deliberately kept those panels weekly — so it gets one line of the same form and nothing more.

**Out of scope:** a rationale panel for the projected week.

- [ ] **Step 1: Add the line**

Add the import first — `fmt` is already exported from `week-rationale.tsx` for exactly this kind of reuse, and it keeps the two surfaces formatting hours identically:

```tsx
import { fmt } from "@/components/plan/week-rationale";
```

Then, next to the existing assumption line (`projected` is declared at
`page.tsx:469` and `nextWeekPreview` at `:481`, both in scope at the render site):

```tsx
{
  nextWeekPreview && (
    <p className="-mt-3 mb-5 px-1 text-[11px] text-white/40">
      {`${fmt(nextWeekPlannedHours)} planned against a ${fmt(
        nextWeekTargetHours
      )} target. `}
      Assumes this week goes to plan. Firms up Monday.{" "}
      <Link href={href({ availability: "next" })} className="underline">
        Set next week&apos;s availability
      </Link>
    </p>
  );
}
```

Derive both figures beside the existing `nextWeekPreview` derivation:

```tsx
const nextWeekPlannedHours =
  (projected?.days.reduce(
    (s, d) => s + d.workouts.reduce((t, w) => t + w.durationMins, 0),
    0
  ) ?? 0) / 60;
const nextWeekTargetHours = projected?.target.hours ?? 0;
```

- [ ] **Step 2: Verify by loading the page**

`/train` is `force-dynamic`; `next build` never renders it. Drive an authenticated Playwright session against `next dev` and confirm the preview line renders, with the two figures agreeing after Tasks 1-3.

Use the **dev** database on port 5435 (`.env`) — **never 5434, which is live.** Seed or reuse a dev account with an active cycling plan and an open week. The v0.29.0 work established that headless Chromium runs in this sandbox; if you cannot get an authenticated session working, say so plainly in your report rather than reporting an unverified pass.

- [ ] **Step 3: Full gate and commit**

```bash
npx prettier --write src/app/train/page.tsx
set -a; . ./.env; set +a
npm run format:check && npm run typecheck && npm run lint && npm test && npm run build
git add -A
git commit -m "feat(train): the preview states what it planned against its target"
```

---

### Task 5: Dry-run the repair for the open week

**Files:** none modified. This task produces evidence and a decision, not a diff.

The fix changes future derivations only. `projectWeek` and `rolloverWeekPlan` both call `periodize` fresh, so next week is correct immediately and **no migration is needed**. Only the stored open week keeps its old, short sessions.

- [ ] **Step 1: Dry-run, scoped**

Look the user id up rather than hardcoding one — write a throwaway script under
`scripts/` (Vitest only scans `src/**` and `tests/**`, so nothing there runs as a
test) that reads it by email, then delete the script:

```ts
// scripts/tmp-owner-id.ts — READ-ONLY, delete after use
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
const u = await db.query.users.findFirst({
  where: eq(schema.users.email, "b.abraas@gmail.com"),
});
console.log(u?.id);
process.exit(0);
```

```bash
set -a; . ./.env.live-restore; set +a
npx tsx scripts/tmp-owner-id.ts
rm scripts/tmp-owner-id.ts
npx tsx scripts/repair-corrupted-week.ts --user <the id printed above> --dry-run
```

`--user` is **mandatory**. The script recomputes from current inputs, so unscoped it shows — and would write — diffs for every athlete's week.

Note `.env.live-restore` points at the **live** database on port 5434. This step reads it; nothing in this task writes to it.

- [ ] **Step 2: Report the diff and STOP**

Put the full dry-run output in your report. **Do not apply it.** This would be the script's first run against live data, and applying it mid-week back-loads the remaining days: with Monday and Tuesday settled, raising the week to target concentrates the difference into what is left. The weekly total stays inside the ACWR ceiling, but distribution is the axis cycling research actually cares about.

The decision — apply, or let Monday's rollover pick it up — belongs to the plan owner, with the real numbers in front of them.

---

### Task 6: Release

- [ ] Bump `version` in `package.json` to `0.30.0`.
- [ ] Add the `CHANGELOG.md` entry in the established voice — read several existing entries first. Say what changes for the athlete: weeks now schedule the hours they were targeting, and long rides build toward the hardest day of the event rather than stopping at a fixed four hours. Be explicit that this only lengthens prescriptions for athletes who have a target race, and that the weekly total was already safety-bounded before this change.
- [ ] Add a `docs/ROADMAP.md` entry before `## Ongoing — operations track`. It needs **two** `prettier --write` passes to converge.
- [ ] Record in `docs/plans/2026-07-29-HANDOFF-next-week-preview.md` that `generateRunningWorkouts` and `generateTriathlonWorkouts` still carry the same discard-the-remainder defect, and that running's fix needs the athlete-relative spike rule rather than this cycling one.
- [ ] Full gate. **Do not merge, tag or push** — bring it back for sign-off, as with v0.29.0.
