# Availability & Scheduling Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the copy-last-week availability model with a standard week of time blocks plus date-keyed overrides that always beat the default, and replace whole-week rematerialization with a deterministic replan ladder that preserves each session's training purpose.

**Architecture:** A new pure module `src/lib/availability/` owns the block value type and the precedence resolver. `src/lib/week-plan/` gains two pure engines beside the existing ones: `slots.ts` (turn resolved blocks into placeable slots, decide admission) and `replan.ts` (the four-rung ladder). `materializeWeek` keeps its role for a *fresh* week but places into slots instead of days; `applyAvailability` stops calling it and calls `replanWeek` instead, so changing availability never regenerates the week. Two new tables persist defaults and overrides; the week row keeps holding the resolved snapshot.

**Tech Stack:** Next.js 16 App Router (read `node_modules/next/dist/docs/` before UI work — this Next has breaking changes), Drizzle ORM + Postgres, Vitest (pure-function suites + `describe.skipIf(!hasDb)` integration suites + component tests), zod tool definitions in `src/lib/tools/registry.ts`.

**Spec:** `docs/specs/2026-07-27-availability-scheduling-redesign-design.md`

## Global Constraints

- Engines stay pure: no DB, no LLM, no `Date.now()` inside `src/lib/availability/{types,resolve-day}.ts` or `src/lib/week-plan/{slots,replan,materialize,adapt-day,ctl-projection}.ts`. Thresholds are named constants, not inline numbers.
- **No placement logic may read `DaySlot.availableMins`.** It survives only as a derived sum for existing displays and the race forecast. Reading it for fitting is the bug this plan removes.
- Every automatic change produces exactly one `plan_adjustments` row with a deterministic, human-readable `reason` string.
- New test files that import `@/lib/db` MUST guard with `const hasDb = !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";` and `describe.skipIf(!hasDb)(...)`. Without it the suite crashes CI instead of skipping. Pattern: `src/lib/audit.test.ts:9`.
- Run `npx prettier --write` on every file you create or modify **before** committing (CI checks formatting).
- Commits follow repo style: lowercase `feat:`/`fix:`/`test:`/`docs:` prefixes, with the trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Never tag or release from this plan — see `docs/RELEASING.md`.
- Purpose floors, verbatim from the spec: recovery 20, aerobic_base 40, threshold 45, vo2max 40, brick 60, long 90.
- Energy ceilings, verbatim: `easy` → recovery, aerobic_base, long; `normal` → adds threshold; `full` → adds vo2max and brick.
- Substitution chain, verbatim: `vo2max → threshold → aerobic_base → recovery`, `brick → threshold`, `long → aerobic_base`.
- The insufficient-time warning is silent below 28 days of load history or when `loadPerHour` is 0. Never fabricate a threshold during calibration.

## File Structure

```
src/lib/availability/
  types.ts            # AvailabilityBlock, Energy, Purpose, blockMins,
                      # ENERGY_CEILING, PURPOSE_FLOORS, SUBSTITUTE_TO, validateBlocks
  types.test.ts
  resolve-day.ts      # resolveDay — pure precedence rule
  resolve-day.test.ts
  resolve.ts          # resolveWeek — DB read, maps resolveDay
  resolve.test.ts     # describe.skipIf(!hasDb)
  format.ts           # formatAvailability (moved), formatBlock, formatBlocks
  format.test.ts
src/lib/week-plan/
  types.ts            # DaySlot gains availableBlocks/workouts/unplannedLoad
  slots.ts            # buildSlots, admits — pure
  slots.test.ts
  replan.ts           # replanWeek ladder — pure
  replan.test.ts
  ctl-projection.ts   # projectCtl, availabilityVerdict — pure
  ctl-projection.test.ts
  materialize.ts      # places into slots; truncation deleted
  service.ts          # applyAvailability → replanWeek; rollover → resolveWeek
  availability.ts     # DELETED (prefillAvailability); formatAvailability moves out
src/lib/training-plan.ts        # PlannedWorkout gains purpose + minEffectiveMins
src/lib/db/schema.ts            # availabilityDefaults, availabilityOverrides,
                                # weekPlans.availabilityConfirmedAt
drizzle/00NN_*.sql              # tables + weekPlans.days jsonb backfill
src/app/plan/actions.ts         # setStandardWeekDay, setDayOverride,
                                # clearDayOverride, zeroDay
src/components/plan/
  block-sheet.tsx     # add/edit/remove blocks for one day
  standard-week.tsx   # seven weekday rows
  intake-form.tsx     # resolved view, override badge, warning line
  day-actions.tsx     # + "Set this day to zero"
src/lib/tools/
  set-week-availability.ts      # accepts blocks, still accepts 7 integers
  set-standard-week.ts          # new
  clear-availability-override.ts # new
  get-week-plan.ts              # returns workouts plural + resolved blocks
```

**Dependency order:** Tasks 1–2 are pure leaves. Task 3 is the migration. Task 4 adds workout metadata. Task 5 is the `workout` → `workouts` ripple and must land complete before Tasks 6–8 build on it. Tasks 6–8 are the engines. Task 9 wires the service. Tasks 10–11 are independent rules. Tasks 12–16 are UI. Tasks 17–19 are surface work.

---

### Task 1: Availability block value type

**Files:**
- Create: `src/lib/availability/types.ts`
- Test: `src/lib/availability/types.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `AvailabilityBlock`, `Energy`, `Purpose`, `blockMins(b: AvailabilityBlock): number`, `ENERGY_CEILING: Record<Energy, Purpose[]>`, `PURPOSE_FLOORS: Record<Purpose, number>`, `SUBSTITUTE_TO: Partial<Record<Purpose, Purpose>>`, `validateBlocks(blocks: AvailabilityBlock[]): string | null`, `MAX_SESSIONS_PER_DAY = 2`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/availability/types.test.ts
import { describe, expect, it } from "vitest";
import {
  blockMins,
  validateBlocks,
  ENERGY_CEILING,
  PURPOSE_FLOORS,
  SUBSTITUTE_TO,
  type AvailabilityBlock,
} from "./types";

const block = (o: Partial<AvailabilityBlock> = {}): AvailabilityBlock => ({
  start: "18:00",
  end: "19:30",
  mins: 90,
  energy: "normal",
  sports: null,
  ...o,
});

describe("blockMins", () => {
  it("derives minutes from clock times", () => {
    expect(blockMins(block({ start: "06:30", end: "07:15", mins: 999 }))).toBe(45);
  });

  it("falls back to stored mins on legacy blocks with no times", () => {
    expect(blockMins(block({ start: null, end: null, mins: 75 }))).toBe(75);
  });
});

describe("validateBlocks", () => {
  it("accepts non-overlapping ordered blocks", () => {
    expect(
      validateBlocks([
        block({ start: "06:30", end: "07:15", mins: 45 }),
        block({ start: "19:00", end: "20:00", mins: 60 }),
      ])
    ).toBeNull();
  });

  it("rejects an end before its start", () => {
    expect(validateBlocks([block({ start: "19:00", end: "18:00", mins: 0 })])).toBe(
      "A block must end after it starts."
    );
  });

  it("rejects overlapping blocks", () => {
    expect(
      validateBlocks([
        block({ start: "18:00", end: "19:30", mins: 90 }),
        block({ start: "19:00", end: "20:00", mins: 60 }),
      ])
    ).toBe("Blocks on the same day cannot overlap.");
  });

  it("accepts an empty list — that is an unavailable day", () => {
    expect(validateBlocks([])).toBeNull();
  });
});

describe("engine tables", () => {
  it("caps easy energy at aerobic work", () => {
    expect(ENERGY_CEILING.easy).toEqual(["recovery", "aerobic_base", "long"]);
    expect(ENERGY_CEILING.normal).toContain("threshold");
    expect(ENERGY_CEILING.normal).not.toContain("vo2max");
    expect(ENERGY_CEILING.full).toContain("vo2max");
    expect(ENERGY_CEILING.full).toContain("brick");
  });

  it("pins the purpose floors from the spec", () => {
    expect(PURPOSE_FLOORS).toEqual({
      recovery: 20,
      aerobic_base: 40,
      threshold: 45,
      vo2max: 40,
      brick: 60,
      long: 90,
    });
  });

  it("steps each purpose toward the nearest lesser stimulus", () => {
    expect(SUBSTITUTE_TO.vo2max).toBe("threshold");
    expect(SUBSTITUTE_TO.threshold).toBe("aerobic_base");
    expect(SUBSTITUTE_TO.aerobic_base).toBe("recovery");
    expect(SUBSTITUTE_TO.brick).toBe("threshold");
    expect(SUBSTITUTE_TO.long).toBe("aerobic_base");
    expect(SUBSTITUTE_TO.recovery).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/availability/types.test.ts`
Expected: FAIL — `Failed to resolve import "./types"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/availability/types.ts
// The availability value type. Pure: no DB, no clock reads.

export type Energy = "easy" | "normal" | "full";

export type Purpose =
  | "recovery"
  | "aerobic_base"
  | "threshold"
  | "vo2max"
  | "brick"
  | "long";

export interface AvailabilityBlock {
  /** "HH:MM" local. null only on rows migrated from the pre-block model. */
  start: string | null;
  end: string | null;
  /** Derived from start/end on write when both are present. */
  mins: number;
  energy: Energy;
  /** null = any sport in the plan. */
  sports: string[] | null;
}

/** At most this many sessions land on one calendar day. */
export const MAX_SESSIONS_PER_DAY = 2;

/** Which purposes an expected energy level admits. */
export const ENERGY_CEILING: Record<Energy, Purpose[]> = {
  easy: ["recovery", "aerobic_base", "long"],
  normal: ["recovery", "aerobic_base", "long", "threshold"],
  full: ["recovery", "aerobic_base", "long", "threshold", "vo2max", "brick"],
};

/** Below its floor a session no longer delivers its stimulus. */
export const PURPOSE_FLOORS: Record<Purpose, number> = {
  recovery: 20,
  aerobic_base: 40,
  threshold: 45,
  vo2max: 40,
  brick: 60,
  long: 90,
};

/** One step toward the nearest lesser stimulus. recovery is the floor. */
export const SUBSTITUTE_TO: Partial<Record<Purpose, Purpose>> = {
  vo2max: "threshold",
  brick: "threshold",
  threshold: "aerobic_base",
  long: "aerobic_base",
  aerobic_base: "recovery",
};

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * The only reader of a block's duration. Clock times win when present so
 * `mins` can never drift from them; legacy blocks carry `mins` alone.
 */
export function blockMins(b: AvailabilityBlock): number {
  if (b.start != null && b.end != null) {
    return toMinutes(b.end) - toMinutes(b.start);
  }
  return b.mins;
}

/** Null when the list is a legal day. An empty list is legal: "unavailable". */
export function validateBlocks(blocks: AvailabilityBlock[]): string | null {
  for (const b of blocks) {
    if (b.start != null && b.end != null && toMinutes(b.end) <= toMinutes(b.start)) {
      return "A block must end after it starts.";
    }
  }
  const timed = blocks
    .filter((b) => b.start != null && b.end != null)
    .sort((a, b) => toMinutes(a.start!) - toMinutes(b.start!));
  for (let i = 1; i < timed.length; i++) {
    if (toMinutes(timed[i].start!) < toMinutes(timed[i - 1].end!)) {
      return "Blocks on the same day cannot overlap.";
    }
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/availability/types.test.ts`
Expected: PASS — 9 tests.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/lib/availability/types.ts src/lib/availability/types.test.ts
git add src/lib/availability/types.ts src/lib/availability/types.test.ts
git commit -m "feat(availability): block value type, energy ceilings and purpose floors"
```

---

### Task 2: The precedence rule

**Files:**
- Create: `src/lib/availability/resolve-day.ts`
- Test: `src/lib/availability/resolve-day.test.ts`

**Interfaces:**
- Consumes: `AvailabilityBlock` from Task 1.
- Produces: `resolveDay(defaults: AvailabilityBlock[], override: AvailabilityBlock[] | null): AvailabilityBlock[]`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/availability/resolve-day.test.ts
import { describe, expect, it } from "vitest";
import { resolveDay } from "./resolve-day";
import type { AvailabilityBlock } from "./types";

const b = (mins: number): AvailabilityBlock => ({
  start: null,
  end: null,
  mins,
  energy: "normal",
  sports: null,
});

describe("resolveDay", () => {
  it("uses the weekday default when there is no override", () => {
    expect(resolveDay([b(180)], null)).toEqual([b(180)]);
  });

  it("lets an override win outright", () => {
    expect(resolveDay([b(180)], [b(60)])).toEqual([b(60)]);
  });

  it("treats an empty override as unavailable, not as absent", () => {
    expect(resolveDay([b(180)], [])).toEqual([]);
  });

  it("does not merge: the override replaces the whole day", () => {
    expect(resolveDay([b(60), b(60)], [b(30)])).toEqual([b(30)]);
  });

  // The JOIN rule, stated as a test: raising every Wednesday to 3h must not
  // touch the one Wednesday already pinned to 1h.
  it("keeps a pinned date when the weekday default is raised later", () => {
    const pinned = [b(60)];
    const before = resolveDay([b(60)], pinned);
    const after = resolveDay([b(180)], pinned);
    expect(before).toEqual(after);
    expect(after).toEqual([b(60)]);
  });

  it("returns an empty day when neither default nor override exists", () => {
    expect(resolveDay([], null)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/availability/resolve-day.test.ts`
Expected: FAIL — `Failed to resolve import "./resolve-day"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/availability/resolve-day.ts
import type { AvailabilityBlock } from "./types";

/**
 * The whole precedence rule, in one pure function.
 *
 * An override is a complete replacement of that date, never a delta — so
 * an empty array means "unavailable that day", which is a different thing
 * from `null` ("no override row: use the weekday default"). Because
 * defaults and overrides are separate tables, editing a default can never
 * disturb a date the athlete already pinned.
 */
export function resolveDay(
  defaults: AvailabilityBlock[],
  override: AvailabilityBlock[] | null
): AvailabilityBlock[] {
  return override ?? defaults;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/availability/resolve-day.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/lib/availability/resolve-day.ts src/lib/availability/resolve-day.test.ts
git add src/lib/availability/resolve-day.ts src/lib/availability/resolve-day.test.ts
git commit -m "feat(availability): date override always beats the weekday default"
```

---

### Task 3: Schema and migration

**Files:**
- Modify: `src/lib/db/schema.ts` (add two tables after `weekPlans`, add one column to `weekPlans`)
- Create: `drizzle/00NN_*.sql` (generated, then hand-edited to add the backfill)

**Interfaces:**
- Consumes: nothing at runtime.
- Produces: `schema.availabilityDefaults`, `schema.availabilityOverrides`, `schema.weekPlans.availabilityConfirmedAt`.

- [ ] **Step 1: Add the column to `weekPlans`**

In `src/lib/db/schema.ts`, inside the `weekPlans` column block, directly after `effectiveTarget`:

```ts
    // Set when the athlete confirms the week's availability — even without
    // changing anything. The weekly prompt fires only while this is null,
    // so confirming an unchanged week silences it.
    availabilityConfirmedAt: timestamp("availability_confirmed_at", {
      withTimezone: true,
    }),
```

- [ ] **Step 2: Add the two tables**

Append after the `weekPlans` definition in `src/lib/db/schema.ts`:

```ts
/**
 * The athlete's standard week: one row per weekday (Monday = 0). `blocks`
 * is an AvailabilityBlock[] (src/lib/availability/types.ts).
 */
export const availabilityDefaults = pgTable(
  "availability_defaults",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    weekday: smallint("weekday").notNull(), // 0 = Monday
    blocks: jsonb("blocks").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("availability_defaults_user_weekday_uq").on(t.userId, t.weekday)]
);

/**
 * Date-specific availability. A row here replaces that date's weekday
 * default entirely — including `blocks: []`, which means "unavailable".
 * Kept in its own table so that editing a default can never disturb a
 * pinned date (see resolveDay).
 */
export const availabilityOverrides = pgTable(
  "availability_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    blocks: jsonb("blocks").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("availability_overrides_user_date_uq").on(t.userId, t.date)]
);
```

- [ ] **Step 3: Generate the migration**

Run: `npm run db:generate`
Expected: a new file `drizzle/00NN_<name>.sql` containing two `CREATE TABLE` statements, two unique indexes, and one `ALTER TABLE "week_plans" ADD COLUMN "availability_confirmed_at"`.

- [ ] **Step 4: Hand-edit the migration to backfill `week_plans.days`**

Append to the generated file. This converts every stored day in place:
`workout` → `workouts` (an empty array when it was null), `availableMins`
→ one legacy block with null clock times (an empty array when it was 0),
and infers `purpose` / `minEffectiveMins` from the workout's `type`.

```sql
--> statement-breakpoint
-- Backfill week_plans.days into the block/plural shape. Legacy blocks keep
-- null clock times on purpose: the migration must not invent times the
-- athlete never gave.
UPDATE "week_plans" SET "days" = (
  SELECT jsonb_agg(
    (d - 'workout')
    || jsonb_build_object(
      'workouts',
      CASE WHEN d->'workout' IS NULL OR d->'workout' = 'null'::jsonb
        THEN '[]'::jsonb
        ELSE jsonb_build_array(
          (d->'workout') || jsonb_build_object(
            'purpose',
            CASE d->'workout'->>'type'
              WHEN 'Recovery'  THEN 'recovery'
              WHEN 'Endurance' THEN 'aerobic_base'
              WHEN 'Long'      THEN 'long'
              WHEN 'Tempo'     THEN 'threshold'
              WHEN 'Intervals' THEN 'vo2max'
              WHEN 'Brick'     THEN 'brick'
              ELSE 'aerobic_base'
            END,
            'minEffectiveMins',
            CASE d->'workout'->>'type'
              WHEN 'Recovery'  THEN 20
              WHEN 'Endurance' THEN 40
              WHEN 'Long'      THEN 90
              WHEN 'Tempo'     THEN 45
              WHEN 'Intervals' THEN 40
              WHEN 'Brick'     THEN 60
              ELSE 40
            END
          )
        )
      END,
      'availableBlocks',
      CASE WHEN COALESCE((d->>'availableMins')::int, 0) > 0
        THEN jsonb_build_array(jsonb_build_object(
          'start', NULL, 'end', NULL,
          'mins', (d->>'availableMins')::int,
          'energy', 'normal', 'sports', NULL
        ))
        ELSE '[]'::jsonb
      END
    )
    ORDER BY ord
  )
  FROM jsonb_array_elements("days") WITH ORDINALITY AS t(d, ord)
)
WHERE jsonb_typeof("days") = 'array';
```

- [ ] **Step 5: Apply and verify**

Run: `npm run db:migrate`
Expected: applies without error.

Then verify the backfill shape (requires a database with at least one week row):

```bash
psql "$DATABASE_URL" -c "SELECT jsonb_pretty(days->0) FROM week_plans LIMIT 1;"
```

Expected: the first day object has `workouts` (an array), `availableBlocks` (an array), and retains `availableMins`. No `workout` key remains.

- [ ] **Step 6: Commit**

```bash
npx prettier --write src/lib/db/schema.ts
git add src/lib/db/schema.ts drizzle/
git commit -m "feat(db): availability defaults and overrides, week days backfilled to blocks"
```

---

### Task 4: Workout purpose and effective floor

**Files:**
- Modify: `src/lib/training-plan.ts:12-19` (the `PlannedWorkout` interface), and every literal that constructs a workout in `generateRunningWorkouts` (`:219`), `generateCyclingWorkouts` (`:306`), `generateTriathlonWorkouts` (`:375`)
- Modify: `src/lib/race/taper.ts` (`raceWeekWorkouts` also constructs workouts)
- Test: `src/lib/training-plan.test.ts` (add cases; create the file if absent)

**Interfaces:**
- Consumes: `Purpose`, `PURPOSE_FLOORS` from Task 1.
- Produces: `PlannedWorkout` with `purpose: Purpose` and `minEffectiveMins: number`; `PURPOSE_BY_TYPE: Record<string, Purpose>`; `withPurpose(w: Omit<PlannedWorkout, "purpose" | "minEffectiveMins">): PlannedWorkout`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/training-plan.test.ts  (add to the existing describe blocks if present)
import { describe, expect, it } from "vitest";
import { generateWorkouts, withPurpose, PURPOSE_BY_TYPE } from "./training-plan";

describe("workout purpose", () => {
  it("maps every generated type to a purpose one-to-one", () => {
    expect(PURPOSE_BY_TYPE).toEqual({
      Recovery: "recovery",
      Endurance: "aerobic_base",
      Long: "long",
      Tempo: "threshold",
      Intervals: "vo2max",
      Brick: "brick",
    });
  });

  it("stamps purpose and floor onto a bare workout", () => {
    const w = withPurpose({
      day: 2,
      sport: "Bike",
      type: "Intervals",
      durationMins: 90,
      intensity: "Z4-Z5",
      description: "VO2max intervals",
    });
    expect(w.purpose).toBe("vo2max");
    expect(w.minEffectiveMins).toBe(40);
  });

  it("falls back to aerobic_base for an unknown type", () => {
    const w = withPurpose({
      day: 0,
      sport: "Bike",
      type: "Mystery",
      durationMins: 60,
      intensity: "Z1-Z2",
      description: "?",
    });
    expect(w.purpose).toBe("aerobic_base");
    expect(w.minEffectiveMins).toBe(40);
  });

  it("gives every generated workout a purpose and a floor", () => {
    const ws = generateWorkouts(4, 8, "build", "Gran Fondo", ["Bike"]);
    expect(ws.length).toBeGreaterThan(0);
    for (const w of ws) {
      expect(w.purpose).toBeDefined();
      expect(w.minEffectiveMins).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/training-plan.test.ts -t "workout purpose"`
Expected: FAIL — `withPurpose is not a function`.

- [ ] **Step 3: Write minimal implementation**

Change the interface at `src/lib/training-plan.ts:12`:

```ts
import type { Purpose } from "@/lib/availability/types";
import { PURPOSE_FLOORS } from "@/lib/availability/types";

export interface PlannedWorkout {
  day: number; // 0=Mon..6=Sun
  sport: string;
  type: string; // display label: "Endurance", "Tempo", "Intervals", ...
  durationMins: number;
  intensity: string; // "Z1-Z2", "Z3", "Z4-Z5", "Recovery"
  description: string;
  /** What the engine reasons about. Derived from `type`, one-to-one. */
  purpose: Purpose;
  /** Below this the session no longer delivers its stimulus. */
  minEffectiveMins: number;
}

export const PURPOSE_BY_TYPE: Record<string, Purpose> = {
  Recovery: "recovery",
  Endurance: "aerobic_base",
  Long: "long",
  Tempo: "threshold",
  Intervals: "vo2max",
  Brick: "brick",
};

/** Stamps purpose + floor onto a workout literal. Unknown types are aerobic. */
export function withPurpose(
  w: Omit<PlannedWorkout, "purpose" | "minEffectiveMins">
): PlannedWorkout {
  const purpose = PURPOSE_BY_TYPE[w.type] ?? "aerobic_base";
  return { ...w, purpose, minEffectiveMins: PURPOSE_FLOORS[purpose] };
}
```

Then wrap every workout literal. In `generateCyclingWorkouts` each
`workouts.push({ ... })` becomes `workouts.push(withPurpose({ ... }))`.
Apply the same change in `generateRunningWorkouts`,
`generateTriathlonWorkouts`, and `raceWeekWorkouts` in
`src/lib/race/taper.ts`.

Also update the step-down site in `src/lib/week-plan/materialize.ts:270-277`,
which builds a modified copy — it must restamp the purpose:

```ts
          workout = withPurpose({
            ...w,
            type: steppedType,
            intensity: "Z1-Z2",
          });
```

and the race step-down at `materialize.ts:353-359`:

```ts
        workout: withPurpose({
          ...days[idx - 2].workout!,
          type: "Endurance",
          intensity: "Z1-Z2",
        }),
```

- [ ] **Step 4: Run tests and the type checker**

Run: `npx vitest run src/lib/training-plan.test.ts && npm run typecheck`
Expected: the new tests PASS. `typecheck` will still report errors in files that construct `PlannedWorkout` literals — fix each by wrapping in `withPurpose` until it is clean.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/lib/training-plan.ts src/lib/training-plan.test.ts src/lib/race/taper.ts src/lib/week-plan/materialize.ts
git add src/lib/training-plan.ts src/lib/training-plan.test.ts src/lib/race/taper.ts src/lib/week-plan/materialize.ts
git commit -m "feat(plan): every workout carries a training purpose and its effective floor"
```

---

### Task 5: `DaySlot` goes plural

This is the widest change in the plan. Land it complete — a half-migrated
`DaySlot` dragged through Tasks 6–8 is the failure mode to avoid.

**Files:**
- Modify: `src/lib/week-plan/types.ts:7-18`
- Modify: `src/lib/week-plan/materialize.ts`, `src/lib/week-plan/adapt-day.ts`, `src/lib/week-plan/service.ts`
- Modify: `src/components/plan/week-strip.tsx`, `src/components/plan/day-actions.tsx`, `src/components/train/week-day-list.tsx`, `src/components/plan/today-card.tsx`
- Modify: `src/lib/race/forecast.ts`, `src/lib/tools/get-week-plan.ts`, `src/lib/tools/icu-event-body.ts`, `src/lib/tools/icu-event-shape.ts`
- Test: existing suites are the gate; add one case to `src/lib/week-plan/materialize.test.ts`

**Interfaces:**
- Consumes: `AvailabilityBlock`, `blockMins` from Task 1.
- Produces: `DaySlot` with `availableBlocks: AvailabilityBlock[]`, `workouts: PlannedWorkout[]`, `unplannedLoad?: number`; helper `dayMins(d: DaySlot): number`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/week-plan/materialize.test.ts  (append)
import { dayMins } from "./types";

describe("DaySlot shape", () => {
  it("sums a day's blocks rather than trusting availableMins", () => {
    const day = {
      date: "2026-08-03",
      availableBlocks: [
        { start: "06:30", end: "07:15", mins: 45, energy: "normal" as const, sports: null },
        { start: "19:00", end: "20:00", mins: 60, energy: "normal" as const, sports: null },
      ],
      workouts: [],
      availableMins: 999, // deliberately wrong: nothing may trust it
      status: "rest" as const,
    };
    expect(dayMins(day)).toBe(105);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/week-plan/materialize.test.ts -t "DaySlot shape"`
Expected: FAIL — `dayMins is not exported`.

- [ ] **Step 3: Change the type**

Replace `src/lib/week-plan/types.ts:7-18`:

```ts
import type { AvailabilityBlock } from "@/lib/availability/types";
import { blockMins } from "@/lib/availability/types";

export interface DaySlot {
  date: string; // YYYY-MM-DD
  /** Resolved availability for this date. Empty = unavailable. */
  availableBlocks: AvailabilityBlock[];
  /** Up to MAX_SESSIONS_PER_DAY sessions. Empty = rest. */
  workouts: PlannedWorkout[];
  /**
   * Derived sum, kept only so existing displays and the race forecast keep
   * working. Placement logic must never read it — a day of 45m + 60m is
   * two opportunities, not one 105-minute one.
   */
  availableMins: number;
  status: DayStatus;
  /** Set when a workout was moved here from another day (its original date). */
  movedFrom?: string;
  activityId?: string;
  actualLoad?: number;
  /** Load from work the plan did not ask for. Never triggers a replan. */
  unplannedLoad?: number;
  /** Set on race-day slots (status "race"): the race's display name. */
  raceName?: string;
}

/** The day's total available minutes, from its blocks. */
export function dayMins(d: Pick<DaySlot, "availableBlocks">): number {
  return d.availableBlocks.reduce((s, b) => s + blockMins(b), 0);
}
```

- [ ] **Step 4: Update every reader**

Run: `npm run typecheck` and work the error list. The mechanical rules:

- `d.workout` (read) → `d.workouts[0] ?? null` where a single session is
  assumed, or iterate `d.workouts` where the display should show all.
- `d.workout !== null` (a "is this day taken" guard) → `d.workouts.length > 0`.
- `{ ...d, workout: w, status: "planned" }` → `{ ...d, workouts: [...d.workouts, w], status: "planned" }`.
- `{ ...d, workout: null, status: "rest" }` → `{ ...d, workouts: [], status: "rest" }`.
- `d.availableMins < w.durationMins` → **do not** translate to `dayMins`.
  These sites are the defect; leave them failing to compile and let Task 6
  replace them with slot admission. Until then, use
  `d.availableBlocks.some((b) => blockMins(b) >= w.durationMins)`.
- Every construction of a `DaySlot` must now set `availableBlocks` and keep
  `availableMins` as `dayMins({ availableBlocks })`.

In `src/components/train/week-day-list.tsx` and
`src/components/plan/week-strip.tsx`, render each workout in `d.workouts`
rather than the single one. In `day-actions.tsx`, `DayActionsDay.hasWorkout`
becomes `workoutCount: number` and the move/swap target filters use it.

- [ ] **Step 5: Run the whole suite and the type checker**

Run: `npm run typecheck && npx vitest run`
Expected: typecheck clean; all existing tests PASS. Any test that asserted
on `day.workout` must be updated to `day.workouts[0]` — that is an expected
part of this task, not a regression.

- [ ] **Step 6: Commit**

```bash
npx prettier --write src/lib/week-plan src/components/plan src/components/train src/lib/race/forecast.ts src/lib/tools
git add -A
git commit -m "refactor(week-plan): a day carries blocks and a list of workouts"
```

---

### Task 6: Slots and admission

**Files:**
- Create: `src/lib/week-plan/slots.ts`
- Test: `src/lib/week-plan/slots.test.ts`

**Interfaces:**
- Consumes: `AvailabilityBlock`, `blockMins`, `ENERGY_CEILING`, `MAX_SESSIONS_PER_DAY` (Task 1); `PlannedWorkout` (Task 4); `DaySlot`, `isQuality` (Task 5).
- Produces: `Slot { dayIdx: number; blockIdx: number; mins: number; energy: Energy; sports: string[] | null }`, `buildSlots(days: DaySlot[]): Slot[]`, `admits(slot: Slot, w: PlannedWorkout, days: DaySlot[], taken: Set<string>): boolean`, `slotKey(s: Slot): string`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/week-plan/slots.test.ts
import { describe, expect, it } from "vitest";
import { buildSlots, admits, slotKey } from "./slots";
import type { DaySlot } from "./types";
import type { PlannedWorkout } from "@/lib/training-plan";
import type { Energy } from "@/lib/availability/types";

function day(
  date: string,
  blocks: { mins: number; energy?: Energy; sports?: string[] | null }[],
  workouts: PlannedWorkout[] = []
): DaySlot {
  const availableBlocks = blocks.map((b) => ({
    start: null,
    end: null,
    mins: b.mins,
    energy: b.energy ?? ("full" as Energy),
    sports: b.sports ?? null,
  }));
  return {
    date,
    availableBlocks,
    workouts,
    availableMins: availableBlocks.reduce((s, b) => s + b.mins, 0),
    status: workouts.length > 0 ? "planned" : "rest",
  };
}

const workout = (o: Partial<PlannedWorkout> = {}): PlannedWorkout => ({
  day: 0,
  sport: "Bike",
  type: "Intervals",
  durationMins: 60,
  intensity: "Z4-Z5",
  description: "intervals",
  purpose: "vo2max",
  minEffectiveMins: 40,
  ...o,
});

const week = (days: DaySlot[]) => days;

describe("buildSlots", () => {
  it("emits one slot per block, roomiest first, then by day then block", () => {
    const days = week([
      day("2026-08-03", [{ mins: 45 }, { mins: 60 }]),
      day("2026-08-04", [{ mins: 180 }]),
      day("2026-08-05", []),
    ]);
    expect(buildSlots(days).map((s) => [s.dayIdx, s.blockIdx, s.mins])).toEqual([
      [1, 0, 180],
      [0, 1, 60],
      [0, 0, 45],
    ]);
  });

  it("emits nothing for a day with no blocks", () => {
    expect(buildSlots(week([day("2026-08-03", [])]))).toEqual([]);
  });
});

describe("admits", () => {
  const empty = new Set<string>();

  it("refuses a session longer than the block", () => {
    const days = week([day("2026-08-03", [{ mins: 45 }])]);
    expect(admits(buildSlots(days)[0], workout({ durationMins: 60 }), days, empty)).toBe(false);
  });

  it("refuses a session the block's sport list excludes", () => {
    const days = week([day("2026-08-03", [{ mins: 90, sports: ["Run"] }])]);
    expect(admits(buildSlots(days)[0], workout({ sport: "Bike" }), days, empty)).toBe(false);
  });

  it("admits any sport when the block names none", () => {
    const days = week([day("2026-08-03", [{ mins: 90, sports: null }])]);
    expect(admits(buildSlots(days)[0], workout({ sport: "Bike" }), days, empty)).toBe(true);
  });

  it("refuses vo2max in an easy block", () => {
    const days = week([day("2026-08-03", [{ mins: 90, energy: "easy" }])]);
    expect(admits(buildSlots(days)[0], workout({ purpose: "vo2max" }), days, empty)).toBe(false);
  });

  it("admits threshold in a normal block but not vo2max", () => {
    const days = week([day("2026-08-03", [{ mins: 90, energy: "normal" }])]);
    const s = buildSlots(days)[0];
    expect(admits(s, workout({ purpose: "threshold", type: "Tempo" }), days, empty)).toBe(true);
    expect(admits(s, workout({ purpose: "vo2max" }), days, empty)).toBe(false);
  });

  it("refuses a quality session next to another quality day", () => {
    const days = week([
      day("2026-08-03", [{ mins: 90 }], [workout({ type: "Intervals" })]),
      day("2026-08-04", [{ mins: 90 }]),
    ]);
    const target = buildSlots(days).find((s) => s.dayIdx === 1)!;
    expect(admits(target, workout({ type: "Intervals" }), days, empty)).toBe(false);
  });

  it("refuses a third session on a day that already has two", () => {
    const days = week([
      day("2026-08-03", [{ mins: 60 }, { mins: 60 }, { mins: 60 }],
        [workout({ type: "Endurance", purpose: "aerobic_base" }),
         workout({ type: "Endurance", purpose: "aerobic_base" })]),
    ]);
    const third = buildSlots(days)[2];
    expect(admits(third, workout({ type: "Endurance", purpose: "aerobic_base" }), days, empty)).toBe(false);
  });

  it("refuses a slot already taken in this pass", () => {
    const days = week([day("2026-08-03", [{ mins: 90 }])]);
    const s = buildSlots(days)[0];
    expect(admits(s, workout(), days, new Set([slotKey(s)]))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/week-plan/slots.test.ts`
Expected: FAIL — `Failed to resolve import "./slots"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/week-plan/slots.ts
// Placement primitives. A slot is one opportunity to train — a single
// block on a single day — which is why nothing here reads a daily sum.
import {
  blockMins,
  ENERGY_CEILING,
  MAX_SESSIONS_PER_DAY,
  type Energy,
} from "@/lib/availability/types";
import type { PlannedWorkout } from "@/lib/training-plan";
import { isQuality, type DaySlot } from "./types";

export interface Slot {
  dayIdx: number;
  blockIdx: number;
  mins: number;
  energy: Energy;
  sports: string[] | null;
}

export function slotKey(s: Slot): string {
  return `${s.dayIdx}:${s.blockIdx}`;
}

/** Every opportunity in the week, roomiest first; ties are deterministic. */
export function buildSlots(days: DaySlot[]): Slot[] {
  const slots: Slot[] = [];
  days.forEach((d, dayIdx) => {
    d.availableBlocks.forEach((b, blockIdx) => {
      slots.push({
        dayIdx,
        blockIdx,
        mins: blockMins(b),
        energy: b.energy,
        sports: b.sports,
      });
    });
  });
  return slots.sort(
    (a, b) => b.mins - a.mins || a.dayIdx - b.dayIdx || a.blockIdx - b.blockIdx
  );
}

/** Whether this session may occupy this slot, given the week around it. */
export function admits(
  slot: Slot,
  w: PlannedWorkout,
  days: DaySlot[],
  taken: Set<string>
): boolean {
  if (taken.has(slotKey(slot))) return false;
  if (slot.mins < w.durationMins) return false;
  if (slot.sports !== null && !slot.sports.includes(w.sport)) return false;
  if (!ENERGY_CEILING[slot.energy].includes(w.purpose)) return false;

  const day = days[slot.dayIdx];
  if (day.workouts.length >= MAX_SESSIONS_PER_DAY) return false;

  if (isQuality(w)) {
    // Never two quality sessions on one day, nor on adjacent days.
    if (day.workouts.some((x) => isQuality(x))) return false;
    const neighbours = [days[slot.dayIdx - 1], days[slot.dayIdx + 1]];
    if (neighbours.some((n) => n?.workouts.some((x) => isQuality(x)))) return false;
  }
  return true;
}
```

`isQuality` in `src/lib/week-plan/types.ts` currently takes
`PlannedWorkout | null`. Widen it to accept a non-null workout too — its
body already handles both:

```ts
export function isQuality(w: PlannedWorkout | null | undefined): boolean {
  return w != null && (QUALITY_TYPES as readonly string[]).includes(w.type);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/week-plan/slots.test.ts`
Expected: PASS — 10 tests.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/lib/week-plan/slots.ts src/lib/week-plan/slots.test.ts src/lib/week-plan/types.ts
git add src/lib/week-plan/slots.ts src/lib/week-plan/slots.test.ts src/lib/week-plan/types.ts
git commit -m "feat(week-plan): sessions are placed into blocks, not into daily sums"
```

---

### Task 7: `materializeWeek` places into slots

**Files:**
- Modify: `src/lib/week-plan/materialize.ts` (the placement section, roughly `:175-305`)
- Test: `src/lib/week-plan/materialize.test.ts`

**Interfaces:**
- Consumes: `buildSlots`, `admits`, `slotKey` (Task 6).
- Produces: `MaterializeInput.availableBlocksPerDay: AvailabilityBlock[][]` replacing `availabilityMins: number[]`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/week-plan/materialize.test.ts  (append)
describe("materializeWeek — block fitting", () => {
  const blocks = (mins: number[]) =>
    mins.map((m) => ({ start: null, end: null, mins: m, energy: "full" as const, sports: null }));

  const base = {
    weekStart: "2026-08-03",
    skeleton: { weekNumber: 3, phase: "build" as const, targetLoadTotal: 400, targetSessions: 4 },
    prevWeek: null,
    recentBands: [],
    raceType: "Gran Fondo",
    sports: ["Bike"],
    hoursPerWeek: 8,
  };

  it("never schedules a session longer than any single block", () => {
    const r = materializeWeek({
      ...base,
      availableBlocksPerDay: [
        blocks([45, 60]), // 105 total, but no block over 60
        blocks([]), blocks([]), blocks([]), blocks([]), blocks([]), blocks([]),
      ],
    });
    for (const d of r.week.days) {
      for (const w of d.workouts) {
        expect(Math.max(0, ...d.availableBlocks.map((b) => b.mins))).toBeGreaterThanOrEqual(
          w.durationMins
        );
      }
    }
  });

  it("does not truncate a session to fit — it places a fitting one instead", () => {
    const r = materializeWeek({
      ...base,
      availableBlocksPerDay: [
        blocks([50]), blocks([50]), blocks([50]), blocks([50]),
        blocks([50]), blocks([50]), blocks([50]),
      ],
    });
    // Every placed session is at or above its own floor: nothing was
    // clipped below the point where it stops delivering its stimulus.
    for (const d of r.week.days) {
      for (const w of d.workouts) {
        expect(w.durationMins).toBeGreaterThanOrEqual(w.minEffectiveMins);
      }
    }
  });

  it("can place two sessions on a day with two blocks", () => {
    const r = materializeWeek({
      ...base,
      skeleton: { ...base.skeleton, targetSessions: 2 },
      availableBlocksPerDay: [
        blocks([90, 90]),
        blocks([]), blocks([]), blocks([]), blocks([]), blocks([]), blocks([]),
      ],
    });
    expect(r.week.days[0].workouts.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/week-plan/materialize.test.ts -t "block fitting"`
Expected: FAIL — `availableBlocksPerDay` is not a known property.

- [ ] **Step 3: Rewrite the placement section**

In `MaterializeInput`, replace `availabilityMins: number[]` with
`availableBlocksPerDay: AvailabilityBlock[][]`. Then:

```ts
  const days: DaySlot[] = dates.map((date, i) => {
    const availableBlocks = input.availableBlocksPerDay[i] ?? [];
    return {
      date,
      availableBlocks,
      workouts: [],
      availableMins: dayMins({ availableBlocks }),
      status: "rest",
    };
  });

  const hoursBudget = days.reduce((s, d) => s + dayMins(d), 0) / 60;
  const usableDays = days.filter((d) => d.availableBlocks.length > 0).length;
  const sessions = Math.min(skeleton.targetSessions, usableDays * MAX_SESSIONS_PER_DAY);
```

Replace the whole `place()` / `for (const w of workouts)` body with:

```ts
    const workouts = generateWorkouts(
      sessions,
      effectiveHours,
      skeleton.phase,
      input.raceType,
      input.sports
    )
      .sort((a, b) => b.durationMins - a.durationMins)
      .slice(0, sessions);

    const taken = new Set<string>();

    for (const w of workouts) {
      const slots = buildSlots(days); // rebuilt: earlier placements change admission
      let slot = slots.find((s) => admits(s, w, days, taken));
      let workout = w;

      if (!slot && isQuality(w)) {
        // No admitting slot for a quality session: step it down until it is
        // no longer quality, exactly as the previous engine did.
        let steppedType = w.type;
        while ((QUALITY_TYPES as readonly string[]).includes(steppedType)) {
          steppedType = STEP_DOWN[steppedType] ?? "Endurance";
        }
        const stepped = withPurpose({ ...w, type: steppedType, intensity: "Z1-Z2" });
        const steppedSlot = buildSlots(days).find((s) => admits(s, stepped, days, taken));
        if (steppedSlot) {
          slot = steppedSlot;
          workout = stepped;
          adjustments.push({
            date: days[steppedSlot.dayIdx].date,
            trigger: "weekly_rollover",
            action: "scaled",
            before: [],
            after: [],
            reason: `no admitting slot for ${w.type} — stepped down to ${stepped.type}`,
          });
        }
      }

      if (!slot) continue; // fewer opportunities than sessions
      taken.add(slotKey(slot));
      const target = days[slot.dayIdx];
      days[slot.dayIdx] = {
        ...target,
        workouts: [...target.workouts, workout],
        status: "planned",
      };
    }
```

Delete the truncation block that previously set
`workout.durationMins = cap` and pushed a `no_time` adjustment. A session
that fits nothing is simply not placed; the ladder in Task 8 owns shrinking.

Update the race-day and A/B-protection sections below to use `workouts`
(they were mechanically converted in Task 5; confirm they still compile).

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/week-plan/materialize.test.ts`
Expected: PASS. Older cases that passed `availabilityMins` must be updated
to `availableBlocksPerDay` — that is part of this task.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/lib/week-plan/materialize.ts src/lib/week-plan/materialize.test.ts
git add src/lib/week-plan/materialize.ts src/lib/week-plan/materialize.test.ts
git commit -m "feat(week-plan): materialize into blocks and stop truncating sessions"
```

---

### Task 8: The replan ladder

**Files:**
- Create: `src/lib/week-plan/replan.ts`
- Test: `src/lib/week-plan/replan.test.ts`

**Interfaces:**
- Consumes: `buildSlots`, `admits`, `slotKey` (Task 6); `PURPOSE_FLOORS`, `SUBSTITUTE_TO` (Task 1); `withPurpose` (Task 4).
- Produces: `replanWeek(week: WeekState, resolved: Map<string, AvailabilityBlock[]>): { week: WeekState; adjustments: AdjustmentRecord[] }`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/week-plan/replan.test.ts
import { describe, expect, it } from "vitest";
import { replanWeek } from "./replan";
import type { WeekState, DaySlot } from "./types";
import type { PlannedWorkout } from "@/lib/training-plan";
import type { AvailabilityBlock } from "@/lib/availability/types";

const blk = (mins: number): AvailabilityBlock => ({
  start: null, end: null, mins, energy: "full", sports: null,
});

const w = (o: Partial<PlannedWorkout> = {}): PlannedWorkout => ({
  day: 0, sport: "Bike", type: "Intervals", durationMins: 90,
  intensity: "Z4-Z5", description: "5×4min", purpose: "vo2max",
  minEffectiveMins: 40, ...o,
});

function week(spec: { mins: number[]; workouts?: PlannedWorkout[] }[]): WeekState {
  const days: DaySlot[] = spec.map((s, i) => {
    const availableBlocks = s.mins.map(blk);
    return {
      date: `2026-08-${String(3 + i).padStart(2, "0")}`,
      availableBlocks,
      workouts: s.workouts ?? [],
      availableMins: availableBlocks.reduce((a, b) => a + b.mins, 0),
      status: (s.workouts?.length ?? 0) > 0 ? "planned" : "rest",
    };
  });
  return { weekStart: "2026-08-03", skeletonWeek: 3, days };
}

const resolve = (mins: number[][], start = 3) =>
  new Map(mins.map((m, i) => [`2026-08-${String(start + i).padStart(2, "0")}`, m.map(blk)]));

describe("replanWeek — rung 1, move", () => {
  it("moves the displaced session and leaves every other day byte-identical", () => {
    const before = week([
      { mins: [0] },
      { mins: [60], workouts: [w({ type: "Endurance", purpose: "aerobic_base", durationMins: 60 })] },
      { mins: [90], workouts: [w()] },          // Wed: intervals
      { mins: [90] },                            // Thu: free, same size
      { mins: [60], workouts: [w({ type: "Endurance", purpose: "aerobic_base", durationMins: 60 })] },
      { mins: [180], workouts: [w({ type: "Long", purpose: "long", durationMins: 180 })] },
      { mins: [90], workouts: [w({ type: "Endurance", purpose: "aerobic_base", durationMins: 90 })] },
    ]);
    const r = replanWeek(before, resolve([[0], [60], [], [90], [60], [180], [90]]));

    expect(r.week.days[2].workouts).toEqual([]);
    expect(r.week.days[3].workouts[0].type).toBe("Intervals");
    expect(r.week.days[3].workouts[0].durationMins).toBe(90);
    // untouched days are identical objects by value
    expect(r.week.days[5]).toEqual(before.days[5]);
    expect(r.week.days[6]).toEqual(before.days[6]);
    expect(r.adjustments[0].action).toBe("moved");
  });
});

describe("replanWeek — rung 2, compress", () => {
  it("shortens within the same purpose when nowhere else fits", () => {
    const before = week([{ mins: [90], workouts: [w()] }]);
    const r = replanWeek(before, resolve([[60]]));
    const out = r.week.days[0].workouts[0];
    expect(out.purpose).toBe("vo2max");
    expect(out.durationMins).toBe(60);
    expect(r.adjustments[0].action).toBe("scaled");
  });
});

describe("replanWeek — rung 3, substitute", () => {
  it("swaps purpose when the block is below the session's floor", () => {
    const before = week([{ mins: [90], workouts: [w()] }]);
    const r = replanWeek(before, resolve([[30]])); // vo2max floor is 40
    const out = r.week.days[0].workouts[0];
    expect(out.purpose).toBe("recovery"); // vo2max→threshold(45)→aerobic(40)→recovery(20)
    expect(out.durationMins).toBe(30);
    expect(r.adjustments[0].action).toBe("swapped");
  });
});

describe("replanWeek — rung 4, drop", () => {
  it("drops the session when the day goes to zero and nothing else fits", () => {
    const before = week([{ mins: [90], workouts: [w()] }]);
    const r = replanWeek(before, resolve([[]]));
    expect(r.week.days[0].workouts).toEqual([]);
    expect(r.adjustments[0].action).toBe("dropped");
  });
});

describe("replanWeek — look-ahead", () => {
  // The JOIN failure this design exists to avoid: never move a session onto
  // a day the athlete has already said they cannot train.
  it("compresses rather than moving onto a day with no room", () => {
    const before = week([
      { mins: [90], workouts: [w()] },
      { mins: [0] },
      { mins: [0] },
    ]);
    const r = replanWeek(before, resolve([[60], [], []]));
    expect(r.week.days[0].workouts[0].durationMins).toBe(60);
    expect(r.week.days[1].workouts).toEqual([]);
    expect(r.week.days[2].workouts).toEqual([]);
  });
});

describe("replanWeek — locked days", () => {
  it("never touches a completed or missed day", () => {
    const done = week([{ mins: [90], workouts: [w()] }]);
    done.days[0].status = "completed";
    const r = replanWeek(done, resolve([[]]));
    expect(r.week.days[0].workouts.length).toBe(1);
    expect(r.adjustments).toEqual([]);
  });
});

describe("replanWeek — stability", () => {
  it("is a no-op when availability is unchanged", () => {
    const before = week([{ mins: [90], workouts: [w()] }]);
    const r = replanWeek(before, resolve([[90]]));
    expect(r.week.days).toEqual(before.days);
    expect(r.adjustments).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/week-plan/replan.test.ts`
Expected: FAIL — `Failed to resolve import "./replan"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/week-plan/replan.ts
// The ladder. Unlike materializeWeek this never regenerates the week: it
// recomputes each day's slots, and only sessions that no longer fit move.
import {
  blockMins,
  PURPOSE_FLOORS,
  SUBSTITUTE_TO,
  type AvailabilityBlock,
  type Purpose,
} from "@/lib/availability/types";
import { withPurpose, type PlannedWorkout } from "@/lib/training-plan";
import { admits, buildSlots, slotKey } from "./slots";
import type { AdjustmentRecord, DaySlot, WeekState } from "./types";
import { dayMins } from "./types";

/** Display label for a purpose the engine substituted in. */
const TYPE_BY_PURPOSE: Record<Purpose, { type: string; intensity: string }> = {
  recovery: { type: "Recovery", intensity: "Recovery" },
  aerobic_base: { type: "Endurance", intensity: "Z1-Z2" },
  long: { type: "Long", intensity: "Z1-Z2" },
  threshold: { type: "Tempo", intensity: "Z3" },
  vo2max: { type: "Intervals", intensity: "Z4-Z5" },
  brick: { type: "Brick", intensity: "Z3" },
};

function locked(d: DaySlot): boolean {
  return d.status === "completed" || d.status === "missed";
}

/** The largest block on a day, or 0 when the day has none. */
function biggestBlock(blocks: AvailabilityBlock[]): number {
  return blocks.reduce((m, b) => Math.max(m, blockMins(b)), 0);
}

export function replanWeek(
  week: WeekState,
  resolved: Map<string, AvailabilityBlock[]>
): { week: WeekState; adjustments: AdjustmentRecord[] } {
  const adjustments: AdjustmentRecord[] = [];

  // 1. Apply the new availability, keeping locked days exactly as they are.
  const days: DaySlot[] = week.days.map((d) => {
    if (locked(d)) return d;
    const availableBlocks = resolved.get(d.date) ?? d.availableBlocks;
    return { ...d, availableBlocks, availableMins: dayMins({ availableBlocks }) };
  });

  // 2. Find displaced sessions: those whose day no longer holds them.
  const displaced: { dayIdx: number; workout: PlannedWorkout; before: DaySlot }[] = [];
  days.forEach((d, dayIdx) => {
    if (locked(d)) return;
    const room = biggestBlock(d.availableBlocks);
    const keep: PlannedWorkout[] = [];
    for (const w of d.workouts) {
      if (w.durationMins <= room) keep.push(w);
      else displaced.push({ dayIdx, workout: w, before: { ...d, workouts: [...d.workouts] } });
    }
    if (keep.length !== d.workouts.length) {
      days[dayIdx] = { ...d, workouts: keep, status: keep.length > 0 ? d.status : "rest" };
    }
  });

  if (displaced.length === 0) return { week: { ...week, days }, adjustments };

  // 3. Walk each displaced session down the ladder.
  const taken = new Set<string>();
  for (const { dayIdx, workout, before } of displaced) {
    const fromDate = days[dayIdx].date;

    // Rung 1 — move. "Nearest" is the smallest absolute day distance from
    // the original date; ties break toward the earlier day, then the
    // earlier block. Only days with real room are considered, so a session
    // is never pushed onto a day the athlete marked unavailable.
    const candidates = buildSlots(days)
      .filter((s) => s.dayIdx !== dayIdx && !locked(days[s.dayIdx]))
      .filter((s) => admits(s, workout, days, taken))
      .sort(
        (a, b) =>
          Math.abs(a.dayIdx - dayIdx) - Math.abs(b.dayIdx - dayIdx) ||
          a.dayIdx - b.dayIdx ||
          a.blockIdx - b.blockIdx
      );
    const move = candidates[0];
    if (move) {
      taken.add(slotKey(move));
      const target = days[move.dayIdx];
      days[move.dayIdx] = {
        ...target,
        workouts: [...target.workouts, workout],
        status: "moved",
        movedFrom: fromDate,
      };
      adjustments.push({
        date: fromDate,
        trigger: "availability_change",
        action: "moved",
        before: [before],
        after: [{ ...days[move.dayIdx] }],
        reason: `no time on ${fromDate} — moved to ${days[move.dayIdx].date}, which fits it whole`,
      });
      continue;
    }

    const room = biggestBlock(days[dayIdx].availableBlocks);

    // Rung 2 — compress within the same purpose.
    if (room >= workout.minEffectiveMins) {
      const shorter = { ...workout, durationMins: room };
      days[dayIdx] = {
        ...days[dayIdx],
        workouts: [...days[dayIdx].workouts, shorter],
        status: "adapted",
      };
      adjustments.push({
        date: fromDate,
        trigger: "no_time",
        action: "scaled",
        before: [before],
        after: [{ ...days[dayIdx] }],
        reason: `${workout.type} shortened from ${workout.durationMins} to ${room}min — same session, less of it`,
      });
      continue;
    }

    // Rung 3 — substitute toward the nearest lesser stimulus that fits.
    let purpose: Purpose | undefined = SUBSTITUTE_TO[workout.purpose];
    while (purpose && PURPOSE_FLOORS[purpose] > room) {
      purpose = SUBSTITUTE_TO[purpose];
    }
    if (purpose && room > 0) {
      const label = TYPE_BY_PURPOSE[purpose];
      const swapped = withPurpose({
        day: workout.day,
        sport: workout.sport,
        type: label.type,
        durationMins: room,
        intensity: label.intensity,
        description: `${label.type} — replaces ${workout.type}, which needs ${workout.minEffectiveMins}min to be worth doing`,
      });
      days[dayIdx] = {
        ...days[dayIdx],
        workouts: [...days[dayIdx].workouts, swapped],
        status: "adapted",
      };
      adjustments.push({
        date: fromDate,
        trigger: "no_time",
        action: "swapped",
        before: [before],
        after: [{ ...days[dayIdx] }],
        reason: `only ${room}min on ${fromDate} — ${workout.type} replaced by ${label.type}, which still works at that length`,
      });
      continue;
    }

    // Rung 4 — drop.
    adjustments.push({
      date: fromDate,
      trigger: "availability_change",
      action: "dropped",
      before: [before],
      after: [{ ...days[dayIdx] }],
      reason: `no time left on ${fromDate} and nowhere else in the week fits — ${workout.type} dropped`,
    });
  }

  return { week: { ...week, days }, adjustments };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/week-plan/replan.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/lib/week-plan/replan.ts src/lib/week-plan/replan.test.ts
git add src/lib/week-plan/replan.ts src/lib/week-plan/replan.test.ts
git commit -m "feat(week-plan): move, compress, substitute, drop — one session moves, not the week"
```

---

### Task 9: Resolver against the database, and service wiring

**Files:**
- Create: `src/lib/availability/resolve.ts`, `src/lib/availability/resolve.test.ts`
- Create: `src/lib/availability/format.ts`, `src/lib/availability/format.test.ts`
- Delete: `src/lib/week-plan/availability.ts`, `src/lib/week-plan/availability.test.ts`
- Modify: `src/lib/week-plan/service.ts` (`rolloverWeekPlan`, `applyAvailability`)

**Interfaces:**
- Consumes: `resolveDay` (Task 2), `replanWeek` (Task 8), `schema.availabilityDefaults` / `schema.availabilityOverrides` (Task 3).
- Produces: `resolveWeek(userId: string, dates: string[]): Promise<Map<string, AvailabilityBlock[]>>`, `formatAvailability(mins: number): string`, `formatBlock(b: AvailabilityBlock): string`, `applyAvailability(userId: string, blocksPerDay: AvailabilityBlock[][])`.

- [ ] **Step 1: Move the formatter**

```ts
// src/lib/availability/format.ts
import { formatDuration } from "@/lib/format";
import { blockMins, type AvailabilityBlock } from "./types";

export function formatAvailability(mins: number): string {
  if (mins === 0) return "Rest";
  return formatDuration(mins * 60);
}

/** "18:00–19:30 · 1h 30m" for a timed block, "1h 30m" for a legacy one. */
export function formatBlock(b: AvailabilityBlock): string {
  const dur = formatAvailability(blockMins(b));
  if (b.start == null || b.end == null) return dur;
  return `${b.start}–${b.end} · ${dur}`;
}

export function formatBlocks(blocks: AvailabilityBlock[]): string {
  if (blocks.length === 0) return "Rest";
  return blocks.map(formatBlock).join(" + ");
}
```

```ts
// src/lib/availability/format.test.ts
import { describe, expect, it } from "vitest";
import { formatAvailability, formatBlock, formatBlocks } from "./format";

const b = (o = {}) => ({
  start: "18:00", end: "19:30", mins: 90, energy: "normal" as const, sports: null, ...o,
});

describe("formatAvailability", () => {
  it("calls zero a rest day", () => expect(formatAvailability(0)).toBe("Rest"));
  it("formats under an hour", () => expect(formatAvailability(45)).toBe("45m"));
  it("formats a mixed duration", () => expect(formatAvailability(90)).toBe("1h 30m"));
});

describe("formatBlock", () => {
  it("shows the clock window and the duration", () =>
    expect(formatBlock(b())).toBe("18:00–19:30 · 1h 30m"));
  it("shows only a duration for a legacy block", () =>
    expect(formatBlock(b({ start: null, end: null, mins: 60 }))).toBe("1h"));
});

describe("formatBlocks", () => {
  it("calls an empty day a rest day", () => expect(formatBlocks([])).toBe("Rest"));
  it("joins two blocks", () =>
    expect(formatBlocks([b({ start: "06:30", end: "07:15", mins: 45 }), b()]))
      .toBe("06:30–07:15 · 45m + 18:00–19:30 · 1h 30m"));
});
```

Run: `npx vitest run src/lib/availability/format.test.ts` — expected PASS.

- [ ] **Step 2: Write the resolver's failing test**

```ts
// src/lib/availability/resolve.test.ts
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { resolveWeek } from "./resolve";

// requires Postgres; skips without DATABASE_URL.
const hasDb = !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";
const USER = "test-availability-user";

describe.skipIf(!hasDb)("resolveWeek", () => {
  beforeAll(async () => {
    await db.insert(schema.users).values({ id: USER, email: `${USER}@example.test` })
      .onConflictDoNothing();
    // Standard week: Wednesday (weekday 2) 90 minutes, nothing else.
    await db.insert(schema.availabilityDefaults).values({
      userId: USER, weekday: 2,
      blocks: [{ start: "18:00", end: "19:30", mins: 90, energy: "normal", sports: null }],
    }).onConflictDoNothing();
  });

  afterAll(async () => {
    await db.delete(schema.availabilityOverrides).where(eq(schema.availabilityOverrides.userId, USER));
    await db.delete(schema.availabilityDefaults).where(eq(schema.availabilityDefaults.userId, USER));
    await db.delete(schema.users).where(eq(schema.users.id, USER));
  });

  it("returns the weekday default when no override exists", async () => {
    const r = await resolveWeek(USER, ["2026-08-05"]); // a Wednesday
    expect(r.get("2026-08-05")?.[0].mins).toBe(90);
  });

  it("returns an empty day for a weekday with no default", async () => {
    const r = await resolveWeek(USER, ["2026-08-03"]); // Monday
    expect(r.get("2026-08-03")).toEqual([]);
  });

  it("lets a date override beat the default, and survive a default change", async () => {
    await db.insert(schema.availabilityOverrides).values({
      userId: USER, date: "2026-08-05",
      blocks: [{ start: "19:00", end: "20:00", mins: 60, energy: "easy", sports: null }],
    });
    await db.update(schema.availabilityDefaults)
      .set({ blocks: [{ start: "17:00", end: "20:00", mins: 180, energy: "full", sports: null }] })
      .where(eq(schema.availabilityDefaults.userId, USER));

    const r = await resolveWeek(USER, ["2026-08-05", "2026-08-12"]);
    expect(r.get("2026-08-05")?.[0].mins).toBe(60);   // pinned
    expect(r.get("2026-08-12")?.[0].mins).toBe(180);  // follows the new default
  });

  it("treats an empty override as unavailable", async () => {
    await db.insert(schema.availabilityOverrides)
      .values({ userId: USER, date: "2026-08-19", blocks: [] });
    const r = await resolveWeek(USER, ["2026-08-19"]);
    expect(r.get("2026-08-19")).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/availability/resolve.test.ts`
Expected: FAIL — `Failed to resolve import "./resolve"` (or SKIP without a database, which is also acceptable here; run it against a database before moving on).

- [ ] **Step 4: Write the resolver**

```ts
// src/lib/availability/resolve.ts
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { resolveDay } from "./resolve-day";
import type { AvailabilityBlock } from "./types";

/** Monday = 0, matching availability_defaults.weekday. */
function weekdayOf(ymd: string): number {
  return (new Date(ymd + "T00:00:00").getDay() + 6) % 7;
}

/**
 * Resolved availability for each requested date. Two queries: the seven
 * defaults, and the overrides for exactly these dates.
 */
export async function resolveWeek(
  userId: string,
  dates: string[]
): Promise<Map<string, AvailabilityBlock[]>> {
  const [defaults, overrides] = await Promise.all([
    db.query.availabilityDefaults.findMany({
      where: eq(schema.availabilityDefaults.userId, userId),
    }),
    dates.length > 0
      ? db.query.availabilityOverrides.findMany({
          where: and(
            eq(schema.availabilityOverrides.userId, userId),
            inArray(schema.availabilityOverrides.date, dates)
          ),
        })
      : Promise.resolve([]),
  ]);

  const byWeekday = new Map<number, AvailabilityBlock[]>(
    defaults.map((d) => [d.weekday, d.blocks as AvailabilityBlock[]])
  );
  const byDate = new Map<string, AvailabilityBlock[]>(
    overrides.map((o) => [o.date, o.blocks as AvailabilityBlock[]])
  );

  return new Map(
    dates.map((date) => [
      date,
      resolveDay(byWeekday.get(weekdayOf(date)) ?? [], byDate.get(date) ?? null),
    ])
  );
}
```

- [ ] **Step 5: Rewire the service**

In `src/lib/week-plan/service.ts`:

Delete the `prefillAvailability` import and its call in `rolloverWeekPlan`
(`:218-230`), replacing it with:

```ts
  const dates = Array.from({ length: 7 }, (_, i) => addDaysYmd(weekStart, i));
  const resolved = await resolveWeek(userId, dates);
  // Days already behind us have no availability: a mid-week start must not
  // invent workouts in the past. On the normal Monday rollover this is a
  // no-op.
  const availableBlocksPerDay = dates.map((d) =>
    d < today ? [] : (resolved.get(d) ?? [])
  );
```

and pass `availableBlocksPerDay` to `materializeWeek` in place of
`availabilityMins`.

Replace the body of `applyAvailability` so it calls the ladder instead of
regenerating:

```ts
export async function applyAvailability(
  userId: string,
  blocksPerDay: AvailabilityBlock[][]
): Promise<"applied" | "no_open_week"> {
  const week = await getOpenWeekPlan(userId);
  if (!week || blocksPerDay.length !== 7) return "no_open_week";

  const resolved = new Map(week.days.map((d, i) => [d.date, blocksPerDay[i]]));
  const r = replanWeek(
    { weekStart: week.weekStart, skeletonWeek: week.skeletonWeek, days: week.days },
    resolved
  );

  const oldTotal = week.days.reduce((s, d) => s + dayMins(d), 0);
  const newTotal = r.week.days.reduce((s, d) => s + dayMins(d), 0);
  const now = new Date();

  await db
    .update(schema.weekPlans)
    .set({ days: r.week.days, availabilityConfirmedAt: now, updatedAt: now })
    .where(eq(schema.weekPlans.id, week.id));

  const today = localYmd(now);
  await saveAdjustments(week.id, [
    ...r.adjustments,
    {
      date: week.days.some((d) => d.date === today) ? today : week.weekStart,
      trigger: "availability_change",
      action: "redistributed",
      before: [],
      after: [],
      reason: `availability updated: ${fmtHours(oldTotal)}h→${fmtHours(newTotal)}h`,
    },
  ]);

  await runDailyAdaptation(userId, now);
  return "applied";
}
```

Note the deliberate change: `effectiveTarget` is **not** recomputed here.
The week's target belongs to materialization; the ladder reshapes what was
already decided. Delete the `materializeWeek` import from this function's
path if nothing else uses it (`rolloverWeekPlan` still does).

Then delete the old files:

```bash
git rm src/lib/week-plan/availability.ts src/lib/week-plan/availability.test.ts
```

and repoint every `formatAvailability` import at `@/lib/availability/format`.

- [ ] **Step 6: Run everything**

Run: `npm run typecheck && npx vitest run`
Expected: typecheck clean, all suites PASS (the resolve suite skips without a database).

- [ ] **Step 7: Commit**

```bash
npx prettier --write src/lib/availability src/lib/week-plan/service.ts
git add -A
git commit -m "feat(week-plan): resolve availability from defaults and overrides, replan instead of regenerate"
```

---

### Task 10: Bonus work never costs you a session

**Files:**
- Modify: `src/lib/week-plan/service.ts` (`runDailyAdaptation`)
- Test: `src/lib/week-plan/service.test.ts` (create; `describe.skipIf(!hasDb)`)

**Interfaces:**
- Consumes: `DaySlot.unplannedLoad` (Task 5).
- Produces: no new exports; a behavioural guarantee.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/week-plan/service.test.ts
import { describe, expect, it } from "vitest";
import { recordUnplannedLoad } from "./service";
import type { DaySlot } from "./types";

const day = (o: Partial<DaySlot> = {}): DaySlot => ({
  date: "2026-08-03",
  availableBlocks: [],
  workouts: [],
  availableMins: 0,
  status: "rest",
  ...o,
});

describe("recordUnplannedLoad", () => {
  it("books load on a day with no planned session as unplanned", () => {
    const d = recordUnplannedLoad(day(), 55);
    expect(d.unplannedLoad).toBe(55);
    expect(d.actualLoad).toBeUndefined();
    expect(d.status).toBe("rest");
  });

  it("books load on a planned day as the session's actual", () => {
    const planned = day({
      status: "planned",
      workouts: [{
        day: 0, sport: "Bike", type: "Endurance", durationMins: 60,
        intensity: "Z1-Z2", description: "ride",
        purpose: "aerobic_base", minEffectiveMins: 40,
      }],
    });
    const d = recordUnplannedLoad(planned, 55);
    expect(d.actualLoad).toBe(55);
    expect(d.unplannedLoad).toBeUndefined();
  });

  it("never removes a workout", () => {
    const planned = day({
      status: "planned",
      workouts: [{
        day: 0, sport: "Bike", type: "Intervals", durationMins: 90,
        intensity: "Z4-Z5", description: "intervals",
        purpose: "vo2max", minEffectiveMins: 40,
      }],
    });
    expect(recordUnplannedLoad(planned, 400).workouts.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/week-plan/service.test.ts`
Expected: FAIL — `recordUnplannedLoad is not exported`.

- [ ] **Step 3: Write the implementation**

Add to `src/lib/week-plan/service.ts`:

```ts
/**
 * Books an activity's load onto a day. Work the plan did not ask for goes
 * to `unplannedLoad`, which counts toward the week's actuals but never
 * triggers a replan — an extra easy hour on a rest day must not cost you a
 * session later in the week.
 *
 * Pure, and exported for its tests: the only thing it decides is which
 * field the load lands in.
 */
export function recordUnplannedLoad(day: DaySlot, load: number): DaySlot {
  if (day.workouts.length === 0) {
    return { ...day, unplannedLoad: (day.unplannedLoad ?? 0) + load };
  }
  return { ...day, actualLoad: load };
}
```

In `runDailyAdaptation`, replace the direct assignment at `:351-357`:

```ts
  if (matched) {
    const idx = result.week.days.findIndex((d) => d.date === yesterdayYmd);
    if (idx !== -1) {
      result.week.days[idx] = {
        ...recordUnplannedLoad(result.week.days[idx], matched.load ?? 0),
        activityId: matched.id,
      };
    }
  }
```

Add a comment above the `adaptDay` call stating the invariant:

```ts
  // adaptDay may scale, step down or move a session in response to
  // readiness and availability. It must never remove one because the
  // week's load ran ahead of target — that is what unplannedLoad is for.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/week-plan/service.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/lib/week-plan/service.ts src/lib/week-plan/service.test.ts
git add src/lib/week-plan/service.ts src/lib/week-plan/service.test.ts
git commit -m "feat(week-plan): unplanned work counts toward actuals but never costs a session"
```

---

### Task 11: CTL projection and the insufficient-time verdict

**Files:**
- Create: `src/lib/week-plan/ctl-projection.ts`
- Test: `src/lib/week-plan/ctl-projection.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `projectCtl(currentCtl: number, weekLoad: number, days?: number): number`, `availabilityVerdict(input: VerdictInput): Verdict`, with
  `VerdictInput { offeredMins: number; currentCtl: number | null; loadPerHour: number | null; historyDays: number; effectiveTarget: number }`
  and `Verdict = { kind: "silent" } | { kind: "losing"; maintenanceHrs: number; projectedCtl: number } | { kind: "holding"; targetHrs: number } | { kind: "ok" }`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/week-plan/ctl-projection.test.ts
import { describe, expect, it } from "vitest";
import { projectCtl, availabilityVerdict } from "./ctl-projection";

describe("projectCtl", () => {
  it("holds CTL flat when the week's load equals CTL × 7", () => {
    expect(projectCtl(60, 60 * 7)).toBeCloseTo(60, 1);
  });

  it("falls when the week's load is below maintenance", () => {
    expect(projectCtl(60, 0)).toBeLessThan(60);
  });

  it("rises when the week's load is above maintenance", () => {
    expect(projectCtl(60, 60 * 7 * 1.5)).toBeGreaterThan(60);
  });
});

describe("availabilityVerdict", () => {
  const base = {
    currentCtl: 60,
    loadPerHour: 70,
    historyDays: 40,
    effectiveTarget: 560, // 8h at 70 load/h
  };
  // maintenance = 60 × 7 = 420 load = 6h at 70 load/h

  it("stays silent below 28 days of history", () => {
    expect(availabilityVerdict({ ...base, historyDays: 27, offeredMins: 60 }).kind).toBe("silent");
  });

  it("stays silent with no CTL yet", () => {
    expect(availabilityVerdict({ ...base, currentCtl: null, offeredMins: 60 }).kind).toBe("silent");
  });

  it("stays silent when load per hour is unknown or zero", () => {
    expect(availabilityVerdict({ ...base, loadPerHour: 0, offeredMins: 60 }).kind).toBe("silent");
    expect(availabilityVerdict({ ...base, loadPerHour: null, offeredMins: 60 }).kind).toBe("silent");
  });

  it("warns about losing fitness below maintenance", () => {
    const v = availabilityVerdict({ ...base, offeredMins: 4.5 * 60 });
    expect(v.kind).toBe("losing");
    if (v.kind === "losing") {
      expect(v.maintenanceHrs).toBeCloseTo(6, 1);
      expect(v.projectedCtl).toBeLessThan(60);
    }
  });

  it("says holding between maintenance and target", () => {
    const v = availabilityVerdict({ ...base, offeredMins: 7 * 60 });
    expect(v.kind).toBe("holding");
    if (v.kind === "holding") expect(v.targetHrs).toBeCloseTo(8, 1);
  });

  it("says nothing at or above target", () => {
    expect(availabilityVerdict({ ...base, offeredMins: 8 * 60 }).kind).toBe("ok");
    expect(availabilityVerdict({ ...base, offeredMins: 10 * 60 }).kind).toBe("ok");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/week-plan/ctl-projection.test.ts`
Expected: FAIL — `Failed to resolve import "./ctl-projection"`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/week-plan/ctl-projection.ts
// CTL itself arrives from intervals.icu in wellnessDaily and is never
// recomputed here. This projects it forward, which is a different job.

/** Standard CTL time constant, in days. */
const CTL_TAU = 42;
/** Below this much load history no verdict is honest enough to show. */
export const MIN_HISTORY_DAYS = 28;

/**
 * CTL after `days` days at an even daily share of `weekLoad`, using the
 * standard exponential smoothing. Load equal to CTL × 7 over a week holds
 * CTL flat, which is what makes "maintenance" a real number.
 */
export function projectCtl(currentCtl: number, weekLoad: number, days = 7): number {
  const daily = weekLoad / 7;
  const alpha = 1 - Math.exp(-1 / CTL_TAU);
  let ctl = currentCtl;
  for (let i = 0; i < days; i++) ctl += (daily - ctl) * alpha;
  return ctl;
}

export interface VerdictInput {
  offeredMins: number;
  currentCtl: number | null;
  loadPerHour: number | null;
  historyDays: number;
  effectiveTarget: number;
}

export type Verdict =
  | { kind: "silent" }
  | { kind: "losing"; maintenanceHrs: number; projectedCtl: number }
  | { kind: "holding"; targetHrs: number }
  | { kind: "ok" };

/**
 * Is the offered time enough? Silent while calibrating — a fabricated
 * threshold during the first four weeks would be worse than saying
 * nothing.
 */
export function availabilityVerdict(input: VerdictInput): Verdict {
  const { offeredMins, currentCtl, loadPerHour, historyDays, effectiveTarget } = input;
  if (historyDays < MIN_HISTORY_DAYS) return { kind: "silent" };
  if (currentCtl == null || loadPerHour == null || loadPerHour <= 0) {
    return { kind: "silent" };
  }

  const offeredHrs = offeredMins / 60;
  const maintenanceHrs = (currentCtl * 7) / loadPerHour;
  const targetHrs = effectiveTarget / loadPerHour;

  if (offeredHrs < maintenanceHrs) {
    return {
      kind: "losing",
      maintenanceHrs,
      projectedCtl: projectCtl(currentCtl, offeredHrs * loadPerHour),
    };
  }
  if (offeredHrs < targetHrs) return { kind: "holding", targetHrs };
  return { kind: "ok" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/week-plan/ctl-projection.test.ts`
Expected: PASS — 9 tests.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/lib/week-plan/ctl-projection.ts src/lib/week-plan/ctl-projection.test.ts
git add src/lib/week-plan/ctl-projection.ts src/lib/week-plan/ctl-projection.test.ts
git commit -m "feat(week-plan): tell the athlete when the time given cannot hold their fitness"
```

---

### Task 12: Server actions

**Files:**
- Modify: `src/app/plan/actions.ts`
- Test: `src/app/plan/actions.test.ts` (create; `describe.skipIf(!hasDb)`)

**Interfaces:**
- Consumes: `validateBlocks` (Task 1), `applyAvailability` (Task 9).
- Produces: `setStandardWeekDay(weekday: number, blocks: AvailabilityBlock[])`, `setDayOverride(date: string, blocks: AvailabilityBlock[])`, `clearDayOverride(date: string)`, `zeroDay(date: string)`, and `submitAvailability` reshaped to blocks.

- [ ] **Step 1: Write the actions**

```ts
// src/app/plan/actions.ts  (append; keep the existing exports)
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { validateBlocks, type AvailabilityBlock } from "@/lib/availability/types";

type Result = { ok: true } | { ok: false; error: string };

function revalidatePlan(): void {
  revalidatePath("/train");
  revalidatePath("/");
}

/** Standard week: one weekday's blocks. Never touches existing overrides. */
export async function setStandardWeekDay(
  weekday: number,
  blocks: AvailabilityBlock[]
): Promise<Result> {
  const user = await requireUser();
  if (weekday < 0 || weekday > 6) return { ok: false, error: "invalid_weekday" };
  const invalid = validateBlocks(blocks);
  if (invalid) return { ok: false, error: invalid };

  await db
    .insert(schema.availabilityDefaults)
    .values({ userId: user.id, weekday, blocks })
    .onConflictDoUpdate({
      target: [schema.availabilityDefaults.userId, schema.availabilityDefaults.weekday],
      set: { blocks, updatedAt: new Date() },
    });
  revalidatePlan();
  return { ok: true };
}

/** Pin one date. Wins over the weekday default from now on. */
export async function setDayOverride(
  date: string,
  blocks: AvailabilityBlock[]
): Promise<Result> {
  const user = await requireUser();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: "invalid_date" };
  const invalid = validateBlocks(blocks);
  if (invalid) return { ok: false, error: invalid };

  await db
    .insert(schema.availabilityOverrides)
    .values({ userId: user.id, date, blocks })
    .onConflictDoUpdate({
      target: [schema.availabilityOverrides.userId, schema.availabilityOverrides.date],
      set: { blocks, updatedAt: new Date() },
    });
  revalidatePlan();
  return { ok: true };
}

/** "Back to standard": deletes the pin so the weekday default applies again. */
export async function clearDayOverride(date: string): Promise<Result> {
  const user = await requireUser();
  await db
    .delete(schema.availabilityOverrides)
    .where(
      and(
        eq(schema.availabilityOverrides.userId, user.id),
        eq(schema.availabilityOverrides.date, date)
      )
    );
  revalidatePlan();
  return { ok: true };
}

/** The swap menu's reset: an override of zero blocks means unavailable. */
export async function zeroDay(date: string): Promise<Result> {
  return setDayOverride(date, []);
}
```

Reshape `submitAvailability` to carry blocks. The form serialises each
day's blocks as JSON in a single field per day:

```ts
export async function submitAvailability(
  _prev: IntakeState,
  formData: FormData
): Promise<IntakeState> {
  const user = await requireUser();

  const blocksPerDay: AvailabilityBlock[][] = [];
  for (let i = 0; i < 7; i++) {
    const raw = formData.get(`blocks-${i}`);
    let parsed: AvailabilityBlock[] = [];
    try {
      parsed = raw ? (JSON.parse(String(raw)) as AvailabilityBlock[]) : [];
    } catch {
      parsed = [];
    }
    if (validateBlocks(parsed) !== null) parsed = [];
    blocksPerDay.push(parsed);
  }

  const result = await applyAvailability(user.id, blocksPerDay);
  revalidatePlan();
  return {
    message:
      result === "applied"
        ? "Week updated around your availability."
        : "No open week to update yet.",
  };
}
```

- [ ] **Step 2: Write the test**

```ts
// src/app/plan/actions.test.ts
import { describe, expect, it } from "vitest";
import { validateBlocks } from "@/lib/availability/types";

// The actions themselves need a session; their guard logic is what matters
// and is exercised through validateBlocks, which they delegate to.
describe("availability action guards", () => {
  it("rejects overlapping blocks before they can reach the database", () => {
    expect(
      validateBlocks([
        { start: "18:00", end: "19:30", mins: 90, energy: "normal", sports: null },
        { start: "19:00", end: "20:00", mins: 60, energy: "normal", sports: null },
      ])
    ).not.toBeNull();
  });

  it("accepts an empty day, which is how zeroDay works", () => {
    expect(validateBlocks([])).toBeNull();
  });
});
```

- [ ] **Step 3: Run the tests and the type checker**

Run: `npx vitest run src/app/plan/actions.test.ts && npm run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 4: Commit**

```bash
npx prettier --write src/app/plan/actions.ts src/app/plan/actions.test.ts
git add src/app/plan/actions.ts src/app/plan/actions.test.ts
git commit -m "feat(plan): server actions for the standard week and date overrides"
```

---

### Task 13: The block editor sheet

**Files:**
- Create: `src/components/plan/block-sheet.tsx`
- Test: `src/components/plan/block-sheet.test.tsx`
- Reuse: `src/components/plan/availability-sheet.tsx` (sheet shell + backdrop), `src/components/plan/wheel-column.tsx` (time control)

**Interfaces:**
- Consumes: `AvailabilityBlock`, `validateBlocks`, `formatBlock`.
- Produces: `<BlockSheet dayLabel blocks sports onChange onClose />` where `onChange(next: AvailabilityBlock[]): void`.

Read `node_modules/next/dist/docs/` before writing this component — this
Next release has breaking changes from what you may expect.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/plan/block-sheet.test.tsx
import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { BlockSheet } from "./block-sheet";

const blocks = [
  { start: "18:00", end: "19:30", mins: 90, energy: "normal" as const, sports: null },
];

describe("BlockSheet", () => {
  it("lists each block with its window and duration", () => {
    const html = renderToString(
      <BlockSheet dayLabel="Wednesday" blocks={blocks} sports={["Bike"]}
        onChange={vi.fn()} onClose={vi.fn()} />
    );
    expect(html).toContain("Wednesday");
    expect(html).toContain("18:00");
    expect(html).toContain("1h 30m");
  });

  it("offers the three energy levels", () => {
    const html = renderToString(
      <BlockSheet dayLabel="Wednesday" blocks={blocks} sports={["Bike"]}
        onChange={vi.fn()} onClose={vi.fn()} />
    );
    expect(html).toContain("Easy");
    expect(html).toContain("Normal");
    expect(html).toContain("Full gas");
  });

  it("says the day is a rest day when there are no blocks", () => {
    const html = renderToString(
      <BlockSheet dayLabel="Monday" blocks={[]} sports={["Bike"]}
        onChange={vi.fn()} onClose={vi.fn()} />
    );
    expect(html).toContain("Rest");
  });

  it("shows sport chips only when the plan has more than one sport", () => {
    const one = renderToString(
      <BlockSheet dayLabel="Wednesday" blocks={blocks} sports={["Bike"]}
        onChange={vi.fn()} onClose={vi.fn()} />
    );
    const two = renderToString(
      <BlockSheet dayLabel="Wednesday" blocks={blocks} sports={["Bike", "Run"]}
        onChange={vi.fn()} onClose={vi.fn()} />
    );
    expect(one).not.toContain("Run");
    expect(two).toContain("Run");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/plan/block-sheet.test.tsx`
Expected: FAIL — `Failed to resolve import "./block-sheet"`.

- [ ] **Step 3: Write the component**

```tsx
"use client";

// src/components/plan/block-sheet.tsx
import { useState } from "react";
import { X, Plus, Trash2 } from "lucide-react";
import {
  validateBlocks,
  type AvailabilityBlock,
  type Energy,
} from "@/lib/availability/types";
import { formatBlock } from "@/lib/availability/format";

interface Props {
  dayLabel: string;
  blocks: AvailabilityBlock[];
  /** Sports in the athlete's plan. Chips appear only when there's a choice. */
  sports: string[];
  onChange: (next: AvailabilityBlock[]) => void;
  onClose: () => void;
}

const ENERGY_LABELS: { value: Energy; label: string; hint: string }[] = [
  { value: "easy", label: "Easy", hint: "aerobic only" },
  { value: "normal", label: "Normal", hint: "up to tempo" },
  { value: "full", label: "Full gas", hint: "anything" },
];

const NEW_BLOCK: AvailabilityBlock = {
  start: "18:00",
  end: "19:00",
  mins: 60,
  energy: "normal",
  sports: null,
};

function minutesBetween(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  return eh * 60 + em - (sh * 60 + sm);
}

export function BlockSheet({ dayLabel, blocks, sports, onChange, onClose }: Props) {
  const [error, setError] = useState<string | null>(null);

  function commit(next: AvailabilityBlock[]) {
    const invalid = validateBlocks(next);
    setError(invalid);
    if (!invalid) onChange(next);
  }

  function patch(i: number, patchBlock: Partial<AvailabilityBlock>) {
    const next = blocks.map((b, j) => {
      if (j !== i) return b;
      const merged = { ...b, ...patchBlock };
      if (merged.start != null && merged.end != null) {
        merged.mins = minutesBetween(merged.start, merged.end);
      }
      return merged;
    });
    commit(next);
  }

  return (
    <>
      <div
        aria-hidden
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-label={`Availability for ${dayLabel}`}
        className="glass fixed inset-x-0 bottom-0 z-50 rounded-t-[2rem] p-6"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[15px] font-bold">{dayLabel}</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            <X aria-hidden className="size-4 text-white/50" />
          </button>
        </div>

        {blocks.length === 0 && (
          <p className="mb-4 text-[12px] text-white/50">Rest — no time set for this day.</p>
        )}

        <ul className="mb-4 space-y-3">
          {blocks.map((b, i) => (
            <li key={i} className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <input
                    type="time"
                    value={b.start ?? ""}
                    aria-label="Start time"
                    onChange={(e) => patch(i, { start: e.target.value })}
                    className="rounded-lg bg-white/[0.06] px-2 py-1 text-[12px]"
                  />
                  <span className="text-white/30">–</span>
                  <input
                    type="time"
                    value={b.end ?? ""}
                    aria-label="End time"
                    onChange={(e) => patch(i, { end: e.target.value })}
                    className="rounded-lg bg-white/[0.06] px-2 py-1 text-[12px]"
                  />
                </div>
                <button
                  type="button"
                  aria-label="Remove block"
                  onClick={() => commit(blocks.filter((_, j) => j !== i))}
                >
                  <Trash2 aria-hidden className="size-3.5 text-white/40" />
                </button>
              </div>

              <p className="mb-2 text-[11px] text-white/40">{formatBlock(b)}</p>

              <div className="mb-2 flex gap-1.5">
                {ENERGY_LABELS.map((e) => (
                  <button
                    key={e.value}
                    type="button"
                    aria-pressed={b.energy === e.value}
                    onClick={() => patch(i, { energy: e.value })}
                    className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${
                      b.energy === e.value
                        ? "bg-emerald-500/20 text-emerald-300"
                        : "bg-white/[0.06] text-white/50"
                    }`}
                  >
                    {e.label}
                  </button>
                ))}
              </div>

              {sports.length > 1 && (
                <div className="flex gap-1.5">
                  {sports.map((s) => {
                    const on = b.sports == null || b.sports.includes(s);
                    return (
                      <button
                        key={s}
                        type="button"
                        aria-pressed={on}
                        onClick={() => {
                          const current = b.sports ?? sports;
                          const next = on
                            ? current.filter((x) => x !== s)
                            : [...current, s];
                          patch(i, {
                            sports: next.length === sports.length ? null : next,
                          });
                        }}
                        className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${
                          on ? "bg-white/[0.14] text-white" : "bg-white/[0.04] text-white/40"
                        }`}
                      >
                        {s}
                      </button>
                    );
                  })}
                </div>
              )}
            </li>
          ))}
        </ul>

        {error && <p className="mb-3 text-[11px] text-red-400">{error}</p>}

        <button
          type="button"
          onClick={() => commit([...blocks, { ...NEW_BLOCK }])}
          className="flex w-full items-center justify-center gap-1.5 rounded-2xl border border-white/10 py-2.5 text-[12px] font-bold text-white/70"
        >
          <Plus aria-hidden className="size-3.5" />
          Add a block
        </button>
      </div>
    </>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/plan/block-sheet.test.tsx`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/components/plan/block-sheet.tsx src/components/plan/block-sheet.test.tsx
git add src/components/plan/block-sheet.tsx src/components/plan/block-sheet.test.tsx
git commit -m "feat(plan): block editor with clock window, energy level and sport"
```

---

### Task 14: The standard week screen

**Files:**
- Create: `src/components/plan/standard-week.tsx`
- Test: `src/components/plan/standard-week.test.tsx`
- Modify: `src/app/train/page.tsx` (render it in the Week tab, under a `Collapsible`)

**Interfaces:**
- Consumes: `BlockSheet` (Task 13), `setStandardWeekDay` (Task 12), `formatBlocks` (Task 9).
- Produces: `<StandardWeek defaults sports />` where `defaults: AvailabilityBlock[][]` is Monday-first, seven entries.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/plan/standard-week.test.tsx
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { StandardWeek } from "./standard-week";

const empty = Array.from({ length: 7 }, () => []);

describe("StandardWeek", () => {
  it("lists all seven weekdays", () => {
    const html = renderToString(<StandardWeek defaults={empty} sports={["Bike"]} />);
    for (const d of ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]) {
      expect(html).toContain(d);
    }
  });

  it("shows a rest day for a weekday with no blocks", () => {
    const html = renderToString(<StandardWeek defaults={empty} sports={["Bike"]} />);
    expect(html).toContain("Rest");
  });

  it("shows both blocks on a two-block weekday", () => {
    const defaults = empty.map((d, i) =>
      i === 2
        ? [
            { start: "06:30", end: "07:15", mins: 45, energy: "easy" as const, sports: null },
            { start: "19:00", end: "20:00", mins: 60, energy: "full" as const, sports: null },
          ]
        : d
    );
    const html = renderToString(<StandardWeek defaults={defaults} sports={["Bike"]} />);
    expect(html).toContain("06:30");
    expect(html).toContain("19:00");
  });

  it("totals the standard week", () => {
    const defaults = empty.map((d, i) =>
      i === 5 ? [{ start: "09:00", end: "12:00", mins: 180, energy: "full" as const, sports: null }] : d
    );
    const html = renderToString(<StandardWeek defaults={defaults} sports={["Bike"]} />);
    expect(html).toContain("3h");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/plan/standard-week.test.tsx`
Expected: FAIL — `Failed to resolve import "./standard-week"`.

- [ ] **Step 3: Write the component**

```tsx
"use client";

// src/components/plan/standard-week.tsx
import { useState, useTransition } from "react";
import { blockMins, type AvailabilityBlock } from "@/lib/availability/types";
import { formatAvailability, formatBlocks } from "@/lib/availability/format";
import { setStandardWeekDay } from "@/app/plan/actions";
import { BlockSheet } from "./block-sheet";

const DAY_NAMES = [
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
];

interface Props {
  /** Monday-first, seven entries. */
  defaults: AvailabilityBlock[][];
  sports: string[];
}

export function StandardWeek({ defaults, sports }: Props) {
  const [week, setWeek] = useState(defaults);
  const [open, setOpen] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const total = week.reduce(
    (s, day) => s + day.reduce((d, b) => d + blockMins(b), 0),
    0
  );

  function save(weekday: number, blocks: AvailabilityBlock[]) {
    setWeek((prev) => prev.map((d, i) => (i === weekday ? blocks : d)));
    startTransition(async () => {
      const r = await setStandardWeekDay(weekday, blocks);
      setError(r.ok ? null : r.error);
    });
  }

  return (
    <div className="glass rounded-[2rem] p-6">
      <p className="label-micro mb-1">Your standard week</p>
      <p className="mb-5 text-[12px] text-white/50">
        The time you normally have. Any single day you change from the week
        view overrides this — and keeps overriding it.
      </p>

      <ul className="mb-4">
        {DAY_NAMES.map((name, i) => (
          <li key={name} className="border-b border-white/[0.06] last:border-0">
            <button
              type="button"
              onClick={() => setOpen(i)}
              disabled={pending}
              className="flex w-full items-center justify-between py-3 text-left disabled:opacity-50"
            >
              <span className="text-[12.5px] font-bold text-white/85">{name}</span>
              <span className="text-[11.5px] text-white/50">{formatBlocks(week[i])}</span>
            </button>
          </li>
        ))}
      </ul>

      <p className="text-center text-[11px] text-white/40">
        {formatAvailability(total)} in a standard week
      </p>
      {error && <p className="mt-2 text-center text-[11px] text-red-400">{error}</p>}

      {open !== null && (
        <BlockSheet
          dayLabel={DAY_NAMES[open]}
          blocks={week[open]}
          sports={sports}
          onChange={(next) => save(open, next)}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Wire it into the Week tab**

In `src/app/train/page.tsx`, inside `WeekTab`, load the defaults alongside
the existing queries:

```ts
  const defaultRows = await db.query.availabilityDefaults.findMany({
    where: eq(schema.availabilityDefaults.userId, userId),
  });
  const standardWeek: AvailabilityBlock[][] = Array.from({ length: 7 }, (_, i) =>
    (defaultRows.find((r) => r.weekday === i)?.blocks as AvailabilityBlock[]) ?? []
  );
```

and render it below the intake section:

```tsx
          <div className="mb-6">
            <Collapsible>
              <CollapsibleTrigger className="rounded-[18px] p-4">
                <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-white/60">
                  Standard week
                </span>
              </CollapsibleTrigger>
              <CollapsiblePanel>
                <div className="px-1 pb-1 pt-3">
                  <StandardWeek
                    defaults={standardWeek}
                    sports={constraints.sports ?? ["Bike"]}
                  />
                </div>
              </CollapsiblePanel>
            </Collapsible>
          </div>
```

- [ ] **Step 5: Run tests and the type checker**

Run: `npx vitest run src/components/plan/standard-week.test.tsx && npm run typecheck`
Expected: PASS — 4 tests; typecheck clean.

- [ ] **Step 6: Commit**

```bash
npx prettier --write src/components/plan/standard-week.tsx src/components/plan/standard-week.test.tsx src/app/train/page.tsx
git add src/components/plan/standard-week.tsx src/components/plan/standard-week.test.tsx src/app/train/page.tsx
git commit -m "feat(plan): a standard week you set once"
```

---

### Task 15: Week view — resolved blocks, override badge, warning

**Files:**
- Modify: `src/components/plan/intake-form.tsx`
- Modify: `src/components/plan/intake-form.test.tsx`
- Modify: `src/app/train/page.tsx` (feed resolved blocks, override dates, and the verdict)

**Interfaces:**
- Consumes: `BlockSheet` (Task 13), `clearDayOverride` (Task 12), `availabilityVerdict` (Task 11), `resolveWeek` (Task 9).
- Produces: `<IntakeForm resolved overrideDates verdict sports action />` where `resolved: AvailabilityBlock[][]`, `overrideDates: string[]`, `verdict: Verdict`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/plan/intake-form.test.tsx  (replace the file's body)
import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { IntakeForm } from "./intake-form";

const resolved = Array.from({ length: 7 }, (_, i) =>
  i === 2 ? [{ start: "18:00", end: "19:30", mins: 90, energy: "normal" as const, sports: null }] : []
);
const noop = vi.fn();

describe("IntakeForm", () => {
  it("carries each day's blocks into the form as JSON", () => {
    const html = renderToString(
      <IntakeForm resolved={resolved} overrideDates={[]} dates={[]}
        verdict={{ kind: "ok" }} sports={["Bike"]} action={noop} />
    );
    expect(html).toContain('name="blocks-2"');
  });

  it("badges a day that is pinned by an override", () => {
    const dates = ["2026-08-03","2026-08-04","2026-08-05","2026-08-06","2026-08-07","2026-08-08","2026-08-09"];
    const html = renderToString(
      <IntakeForm resolved={resolved} overrideDates={["2026-08-05"]} dates={dates}
        verdict={{ kind: "ok" }} sports={["Bike"]} action={noop} />
    );
    expect(html).toContain("Pinned");
  });

  it("shows the weekly total", () => {
    const html = renderToString(
      <IntakeForm resolved={resolved} overrideDates={[]} dates={[]}
        verdict={{ kind: "ok" }} sports={["Bike"]} action={noop} />
    );
    expect(html).toContain("1h 30m this week");
  });

  it("warns when the time given cannot hold fitness", () => {
    const html = renderToString(
      <IntakeForm resolved={resolved} overrideDates={[]} dates={[]}
        verdict={{ kind: "losing", maintenanceHrs: 6, projectedCtl: 57 }}
        sports={["Bike"]} action={noop} />
    );
    expect(html).toContain("6h");
    expect(html).toContain("57");
  });

  it("says nothing at all when the verdict is silent", () => {
    const html = renderToString(
      <IntakeForm resolved={resolved} overrideDates={[]} dates={[]}
        verdict={{ kind: "silent" }} sports={["Bike"]} action={noop} />
    );
    expect(html).not.toContain("hold your fitness");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/plan/intake-form.test.tsx`
Expected: FAIL — `IntakeForm` does not accept `resolved`.

- [ ] **Step 3: Rewrite the component**

```tsx
"use client";

// src/components/plan/intake-form.tsx
import { useActionState, useState, useTransition } from "react";
import { blockMins, type AvailabilityBlock } from "@/lib/availability/types";
import { formatAvailability, formatBlocks } from "@/lib/availability/format";
import type { Verdict } from "@/lib/week-plan/ctl-projection";
import { clearDayOverride } from "@/app/plan/actions";
import { BlockSheet } from "./block-sheet";

export interface IntakeState {
  message: string;
}

interface Props {
  /** Resolved blocks per day, Monday first. */
  resolved: AvailabilityBlock[][];
  /** The dates of this week, Monday first. */
  dates: string[];
  /** Which of those dates are pinned by an override. */
  overrideDates: string[];
  verdict: Verdict;
  sports: string[];
  action: (prev: IntakeState, formData: FormData) => Promise<IntakeState>;
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_NAMES = [
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
];

function verdictLine(v: Verdict): string | null {
  if (v.kind === "losing") {
    return `That's under the ${formatAvailability(Math.round(v.maintenanceHrs * 60))} it takes to hold your fitness — CTL is projected to fall to about ${Math.round(v.projectedCtl)} this week.`;
  }
  if (v.kind === "holding") {
    return `Enough to hold your fitness, not to build it — this week's plan asks for about ${formatAvailability(Math.round(v.targetHrs * 60))}.`;
  }
  return null;
}

export function IntakeForm({
  resolved, dates, overrideDates, verdict, sports, action,
}: Props) {
  const [state, formAction, pending] = useActionState(action, { message: "" });
  const [week, setWeek] = useState(resolved);
  const [openDay, setOpenDay] = useState<number | null>(null);
  const [, startTransition] = useTransition();

  const totalMins = week.reduce(
    (s, day) => s + day.reduce((d, b) => d + blockMins(b), 0),
    0
  );
  const warning = verdictLine(verdict);

  function unpin(i: number) {
    startTransition(async () => {
      await clearDayOverride(dates[i]);
    });
  }

  return (
    <form action={formAction} className="glass rounded-[2rem] p-7">
      <p className="label-micro mb-1">This week&apos;s availability</p>
      <p className="mb-5 text-[12px] text-white/50">
        When you can train — the week plans itself around these blocks.
      </p>

      <ul className="mb-3">
        {week.map((blocks, i) => {
          const pinned = overrideDates.includes(dates[i] ?? "");
          return (
            <li key={DAY_LABELS[i]} className="border-b border-white/[0.06] last:border-0">
              <div className="flex items-center gap-3 py-2.5">
                <button
                  type="button"
                  onClick={() => setOpenDay(i)}
                  className="flex flex-1 items-center justify-between text-left"
                >
                  <span className="text-[11px] font-bold uppercase tracking-wider text-white/45">
                    {DAY_LABELS[i]}
                  </span>
                  <span className="text-[11.5px] text-white/70">{formatBlocks(blocks)}</span>
                </button>
                {pinned && (
                  <button
                    type="button"
                    onClick={() => unpin(i)}
                    title="Back to your standard week"
                    className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[9.5px] font-bold text-amber-300"
                  >
                    Pinned ×
                  </button>
                )}
              </div>
              <input type="hidden" name={`blocks-${i}`} value={JSON.stringify(blocks)} />
            </li>
          );
        })}
      </ul>

      <p className="mb-2 text-center text-[11px] text-white/40">
        {formatAvailability(totalMins)} this week
      </p>
      {warning && (
        <p className="mb-5 text-center text-[11px] leading-relaxed text-amber-300/80">
          {warning}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-2xl bg-emerald-500/90 py-3 text-sm font-bold text-neutral-950 transition-opacity disabled:opacity-50"
      >
        Confirm week
      </button>
      {state.message !== "" && (
        <p className="mt-3 text-center text-[12px] text-white/60">{state.message}</p>
      )}

      {openDay !== null && (
        <BlockSheet
          dayLabel={DAY_NAMES[openDay]}
          blocks={week[openDay]}
          sports={sports}
          onChange={(next) =>
            setWeek((prev) => prev.map((d, j) => (j === openDay ? next : d)))
          }
          onClose={() => setOpenDay(null)}
        />
      )}
    </form>
  );
}
```

- [ ] **Step 4: Feed it from the page**

In `src/app/train/page.tsx`, replace the `intake` block (`:264-302`):

```ts
  let intake: {
    resolved: AvailabilityBlock[][];
    dates: string[];
    overrideDates: string[];
    verdict: Verdict;
  } | null = null;
  if (week && week.days[0]?.status !== "completed") {
    const dates = week.days.map((d) => d.date);
    const resolvedMap = await resolveWeek(userId, dates);
    const overrides = await db.query.availabilityOverrides.findMany({
      where: and(
        eq(schema.availabilityOverrides.userId, userId),
        inArray(schema.availabilityOverrides.date, dates)
      ),
    });

    // Load per hour over the last 28 days, from real sessions only.
    const since = new Date();
    since.setDate(since.getDate() - 28);
    const recent = await db.query.activities.findMany({
      where: and(
        eq(schema.activities.userId, userId),
        ne(schema.activities.provider, "strava"),
        gte(schema.activities.startDate, since)
      ),
    });
    const hours = recent.reduce((s, a) => s + (a.durationS ?? 0) / 3600, 0);
    const load = recent.reduce((s, a) => s + (a.load ?? 0), 0);
    const loadPerHour = hours > 0 ? load / hours : null;

    // The real span of history, not "any activity means 28 days". An
    // athlete who synced their first ride yesterday must not be told what
    // their CTL will do.
    const oldest = recent.reduce<Date | null>((min, a) => {
      const d = a.startDateLocal ?? a.startDate;
      return min == null || d < min ? d : min;
    }, null);
    const historyDays =
      oldest == null
        ? 0
        : Math.floor((Date.now() - oldest.getTime()) / 86_400_000);

    const offeredMins = dates.reduce(
      (s, d) => s + (resolvedMap.get(d) ?? []).reduce((x, b) => x + blockMins(b), 0),
      0
    );

    intake = {
      resolved: dates.map((d) => resolvedMap.get(d) ?? []),
      dates,
      overrideDates: overrides.map((o) => o.date),
      verdict: availabilityVerdict({
        offeredMins,
        currentCtl: latestMetric?.ctl ?? null,
        loadPerHour,
        historyDays,
        effectiveTarget: week.effectiveTarget ?? 0,
      }),
    };
  }
```

and render:

```tsx
              <IntakeForm
                resolved={intake.resolved}
                dates={intake.dates}
                overrideDates={intake.overrideDates}
                verdict={intake.verdict}
                sports={constraints.sports ?? ["Bike"]}
                action={submitAvailability}
              />
```

The Google Calendar block above stays where it is — it keeps lowering the
*suggestion*, never what is stored.

- [ ] **Step 5: Run tests and the type checker**

Run: `npx vitest run src/components/plan/intake-form.test.tsx && npm run typecheck`
Expected: PASS — 5 tests; typecheck clean.

- [ ] **Step 6: Commit**

```bash
npx prettier --write src/components/plan/intake-form.tsx src/components/plan/intake-form.test.tsx src/app/train/page.tsx
git add src/components/plan/intake-form.tsx src/components/plan/intake-form.test.tsx src/app/train/page.tsx
git commit -m "feat(plan): week view shows resolved blocks, pinned days and an honest time warning"
```

---

### Task 16: "Set this day to zero"

**Files:**
- Modify: `src/components/plan/day-actions.tsx`
- Modify: `src/components/plan/day-actions.test.tsx`

**Interfaces:**
- Consumes: `zeroDay` (Task 12).
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/plan/day-actions.test.tsx  (append)
import { renderToString } from "react-dom/server";
import { DayActions } from "./day-actions";

describe("DayActions — zero the day", () => {
  it("offers the reset next to move, swap and skip", () => {
    const html = renderToString(
      <DayActions
        day={{ date: "2026-08-05", workoutCount: 1 }}
        otherDays={[{ date: "2026-08-06", workoutCount: 0, isRace: false }]}
      />
    );
    expect(html).toContain("No time today");
  });

  it("renders nothing for a day with no session", () => {
    const html = renderToString(
      <DayActions day={{ date: "2026-08-05", workoutCount: 0 }} otherDays={[]} />
    );
    expect(html).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/plan/day-actions.test.tsx -t "zero the day"`
Expected: FAIL — "No time today" not found.

- [ ] **Step 3: Add the control**

In `src/components/plan/day-actions.tsx`, import the action and add state:

```tsx
import { applyPlanChange, previewPlanChange, zeroDay } from "@/app/plan/actions";
```

Add the button to the default (non-preview) branch, after the "What if?"
button:

```tsx
          {/* Pins this date to zero — an override, so it survives any later
              change to the standard week (that is the whole point). */}
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const r = await zeroDay(day.date);
                if (!r.ok) setError(friendlyPlanError(r.error));
              })
            }
            className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-bold text-white/60 disabled:opacity-40"
          >
            No time today
          </button>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/plan/day-actions.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/components/plan/day-actions.tsx src/components/plan/day-actions.test.tsx
git add src/components/plan/day-actions.tsx src/components/plan/day-actions.test.tsx
git commit -m "feat(plan): zero a day straight from its action menu"
```

---

### Task 17: The weekly prompt

**Files:**
- Modify: `src/lib/sync/scheduler.ts` (the weekly-review slot)
- Create: `src/lib/week-plan/availability-prompt.ts`
- Test: `src/lib/week-plan/availability-prompt.test.ts`

**Interfaces:**
- Consumes: `weekPlans.availabilityConfirmedAt` (Task 3), `sendPush` from `src/lib/push.ts`.
- Produces: `shouldPromptAvailability(input: { confirmedAt: Date | null; weekStart: string; today: string }): boolean`, `promptAvailability(userId: string, now?: Date): Promise<"sent" | "skipped">`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/week-plan/availability-prompt.test.ts
import { describe, expect, it } from "vitest";
import { shouldPromptAvailability } from "./availability-prompt";

describe("shouldPromptAvailability", () => {
  it("prompts an unconfirmed open week", () => {
    expect(
      shouldPromptAvailability({
        confirmedAt: null, weekStart: "2026-08-03", today: "2026-08-03",
      })
    ).toBe(true);
  });

  it("stays quiet once the week is confirmed, changed or not", () => {
    expect(
      shouldPromptAvailability({
        confirmedAt: new Date("2026-08-03T08:00:00Z"),
        weekStart: "2026-08-03", today: "2026-08-04",
      })
    ).toBe(false);
  });

  it("prompts again when the confirmation belongs to an earlier week", () => {
    expect(
      shouldPromptAvailability({
        confirmedAt: new Date("2026-07-27T08:00:00Z"),
        weekStart: "2026-08-03", today: "2026-08-03",
      })
    ).toBe(true);
  });

  it("stops prompting once the week is more than half gone", () => {
    expect(
      shouldPromptAvailability({
        confirmedAt: null, weekStart: "2026-08-03", today: "2026-08-08",
      })
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/week-plan/availability-prompt.test.ts`
Expected: FAIL — `Failed to resolve import "./availability-prompt"`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/week-plan/availability-prompt.ts
/** Past this many days into the week, nagging is worse than silence. */
const PROMPT_WINDOW_DAYS = 4;

function daysBetween(from: string, to: string): number {
  return Math.round(
    (new Date(to + "T00:00:00").getTime() - new Date(from + "T00:00:00").getTime()) /
      86_400_000
  );
}

/**
 * Pure. A confirmation counts only when it was made during the week it
 * confirms — last week's tick must not silence this week.
 */
export function shouldPromptAvailability(input: {
  confirmedAt: Date | null;
  weekStart: string;
  today: string;
}): boolean {
  const age = daysBetween(input.weekStart, input.today);
  if (age < 0 || age > PROMPT_WINDOW_DAYS) return false;
  if (input.confirmedAt == null) return true;
  const confirmedYmd = input.confirmedAt.toISOString().slice(0, 10);
  return confirmedYmd < input.weekStart;
}
```

Then the DB-facing half in the same file:

```ts
import { getOpenWeekPlan } from "./service";
import { sendPush } from "@/lib/push";

export async function promptAvailability(
  userId: string,
  now = new Date()
): Promise<"sent" | "skipped"> {
  const week = await getOpenWeekPlan(userId);
  if (!week) return "skipped";
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  if (
    !shouldPromptAvailability({
      confirmedAt: week.availabilityConfirmedAt ?? null,
      weekStart: week.weekStart,
      today,
    })
  ) {
    return "skipped";
  }
  await sendPush(userId, {
    title: "How's your week looking?",
    body: "Confirm your training time so this week plans itself around it.",
    url: "/train",
  });
  return "sent";
}
```

`getOpenWeekPlan` must return the new column — add
`availabilityConfirmedAt: row.availabilityConfirmedAt` to its return object
and to the `OpenWeekPlan` interface in `src/lib/week-plan/service.ts`.

In `src/lib/sync/scheduler.ts`, call `promptAvailability(userId)` directly
after the existing `generateWeeklyReview` call, inside the same guard, and
log failures the same way the review does.

**Before writing the `sendPush` call, open `src/lib/push.ts` and read its
exported signature.** The call above is a sketch of intent, not a verified
signature — match the real one (argument order, payload shape, and whether
it takes a subscription or a user id) rather than trusting it.

- [ ] **Step 4: Run tests and the type checker**

Run: `npx vitest run src/lib/week-plan/availability-prompt.test.ts && npm run typecheck`
Expected: PASS — 4 tests; typecheck clean.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/lib/week-plan/availability-prompt.ts src/lib/week-plan/availability-prompt.test.ts src/lib/sync/scheduler.ts src/lib/week-plan/service.ts
git add src/lib/week-plan/availability-prompt.ts src/lib/week-plan/availability-prompt.test.ts src/lib/sync/scheduler.ts src/lib/week-plan/service.ts
git commit -m "feat(week-plan): one prompt a week to keep availability current"
```

---

### Task 18: Coach tools

**Files:**
- Modify: `src/lib/tools/set-week-availability.ts`
- Create: `src/lib/tools/set-standard-week.ts`, `src/lib/tools/clear-availability-override.ts`
- Modify: `src/lib/tools/registry.ts`, `src/lib/tools/get-week-plan.ts`
- Modify: `src/lib/tools/registry.test.ts`

**Interfaces:**
- Consumes: `applyAvailability` (Task 9), `setStandardWeekDay` equivalent logic (Task 12).
- Produces: tools `set_week_availability` (blocks or legacy integers), `set_standard_week`, `clear_availability_override`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/tools/registry.test.ts  (append)
import { setWeekAvailabilityTool } from "./set-week-availability";

describe("set_week_availability", () => {
  it("still accepts seven plain integers", () => {
    const parsed = setWeekAvailabilityTool.parameters.parse({
      availableMins: [0, 60, 90, 0, 60, 180, 120],
    });
    expect(parsed.availableMins).toHaveLength(7);
  });

  it("accepts blocks per day", () => {
    const parsed = setWeekAvailabilityTool.parameters.parse({
      availableBlocks: [
        [], [{ start: "18:00", end: "19:00", mins: 60, energy: "normal", sports: null }],
        [], [], [], [], [],
      ],
    });
    expect(parsed.availableBlocks?.[1][0].mins).toBe(60);
  });

  it("rejects a week that is not seven days long", () => {
    expect(() =>
      setWeekAvailabilityTool.parameters.parse({ availableMins: [60, 60] })
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/tools/registry.test.ts -t "set_week_availability"`
Expected: FAIL — `availableBlocks` is not a known key.

- [ ] **Step 3: Rewrite the tool**

```ts
// src/lib/tools/set-week-availability.ts
import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./registry";
import { applyAvailability, getOpenWeekPlan } from "@/lib/week-plan/service";
import type { AvailabilityBlock } from "@/lib/availability/types";

const blockSchema = z.object({
  start: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  end: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  mins: z.number().int().min(0).max(720),
  energy: z.enum(["easy", "normal", "full"]),
  sports: z.array(z.string()).nullable(),
});

const parameters = z
  .object({
    availableBlocks: z
      .array(z.array(blockSchema))
      .length(7)
      .optional()
      .describe("Time blocks per day, Monday first"),
    availableMins: z
      .array(z.number().int().min(0).max(720))
      .length(7)
      .optional()
      .describe("Legacy: total minutes per day, Monday first"),
  })
  .refine((v) => v.availableBlocks != null || v.availableMins != null, {
    message: "Provide availableBlocks or availableMins",
  });

/** A plain number becomes one untimed block — same meaning, new shape. */
function toBlocks(args: z.infer<typeof parameters>): AvailabilityBlock[][] {
  if (args.availableBlocks) return args.availableBlocks as AvailabilityBlock[][];
  return (args.availableMins ?? []).map((mins) =>
    mins > 0
      ? [{ start: null, end: null, mins, energy: "normal" as const, sports: null }]
      : []
  );
}

async function execute(args: z.infer<typeof parameters>, ctx: ToolContext) {
  const result = await applyAvailability(ctx.userId, toBlocks(args));
  if (result !== "applied") return { applied: false, reason: result };
  const week = await getOpenWeekPlan(ctx.userId);
  return {
    applied: true,
    week: week
      ? {
          weekStart: week.weekStart,
          days: week.days.map((d) => ({
            date: d.date,
            availableBlocks: d.availableBlocks,
            workouts: d.workouts,
            status: d.status,
          })),
        }
      : null,
  };
}

export const setWeekAvailabilityTool: ToolDefinition<typeof parameters> = {
  name: "set_week_availability",
  description:
    "Update the athlete's availability for the current week as time blocks (or legacy minutes per day). Displaced sessions move, shorten, or are substituted — the rest of the week stays put.",
  parameters,
  scope: "write:plan",
  execute,
};
```

Then the two new tools. Server actions cannot be called from a tool, so
these talk to the database directly:

```ts
// src/lib/tools/set-standard-week.ts
import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./registry";
import { db, schema } from "@/lib/db";
import { validateBlocks, type AvailabilityBlock } from "@/lib/availability/types";

const blockSchema = z.object({
  start: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  end: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  mins: z.number().int().min(0).max(720),
  energy: z.enum(["easy", "normal", "full"]),
  sports: z.array(z.string()).nullable(),
});

const parameters = z.object({
  weekday: z.number().int().min(0).max(6).describe("0 = Monday"),
  blocks: z.array(blockSchema).describe("Time blocks; an empty list means a rest day"),
});

async function execute(args: z.infer<typeof parameters>, ctx: ToolContext) {
  const blocks = args.blocks as AvailabilityBlock[];
  const invalid = validateBlocks(blocks);
  if (invalid) return { applied: false, reason: invalid };

  await db
    .insert(schema.availabilityDefaults)
    .values({ userId: ctx.userId, weekday: args.weekday, blocks })
    .onConflictDoUpdate({
      target: [schema.availabilityDefaults.userId, schema.availabilityDefaults.weekday],
      set: { blocks, updatedAt: new Date() },
    });
  return { applied: true, weekday: args.weekday, blocks };
}

export const setStandardWeekTool: ToolDefinition<typeof parameters> = {
  name: "set_standard_week",
  description:
    "Set one weekday of the athlete's standard weekly availability. Dates the athlete has already pinned keep their pinned value — this only changes weekdays that follow the default.",
  parameters,
  scope: "write:plan",
  execute,
};
```

```ts
// src/lib/tools/clear-availability-override.ts
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import type { ToolDefinition, ToolContext } from "./registry";
import { db, schema } from "@/lib/db";

const parameters = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("YYYY-MM-DD"),
});

async function execute(args: z.infer<typeof parameters>, ctx: ToolContext) {
  const deleted = await db
    .delete(schema.availabilityOverrides)
    .where(
      and(
        eq(schema.availabilityOverrides.userId, ctx.userId),
        eq(schema.availabilityOverrides.date, args.date)
      )
    )
    .returning();
  return { cleared: deleted.length > 0, date: args.date };
}

export const clearAvailabilityOverrideTool: ToolDefinition<typeof parameters> = {
  name: "clear_availability_override",
  description:
    "Remove the athlete's pinned availability for one date, so that date follows the standard week again.",
  parameters,
  scope: "write:plan",
  execute,
};
```

Register both in `src/lib/tools/registry.ts` beside the existing
`setWeekAvailabilityTool` import, following the file's established pattern
for adding a tool to the exported list.

Update `get-week-plan.ts` so each returned day carries `workouts` (plural)
and `availableBlocks` in place of `workout` and `availableMins`.

- [ ] **Step 4: Run tests and the type checker**

Run: `npx vitest run src/lib/tools/registry.test.ts && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/lib/tools
git add src/lib/tools
git commit -m "feat(tools): coach can set the standard week and pin or clear a date"
```

---

### Task 19: Full verification and changelog

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `docs/ROADMAP.md` (mark the item done, if it is listed)

**Interfaces:**
- Consumes: everything.
- Produces: a merge-ready branch.

- [ ] **Step 1: Run the full gate**

Run: `npm run typecheck && npm run lint && npx vitest run && npm run format:check`
Expected: all four clean. Fix anything that is not before continuing — do
not report completion on a partial pass.

- [ ] **Step 2: Run the app and click the flow**

Run: `npm run dev`

Then check by hand, because these are the behaviours the whole plan exists
for and no unit test proves them end to end:

1. Set a standard week with two blocks on one weekday. Confirm the week.
2. Change that single date's availability. Confirm the week again.
3. Go back to the standard week and change that same weekday's default.
4. Reload `/train`: the pinned date must still show the pinned value, and
   every *other* instance of that weekday must show the new default.
5. Zero a day that holds a session. The session must move to a day that
   fits it whole, and no other day may change.

- [ ] **Step 3: Write the changelog entry**

Add under a new version heading in `CHANGELOG.md`:

```markdown
### Changed

- Availability is now a standard week of time blocks plus date overrides
  that always beat the default and survive later changes to it. A one-off
  change is a one-off again — it no longer becomes next week's default.
- Sessions are placed into a single block rather than a day's total, so
  45 minutes before work and an hour in the evening are two opportunities,
  not one 105-minute one. Two blocks can carry two sessions.
- Each block carries an expected energy level and an optional sport, both
  of which constrain what may be scheduled in it.
- Changing availability no longer regenerates the week. Only displaced
  sessions move, along a fixed ladder: move, shorten within the same
  purpose, substitute a session that works at that length, drop.
- A session is never truncated below the point where it stops delivering
  its stimulus.
- Unplanned work counts toward the week's actuals but never removes a
  planned session.

### Added

- One prompt a week to confirm your training time, with a warning — from
  your own CTL — when the time given cannot hold your fitness. Silent
  until there are 28 days of history behind it.
- "No time today" on a day's action menu pins that date to zero.
```

- [ ] **Step 4: Commit**

```bash
npx prettier --write CHANGELOG.md docs/ROADMAP.md
git add CHANGELOG.md docs/ROADMAP.md
git commit -m "docs(changelog): availability and scheduling redesign"
```

- [ ] **Step 5: Hand off**

Do not tag or release — see `docs/RELEASING.md`; the tag comes after merge.
Open a pull request from `feat/availability-scheduling-redesign`.
