# Next-Week Preview & Availability Horizon — Design

**Date:** 2026-07-29
**Status:** design approved, spec under review
**Prerequisite:** v0.28.1 (`main` @ `cee7319`)

## The problem

> "on sunday you cant see what you need to do the next week"

Recover shows exactly one week, Monday to Sunday. Beyond it there is nothing —
not because the UI hides it, but because **next week does not exist as data**.
`rolloverWeekPlan` materialises only the week for the current Monday, and
`getOpenWeekPlan` returns exactly one open row. Ahead of today there is only the
periodized skeleton in `training_blocks`: phase, target load, session count. No
days, no sessions, no times.

So the athlete plans their life against a horizon that collapses to zero every
Sunday evening.

JOIN Cycling has the same limitation. "Availability beyond one week ahead" is an
open request on their public roadmap with **152 votes**, unshipped. There is no
reference implementation to copy.

## What this builds

Two things, shippable independently.

**Phase 1 — the availability horizon.** Let the athlete enter availability for
next week. This is the real unlock: a day pinned on Thursday is honoured by
Monday's rollover automatically, because `resolveWeek` already reads
`availability_overrides` for any date.

**Phase 2 — the projection and the rolling list.** Show next week's actual
sessions, computed on render, clearly provisional. Completed days fall off the
list so it always shows what is ahead.

## Architecture

### The core primitive: `projectWeek`

`computeWeekRepair(userId, now)` in `src/lib/week-plan/repair.ts` already
computes a complete week **without persisting it**, through exactly the pipeline
the rollover uses:

```
assembleVolumeInputs → weeklyTargetHours → hoursForMaterialize
                     → periodize → materializeWeek
```

It is hardwired to `getOpenWeekPlan`. Generalise it:

```ts
export async function projectWeek(
  userId: string,
  weekStart: string, // any Monday, stored or not
  now: Date
): Promise<ProjectedWeek | null>;

export interface ProjectedWeek {
  weekStart: string;
  skeletonWeek: number;
  days: DaySlot[];
  /** The volume target this week was built to, and where it came from. */
  target: VolumeResult;
  /** True when no `week_plans` row exists for this weekStart — a forecast. */
  provisional: boolean;
  /** Per-day: was availability pinned for this date, or inherited from the
   *  standard week? Drives how firmly the UI may state each day. */
  pinned: Record<string, boolean>;
}
```

`provisional` and `pinned` are independent and both matter. A week is
`provisional` when it has no stored row — nothing in it is committed. A _day_
within it is `pinned` when the athlete gave that date explicit availability. So
a provisional week can hold pinned days: the athlete has told us what time they
have on Tuesday, but the session that lands there still depends on how this week
closes. The UI needs both to be honest — pinned removes the _availability_
uncertainty, not the _plan_ uncertainty.

`computeWeekRepair`, `rolloverWeekPlan` and the preview all call it. One
derivation, several consumers, structurally unable to disagree — the same
pattern as `assembleWeeklyTarget`.

**This never writes.** No `week_plans` row is created for a future week, ever.
A second open row would break `getOpenWeekPlan`'s single-open-week assumption,
the rollover's idempotency and adherence; and a stored forecast going stale is
precisely the defect v0.28.0 existed to eliminate.

### What the projection assumes about this week

`materializeWeek` takes `prevWeek: { actualLoad, adherencePct } | null`, which
for next week means _how this week finally closes_ — unknowable until Sunday.

**The projection assumes this week closes to plan.** Concretely: `prevWeek` is
derived from this week's `effectiveTarget` at 100% adherence, not from
actuals-so-far.

The alternative — feeding actuals as they accumulate — was rejected because it
makes the preview swing every single day, and swings _downward_ early in the
week when little has been logged yet. An athlete checking Monday's preview on
Wednesday would see a different week again on Thursday, for no reason connected
to their own decisions. A stable, stated assumption is more useful than a
precise-looking number that moves under them.

This assumption is **surfaced in the UI**, not buried.

### Availability horizon

The data layer is already date-generic and needs no change:

| Thing                        | Keyed by        | Already works for future weeks?                           |
| ---------------------------- | --------------- | --------------------------------------------------------- |
| `availability_defaults`      | weekday         | **Yes** — the standard week applies forward automatically |
| `availability_overrides`     | date            | **Yes**                                                   |
| `resolveWeek(userId, dates)` | arbitrary dates | **Yes**                                                   |

The single point of week-scoping is `syncDateOverrides`
(`src/lib/availability/sync-overrides.ts:77`), which calls `getOpenWeekPlan` and
iterates `week.days`. It gains an explicit target week:

```ts
export async function syncDateOverrides(
  userId: string,
  blocksPerDay: AvailabilityBlock[][],
  weekStart?: string // defaults to the open week, preserving today's callers
): Promise<void>;
```

Its `completed`/`missed` skip must be preserved for the current week and is
simply inapplicable to a future one.

`submitAvailability` (`src/app/plan/actions.ts`) gains the target week, and the
form at `src/app/train/page.tsx:593` gains a way to address it.

**Applying availability to a future week must not replan anything.** Today
`submitAvailability` calls `applyAvailability`, which replans the open week.
For a future week there is nothing to replan — the projection simply recomputes
on the next render.

## UI

### The rolling list

The Week tab's day list becomes rolling: it starts at today and runs seven days
forward, crossing into next week with a visible boundary.

```
┌───────────────────────────────────────┐
│ Wed  Rest                             │
│ Thu  Rest             120m free       │
│ Fri  Rest                             │
│ Sat  Long · 215min    planned         │
│ Sun  Rest                             │
│ ─────────── next week ───────────     │
│ Mon  Endurance · ~90min   provisional │
│ Tue  Intervals · ~75min   ✓ pinned    │
└───────────────────────────────────────┘
```

**Days before today fall off — today never does**, whether or not it is
completed. An athlete opening the app at 20:00 must still see what today asked
of them and whether they did it.

The current week's remaining days render from the stored row exactly as they do
today; next week's come from `projectWeek`.

Past days of the current week remain visible in the weekly panels below (which
still cover Monday–Sunday) and in the History tab, so nothing becomes
unreachable — the rolling list is a _schedule_, not the week's record.

### What stays weekly

**"Why this week", adherence and the weekly review remain Monday–Sunday.** They
describe a closing week's arithmetic; making them rolling would make them
describe a period the list no longer shows whole. The rolling list is a
_schedule_ view; those panels are _accounting_.

### Honesty

Three inputs feed the projection and only one is known:

| Input                     | Known?                                           |
| ------------------------- | ------------------------------------------------ |
| Next week's availability  | **Yes** once pinned; otherwise the standard week |
| How this week closes      | **No** — assumed to plan                         |
| Readiness bands next week | **No**                                           |

Therefore:

- A day whose availability is **pinned** renders firm.
- A day inheriting the **standard week** renders provisional.
- The section states its assumption in one plain line, e.g.
  _"Assumes this week goes to plan. Firms up Monday."_
- Durations on provisional days are prefixed `~`.

The app's character is to say what it knows and refuse to guess. The preview
must not imply more certainty than it has.

## Edge cases

| Case                               | Behaviour                                                                                                                                                                        |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No active training plan            | No projection; the rolling list shows this week only                                                                                                                             |
| `currentWeek + 1 > weeksTotal`     | Hold the last block, exactly as `rolloverWeekPlan` does                                                                                                                          |
| Next week contains the target race | Projection runs `materializeWeek`'s race-week path, same as the rollover would                                                                                                   |
| No availability at all next week   | Every day rest; say so rather than rendering an empty box                                                                                                                        |
| Athlete has no measured ceiling    | `weeklyTargetHours` already falls back; the projection inherits that unchanged                                                                                                   |
| DST boundary inside the window     | Dates are `YYYY-MM-DD` strings throughout; parse as **local midnight** (`new Date(ymd + "T00:00:00")`) — a bare `new Date(ymd)` is UTC and has already shipped one live bug here |
| Today is Sunday                    | The window is Sunday plus six days of next week — the case this feature exists for                                                                                               |

## Testing

- `projectWeek` is pure apart from its reads, so it is directly testable. Cover:
  a future week with no stored row; the open week (must equal today's
  `computeWeekRepair` result); a plan that has run out of blocks; no active plan.
- **Pin the "assumes this week closes to plan" rule with a test that fails if the
  projection starts reading actuals-so-far** — that is the property most likely
  to be "improved" away later.
- Availability: pinning a day next week must change that day's projection and
  must be honoured by a subsequent rollover.
- **Never-persists is a testable invariant**: assert the `week_plans` row count
  is unchanged after rendering a projection.
- DB-gated tests need `describe.skipIf(!hasDb)` and will skip in CI, so put every
  assertion that can live in a pure test in a pure test.

## Explicitly out of scope

- **More than one week ahead.** Each further week compounds the assumption about
  how the previous one closed.
- **Editing next week's sessions.** It is a forecast; editing implies a
  permanence it does not have.
- **The replan "fill" rung** — added availability producing training in the
  _current_ week. Related and wanted, but a separate piece of work with its own
  safety analysis (see the handoff).
- **Late-load reconciliation** and the stale-open-week/multiple-active-plans
  cleanup.

## Open question for review

Should the availability editor address next week through a **week switcher on
the existing form** (one form, a toggle) or a **separate "next week" card**
beneath the preview? The first is less UI; the second puts the control where the
athlete is already looking when they think about next week. No strong preference
— worth deciding before planning.
