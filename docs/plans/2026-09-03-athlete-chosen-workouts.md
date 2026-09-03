# Athlete-Chosen Workouts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the athlete browse the whole 103-workout cycling library and place a chosen workout on a day the engine left empty, without touching availability.

**Architecture:** `ScheduledWorkout` swaps a bare `blockIdx: number` for a `Placement` discriminated union — either `{ kind: "block"; blockIdx }` (engine-placed, occupies availability) or `{ kind: "athlete"; choice }` (chosen, occupies none). Every mutating engine rung gains session-level immunity for athlete-placed sessions and records an adjustment instead of changing them. A new picker sheet lists the full library with recommendations marked inside it.

**Tech Stack:** Next.js App Router (server components + server actions), TypeScript strict, Drizzle ORM on Postgres (`week_plans.days` is `jsonb`), Vitest, Playwright-driven surface capture.

**Spec:** `docs/specs/2026-09-03-athlete-chosen-workouts-design.md`

## Global Constraints

- **`npx tsc --noEmit` after every task.** A green Vitest run is not evidence the branch compiles — Vitest transpiles and strips types. `docs/2026-09-01-structured-workouts-handoff.md` records 47/47 passing on a branch with seven type errors.
- **Never `git add -A`.** Another session may edit this tree live; stage explicit paths only.
- **Every new constant carries a `source`** naming provenance, a `Confidence:` label, and what would raise it — the voice `src/lib/plan-constants.ts` and `src/lib/interval/library.ts` use.
- **Zero confirmed axe violations is a ratchet, not a milestone.** No task may raise `surface-ceilings.json`.
- **A guard never seen to fail is not a guard.** The immunity branch (Task 4) must be mutation-tested: delete the skip, watch a named test go red, restore it.
- **Commit before mutation-testing.** `git checkout` on an uncommitted file discards the work, not the mutation.
- **A new surface goes in BOTH `--except` lists** — `.github/workflows/surfaces.yml` and `.github/workflows/soak.yml`. `0.127.0-rc.1` died in the Soak for updating only one.
- **Library targets are always % of FTP, never watts** (`src/lib/interval/types.ts`).
- `MAX_SESSIONS_PER_DAY = 2` (`src/lib/availability/types.ts`).

---

## File Structure

| File                                                  | Responsibility                                                                                        |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `src/lib/week-plan/placement.ts` (new)                | The `Placement` union, `AthleteChoice`, constructors, and `normalizePlacement` for legacy jsonb rows. |
| `src/lib/week-plan/types.ts` (modify)                 | `ScheduledWorkout` carries `placement`; `AdjustmentTrigger`/`AdjustmentAction` gain members.          |
| `src/lib/week-plan/immunity.ts` (new)                 | The single predicate `isAthleteChosen` every rung consults, plus the adjustment builder.              |
| `src/lib/week-plan/add-chosen.ts` (new)               | `canAddWorkout` eligibility + `buildChosenSession` — pure, no db.                                     |
| `src/lib/interval/recommend.ts` (new)                 | `recommendWorkouts` — pure ranking over `LIBRARY`, with sourced constants.                            |
| `src/app/plan/actions.ts` (modify)                    | `addChosenWorkoutAction` / `removeChosenWorkoutAction` server actions.                                |
| `src/components/train/workout-picker-sheet.tsx` (new) | The full-library picker with recommendations and warnings.                                            |
| `scripts/backfill-placement.ts` (new)                 | One-off normalization of stored `week_plans.days`.                                                    |

---

### Task 1: The placement type and its normalizer

**Files:**

- Create: `src/lib/week-plan/placement.ts`
- Test: `src/lib/week-plan/placement.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `AthleteChoice`, `Placement`, `blockPlacement(blockIdx: number): Placement`, `athletePlacement(choice: AthleteChoice): Placement`, `isAthleteChosen(w: { placement: Placement }): boolean`, `blockIdxOf(p: Placement): number | null`, `normalizePlacement(raw: unknown): Placement`.

- [x] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import {
  athletePlacement,
  blockIdxOf,
  blockPlacement,
  isAthleteChosen,
  normalizePlacement,
  type AthleteChoice,
} from "./placement";

const choice: AthleteChoice = {
  workoutId: "thr-4x8",
  chosenAt: "2026-09-03T07:00:00.000Z",
};

describe("blockIdxOf", () => {
  it("returns the index for a block placement", () => {
    expect(blockIdxOf(blockPlacement(1))).toBe(1);
  });

  it("returns null for an athlete placement — it occupies no block", () => {
    expect(blockIdxOf(athletePlacement(choice))).toBeNull();
  });
});

describe("isAthleteChosen", () => {
  it("is true only for an athlete placement", () => {
    expect(isAthleteChosen({ placement: athletePlacement(choice) })).toBe(true);
    expect(isAthleteChosen({ placement: blockPlacement(0) })).toBe(false);
  });
});

describe("normalizePlacement", () => {
  it("maps a legacy bare index onto a block placement", () => {
    // Every week stored before this release serialised `blockIdx: number`.
    expect(normalizePlacement({ blockIdx: 2 })).toEqual({
      kind: "block",
      blockIdx: 2,
    });
  });

  it("passes a new-shape placement through untouched", () => {
    const p = athletePlacement(choice);
    expect(normalizePlacement({ placement: p })).toEqual(p);
  });

  it("prefers placement over a dual-written legacy blockIdx", () => {
    // The transition release writes both; placement is the authority.
    expect(
      normalizePlacement({
        placement: { kind: "block", blockIdx: 3 },
        blockIdx: 3,
      })
    ).toEqual({ kind: "block", blockIdx: 3 });
  });

  it("falls back to block 0 for a row carrying neither", () => {
    // Defensive: a hand-edited or truncated row still deserialises to
    // something the engine can reason about rather than crashing a week.
    expect(normalizePlacement({})).toEqual({ kind: "block", blockIdx: 0 });
  });

  it("is idempotent", () => {
    const once = normalizePlacement({ blockIdx: 2 });
    expect(normalizePlacement({ placement: once })).toEqual(once);
  });
});
```

- [x] **Step 2: Run the test and watch it fail**

Run: `npx vitest run src/lib/week-plan/placement.test.ts`
Expected: FAIL — `Failed to resolve import "./placement"`.

- [x] **Step 3: Write the implementation**

```ts
/**
 * Where a session sits, and who put it there.
 *
 * `blockIdx` used to be a bare required field on ScheduledWorkout, with the
 * comment "placing a session without saying where is a compile error, not a
 * silent wrong week". That property is preserved here rather than weakened:
 * an ENGINE-placed session must still name its block. What the union adds is
 * a second, equally explicit answer — an athlete-placed session occupies no
 * availability block at all, because availability is the auto-assigner's
 * input and a session the athlete chose is not the auto-assigner's business.
 */
export interface AthleteChoice {
  /** The library workout the athlete picked. */
  workoutId: string;
  /** ISO instant. Recorded for the athlete, never compared. */
  chosenAt: string;
}

export type Placement =
  | { kind: "block"; blockIdx: number }
  | { kind: "athlete"; choice: AthleteChoice };

export function blockPlacement(blockIdx: number): Placement {
  return { kind: "block", blockIdx };
}

export function athletePlacement(choice: AthleteChoice): Placement {
  return { kind: "athlete", choice };
}

export function isAthleteChosen(w: { placement: Placement }): boolean {
  return w.placement.kind === "athlete";
}

/**
 * The block index, or null when the session occupies none.
 *
 * Returning null rather than -1 is deliberate: every caller indexes
 * `availableBlocks` with this, and `arr[-1]` is silently `undefined` while
 * `arr[null as never]` is a type error. The compiler does the work.
 */
export function blockIdxOf(p: Placement): number | null {
  return p.kind === "block" ? p.blockIdx : null;
}

/**
 * `week_plans.days` is jsonb with no runtime validation, so every week stored
 * before this release carries `blockIdx: number` and no `placement`. This is
 * the read boundary's translation, and it is idempotent so it can run on
 * every read without accumulating.
 */
export function normalizePlacement(raw: unknown): Placement {
  const r = (raw ?? {}) as {
    placement?: Placement;
    blockIdx?: number;
  };
  if (r.placement != null) return r.placement;
  if (typeof r.blockIdx === "number") return blockPlacement(r.blockIdx);
  return blockPlacement(0);
}
```

- [x] **Step 4: Run the test and the typecheck**

Run: `npx vitest run src/lib/week-plan/placement.test.ts && npx tsc --noEmit`
Expected: PASS, and a clean typecheck.

- [x] **Step 5: Commit**

```bash
git add src/lib/week-plan/placement.ts src/lib/week-plan/placement.test.ts
git commit -m "Placement union: an engine block, or the athlete's own choice"
```

---

### Task 2: Walk `ScheduledWorkout` onto the placement

This task changes no behaviour. It is the compiler-driven walk of all 49 `blockIdx` sites, and every existing test must still pass at the end of it.

**Files:**

- Modify: `src/lib/week-plan/types.ts` (`ScheduledWorkout`, `blockFits`)
- Modify: `src/lib/week-plan/replan.ts`, `adapt-day.ts`, `fill.ts`, `service.ts`, `slots.ts`, `repair.ts`, `project.ts`, `materialize.ts`
- Modify: `src/lib/training-plan.ts:108` (the `withPurpose` comment naming `blockIdx`)

**Interfaces:**

- Consumes: everything Task 1 produced.
- Produces: `ScheduledWorkout` with `placement: Placement` and no `blockIdx`; `blockFits(d, placement, mins)`.

- [x] **Step 1: Change the type and let the compiler find the work**

In `src/lib/week-plan/types.ts`, replace the `blockIdx` field:

```ts
export interface ScheduledWorkout extends PlannedWorkout {
  /**
   * Where this session sits and who put it there. See placement.ts — an
   * engine-placed session names its block; an athlete-placed one occupies
   * none, and the engine reads it but never writes it.
   */
  placement: Placement;
  pin?: WorkoutPin;
}
```

and widen `blockFits` to take a placement, since a session with no block never fits one:

```ts
export function blockFits(
  d: Pick<DaySlot, "availableBlocks">,
  placement: Placement,
  mins: number
): boolean {
  const idx = blockIdxOf(placement);
  if (idx == null) return false;
  const block = d.availableBlocks[idx];
  return block != null && blockMins(block) >= mins;
}
```

- [x] **Step 2: Run the typecheck to enumerate every site**

Run: `npx tsc --noEmit 2>&1 | tee /tmp/placement-walk.txt; wc -l /tmp/placement-walk.txt`
Expected: a long list of errors. This list IS the task. Do not proceed by grep.

- [x] **Step 3: Fix each site mechanically**

Three mechanical shapes cover nearly all of them:

```ts
// Reading an index:            const block = d.availableBlocks[w.blockIdx];
const idx = blockIdxOf(w.placement);
const block = idx == null ? undefined : d.availableBlocks[idx];

// Constructing a placed session:   { ...workout, blockIdx }
{ ...workout, placement: blockPlacement(blockIdx) }

// Sorting by index:            a.blockIdx - b.blockIdx
(blockIdxOf(a.placement) ?? 0) - (blockIdxOf(b.placement) ?? 0)
```

Do not change any behaviour in this task. Where a site currently treats a
missing block as capacity 0 or a null slot, keep exactly that.

- [x] **Step 4: Run the whole suite and the typecheck**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean typecheck; the same pass count as before the task (2921 passed without a database).

- [x] **Step 5: Commit**

```bash
git add src/lib/week-plan src/lib/training-plan.ts
git commit -m "Walk every placed session onto Placement — no behaviour change"
```

---

### Task 3: Normalize at the read boundary, dual-write for rollback

**Files:**

- Modify: `src/lib/week-plan/service.ts` (`getOpenWeekPlan`, around line 192)
- Create: `src/lib/week-plan/serialize.ts`
- Test: `src/lib/week-plan/serialize.test.ts`

**Interfaces:**

- Consumes: `normalizePlacement`, `blockIdxOf` from Task 1.
- Produces: `normalizeDays(raw: unknown): DaySlot[]`, `serializeDays(days: DaySlot[]): unknown`.

- [x] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { normalizeDays, serializeDays } from "./serialize";
import type { DaySlot } from "./types";
import { athletePlacement, blockPlacement } from "./placement";

const legacyRow = [
  {
    date: "2026-09-07",
    availableBlocks: [],
    workouts: [
      {
        day: 0,
        sport: "Cycling",
        type: "Endurance",
        durationMins: 60,
        intensity: "Z1-Z2",
        description: "",
        purpose: "aerobic_base",
        minEffectiveMins: 30,
        blockIdx: 1,
      },
    ],
    availableMins: 0,
    status: "planned",
  },
];

describe("normalizeDays", () => {
  it("lifts a legacy blockIdx onto a placement", () => {
    const days = normalizeDays(legacyRow);
    expect(days[0].workouts[0].placement).toEqual({
      kind: "block",
      blockIdx: 1,
    });
  });

  it("leaves a day with no workouts alone", () => {
    expect(
      normalizeDays([{ ...legacyRow[0], workouts: [] }])[0].workouts
    ).toEqual([]);
  });
});

describe("serializeDays", () => {
  it("dual-writes a top-level blockIdx for a block placement", () => {
    // Rollback safety: v0.135.0 code reading this row still finds its index.
    const days = normalizeDays(legacyRow) as DaySlot[];
    const out = serializeDays(days) as typeof legacyRow;
    expect(out[0].workouts[0]).toMatchObject({ blockIdx: 1 });
    expect(out[0].workouts[0]).toMatchObject({
      placement: { kind: "block", blockIdx: 1 },
    });
  });

  it("writes no legacy blockIdx for an athlete placement", () => {
    // There is no honest index to write: the session occupies no block.
    const days = normalizeDays(legacyRow) as DaySlot[];
    days[0].workouts[0].placement = athletePlacement({
      workoutId: "thr-4x8",
      chosenAt: "2026-09-03T07:00:00.000Z",
    });
    const out = serializeDays(days) as {
      workouts: Record<string, unknown>[];
    }[];
    expect(out[0].workouts[0].blockIdx).toBeUndefined();
  });

  it("round-trips", () => {
    const days = normalizeDays(legacyRow) as DaySlot[];
    expect(normalizeDays(serializeDays(days))).toEqual(days);
  });
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/week-plan/serialize.test.ts`
Expected: FAIL — `Failed to resolve import "./serialize"`.

- [x] **Step 3: Implement**

```ts
import type { DaySlot, ScheduledWorkout } from "./types";
import { blockIdxOf, normalizePlacement } from "./placement";

/**
 * `week_plans.days` is jsonb and `getOpenWeekPlan` used to cast it straight to
 * DaySlot[] with no validation. Every week stored before this release carries
 * `blockIdx` and no `placement`, so the cast is now a translation.
 */
export function normalizeDays(raw: unknown): DaySlot[] {
  const days = (raw ?? []) as (DaySlot & { workouts: unknown[] })[];
  return days.map((d) => ({
    ...d,
    workouts: (d.workouts ?? []).map((w) => {
      const { blockIdx: _legacy, ...rest } = w as ScheduledWorkout & {
        blockIdx?: number;
      };
      return { ...rest, placement: normalizePlacement(w) } as ScheduledWorkout;
    }),
  }));
}

/**
 * The inverse, with ONE transitional addition: a block-placed session also
 * writes a top-level `blockIdx`, so a rollback to v0.135.0 finds the index it
 * expects. An athlete-placed session writes none — there is no honest index
 * for a session that occupies no block, and inventing one is precisely the
 * sentinel this design refuses. The rollback hazard that leaves is recorded
 * in the spec under "Design 3".
 *
 * Drop the dual write once scripts/backfill-placement.ts has run everywhere.
 */
export function serializeDays(days: DaySlot[]): unknown {
  return days.map((d) => ({
    ...d,
    workouts: d.workouts.map((w) => {
      const idx = blockIdxOf(w.placement);
      return idx == null ? { ...w } : { ...w, blockIdx: idx };
    }),
  }));
}
```

- [x] **Step 4: Wire the read boundary**

In `src/lib/week-plan/service.ts`, `getOpenWeekPlan` currently reads
`days: row.days as DaySlot[]`. Replace with `days: normalizeDays(row.days)`.
Then run `grep -rn "as DaySlot\[\]" src/ --include="*.ts" | grep -v '\.test\.'`
and give every remaining jsonb read the same treatment.

- [x] **Step 5: Run the suite and typecheck, then commit**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean typecheck, all tests pass.

```bash
git add src/lib/week-plan/serialize.ts src/lib/week-plan/serialize.test.ts src/lib/week-plan/service.ts
git commit -m "Normalize placements at the jsonb boundary, dual-write for rollback"
```

---

### Task 4: Session-level immunity in the engine rungs

The spec's whole contract: **the engine reads athlete-placed sessions and never writes them.** This is session-level, not the day-level `locked()` — a day holding a chosen ride still has real availability the engine may use for its own second session.

**Files:**

- Modify: `src/lib/week-plan/replan.ts` (keep/move/drop), `adapt-day.ts` (redistribute, shrink, swap, red-recovery), `fill.ts` (placement + cap counting), `service.ts` (`moveWorkout`, `swapWorkouts`)
- Test: `src/lib/week-plan/immunity.test.ts`

**Interfaces:**

- Consumes: `isAthleteChosen` from Task 1.
- Produces: no new exports — the rungs consult `isAthleteChosen` directly.

- [x] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { adaptDay } from "./adapt-day";
import { replanWeek } from "./replan";
import { athletePlacement, blockPlacement } from "./placement";
import type { DaySlot, ScheduledWorkout, WeekState } from "./types";

const chosen = (mins: number): ScheduledWorkout => ({
  day: 1,
  sport: "Cycling",
  type: "Intervals",
  durationMins: mins,
  intensity: "Z4-Z5",
  description: "",
  purpose: "vo2max",
  minEffectiveMins: 40,
  placement: athletePlacement({
    workoutId: "vo2-5x5",
    chosenAt: "2026-09-03T07:00:00.000Z",
  }),
});

const engine = (mins: number): ScheduledWorkout => ({
  day: 1,
  sport: "Cycling",
  type: "Endurance",
  durationMins: mins,
  intensity: "Z1-Z2",
  description: "",
  purpose: "aerobic_base",
  minEffectiveMins: 30,
  placement: blockPlacement(0),
});

function week(days: DaySlot[]): WeekState {
  return { weekStart: "2026-09-07", skeletonWeek: 3, days };
}

describe("athlete-chosen sessions are immune to the engine", () => {
  it("keeps its duration when redistribution would have shrunk it to zero", () => {
    // The defect this guards: a session with no block resolves to
    // blockCapacity 0, and Math.min(cap, 0) sets durationMins to 0.
    const days = seedWeekWithMissedDay([chosen(75)]);
    const out = adaptDay(week(days), "2026-09-08", "green");
    const survivor = out.week.days.flatMap((d) => d.workouts)[0];
    expect(survivor.durationMins).toBe(75);
  });

  it("is not dropped by a replan that has no slot for it", () => {
    const days = seedWeekWithNoAvailability([chosen(75)]);
    const out = replanWeek(week(days), new Map(), "2026-09-07", null);
    expect(out.week.days.flatMap((d) => d.workouts)).toHaveLength(1);
  });

  it("still counts toward the day's session cap", () => {
    // It is a plan, not a ghost: MAX_SESSIONS_PER_DAY sees it.
    const days = seedDayWith([chosen(75), engine(60)]);
    const out = replanWeek(week(days), new Map(), "2026-09-07", fillOpts());
    expect(out.week.days[1].workouts).toHaveLength(2);
  });

  it("an engine-placed session on the same day is still adapted normally", () => {
    // Immunity is per session, never per day.
    const days = seedDayWith([chosen(75), engine(90)]);
    const out = adaptDay(week(days), "2026-09-08", "red");
    const eng = out.week.days[1].workouts.find((w) => w.type === "Endurance")!;
    expect(eng.durationMins).toBeLessThan(90);
  });
});
```

Write the three `seed*` helpers at the top of the file against the fixtures the
neighbouring `adapt-day.test.ts` and `replan.test.ts` already use — read those
first and copy their week shape rather than inventing one. A fixture that
cannot distinguish two rules tests neither.

- [x] **Step 2: Run and watch them fail**

Run: `npx vitest run src/lib/week-plan/immunity.test.ts`
Expected: FAIL — the chosen session is shrunk to 0 and dropped.

- [x] **Step 3: Add the skip to every mutating rung**

At the top of each loop that resizes, moves or drops a session:

```ts
if (isAthleteChosen(w)) continue;
```

The sites, from the Task 2 walk: `replan.ts` keep/move/drop; `adapt-day.ts`
redistribute (the `blockCapacity` loop near line 167), shrink, swap and
red-recovery; `fill.ts` growth. In `fill.ts` cap counting, athlete sessions
**do** count — that loop is a read, not a write.

In `service.ts`, `moveWorkout` and `swapWorkouts` return `"invalid"` when
asked to move an athlete-placed session: the athlete moves it by removing and
re-adding, and a drag that silently re-placed it into an availability block
would convert a choice back into an engine session.

- [x] **Step 4: Run the tests, the whole suite, and the typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all pass.

- [x] **Step 5: Commit, THEN mutation-test the guard**

Commit first — `git checkout` on an uncommitted file discards the work, not the mutation.

```bash
git add src/lib/week-plan
git commit -m "Athlete-chosen sessions are immune to every mutating rung"
```

Then, one at a time, delete each `if (isAthleteChosen(w)) continue;` and run
`npx vitest run src/lib/week-plan/immunity.test.ts`. Each deletion must turn a
**named** test red. Record which test catches which site in the commit message
of the next task. Restore with `git checkout src/lib/week-plan`.

If any deletion leaves the suite green, that site has no guard — write the
missing test before moving on.

---

### Task 5: The engine says what it would have done

**Files:**

- Modify: `src/lib/week-plan/types.ts` (`AdjustmentTrigger`, `AdjustmentAction`)
- Create: `src/lib/week-plan/kept-note.ts`
- Test: `src/lib/week-plan/kept-note.test.ts`

**Interfaces:**

- Consumes: `isAthleteChosen`, `AdjustmentRecord`.
- Produces: `keptNote(day: DaySlot, w: ScheduledWorkout, band: Band): AdjustmentRecord | null`.

- [x] **Step 1: Extend the unions**

```ts
export type AdjustmentTrigger =
  | "low_readiness"
  | "no_time"
  | "missed_workout"
  | "availability_change"
  | "weekly_rollover"
  | "race"
  /** A rung would have changed an athlete-chosen session and was not allowed to. */
  | "athlete_choice";

export type AdjustmentAction =
  | "scaled"
  | "moved"
  | "swapped"
  | "dropped"
  | "redistributed"
  | "added"
  /** Left standing on purpose, with the engine's disagreement recorded. */
  | "kept";
```

- [x] **Step 2: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { keptNote } from "./kept-note";
import { athletePlacement, blockPlacement } from "./placement";

const chosen = {
  day: 1,
  sport: "Cycling",
  type: "Intervals",
  durationMins: 75,
  intensity: "Z4-Z5",
  description: "",
  purpose: "vo2max" as const,
  minEffectiveMins: 40,
  placement: athletePlacement({
    workoutId: "vo2-5x5",
    chosenAt: "2026-09-03T07:00:00.000Z",
  }),
};
const day = {
  date: "2026-09-08",
  availableBlocks: [],
  workouts: [chosen],
  availableMins: 0,
  status: "planned" as const,
};

describe("keptNote", () => {
  it("records disagreement on a red band", () => {
    const note = keptNote(day, chosen, "red")!;
    expect(note.trigger).toBe("athlete_choice");
    expect(note.action).toBe("kept");
    expect(note.reason).toContain("your choice");
  });

  it("records disagreement on a pre-race rest day", () => {
    const note = keptNote({ ...day, restIntent: "pre_race" }, chosen, "green")!;
    expect(note.reasonCode).toBe("chosen_on_pre_race_rest");
  });

  it("says nothing when the engine does not disagree", () => {
    // Silence is the common case; a note on every chosen session would be noise.
    expect(keptNote(day, chosen, "green")).toBeNull();
  });

  it("says nothing about an engine-placed session", () => {
    expect(
      keptNote(day, { ...chosen, placement: blockPlacement(0) }, "red")
    ).toBeNull();
  });
});
```

- [x] **Step 3: Run it, watch it fail, implement, run again**

Run: `npx vitest run src/lib/week-plan/kept-note.test.ts`

The implementation returns `null` unless the session is athlete-chosen AND one
of the disagreement conditions holds: a `red` band on a quality session
(`isQuality`), or `restIntent === "pre_race"`. `before` and `after` are the
same day — nothing changed, which is the point.

- [x] **Step 4: Call it from `adaptDay`**

Where each rung skips an athlete session, push `keptNote(...)` onto the
adjustments array when it returns non-null.

- [x] **Step 5: Commit**

```bash
git add src/lib/week-plan
git commit -m "The engine records what it would have changed, and did not"
```

---

### Task 6: Eligibility

**Files:**

- Create: `src/lib/week-plan/add-chosen.ts`
- Test: `src/lib/week-plan/add-chosen.test.ts`

**Interfaces:**

- Consumes: `DaySlot`, `MAX_SESSIONS_PER_DAY`, `athletePlacement`, `LIBRARY`, `PURPOSE_BY_TYPE`.
- Produces: `type AddRefusal = "day_settled" | "day_full" | "past_day" | "unknown_workout" | "duration_out_of_range"`, `canAddWorkout(day, todayYmd): { ok: true } | { ok: false; reason: AddRefusal }`, `buildChosenSession(workoutId, durationMins, dayIdx, nowIso): ScheduledWorkout | null`.

- [x] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { buildChosenSession, canAddWorkout } from "./add-chosen";

const empty = {
  date: "2026-09-10",
  availableBlocks: [],
  workouts: [],
  availableMins: 0,
  status: "rest" as const,
};

describe("canAddWorkout", () => {
  it("allows an empty future day", () => {
    expect(canAddWorkout(empty, "2026-09-08")).toEqual({ ok: true });
  });

  it("allows today", () => {
    expect(canAddWorkout(empty, "2026-09-10")).toEqual({ ok: true });
  });

  it("refuses a past day", () => {
    expect(canAddWorkout(empty, "2026-09-11")).toEqual({
      ok: false,
      reason: "past_day",
    });
  });

  it.each(["completed", "missed", "race"] as const)(
    "refuses a %s day",
    (status) => {
      expect(canAddWorkout({ ...empty, status }, "2026-09-08")).toEqual({
        ok: false,
        reason: "day_settled",
      });
    }
  );

  it("refuses a day already at the session cap", () => {
    const w = { workouts: [{}, {}] } as unknown as typeof empty;
    expect(canAddWorkout({ ...empty, ...w }, "2026-09-08")).toEqual({
      ok: false,
      reason: "day_full",
    });
  });

  it("allows a pre-race rest day — the athlete asked for agency", () => {
    // Not a refusal. Recover warns loudly (Task 5) and complies.
    expect(
      canAddWorkout({ ...empty, restIntent: "pre_race" }, "2026-09-08")
    ).toEqual({ ok: true });
  });
});

describe("buildChosenSession", () => {
  it("derives type and purpose from the library workout", () => {
    const s = buildChosenSession("vo2-5x5", 75, 1, "2026-09-03T07:00:00.000Z")!;
    expect(s.purpose).toBe("vo2max");
    expect(s.type).toBe("Intervals");
    expect(s.sport).toBe("Cycling");
    expect(s.placement).toEqual({
      kind: "athlete",
      choice: { workoutId: "vo2-5x5", chosenAt: "2026-09-03T07:00:00.000Z" },
    });
  });

  it("returns null for a workout id the library does not have", () => {
    expect(
      buildChosenSession("no-such-workout", 60, 1, "2026-09-03T07:00:00.000Z")
    ).toBeNull();
  });

  it("returns null for a duration outside the workout's flex range", () => {
    // flex.ts resolves the workout, and a length it cannot reach is not a
    // session — refusing beats silently rendering a different workout.
    expect(
      buildChosenSession("vo2-5x5", 5, 1, "2026-09-03T07:00:00.000Z")
    ).toBeNull();
  });

  it("stores no description — it is derived on read", () => {
    const s = buildChosenSession("vo2-5x5", 75, 1, "2026-09-03T07:00:00.000Z")!;
    expect(s.description).toBe("");
  });
});
```

- [x] **Step 2: Run, fail, implement, pass**

`buildChosenSession` looks the workout up in `LIBRARY`, calls `resolve` from
`flex.ts` to confirm the duration is reachable, inverts `PURPOSE_BY_TYPE` to
get `type`, and sets `description: ""` because `renderDescription` owns it.

- [x] **Step 3: Typecheck and commit**

```bash
git add src/lib/week-plan/add-chosen.ts src/lib/week-plan/add-chosen.test.ts
git commit -m "Eligibility and construction for an athlete-chosen session"
```

---

### Task 7: Recommendation

**Files:**

- Create: `src/lib/interval/recommend.ts`
- Test: `src/lib/interval/recommend.test.ts`

**Interfaces:**

- Consumes: `LIBRARY`, `LibraryWorkout`, `Band`.
- Produces: `interface RecommendContext { band: Band; daysSinceQuality: number; weekLoadFraction: number; recentFamilies: readonly string[] }`, `interface Recommendation { workoutId: string; rank: number; why: string }`, `recommendWorkouts(ctx: RecommendContext): Recommendation[]`.

- [x] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { recommendWorkouts } from "./recommend";
import { LIBRARY } from "./library";

const base = {
  band: "green" as const,
  daysSinceQuality: 3,
  weekLoadFraction: 0.5,
  recentFamilies: [],
};

describe("recommendWorkouts", () => {
  it("ranks, never filters — every workout stays pickable", () => {
    expect(recommendWorkouts(base)).toHaveLength(LIBRARY.length);
  });

  it("puts recovery first on a red band", () => {
    const top = recommendWorkouts({ ...base, band: "red" })[0];
    expect(LIBRARY.find((w) => w.id === top.workoutId)!.purpose).toBe(
      "recovery"
    );
  });

  it("does not put quality first the day after quality", () => {
    const top = recommendWorkouts({ ...base, daysSinceQuality: 1 })[0];
    const purpose = LIBRARY.find((w) => w.id === top.workoutId)!.purpose;
    expect(["threshold", "vo2max"]).not.toContain(purpose);
  });

  it("demotes a family ridden recently", () => {
    const fam = LIBRARY[0].family;
    const withFam = recommendWorkouts({ ...base, recentFamilies: [fam] });
    const without = recommendWorkouts(base);
    const rankOf = (r: typeof withFam, f: string) =>
      r.findIndex(
        (x) => LIBRARY.find((w) => w.id === x.workoutId)!.family === f
      );
    expect(rankOf(withFam, fam)).toBeGreaterThan(rankOf(without, fam));
  });

  it("gives every recommendation a why sentence", () => {
    expect(recommendWorkouts(base).every((r) => r.why.length > 0)).toBe(true);
  });

  it("is deterministic", () => {
    expect(recommendWorkouts(base)).toEqual(recommendWorkouts(base));
  });
});
```

- [x] **Step 2: Run, fail, implement**

Score each workout, sort descending, ties broken by `id` so the result is
deterministic. **Every weight is a new constant and must carry the full
provenance block**, in `library.ts`'s voice:

```ts
/**
 * How much a red readiness band demotes a quality session.
 *
 * Source: Coaching convention — the same judgement adaptDay already makes
 * when it substitutes a recovery session on a red band. This module claims
 * nothing that rung does not.
 * What would raise it: a controlled comparison of outcomes when an athlete
 * trains hard against a red reading versus resting, on this athlete.
 * Confidence: Low.
 */
const RED_QUALITY_PENALTY = 100;
```

Do not introduce a weight whose justification is only "it looked right".
If a factor cannot be sourced, leave it out — the library is already ranked
usefully by band and recency alone.

- [x] **Step 3: Guard the prose**

`renderDescription`'s output and every `why` become text the athlete reads.
Add to the existing prose check pattern in `src/lib/interval/purity-guard.test.ts`
(which strips comments before matching) an assertion that no `why` produced
here contains "watt" — targets are % of FTP.

- [x] **Step 4: Typecheck and commit**

```bash
git add src/lib/interval/recommend.ts src/lib/interval/recommend.test.ts src/lib/interval/purity-guard.test.ts
git commit -m "Rank the library for a day without filtering it"
```

---

### Task 8: Placing and removing a chosen session

**Files:**

- Modify: `src/app/plan/actions.ts`
- Modify: `src/lib/week-plan/service.ts`
- Test: `src/lib/week-plan/add-chosen.db.test.ts`

**Interfaces:**

- Consumes: `canAddWorkout`, `buildChosenSession`, `serializeDays`, `getOpenWeekPlan`.
- Produces: `addChosenWorkout(userId, date, workoutId, durationMins): Promise<Result>`, `removeChosenWorkout(userId, date, workoutId): Promise<Result>`, and the two server actions wrapping them.

- [x] **Step 1: Write the failing database test**

Model it on the existing db-backed tests in `src/lib/week-plan/service.test.ts`
(they skip without `DATABASE_URL`). Cover: a chosen session lands on the day
and survives a re-read; `canAddWorkout`'s refusals are honoured server-side, not
only in the UI; removing takes the session off and leaves the day empty;
adding twice to the same day hits `day_full` on the third.

- [x] **Step 2: Implement**

`addChosenWorkout` reads the open week, finds the day by date, runs
`canAddWorkout`, builds the session, appends it, and writes through
`serializeDays`. It **does not** touch `availabilityOverrides` — that is the
whole point of the feature.

The server action re-validates the date shape and the user exactly as
`setDayOverride` does, then calls `revalidatePlan()`.

- [x] **Step 3: Run with a database, typecheck, commit**

Run: `DATABASE_URL=postgres://…@localhost:5434/recover npx vitest run src/lib/week-plan && npx tsc --noEmit`

Note from memory: the dev database on :5434 is schema-current but
`training_plans` is empty — seed with `npm run db:seed` before expecting a week.

```bash
git add src/lib/week-plan src/app/plan/actions.ts
git commit -m "Add and remove an athlete-chosen session without touching availability"
```

---

### Task 9: The picker sheet

**Files:**

- Create: `src/components/train/workout-picker-sheet.tsx`
- Test: `src/components/train/workout-picker-sheet.test.tsx`

- [x] **Step 1: Write the failing component test**

Follow the testing-library style in `src/components/train/plan-preview-card.test.tsx`.
Cover: all 103 workouts render behind their filters; the recommended group is
marked and is not a separate screen; a `pre_race` warning renders on the pick
control; a workout with no FTP set shows percentages and says targets cannot be
shown in watts; the duration control is bounded by the workout's flex range.

- [x] **Step 2: Implement**

`LIBRARY` is 103 workouts of data — **resolve it in a server component and pass
down only what the sheet renders**, exactly as `for-day.ts`'s doc comment
demands, so the library stays out of the client bundle.

- [x] **Step 3: Typecheck, lint, commit**

Run: `npx tsc --noEmit && npx eslint src --max-warnings=0`

```bash
git add src/components/train/workout-picker-sheet.tsx src/components/train/workout-picker-sheet.test.tsx
git commit -m "The library picker: everything pickable, recommendations marked"
```

---

### Task 10: Entry points

**Files:**

- Modify: `src/components/train/week-day-list.tsx`
- Modify: `src/app/page.tsx` (Today)

- [x] **Step 1: Write the failing tests** — an eligible empty day offers the picker; a settled, full or past day does not.
- [x] **Step 2: Implement**, calling `canAddWorkout` for the affordance so the UI and the server agree on one predicate.
- [x] **Step 3: Typecheck, lint, run the suite, commit.**

---

### Task 11: Capture the new surface

**Files:**

- Modify: `scripts/verify-surfaces.ts` (the `SURFACES` map)
- Modify: `.github/workflows/surfaces.yml` AND `.github/workflows/soak.yml`
- Modify: `scripts/seed-cycling-owner.ts`

- [x] **Step 1: Add a `train-workout-picker` surface** to the `SURFACES` map.
- [x] **Step 2: Add it to `$CYCLING_SURFACES`** — a marathon-plan owner cannot exercise a cycling library, which is why `capture-cycling` exists.
- [x] **Step 3: Add it to the `--except` list in BOTH workflow files.** `0.127.0-rc.1` died in the Soak for updating only one. Verify with:

```bash
grep -n "except" .github/workflows/surfaces.yml .github/workflows/soak.yml
```

- [x] **Step 4: Seed a chosen session** in `scripts/seed-cycling-owner.ts` so the capture photographs a placed athlete session and not just the empty picker. A capture that passes over a state nobody has is not evidence.
- [x] **Step 5: Run the capture locally and confirm the ratchet holds at 0.**

Per memory, local capture needs the standalone server with `BETTER_AUTH_URL`
matching the port — `next start` silently breaks sign-in.

- [x] **Step 6: Commit.**

---

### Task 12: Backfill

**Files:**

- Create: `scripts/backfill-placement.ts`

- [x] **Step 1: Write it** following `scripts/backfill-day-load.ts`: read every `week_plans` row, run `normalizeDays`, write back through `serializeDays`, report counts, and be idempotent.
- [x] **Step 2: Dry-run it against the dev database on :5434, then commit.**

---

### Task 13: Documentation

**Files:**

- Modify: `CHANGELOG.md`, `docs/ROADMAP.md`, `README.md` if the release version moves

- [x] **Step 1: Write the CHANGELOG entry** in this repo's voice: what the athlete will notice, then "Under the hood", then a `**Migrations:**` line (none — the jsonb shape changes are handled by the normalizer and the backfill script).
- [x] **Step 2: State the rollback hazard explicitly** — an athlete-placed session read by rolled-back v0.135.0 code has no `blockIdx` and would be scaled to 0 minutes. Blast radius: sessions added between deploy and rollback.
- [x] **Step 3: Add the strand to `docs/ROADMAP.md`** under Phase 6 (Experience) — this is demand-pillar work, requested verbatim by the athlete, and it is not Phase 7.
- [x] **Step 4: `npm run format:check`**, then commit.

---

## Self-Review

**Spec coverage.** Design 1 → Tasks 1–2. Design 2 → Tasks 4–5. Design 3 → Tasks 3 and 12. Design 4 → Task 6. Design 5 → Task 7. Design 6 → Tasks 9–10. Testing section → Tasks 4 (mutation), 11 (capture), and the global constraints. Non-goals need no tasks.

**Placeholders.** Tasks 9, 10 and 11 describe test _coverage_ rather than printing full component test bodies. That is deliberate: the component fixtures must be copied from the neighbouring test files that already exist, and inventing them here would produce fixtures that do not match the repo's helpers. Each names the file to copy from.

**Type consistency.** `isAthleteChosen` takes `{ placement: Placement }` in Task 1 and is called on `ScheduledWorkout` throughout — satisfied by structural typing. `blockFits` changes signature in Task 2 and every caller is found by the compiler. `AddRefusal` in Task 6 is the only refusal union; the UI in Task 10 consumes the same `canAddWorkout`.
