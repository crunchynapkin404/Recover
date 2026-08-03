# The Week's Target Follows the Week — Design (v0.38.0)

## The defect

`week_plans.effective_target` is a **load**, written once when the week is
materialized (`src/lib/week-plan/service.ts:334`) and never updated again.
`applyAvailability` rewrites `days` and nothing else.

Meanwhile the replan ladder changes what the week actually contains, all week
long. The drop rungs shrink it — they always have. Since v0.37.0 the fill rung
also grows it. So the stored target drifts away from the week in **both**
directions. Three consumers read it directly as if it were current, and a
fourth inherits the error through `adherencePct`:

| Consumer                                                                                      | Consequence of drift                                                                               |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Week-close adherence (`service.ts:223`)                                                       | `actualLoad / target` — a week that shed sessions scores low, one that grew scores high            |
| Next week's plan                                                                              | that `adherencePct` feeds `materializeWeek`'s low-adherence branch, so the error compounds forward |
| Race-day forecast (`race/service.ts:244`)                                                     | distributes a frozen load across current minutes                                                   |
| CTL projection (`train/page.tsx:545`) and the taper-execution debrief stat (`debrief.ts:286`) | project from a stale figure                                                                        |

The race-day forecast is the sharpest case. It computes:

```ts
load = weekTarget * (dayWorkoutMins(d) / totalMins);
```

`weekTarget` is frozen while `totalMins` moves. Add a session and every other
day's projected load falls: the new training is invisible and the existing
sessions are understated. Drop a session and the remainder are overstated.

This is not "the fill rung broke the forecast". It is **a snapshot that nobody
maintains, read by consumers that assume it is current**. v0.37.0 only added a
second direction of drift and made the first one visible.

## The decision that shapes the design

A maintained target and a frozen one answer different questions, and the
codebase needs both.

`adherencePct` is not merely displayed. It gates a safety rail
(`materialize.ts:56-61`):

```ts
if (!taperWeek && prevWeek && prevWeek.adherencePct < LOW_ADHERENCE_PCT) {
  target = prevWeek.actualLoad * LOW_ADHERENCE_BUMP;
}
```

That rail exists so an athlete who managed only part of a week is not handed a
full skeleton week next. It builds from what they actually did instead. If the
target were maintained everywhere, a sick athlete whose week adapts down to
match what they managed would score ~100%, the rail would never fire, and they
would get a full week straight after a bad one. That is an athlete-safety
regression of the same shape as the taper defect v0.37.0 nearly shipped.

**So the two targets are split by consumer:**

- **Frozen** (`effective_target`, unchanged) answers _"what did you set out to
  do?"_ — adherence and progression.
- **Maintained** (derived, below) answers _"what does this week hold now?"_ —
  the forecast, the CTL projection, the taper stat.

## Why the maintained target is proportional to minutes

`PlannedWorkout` carries `durationMins`, an intensity _label_ (`"Z1-Z2"`), and
a `purpose`. There is **no per-session load model anywhere in this codebase**.

So the only honest answer to "how much load did the week gain" is one
proportional to minutes — and that is already the assumption the forecast
makes when it distributes `target * dayMins / totalMins`. Scaling the target by
minutes is therefore not a new physiological claim; it is the existing
assumption applied consistently at both ends.

Inventing a per-session load model is a different project. See Non-goals.

## Architecture

### Data

One additive column, migration `0037` (next after
`0036_wellness_poll_interval`):

```sql
ALTER TABLE week_plans ADD COLUMN materialized_mins integer;
```

Written **once**, next to `effective_target` at materialization
(`service.ts:334`). Never updated by any replan. Nullable, so existing rows
need no backfill — they keep today's behaviour and self-heal at the next
materialization.

### The derivation

A pure helper — the only new logic in this release:

```ts
export function currentTargetLoad(input: {
  effectiveTarget: number | null;
  materializedMins: number | null;
  currentMins: number;
}): number | null;
```

`effectiveTarget * (currentMins / materializedMins)`, with the fallbacks in
Failure modes below.

The result is **not** rounded. Every call site already rounds for its own
purpose — the forecast to one decimal place, the debrief stat to whole load —
and rounding here would compound with theirs.

Substituted into the forecast this collapses to:

```
dayLoad = effective_target * dayMins / materialized_mins
```

Per-minute load is pinned at what it was when the week was materialized.
Adding a session adds load; dropping one removes load; neither disturbs the
others.

Deriving on read rather than maintaining a second stored load is deliberate.
A maintained column must be updated by every writer forever, and a future
writer that forgets recreates precisely the bug this release fixes. A derived
value cannot go stale.

### One definition of "the week's minutes"

Both minute counts **must** come from the same function, or the ratio silently
compares different things — the exact drift class being fixed here.

`plannedMins(days)` in `src/lib/week-plan/fill.ts` is already that function: it
sums every session in the week, locked days included, and its doc comment
already explains why completed sessions count. Use it at both ends —
`materialized_mins = plannedMins(days)` on write, `currentMins =
plannedMins(days)` on read.

## Consumers

Switching to `currentTargetLoad`:

- `src/lib/race/service.ts:244` — the race-day forecast.
- `src/app/train/page.tsx:545` — the CTL projection / availability verdict.
- `src/lib/race/debrief.ts:286` — the taper-execution stat.

Each call site needs the week's `days` in scope to compute `currentMins`. The
forecast and debrief queries already return full rows; `train/page.tsx` must be
confirmed rather than assumed.

Deliberately **untouched**:

- **Week-close adherence** (`service.ts:222-223`) keeps reading
  `effectiveTarget`, so `adherencePct` and the `LOW_ADHERENCE_PCT` rail behave
  exactly as today.
- **`materializeWeek`'s progression**, which consumes that `adherencePct`.
- **`fill.ts`** — it works in minutes and never sees a load.

## What the athlete sees on `/train`

`WeekRationale` renders one sentence: `"13.0h planned against a 16.0h target."`
Both halves are already current — `targetHours` comes from
`assembleWeeklyTarget` (live), and `plannedHours` is derived from the week's
days on every render. Nothing here is stale, so **the sentence keeps its
present meaning and the athlete-facing target stays the live hours figure.**

That is deliberate, not an omission. Hours is the unit the athlete offered
their availability in; load is an internal quantity they never entered and
cannot check. Restating an internal load on this surface would add a number
nobody can act on.

### But the minutes behind it must be the same minutes

`plannedHours` is computed by an **inline reduce over the week's days**, and
again separately for the next-week preview (`train/page.tsx:377-381` and
`486-489`). Both duplicate exactly what `plannedMins` already does.

That directly undermines this release's central invariant. If
`materialized_mins` and `currentMins` come from `plannedMins` while the
athlete's own "planned" figure comes from a hand-rolled sum, the number the
athlete reads and the number the forecast reasons from can drift apart — the
precise failure this release exists to remove, reintroduced on the surface
where it would be most confusing.

**Both inline reduces become `plannedMins(days) / 60`.** The two are currently
identical in behaviour — each sums every workout on every day — so this is a
behaviour-preserving substitution, and a test should pin that it stays one.

### The three targets, stated once

Three distinct quantities now coexist. Naming them here so a later change does
not "helpfully" unify them:

| Quantity                       | Unit  | Basis                       | Read by                                  |
| ------------------------------ | ----- | --------------------------- | ---------------------------------------- |
| `assembleWeeklyTarget().hours` | hours | live, recomputed per render | `/train` and the dashboard — the athlete |
| `effective_target`             | load  | frozen at materialization   | adherence, and through it progression    |
| `currentTargetLoad()`          | load  | frozen, scaled by minutes   | forecast, CTL projection, taper stat     |

They are allowed to disagree, because they answer different questions. What
they must never do is disagree about **how many minutes the week contains** —
hence the single `plannedMins`.

### An expected, honest change in output

The taper-execution stat will report a **lower** planned figure for weeks that
shed sessions than it does today. That is not a regression; it is the number
that should always have been shown.

## Failure modes

| Input                   | Behaviour                | Why                                                                        |
| ----------------------- | ------------------------ | -------------------------------------------------------------------------- |
| `materializedMins` null | return `effectiveTarget` | every pre-migration row — today's behaviour exactly                        |
| `materializedMins <= 0` | return `effectiveTarget` | a week materialized with no sessions; never divide by zero                 |
| `effectiveTarget` null  | return `null`            | preserves each call site's existing `?? block?.targetLoadTotal ?? 0` chain |
| `currentMins == 0`      | return `0`               | every session dropped: the week genuinely holds no training                |

## Testing

Every test here is a pure-function test with no `DATABASE_URL` requirement, so
all of them actually run in CI. Do not add a DB-backed test; report instead if
one seems necessary.

1. **Helper tests** — one per row of Failure modes, plus growth and shrink with
   pinned numbers. Choose fixture values so that no two are equal and none
   coincides with a plausible hardcoded constant. A fixture whose value
   collides with a default or with a sibling bound cannot distinguish a real
   derivation from a hardcoded one; this repo has been caught by that three
   times across v0.37.0 and v0.37.1.
2. **The anti-dilution property, stated directly** — given a week, adding a
   session must not lower any _other_ day's projected load. This is the actual
   defect, so it gets its own test rather than being implied by arithmetic.
3. **Adherence regression guard** — a week whose current minutes differ sharply
   from its materialized minutes must produce an unchanged `adherencePct`. This
   is the guard on the split-by-consumer decision: if a future refactor
   unifies the two targets, this must go red.
4. **Same-function invariant** — a source-level guard that every count of "the
   week's minutes" comes from `plannedMins`, in the manner of v0.37.0's
   `fill-wiring` test. This must cover `train/page.tsx`'s two former inline
   reduces as well as the write and read of `materialized_mins`; a second
   minutes definition anywhere would reintroduce the drift silently, and two
   already existed before this release.
5. **`/train` substitution is behaviour-preserving** — the existing
   `week-rationale` tests must pass unchanged, and a test should pin that
   `plannedMins(days) / 60` equals what the inline reduce produced for a week
   containing completed, missed and planned days alike.

Mutation-test each of these: break the implementation, confirm a test fails,
revert. On this repo, green has repeatedly proven nothing on its own.

## Verification beyond the gate

- The migration is additive-only and must be applied to the live database
  (port 5434) after the image ships.
- `/train` is `export const dynamic = "force-dynamic"`, so `next build` never
  renders it. A real authenticated page load is required before merge — a fully
  green five-part gate has already shipped a page-breaking defect through that
  hole on this repo.

## Non-goals

- **No per-session load model.** The codebase has none; inventing one is a
  separate project with its own spec.
- **No change to adherence, progression, or the fill rung.**
- **No backfill** of `materialized_mins` for existing rows.
