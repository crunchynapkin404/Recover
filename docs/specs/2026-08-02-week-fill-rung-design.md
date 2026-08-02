# Design — The Week Can Grow (v0.37.0)

**Status:** approved 2026-08-02, awaiting implementation plan.

## The problem

`replanWeek`'s own opening comment states the defect:

> Unlike materializeWeek this never regenerates the week: it recomputes each
> day's availability, then walks only the sessions that no longer fit — move,
> compress, substitute, drop.

Every rung shrinks. An athlete who frees up time mid-week — clears a Saturday,
extends a Wednesday block from 60 to 120 minutes — changes nothing. The plan
cannot grow into offered time, by construction. The athlete's own words:
adding availability mid-week cannot produce training.

This was deliberately not built earlier. While sessions were still being
wrongly written off as missed (fixed in v0.27.0), a rung that adds would have
filled an athlete from a falsely "fully missed" week straight into a load
spike — roughly double the injury risk, appearing 7–28 days later, where the
athlete can never connect it back to the app.

That blocker is gone. This release adds the fifth rung.

## Scope

**In:** a fill rung, an intended-rest flag, and the adjustment records that
explain both.

**Out, deliberately:**

- **Late-load reconciliation.** A week built while `bookedLoad` read 0 is
  never corrected once load arrives late (observed live: week 2026-07-20
  closed at 0, was really 496, and a later week still carried a 60% restart
  from the false reading). Fill sidesteps this by reading the _live_ target
  rather than the stored one, but the stored figure stays stale. Separate
  work.
- **Collapsing the frozen/live target split.** `week_plans.effective_target`
  is written at materialize time; `assembleWeeklyTarget` recomputes on every
  render. Unifying them touches rollover, race forecast, debrief and the
  dashboard. Separate work.
- **The running and triathlon generators.** `generateRunningWorkouts` and
  `generateTriathlonWorkouts` still discard clamped minutes exactly as cycling
  did before v0.30.0. Their correct rule is athlete-relative rather than
  event-relative, so reusing anything from here would repeat the mistake that
  produced the original bug. Separate work, and this spec carves running out
  of its own long-session path for the same reason.

## 1. The rung

A fifth rung in `replanWeek`, running once after the existing four have
settled and every displaced session has found its outcome.

`replanWeek` takes a new **required** parameter enabling it. Required, not
optional-defaulting-false: the `today` parameter on this same function is
already required for exactly this reason — so that a caller cannot silently
reintroduce a defect by omission. Only two callers pass `true`:

- `applyAvailability` — the athlete submitted the availability form.
- `applyResolvedAvailability` — a default or override was written directly
  ("No time today", a standard-week edit) and the week must follow it.

Every other path passes `false`.

### 1a — Grow in place

For each unlocked day, in day order, each **endurance** session whose own
block now holds more minutes than the session's duration is extended toward
that block's capacity, bounded by its purpose ceiling (§3).

A session is judged against **the specific block it occupies**, never a
roomier sibling — the rule the whole ladder already enforces, and whose
violation is the defect `replanWeek` was written to replace.

### 1b — Add one

If the week is still short after 1a, place **one** new endurance session in
the nearest admitting free block, using the existing `buildSlots` ordering
and `admits` predicate plus the rest rule in §4.

"Nearest" means the same thing rung 1 already means by it: smallest absolute
day distance from today, ties breaking toward the earlier day, then the
earlier block.

At most one new session per call. An athlete making three availability edits
in a day gets at most three sessions, each one bounded by the target, rather
than one edit conjuring a whole week.

Both sub-steps stop the moment planned minutes reach the target.

## 2. The measure, and a unit trap

```text
gapMins = round(target.hours * 60) - plannedMins
```

`target` comes from `assembleWeeklyTarget(userId, now, { availabilityHours,
planHoursPerWeek })` — the single producer both the dashboard's `WeekRow` and
`/train`'s `WeekRationale` already read, so fill cannot disagree with what the
athlete is shown.

That producer already computes `min(race demand, ACWR ceiling)`, applies the
maintenance floor, then clamps by availability. **Adding availability raises
the target itself**, which is exactly why fill needs no ceiling of its own:
the number it fills toward already carries the injury bound (ACWR 0.8–1.3)
and the ramp clamp.

`plannedMins` sums `durationMins` across every day's workouts, including
locked days — a completed Monday is training the week actually contains, and
excluding it would make fill re-add what was already done.

### The unit trap, stated because it has already been shipped once

- `week_plans.effective_target` is a **load**.
- `VolumeResult.hours` is **hours**.
- Sessions carry `durationMins`, **minutes**.

v0.29.0 shipped a defect where `target.hours` was used for a field wanting
`materializeWeek`'s `effectiveLoad`. Fill works in **minutes throughout** and
touches `effective_target` not at all. Any implementation that finds itself
converting through `loadPerHour` has taken a wrong turn.

**Standing instruction for implementers: if a numeric expectation does not
hold, stop and report it rather than loosening the assertion.**

## 3. What fill may add or grow

**Endurance only.** v0.30.0 settled the intensity half of this question when
it excluded Intervals and Tempo from redistribution — stretching a VO2max
block changes what it is. Fill never creates or extends a session of purpose
`threshold`, `vo2max` or `brick`, and never touches a `recovery` session.

That leaves `aerobic_base` and `long`.

### Purpose ceilings

Growth and placement share one bound, so 1a and 1b cannot drift. The bound
follows whatever the generator already does for that sport:

| sport   | `aerobic_base` ceiling               | `long` ceiling                       |
| ------- | ------------------------------------ | ------------------------------------ |
| cycling | `longRideBoundMins(queenStageHours)` | `longRideBoundMins(queenStageHours)` |
| running | the named easy-run cap (today 60)    | fill never touches it — see below    |

`longRideBoundMins` already exists in `training-plan.ts` and is the v0.30.0
rule: bound the ride by the hardest single day the athlete's event demands,
falling back to `NO_DEMAND_LONG_BOUND_MINS` when there is no demand figure.
`generateCyclingWorkouts` bounds **both** its long ride and its easy rides by
it — the flat 90-minute easy cap that used to sit there is exactly what
v0.30.0 removed. Fill calls the same function rather than inventing a second
bound.

Running still carries an inline `Math.min(easyMins, 60)` at its easy-session
call site. This release **names that literal** and imports it. It does not
change its value — that is the running generator rewrite, separately scoped.

### The running carve-out

Fill never creates or grows a **`long` running session**. Running's
single-session rule is athlete-relative (exceeding your own recent longest run
by 10–30% raises injury risk 64% in a study of 5,200+ runners) and does not
exist in this codebase yet. Where fill would otherwise reach for a long run,
it adds an `aerobic_base` run at the filler cap instead.

Cycling has no equivalent single-session spike rule — its injury mechanism is
cumulative, and already bounded upstream — which is why the `long` path is
open for it.

### Choosing what 1b adds

1. A **`long`** session, only when: the week currently holds no `long`
   session, the sport is not running, and the block admits it at
   `longRideBoundMins`. Duration is `min(blockCapacity, gapMins,
longRideBoundMins(...))`.
2. Otherwise an **`aerobic_base`** session, duration
   `min(blockCapacity, gapMins, fillerCap)`.
3. If that duration falls below `PURPOSE_FLOORS[purpose]`, **add nothing**.
   A session below its floor is not worth doing — the rule `fitToBlock`
   already encodes, and fill does not get to override it.

### Choosing the sport

`inferSports` returns an array, and for a triathlon plan it returns three
entries with no ranking, so "the plan's primary sport" is not a well-defined
thing to reach for.

Fill instead adds **in a sport the week already contains**: the sport holding
the most endurance minutes in the current week, ties broken by the order
`inferSports` returns. A week with no endurance sessions at all gives no
evidence of what to add, and fill **adds nothing** rather than guessing.

`admits` already rejects a session whose sport a block excludes, so a
sport-restricted block cannot be mis-filled; if the chosen sport is not
admitted anywhere, 1b places nothing.

## 4. Intended rest days

`admits` enforces the per-day session cap, the energy ceiling, sport
membership and quality adjacency. **Nothing enforces a rest day.** That is
harmless today because every rung shrinks; a rung that adds makes it load
bearing, or the week becomes seven training days by accumulation.

A new optional field on `DaySlot`:

```ts
/**
 * Set only where the engine DELIBERATELY leaves a day empty, as opposed to
 * a day that merely ended up with nothing on it. Optional so every stored
 * week deserializes unchanged.
 */
restIntent?: "pre_race";
```

**Exactly one producer exists today:** the A/B race protection in
`materializeWeek`, which empties the day before the primary race. Fill skips
any day carrying it.

Every other `status: "rest"` in the codebase means "nothing was placed here":
`materializeWeek` starts all seven days at `"rest"` before placing anything,
`replanWeek` sets it when a day's last session is displaced, and
`moveOrDropWorkout` sets it when a session leaves. Those days are legitimately
fillable — a day emptied by the drop rung is precisely where returning time
should go.

**Low readiness needs no flag, and inventing one would be dishonest.**
`adaptDay` never empties a day for a red band: it replaces the session with a
recovery session, or moves it, or drops it when there is no room. Further,
both fill callers run `runDailyAdaptation` immediately afterwards, so a
session fill places on a red day is adapted by the existing machinery on the
same pass. The union is written as a single-member type so a future producer
extends it deliberately rather than by accident.

Fill additionally never places on a day before `today`, and never on a locked
day (`completed`, `missed`, `race`) — both rules the ladder already enforces.

## 5. Honesty

Every fill writes an `AdjustmentRecord`. `AdjustmentAction` gains `"added"`;
the trigger is the existing `availability_change`. Reasons are deterministic
and name the arithmetic, matching the ladder's existing voice:

- grow: `Wednesday's block grew to 120min — Endurance extended from 60 to 120min`
- add: `Saturday now free — Endurance 180min added; 8.8h planned against a 12.5h target`

When fill runs and the week is **still** short after both sub-steps, it logs
that too rather than leaving a silent gap. `WeekRationale` already reports
"planned against target" accurately; a shortfall it cannot close is
information, not an error to hide.

## 6. What fill must never do

- Move, shorten or substitute an existing session. Rungs 1–4 own that.
- Add or grow intensity.
- Fire from any readiness or wellness path.
- Exceed the live target.
- Add more than one new session per call.
- Write to `week_plans.effective_target`.

## 7. Architecture

`replanWeek` stays a **pure function** — `WeekState` plus resolved
availability in, a new `WeekState` and adjustments out, no I/O and no clock.
That is what makes the ladder testable, and fill must not break it.

The live target is therefore resolved by the **callers**, which already have
database access, and passed in:

```text
applyAvailability ─┐
                   ├─► assembleWeeklyTarget ─► targetMins ─► replanWeek(…, { fill: true, targetMins })
applyResolvedAvailability ─┘
```

`longRideBoundMins` needs `queenStageHours`, which comes from `EventDemand`
via `assembleVolumeInputs` — already loaded inside `assembleWeeklyTarget`, so
the callers pass it through rather than issuing a second query.

New/changed files:

| file                               | change                                            |
| ---------------------------------- | ------------------------------------------------- |
| `src/lib/week-plan/replan.ts`      | rung 5, both sub-steps                            |
| `src/lib/week-plan/types.ts`       | `restIntent`, `"added"` action                    |
| `src/lib/week-plan/materialize.ts` | set `restIntent: "pre_race"` on the pre-race rest |
| `src/lib/week-plan/service.ts`     | resolve the target, pass it in, at both callers   |
| `src/lib/training-plan.ts`         | name the inline easy-run cap                      |

No migration. `restIntent` lives inside the existing `week_plans.days` jsonb,
and is optional.

## 8. Verification

**Pure-function tests on `replanWeek`** — each a distinct case, not one test
with branches:

- a block that grew extends its endurance session, bounded by the block
- a freed day receives exactly one new session
- a week already at target gains nothing
- a `pre_race` rest day is never filled
- a locked day and a past day are never filled
- a quality session is never grown; a quality-adjacent slot is never filled
- room below the purpose floor adds nothing
- a running plan never receives a `long` session
- a week with no endurance sessions gains nothing
- a triathlon week fills in the sport holding the most endurance minutes
- fill disabled (every other caller) is byte-identical to today's output

**Idempotence.** Submitting the same availability twice adds nothing the
second time. This is the property v0.28.1 exists to protect — `adaptDay` read
its own output as its input and a real 137-minute ride reached 60 minutes in
five runs. A rung that adds has the same failure shape in the opposite
direction, and it must be proven, not assumed.

**A source-level guard**, in the style of v0.32.0's: assert that `fill: true`
appears at exactly the two intended call sites and nowhere else. DB-gated
tests skip in CI, so a DB-backed regression test enforces nothing there; a
source-level guard is often the only thing CI actually runs. Its documented
blind spot — a flag passed via a variable rather than inline — goes in the
test's own comment.

**The full gate, all five, in this order:**

```bash
npm run format:check && npm run typecheck && npm run lint && npm test && npm run build
```

Each of the last three releases to drop a different member of this gate broke
something, with the suite fully green throughout. `docs/ROADMAP.md` needs two
`prettier --write` passes to converge.

**A real authenticated `/train` page load.** `/train` is
`export const dynamic = "force-dynamic"`, so `next build` never renders it —
a fully green five-part gate has already shipped a page-breaking defect
through that hole. Playwright against `next dev` works in this environment.

**Live data check before merge.** Against the live database (port 5434 —
`.env` points at dev, 5435), confirm no user has a week whose planned minutes
already exceed the live target, which would mean fill's arithmetic disagrees
with what the athlete is being shown.

## 9. Release

**v0.37.0 — "The Week Can Grow".** No migration. Ships behind no flag: the
rung is either reachable from the two availability callers or it is not.
