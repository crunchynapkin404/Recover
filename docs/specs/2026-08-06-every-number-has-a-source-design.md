# v0.45 — Every number has a source

Design spec, 2026-08-06. Sequenced as v0.45 in
`docs/specs/2026-08-05-ai-coaching-landscape.md` §9.

## Premise

`periodize()` is the last unsourced engine in the plan pipeline. Every constant
it uses — the 40/30/15 phase split, the 8 %/7 %/2 % progression, the 60 %
recovery week, a taper that decays two different ways at once — was picked by
feel and has never been written down. The layers downstream of it are rigorous:
`materializeWeek` clamps, floors and records a reason for every adjustment, and
`race/demand-constants.ts` states a source and a confidence per value. The
generator feeding them does none of that.

This release does not make `periodize()` smarter. It makes it **honest**: every
number traceable to a source and a confidence, three defects removed, and the
one athlete-facing figure that still has no source — the weekly review's load —
routed through the same derivation as everything else.

Deliberately **not** in scope: rewriting `periodize()` as a CTL projection. That
overlaps v0.47 "the plan knows how you start", which already owns `startingCtl`
defaulting (`training-plan.ts:1292`) and reading ATL/TSB.

## Findings this spec rests on

All verified against `main` at `8bbb761`, not assumed.

### F1 — The existing ramp guard cannot see the skeleton

`effectiveWeekLoad` clamps week-over-week change to ±`RAMP_CLAMP_PCT` (0.2) of
last week's **actual** load (`week-plan/materialize.ts:76-96`). The skeleton
progresses at 8 %/week. **8 < 20, so the clamp never fires against it.** Each
step is individually legal and the error compounds: a 20-week plan reaches
`1.08^20` = 4.7× its starting load with nothing in the pipeline objecting.

This is the volume pipeline's layering problem stated precisely — a rigorous target
layer fed by a naive generator. The bound has to go where the compounding
happens.

### F2 — The recovery cadence resets at phase boundaries

`training-plan.ts:282-293` computes `weekInPhase` relative to the current phase,
then fires a recovery week on `weekInPhase % recoveryInterval === 0`
(4 in base, 3 in build and peak). The counter restarts at every boundary, so
the gap between recovery weeks depends on where the boundaries happen to land.

A 3-week base is the worst case: `3 % 4 ≠ 0`, so base produces no recovery week
at all, and build's counter starts again from 1 — recovery arrives at
`weekInPhase = 3`, which is plan week 6. **Six consecutive loading weeks**, from
a rule that reads as "every 3rd or 4th week".

This is the trap the ATP thread documented from the other side: recovery weeks
are counted inside phase totals, so the phase arithmetic does not say what a
reader assumes it says.

### F3 — The skeleton taper contradicts itself, and is only _conditionally_ dead

Two independent decay rates describe one taper:

- `currentLoad *= 0.75` — target load, −25 %/week (`training-plan.ts:340-341`)
- `loadMultiplier` taper arm — hours, `0.7 - (weekInPhase-1) * 0.1`, so
  0.7 → 0.6 → 0.5 (`training-plan.ts:357-358`)

Load and hours therefore diverge every taper week, and the implied intensity
drifts as an artefact of two numbers nobody reconciled.

The real taper lives in `race/taper.ts` — 21/14/10-day windows by race class,
fractions 0.45/0.65/0.80 of current actual load — and is applied by
`materializeWeek` (`week-plan/materialize.ts:151-179`) from the race calendar.

**It is not unconditionally dead.** Traced, rather than assumed:

- `racesForWeek` (`race/service.ts:198-224`) queries the races table by
  `userId`, **not** by the plan's `raceId`. So a plan with `race_id = null`
  still tapers — the null-`race_id` case that `8bbb761` had to handle
  elsewhere does not break the taper.
- But `week-plan/service.ts:578-581` applies a taper fraction only when
  `primary.priority === "A"` and the race is still `status = 'upcoming'`.

So for a plan built against a **B or C race**, the skeleton taper is currently
the only taper that exists. Deleting it outright would send an athlete into a B
race at full volume. B/C mini-tapers are v0.47's scope and this release must not
absorb them.

### F4 — The weekly review's number has no source

`weekly-review.ts:141-186` computes its own week load from a **rolling 7-day UTC
window off raw `start_date`** — not a calendar week, and without the
`coalesce(start_date_local, start_date)` every other surface uses. That figure:

1. writes `training_blocks.actualLoad` / `actualSessions` / `adherencePct`
   (lines 251, 360-362), then
2. `rolloverWeekPlan` runs at line 379 and **immediately overwrites the same
   row** with the correct calendar-week value derived from the activities table.

**The database ends up right and the athlete does not.** The message at line 260
— `📊 Week in review: X load across Y sessions…` — is generated from the
divergent figure, stored verbatim in `chat_messages`, and never rewritten. It is
wrong permanently, in the coach's voice.

Two consequences worth stating. The persisted-value bug is invisible to any test
that inspects the DB after a full run, because rollover masks it. And this is a
fifth consumer that v0.44's "one derivation" claim does not cover — the
CHANGELOG's "screen and stored week agree by construction" is scoped to `/train`
and the persisted values, both genuinely unified, so the claim is true as
written but narrower than it sounds.

### F5 — The fix for F4 is nearly free

`deriveDayActuals` (`week-plan/actuals.ts:32`) already excludes Strava
(line 40) and already coalesces `start_date_local` (lines 46, 50). Routing the
weekly review through it closes the wrong number, the UTC-window bug and the
Strava-firewall question in one edit.

## What ships

### 1. `src/lib/plan-constants.ts` — the constants, sourced

Every number `periodize()` uses moves into one exported frozen object, on the
`race/demand-constants.ts` pattern: a doc comment per constant carrying its
value, its source and its confidence. `training-plan.ts` imports them. No magic
number survives in the engine.

Included: the phase split (0.4 / 0.3 / 0.15 and the `Math.max` floors), the
progression rates (1.08 base, 1.07 build, 1.02 peak) and the `baseLoad * 0.1`
absolute step cap, the recovery fraction (0.6) and intervals (4 in base, 3
elsewhere), `loadMultiplier`'s per-phase coefficients, the `Math.max(100, …)`
load floor, and the new CTL ramp bound.

### 2. `docs/specs/2026-08-06-periodize-evidence.md` — the evidence

Same shape as `docs/specs/2026-07-28-training-volume-evidence.md`: a summary
table of constant / value / evidence / confidence, then a section per constant.

The honest expectation is that **most of these land at Low**. The 3:1 and 4:1
step-loading cadence is coaching convention with no head-to-head evidence in
endurance athletes, and the doc says exactly that rather than dressing it up. If
3:1 is cited, it is labelled convention — and **Issurin 2010 is not cited**,
because that is block periodization (accumulation / transmutation / realization),
a different model that does not support the claim.

### 3. The witness test

`src/lib/plan-constants.test.ts` reads the evidence doc and asserts every key in
`PLAN_CONSTANTS` appears in its summary table. A new constant that nobody
documented fails CI.

It reads a file and touches no database, so it is **deliberately never**
`describe.skipIf(!hasDb)`. v0.40 found that 89 of 245 test files skip on every
PR for want of a `DATABASE_URL`; a DB-gated witness would therefore enforce
nothing. This one binds where it matters.

### 4. `periodize()` — three defects

**Recovery cadence (F2).** Replace the per-phase `weekInPhase % interval`
test with a **running counter of weeks since the last recovery week**, carried
across phase boundaries and reset only when a recovery week actually fires. A
recovery week is due when that counter reaches the _current_ phase's interval —
so the per-phase intent (4 in base, 3 in build and peak) survives intact, while
the boundary reset that produced the six-week gap does not.

Worked through the F2 case: a 3-week base leaves the counter at 3 entering
build; build's interval is 3, so recovery fires at plan week 4 rather than
week 6. The cadence becomes a property of the plan, not of where the boundaries
happen to fall.

**Taper (F3).** Delete `loadMultiplier`'s taper arm and the `currentLoad *= 0.75`
branch — the two contradicting rates. The race calendar becomes the single taper
authority.

`periodize()` itself has no reasons channel and does not gain one — it is a
pure skeleton generator. The explicit reason is recorded where every other taper
reason already is: `materializeWeek` (`week-plan/materialize.ts:146-181`), which
picks `primary = races[0]`, computes a taper fraction only when
`primary.priority === "A"`, and otherwise falls through in silence. It already
pushes an `AdjustmentRecord` with `trigger: "race"` when a taper _does_ apply.
The new branch pushes the mirror-image record when the primary race of a week
that falls inside its own taper window is priority **B or C** — same channel,
same persistence as a `plan_adjustments` row. Making the gap loud is this
release's job; filling it is v0.47's.

Note for the implementer: `fillWeek` (`week-plan/service.ts:571-581`) carries a
**second copy** of the same priority-A test, deliberately, so that fill's notion
of "taper week" cannot disagree with the engine's. It decides whether to offer
fill, not what the week's target is, so it needs no reason record — but it must
not be left behind if the priority test itself is ever changed. This release
does not change that test; it only adds a branch for what happens when it fails.

**CTL ramp bound (F1).** Cap each week against a CTL trajectory instead of
letting the percentage compound:

```text
maxLoad(w)  = (startingCtl + CTL_RAMP_PER_WEEK × w) × 7
currentLoad = min(compounded, maxLoad(w))
```

`CTL_RAMP_PER_WEEK = 5`. At a starting CTL of 50, week 20 caps at 1050 against
1631 compounded, so the bound bites where the runaway is. Sourced to the
Coggan/Friel ramp-rate guidance and rated **Medium** — widely used coaching
practice, not a validated threshold, and the evidence doc says so.

### 5. The weekly review reads one derivation

Replace both rolling-UTC aggregates with `deriveDayActuals` over the calendar
week the rollover is about to close — the same `mondayOf` window — so the review
and `rolloverWeekPlan` agree **by construction** rather than by coincidence.

One derivation feeds the message (line 260), `planAdherence` (line 247) and the
`training_blocks` write (line 360). The prior-week delta uses the preceding
calendar week through the same path. `avgReadiness` moves onto the same window,
so all four numbers in the sentence describe one period.

Write ordering is unchanged — the stored review remains the idempotency marker,
and plan side-effects stay last — because agreement no longer depends on who
writes last.

`mondayOf` is currently private in `week-plan/service.ts:51`, with a second copy
in `charts.ts:145`. The plan authority gets exported and the review imports it,
rather than the codebase growing a third copy.

Athletes with no training plan still get a correct number: the derivation runs
over the calendar week whether or not a `week_plans` row exists.

### 6. `docs/specs/2026-07-28-training-volume-evidence.md` — the ACWR correction

`HEADROOM = 1.3` and `RAMP_CLAMP_PCT = 0.2` drop from **High** to **Low**.

The current anchor does not hold. Impellizzeri et al. 2020 (IJSPP) finds no
evidence supporting ACWR for load management: the ratio is mathematically
coupled — the acute week sits inside the chronic window, producing spurious
correlation — and its time windows are arbitrary. Recent work argues the model
should be discarded as a framework. Separately, **`HEADROOM` is not an ACWR at
all**: an ACWR is acute 7-day ÷ chronic 28-day rolling load, while `HEADROOM` is
this week's hours ÷ a 12-week rolling _peak_. It reused the number without
inheriting the definition.

Both values stay. Only the justification and the confidence move: 1.3 is
defensible as "30 % above this athlete's own 12-week peak" — an empirical
guard-rail, not an injury threshold.

### 7. `scripts/repair-plan-blocks.ts`

The active plan in the live database was generated by the current `periodize()`.
On the v0.44 `repair-week-actuals.ts` pattern: **dry-run by default**, `--apply`
to write, a per-block before/after diff, writes atomic and attributable.

It recomputes blocks **only for weeks strictly after the plan's `currentWeek`**.
Closed and in-flight weeks are untouched, so no `effectiveTarget` moves and no
recorded adherence changes — rewriting those would corrupt the low-adherence
safety rail in `materialize.ts`, which reads the frozen target by design.

The classifier blocks an assistant pointing anything at live, so it ships with a
sibling wrapper the way `live-repair-week-actuals.sh` did, and the user runs it.

## Testing

`periodize()` is a pure function. Its tests bind in CI **with no database**,
which is the whole reason this release's guarantees can be trusted where the
DB-gated ones cannot.

- Cadence: no plan of any length between 4 and 52 weeks produces more than
  `recoveryInterval` consecutive loading weeks. Property-style over the range,
  not three hand-picked cases.
- Ramp bound: a long plan's final week never exceeds `maxLoad(w)`; a short plan
  where the bound should not bite is unchanged.
- Taper: `periodize()` emits no taper-phase decay; a week with an A race is
  tapered by `materializeWeek`, and a week with a B race records the explicit
  reason instead.
- Weekly review: one test asserts the review's figure and `rolloverWeekPlan`'s
  stored figure are equal for the same week — the assertion that would have
  caught F4. DB-gated, and therefore carries `describe.skipIf(!hasDb)`.
- Witness: **mutation-tested**. Add an undocumented constant, confirm CI
  actually goes red, then revert. A bound whose fixture lets something else
  bind first is blind, and a witness nobody has seen fail is not evidence.

## Verification before merge

1. Full suite with `DATABASE_URL` **unset** — a green local gate cannot catch
   the skipIf trap, and this release's central claim is that its tests bind
   in CI.
2. Full suite with the env sourced.
3. `npm run typecheck`, `npm run lint`, `npm run format:check`, and
   `npm run build` — the last one because the local pre-merge gate omits it
   and it is the only check that catches a sync
   export from a `"use server"` file.
4. The witness mutation test above.

## Verification after release

Tag last, per `docs/RELEASING.md`. Then the repair script's dry-run output is
read in full before `--apply`, and **any per-block decrease is cross-checked**
before writing — a wrong increase is re-correctable, a wrong decrease destroys
real prescription. Pre-conditions from the v0.44 live repair apply unchanged: read `DATABASE_URL` from the **running container**, never
`docker-compose.yml`, and confirm `DATABASE_DRIVER=pg`.

## Non-goals

- **B/C mini-tapers** — v0.47. This release makes their absence loud, not fixed.
- **`startingCtl` defaulting to 30, and reading ATL/TSB** — v0.47.
- **Rewriting `periodize()` as a CTL projection** — considered and rejected;
  it would pull v0.47 forward and leave v0.45 without its own identity.
- **The one-shot completion judgement and session counts** — the gap v0.44 left
  open, where `2026-07-13` closed with `actualLoad` 619 and `actualSessions` 0.
  Still open, still untested, deferred again. It needs test infrastructure that
  seeds a real `connections` row, which does not exist yet.
- **Tuning any constant's value.** This release sources and bounds them. Where
  the evidence is weak, the doc says so and the value stays.

## Risks

- **Deleting the skeleton taper regresses B/C-race plans.** Mitigated by the
  recorded reason, which makes the gap visible rather than silent, and bounded
  by v0.47. Accepted knowingly, not overlooked.
- **The CTL ramp bound changes generated plans.** Intended. The repair script
  confines the change to un-started weeks, and the dry-run is read before it
  is applied.
- **The witness only proves a constant is _named_ in the doc**, not that its
  documented value or confidence is correct. Stated here so the guarantee is not
  read as stronger than it is — the same overclaiming failure v0.39 caught in
  its own CHANGELOG.

## Related

`docs/specs/2026-08-05-ai-coaching-landscape.md` §8, §9 ·
`docs/specs/2026-07-28-training-volume-evidence.md` ·
`docs/specs/2026-08-06-no-training-is-lost-design.md`
