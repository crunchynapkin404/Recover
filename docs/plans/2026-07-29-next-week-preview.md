# Next-Week Preview & Availability Horizon — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the athlete see next week's sessions and enter next week's availability, so the planning horizon no longer collapses to zero every Sunday.

**Architecture:** Next week is **computed on render, never stored**. `computeWeekRepair` already projects a whole week without persisting it; generalise it to `projectWeek(userId, weekStart, now)` and let the repair script and the preview share that one derivation. Availability is already date-generic in the database and in `resolveWeek`; the only week-scoping is `syncDateOverrides`, which gains an explicit target week.

**Tech Stack:** TypeScript, Next.js 16 (App Router, RSC), Drizzle + Postgres, Vitest, Tailwind v4.

**Spec:** `docs/specs/2026-07-29-next-week-preview-design.md`

## Global Constraints

- **The gate is all five, in this order:** `npm run format:check && npm run typecheck && npm run lint && npm test && npm run build`. Two consecutive releases each dropped a different member and each omission broke `main`. `docs/ROADMAP.md` needs **two** `prettier --write` passes to converge.
- **Never persist a projected week.** No `week_plans` row is created for a future week, ever. A second open row breaks `getOpenWeekPlan`'s single-open-week assumption, the rollover's idempotency and adherence.
- **Rendering must never trigger adaptation or replan** as a side effect.
- **Availability is a ceiling, never a target.**
- **The weekly panels stay weekly.** `WeekRationale`, adherence and the weekly review describe a closing Monday–Sunday week's arithmetic. No task in this plan changes them, and none should — the rolling list is a _schedule_, those panels are _accounting_.
- `@testing-library/react` is **NOT installed** — only `jsdom`. Never import `render`, `screen`, `userEvent`, or jest-dom matchers. Stateless components use `renderToString`; interactive ones use hand-rolled `react-dom/client` + `act()` (see `tests/journal-form.test.tsx`).
- New Vitest files touching `@/lib/db` must open with the repo's `describe.skipIf(!hasDb)` guard. **CI never sets `DATABASE_URL`**, so those skip there — put every assertion that can live in a pure test in a pure test.
- Dates are `YYYY-MM-DD` strings. Parse as **local midnight**: `new Date(ymd + "T00:00:00")`. A bare `new Date(ymd)` is UTC and has already shipped one live bug in this repo.
- `src/app/**/actions.ts` are `"use server"`: every export must be an async function, and only `npm run build` catches a violation.
- **If a numeric expectation does not hold, STOP and report** rather than loosening the test. Across the last two releases this fired a dozen-plus times and the plan was wrong every time.

## File Structure

| File                                                 | Responsibility                                                       |
| ---------------------------------------------------- | -------------------------------------------------------------------- |
| `src/lib/week-plan/project.ts`                       | **new** — `projectWeek`, the single week-derivation primitive        |
| `src/lib/week-plan/repair.ts`                        | `computeWeekRepair` becomes a thin caller of `projectWeek`           |
| `src/lib/availability/sync-overrides.ts`             | `syncDateOverrides` gains an explicit target week                    |
| `src/app/plan/actions.ts`                            | `submitAvailability` gains a target week; future weeks do not replan |
| `src/components/plan/availability-week-switcher.tsx` | **new** — the "this week / next week" control                        |
| `src/components/train/week-day-list.tsx`             | renders a rolling window with a week boundary                        |
| `src/app/train/page.tsx`                             | wires the projection and the switcher                                |

---

### Task 1: `syncDateOverrides` takes an explicit target week

**Files:**

- Modify: `src/lib/availability/sync-overrides.ts:73-120`
- Test: `tests/sync-overrides-week.test.ts` (new, DB-gated)

**Interfaces:**

- Produces: `syncDateOverrides(userId: string, blocksPerDay: AvailabilityBlock[][], weekStart?: string): Promise<void>` — `weekStart` omitted keeps today's behaviour exactly (the open week).

**Why:** this is the only place availability writes are week-scoped. `availability_overrides` is keyed by date, `availability_defaults` by weekday, and `resolveWeek(userId, dates)` takes arbitrary dates — all three already work for any week.

- [ ] **Step 1: Write the failing test**

Create `tests/sync-overrides-week.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";
const USER = "test-sync-overrides-week-user";

function blk(mins: number) {
  return {
    start: null,
    end: null,
    mins,
    energy: "full" as const,
    sports: null,
  };
}

describe.skipIf(!hasDb)("syncDateOverrides target week", () => {
  beforeAll(async () => {
    const { db, schema } = await import("@/lib/db");
    await db.delete(schema.users).where(eq(schema.users.id, USER));
    await db.insert(schema.users).values({
      id: USER,
      name: "SyncWeekUser",
      email: "sync-overrides-week@example.invalid",
      role: "member",
    });
  });
  afterAll(async () => {
    const { db, schema } = await import("@/lib/db");
    await db
      .delete(schema.availabilityOverrides)
      .where(eq(schema.availabilityOverrides.userId, USER));
    await db.delete(schema.users).where(eq(schema.users.id, USER));
  });

  it("writes overrides for a week with no week_plans row at all", async () => {
    const { syncDateOverrides } =
      await import("@/lib/availability/sync-overrides");
    const { db, schema } = await import("@/lib/db");

    // A Monday far enough out that no stored week could exist for it.
    const weekStart = "2027-03-01";
    const blocks = Array.from({ length: 7 }, (_, i) =>
      i === 2 ? [blk(120)] : []
    );

    await syncDateOverrides(USER, blocks, weekStart);

    const rows = await db.query.availabilityOverrides.findMany({
      where: and(
        eq(schema.availabilityOverrides.userId, USER),
        eq(schema.availabilityOverrides.date, "2027-03-03")
      ),
    });
    expect(rows).toHaveLength(1);
    expect((rows[0].blocks as { mins: number }[])[0].mins).toBe(120);
  });

  it("is a no-op for a future week when no open week exists and none is named", async () => {
    // Omitting weekStart must keep the old behaviour: scoped to the open
    // week, and this user has none.
    const { syncDateOverrides } =
      await import("@/lib/availability/sync-overrides");
    const { db, schema } = await import("@/lib/db");
    const before = await db.query.availabilityOverrides.findMany({
      where: eq(schema.availabilityOverrides.userId, USER),
    });
    await syncDateOverrides(
      USER,
      Array.from({ length: 7 }, () => [blk(60)])
    );
    const after = await db.query.availabilityOverrides.findMany({
      where: eq(schema.availabilityOverrides.userId, USER),
    });
    expect(after).toHaveLength(before.length);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
set -a; . ./.env; set +a
npx vitest run tests/sync-overrides-week.test.ts
```

Expected: the first case FAILS — `syncDateOverrides` takes no third argument and returns early because there is no open week.

- [ ] **Step 3: Implement**

Replace the opening of `syncDateOverrides`. It currently derives its seven dates from `getOpenWeekPlan(userId)`; it must derive them from `weekStart` when given one:

```ts
export async function syncDateOverrides(
  userId: string,
  blocksPerDay: AvailabilityBlock[][],
  weekStart?: string
): Promise<void> {
  // Which seven dates are we writing, and which of them may be skipped?
  //
  // With no `weekStart` this is the open week, exactly as before: its own
  // stored days, and completed/missed ones are left alone because their
  // availability is now historical fact.
  //
  // With a `weekStart` — a future week — there is no stored row and nothing
  // is settled, so all seven dates are writable. `availability_overrides` is
  // keyed by date and `resolveWeek` takes arbitrary dates, so nothing else
  // has to change for a week that does not exist yet.
  let dates: string[];
  let skippable: Set<string>;
  if (weekStart) {
    dates = Array.from({ length: 7 }, (_, i) => addDaysYmd(weekStart, i));
    skippable = new Set();
  } else {
    const week = await getOpenWeekPlan(userId);
    if (!week) return;
    dates = week.days.map((d) => d.date);
    skippable = new Set(
      week.days
        .filter((d) => d.status === "completed" || d.status === "missed")
        .map((d) => d.date)
    );
  }

  const defaults = await db.query.availabilityDefaults.findMany({
    where: eq(schema.availabilityDefaults.userId, userId),
  });
  const byWeekday = new Map<number, AvailabilityBlock[]>(
    defaults.map((d) => [d.weekday, d.blocks as AvailabilityBlock[]])
  );

  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    if (skippable.has(date)) continue;

    const submitted = blocksPerDay[i] ?? [];
    const standard = resolveDay(byWeekday.get(weekdayOf(date)) ?? [], null);

    if (blocksEqual(submitted, standard)) {
      await db
        .delete(schema.availabilityOverrides)
        .where(
          and(
            eq(schema.availabilityOverrides.userId, userId),
            eq(schema.availabilityOverrides.date, date)
          )
        );
    } else {
      await db
        .insert(schema.availabilityOverrides)
        .values({ userId, date, blocks: submitted })
        .onConflictDoUpdate({
          target: [
            schema.availabilityOverrides.userId,
            schema.availabilityOverrides.date,
          ],
          set: { blocks: submitted, updatedAt: new Date() },
        });
    }
  }
}
```

Import `addDaysYmd` from wherever `sync-overrides.ts`'s siblings get it — check the file's existing imports first; `src/lib/week-plan/service.ts` uses it, so it already exists in the codebase. Do not write a second date-adder.

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run tests/sync-overrides-week.test.ts src/lib/availability/
```

Expected: all pass, including every pre-existing availability test.

- [ ] **Step 5: Full gate and commit**

```bash
npx prettier --write src/lib/availability/sync-overrides.ts tests/sync-overrides-week.test.ts
npm run format:check && npm run typecheck && npm run lint && npm test && npm run build
git add -A
git commit -m "feat(availability): syncDateOverrides can target any week"
```

---

### Task 2: `submitAvailability` targets a week, and a future week never replans

**Files:**

- Modify: `src/app/plan/actions.ts` (`submitAvailability`)
- Test: `tests/submit-availability-week.test.ts` (new, DB-gated)

**Interfaces:**

- Consumes: `syncDateOverrides(userId, blocksPerDay, weekStart?)` from Task 1.
- Produces: `submitAvailability` reads an optional `weekStart` field from its `FormData`. Its `IntakeState` return shape is unchanged.

**The rule:** applying availability to the **current** week replans it, exactly as today. Applying it to a **future** week writes overrides and does nothing else — there is no materialised week to replan, and the projection simply recomputes on the next render.

- [ ] **Step 1: Write the failing test**

Create `tests/submit-availability-week.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";
const USER = "test-submit-availability-week-user";

vi.mock("@/lib/session", () => ({
  requireUser: async () => ({ id: USER, name: "SubmitWeekUser" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

function form(weekStart: string | null, mins: number): FormData {
  const fd = new FormData();
  for (let i = 0; i < 7; i++) {
    fd.set(`blocks-${i}`, i === 2 ? String(mins) : "");
  }
  if (weekStart) fd.set("weekStart", weekStart);
  return fd;
}

describe.skipIf(!hasDb)("submitAvailability target week", () => {
  it("writes a future week's overrides without touching any week_plans row", async () => {
    const { db, schema } = await import("@/lib/db");
    await db.delete(schema.users).where(eq(schema.users.id, USER));
    await db.insert(schema.users).values({
      id: USER,
      name: "SubmitWeekUser",
      email: "submit-availability-week@example.invalid",
      role: "member",
    });

    const before = await db.query.weekPlans.findMany({
      where: eq(schema.weekPlans.userId, USER),
    });

    const { submitAvailability } = await import("@/app/plan/actions");
    await submitAvailability({ message: "" }, form("2027-03-01", 120));

    const after = await db.query.weekPlans.findMany({
      where: eq(schema.weekPlans.userId, USER),
    });
    // The invariant that matters: projecting/entering a future week never
    // creates a week_plans row.
    expect(after).toHaveLength(before.length);

    const ov = await db.query.availabilityOverrides.findMany({
      where: eq(schema.availabilityOverrides.userId, USER),
    });
    expect(ov.some((o) => o.date === "2027-03-03")).toBe(true);

    await db
      .delete(schema.availabilityOverrides)
      .where(eq(schema.availabilityOverrides.userId, USER));
    await db.delete(schema.users).where(eq(schema.users.id, USER));
  });
});
```

Check `parseDayBlocks`'s expected input format before finalising `form()` — read `src/lib/availability/parse-day-blocks.ts` and match it exactly. If a bare minutes string is not what it parses, use the format it does. **Do not change `parseDayBlocks` to suit the test.**

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run tests/submit-availability-week.test.ts
```

Expected: FAIL — `submitAvailability` ignores `weekStart` and writes nothing for that date.

- [ ] **Step 3: Implement**

In `submitAvailability`, read the target week and branch:

```ts
const weekStart = formData.get("weekStart");
const target = typeof weekStart === "string" && weekStart ? weekStart : null;

await syncDateOverrides(user.id, blocksPerDay, target ?? undefined);

// Only the CURRENT week has a materialised plan to replan. A future week
// has no week_plans row — the preview recomputes from these overrides on
// its next render, and Monday's rollover reads them for real.
if (!target) {
  const result = await applyAvailability(user.id, blocksPerDay);
  revalidatePlan();
  return {
    message:
      result === "applied"
        ? "Week updated around your availability."
        : "No open week to update yet.",
  };
}

revalidatePlan();
return { message: "Next week updated around your availability." };
```

Validate `target` is a `YYYY-MM-DD` Monday before using it — reject anything else with a message rather than writing to an arbitrary date. This is a `"use server"` export and therefore a reachable RPC endpoint.

- [ ] **Step 4: Run to verify it passes, then gate and commit**

```bash
npx vitest run tests/submit-availability-week.test.ts src/lib/week-plan/
npx prettier --write src/app/plan/actions.ts tests/submit-availability-week.test.ts
npm run format:check && npm run typecheck && npm run lint && npm test && npm run build
git add -A
git commit -m "feat(availability): submit availability for a future week without replanning"
```

---

### Task 3: `projectWeek` — one derivation for any week

**Files:**

- Create: `src/lib/week-plan/project.ts`
- Modify: `src/lib/week-plan/repair.ts` (`computeWeekRepair` calls `projectWeek`)
- Test: `src/lib/week-plan/project.test.ts` (new, DB-gated)

**Interfaces:**

- Consumes: `assembleVolumeInputs`, `weeklyTargetHours`, `hoursForMaterialize`, `periodize`, `materializeWeek`, `resolveWeek`, `racesForWeek`, `currentCtl`, `planConstraints`.
- Produces:

```ts
export interface ProjectedWeek {
  weekStart: string;
  skeletonWeek: number;
  days: DaySlot[];
  target: VolumeResult;
  /** True when no `week_plans` row exists for this weekStart — a forecast. */
  provisional: boolean;
  /** date -> the athlete pinned availability for it (an override row exists). */
  pinned: Record<string, boolean>;
}

export async function projectWeek(
  userId: string,
  weekStart: string,
  now: Date
): Promise<ProjectedWeek | null>;
```

**Two behavioural forks the implementer must get right.** Lift the existing body of `computeWeekRepair` (`src/lib/week-plan/repair.ts:122`) and generalise it:

1. **Availability.** For a **stored** week, use the week's own already-resolved `day.availableBlocks` — do NOT re-resolve. `repair.ts`'s docstring is explicit that re-resolving availability is a replan and out of scope, and the repair script depends on that. For a **projected** week there is no stored row, so resolve with `resolveWeek(userId, dates)`.
2. **`prevWeek`.** For a stored week, keep today's lookup of `trainingBlocks` at `skeletonWeek - 1`. For a projected week, pass **`null`** — and say why in a comment:

   > `prevWeek: null` is precisely "assume this week closes to plan". Every branch in `effectiveWeekLoad` is guarded on `prevWeek &&` — the missed-week restart, the low-adherence rebuild and the ramp clamp — so a null prevWeek yields `load = skeletonTarget` unmodified. Feeding this week's actuals-so-far instead would make the preview move every day, and move _downward_ early in the week when little is logged, for reasons unconnected to anything the athlete decided.

   `skeletonWeek` for a projected week is the stored open week's `skeletonWeek + 1`, with the same fallback-to-last-block rule when the plan runs out of periodized blocks.

- [ ] **Step 1: Write the failing test**

Create `src/lib/week-plan/project.test.ts`:

```ts
import { describe, expect, it } from "vitest";

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

describe.skipIf(!hasDb)("projectWeek", () => {
  it("returns null for a user with no active plan", async () => {
    const { projectWeek } = await import("@/lib/week-plan/project");
    const r = await projectWeek(
      "no-such-user-at-all",
      "2027-03-01",
      new Date("2027-02-24T09:00:00")
    );
    expect(r).toBeNull();
  });
});
```

Add these DB-backed cases, seeding a user with an active plan and an open week by following the fixtures already in `tests/week-plans.test.ts`:

```ts
it("marks a week with no stored row as provisional", async () => {
  // projectWeek(user, nextMonday, now) -> provisional === true
  // and projectWeek(user, thisMonday, now) -> provisional === false
});

it("creates no week_plans row", async () => {
  // Count rows before and after projecting a future week; must be equal.
  // This is the plan's hardest invariant — assert it explicitly.
});

it("assumes this week closes to plan, whatever this week's actuals say", async () => {
  // Project next week. Then book real actualLoad onto this week's days
  // and project next week AGAIN. The projected days must be identical.
  // This test exists to fail if someone later feeds actuals-so-far into
  // prevWeek. Do not delete it as redundant.
});

it("reflects a pinned availability override for a future date", async () => {
  // Write an availability_overrides row for a day next week, project,
  // and assert that day's availableMins matches and pinned[date] is true.
});
```

Fill in the seeding by following `tests/week-plans.test.ts`. Every case must exercise `projectWeek` against the DB, not a stub.

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/lib/week-plan/project.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/week-plan/project'`.

- [ ] **Step 3: Implement `projectWeek`, then rewire `computeWeekRepair`**

Move the derivation out of `repair.ts` into `project.ts`, generalised per the two forks above. Then `computeWeekRepair` becomes: call `projectWeek` for the open week, and diff the result against the stored days exactly as it does now (settled days untouched, `actualLoad` / `unplannedLoad` / `activityId` carried over unconditionally — that carve-out exists because a `rest` day can hold a real synced ride's load, and a literal field-for-field overwrite would delete it).

**`computeWeekRepair`'s observable behaviour must not change.** Its existing tests are the check.

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run src/lib/week-plan/project.test.ts src/lib/week-plan/repair.test.ts src/lib/week-plan/
```

Expected: all pass, including every pre-existing repair test **unmodified**. If a repair expectation changes, STOP and report — the generalisation was supposed to be behaviour-preserving there.

- [ ] **Step 5: Full gate and commit**

```bash
npx prettier --write src/lib/week-plan/project.ts src/lib/week-plan/repair.ts src/lib/week-plan/project.test.ts
npm run format:check && npm run typecheck && npm run lint && npm test && npm run build
git add -A
git commit -m "feat(week-plan): projectWeek derives any week without persisting it"
```

---

### Task 4: The rolling day list

**Files:**

- Modify: `src/components/train/week-day-list.tsx`
- Test: `src/components/train/week-day-list.test.tsx` (add cases; create if absent)

**Interfaces:**

- Produces: `WeekDayList` gains `nextWeek?: { days: DaySlot[]; pinned: Record<string, boolean> } | null` and `today: string`.

**The rules:**

- Days **before today** are dropped. **Today is never dropped**, completed or not — an athlete opening the app at 20:00 must still see what today asked of them.
- The list runs from today through the end of next week's days it was given.
- A visible boundary row separates the weeks.
- Next week's days render with `~` before durations and a `provisional` marker, except where `pinned[date]` is true.

- [ ] **Step 1: Write the failing test**

`WeekDayList` is presentational, so use `renderToString` — the idiom in `src/components/plan/week-rationale.test.tsx`. Add:

```tsx
it("drops days before today but never today itself", () => {
  const html = renderToString(
    <WeekDayList
      days={days} // Mon..Sun, Mon+Tue completed, today = Tue
      today="2026-07-28"
      nextWeek={null}
    />
  );
  expect(html).not.toContain("2026-07-27");
  expect(html).toContain("2026-07-28");
});

it("shows next week under a boundary, marked provisional", () => {
  const html = renderToString(
    <WeekDayList
      days={days}
      today="2026-07-28"
      nextWeek={{ days: nextDays, pinned: {} }}
    />
  );
  expect(html).toContain("next week");
  expect(html).toContain("provisional");
});

it("does not mark a pinned day provisional", () => {
  const html = renderToString(
    <WeekDayList
      days={days}
      today="2026-07-28"
      nextWeek={{ days: nextDays, pinned: { "2026-08-04": true } }}
    />
  );
  // The pinned day's row must not carry the provisional marker.
  expect(html).toContain("pinned");
});

it("says so when next week has no availability at all", () => {
  // Spec edge case: every day rest, rather than an empty box the athlete
  // cannot interpret. Silence here reads as a bug, which is the whole
  // failure mode this feature exists to remove.
  const allRest = nextDays.map((d) => ({
    ...d,
    workouts: [],
    availableBlocks: [],
    availableMins: 0,
    status: "rest" as const,
  }));
  const html = renderToString(
    <WeekDayList
      days={days}
      today="2026-07-28"
      nextWeek={{ days: allRest, pinned: {} }}
    />
  );
  expect(html).toContain("No availability set for next week");
});
```

Build `days` and `nextDays` with the file's existing fixture helper if it has one; otherwise construct `DaySlot[]` inline with `date`, `availableBlocks: []`, `availableMins: 0`, `workouts: []`, `status`.

- [ ] **Step 2: Run to verify it fails, implement, verify it passes**

```bash
npx vitest run src/components/train/week-day-list.test.tsx
```

- [ ] **Step 3: Full gate and commit**

```bash
npx prettier --write src/components/train/week-day-list.tsx src/components/train/week-day-list.test.tsx
npm run format:check && npm run typecheck && npm run lint && npm test && npm run build
git add -A
git commit -m "feat(train): the week list rolls into next week"
```

---

### Task 5: The availability week switcher

**Files:**

- Create: `src/components/plan/availability-week-switcher.tsx`
- Modify: `src/app/train/page.tsx` (availability form, ~line 593)
- Test: `src/components/plan/availability-week-switcher.test.tsx` (new)

**Interfaces:**

- Consumes: `submitAvailability`'s `weekStart` form field from Task 2.
- Produces: a `This week | Next week` control that sets a hidden `weekStart` input.

**From the spec, all four are requirements:**

- The form posts an explicit `weekStart`; `submitAvailability` must not infer it from "today".
- **Switching weeks must not silently discard unsaved edits** — save on switch, or warn. Losing a half-entered week to a stray tap is worse than the feature is good.
- The "next week" state must be reachable directly, so the preview can link to it without duplicating the control.
- Only the current week's submission replans (already handled in Task 2).

This component is interactive, so its test uses the hand-rolled `react-dom/client` + `act()` harness from `src/components/plan/races-section-demand.test.tsx`. **Do not import `@testing-library/react`; it is not installed.**

- [ ] **Step 1: Write the failing test** — cover: the switcher sets `weekStart` to next Monday when toggled; it is absent/empty for "this week"; and switching with unsaved edits does not silently lose them (assert whichever behaviour you implement, save-on-switch or warn).

- [ ] **Step 2: Run to verify it fails, implement, verify it passes.**

- [ ] **Step 3: Full gate and commit**

```bash
npx prettier --write src/components/plan/availability-week-switcher.tsx src/components/plan/availability-week-switcher.test.tsx src/app/train/page.tsx
npm run format:check && npm run typecheck && npm run lint && npm test && npm run build
git add -A
git commit -m "feat(availability): switch the availability form between this week and next"
```

---

### Task 6: Wire the preview onto `/train`

**Files:**

- Modify: `src/app/train/page.tsx`

**Interfaces:**

- Consumes: `projectWeek` (Task 3), `WeekDayList`'s new props (Task 4), the switcher (Task 5).

Inside the existing `if (week)` block — where `volumeInputs`, `constraints` and the rationale are already derived — add the projection for next Monday and pass it down. Reuse `week.weekStart` and the repo's `addDaysYmd` to get next Monday; do not write new date arithmetic.

The section states its assumption in one plain line, e.g. _"Assumes this week goes to plan. Firms up Monday."_, and links to the switcher's next-week state.

- [ ] **Step 1: Add the projection and render it**

Inside the existing `if (week)` block, beside the Task 11 derivation that
already produced `volumeInputs`, `constraints` and `rationale`:

```tsx
// Next week does not exist as a row — it is derived on every render and
// never written. See docs/specs/2026-07-29-next-week-preview-design.md.
const nextWeekStart = addDaysYmd(week.weekStart, 7);
const projected = await projectWeek(userId, nextWeekStart, new Date());
const nextWeek = projected
  ? { days: projected.days, pinned: projected.pinned }
  : null;
```

Pass it to the list, along with today, which it needs to know where to start:

```tsx
<WeekDayList days={week.days} today={today} nextWeek={nextWeek} />
```

`today` is already in scope on that page (`const today = localYmd(now)` in the
same block). Add imports for `projectWeek` from `@/lib/week-plan/project` and
`addDaysYmd` from wherever the page's siblings import it — check the existing
imports first rather than adding a second date helper.

The section's assumption line renders once, above next week's rows:

```tsx
{
  nextWeek && (
    <p className="text-[11px] text-white/40">
      Assumes this week goes to plan. Firms up Monday.{" "}
      <a href="?availability=next" className="underline">
        Set next week&apos;s availability
      </a>
    </p>
  );
}
```

The `?availability=next` target is the switcher's next-week state from Task 5 —
the spec requires it be reachable directly so this link does not duplicate the
control.

- [ ] **Step 2: Verify by hand that a page render creates no `week_plans` row** — count rows, load `/train`, count again. The automated version of this lives in Task 3; this is the end-to-end check.
- [ ] **Step 3: Full gate and commit**

```bash
npx prettier --write src/app/train/page.tsx
npm run format:check && npm run typecheck && npm run lint && npm test && npm run build
git add -A
git commit -m "feat(train): show next week under the current one"
```

---

### Task 7: Release

- [ ] Bump `version` in `package.json` to `0.29.0`.
- [ ] Add the `CHANGELOG.md` entry in the established voice — read existing entries first. Say what the athlete can now do, and be explicit that next week is a forecast, what it assumes, and what firms it up.
- [ ] Add a `docs/ROADMAP.md` entry before `## Ongoing — operations track`. Remember it needs **two** `prettier --write` passes.
- [ ] Full gate, merge to `main`, confirm CI green, then tag `v0.29.0`.

**Deliberately not in this release:** more than one week ahead; editing next week's sessions; the replan "fill" rung; late-load reconciliation; the stale-open-week and multiple-`active`-plan cleanup. See `docs/plans/2026-07-29-HANDOFF-next-week-preview.md`.

---
