# Handoff — Race-Driven Training Volume, Phase 1

**Rewritten 2026-07-28 after Task 13.** Everything a fresh session needs to resume
without re-deriving anything. Read this, then the ledger, then the plan.

## Resume in three commands

```bash
cd /home/vscode/recover
git checkout feat/race-driven-volume        # HEAD e7f8ba6
tail -80 .superpowers/sdd/progress.md       # the ledger is authoritative
```

**Tasks the ledger marks complete are DONE. Do not re-dispatch them.** After
any compaction, trust the ledger and `git log` over recollection.

## State

|        |                                                                             |
| ------ | --------------------------------------------------------------------------- |
| Branch | `feat/race-driven-volume` (off `docs/race-driven-volume-spec`, off `main`)   |
| HEAD   | `e7f8ba6`                                                                   |
| Spec   | `docs/specs/2026-07-28-race-driven-volume-design.md` (approved)             |
| Evidence | `docs/specs/2026-07-28-training-volume-evidence.md` (research, per-constant confidence) |
| Plan   | `docs/plans/2026-07-28-race-driven-volume-phase1.md` (12 tasks + Task 13)             |
| Ledger | `.superpowers/sdd/progress.md` (gitignored — recover from `git log` if lost) |
| Done   | Tasks 1–8 **and 13**, all reviewed clean                                     |
| Next   | **Task 9 — rollover wiring.** BASE = current HEAD                          |

Prerequisite **v0.27.0 is shipped and live** (the sport-vocabulary fix).
Nothing here depends on further deployment.

## Start here

Then **Task 9 — the riskiest task on the branch.** Full gate required,
**including `npm run build`**: `tsc` does not model the `"use server"` rule
that every export be async, and only the build catches it. Task 9 must pass
**both** `level.ceilingHours` and `level.floorHours` into `weeklyTargetHours`.

The working tree is clean and the full suite is green (1070 passed / 321
skipped).

## How to run the remaining tasks

Execution mode is `superpowers:subagent-driven-development`, chosen by the
user. Scripts live at:

```
/home/vscode/.claude/plugins/cache/superpowers-marketplace/superpowers/6.1.1/skills/subagent-driven-development/scripts/
```

Per task N:

```bash
SKILL=/home/vscode/.claude/plugins/cache/superpowers-marketplace/superpowers/6.1.1/skills/subagent-driven-development
"$SKILL/scripts/task-brief" docs/plans/2026-07-28-race-driven-volume-phase1.md N
# dispatch implementer (model: sonnet) with brief path + report path
"$SKILL/scripts/review-package" <BASE_BEFORE_IMPLEMENTER> HEAD
# dispatch reviewer (model: sonnet) with brief + report + package paths
```

BASE is the commit recorded **before** dispatching the implementer — never
`HEAD~1`, which silently truncates multi-commit tasks.

**User preference: executing subagents run on Sonnet 5.** The final
whole-branch review is the exception — dispatch that on Opus.

### The instruction that has earned its place in every dispatch

> If any test's numeric expectation does not hold, STOP and report rather than
> loosening the test, adjusting the expectation, or tweaking a constant.

**It has now caught six real defects, and every single time the PLAN was
wrong and the code was right.** Implementers stopped on Tasks 2, 3, 6 and 7.
Do not drop it.

The converse also holds, and Task 13 proved it: when a test and a model
disagree, the model is worth suspecting too. An assertion Task 3 had to
overturn became true again once the model was made coherent.

## Remaining tasks

| #   | Task                               | Notes                                                                          |
| --- | ---------------------------------- | ------------------------------------------------------------------------------ |
| 9   | Rollover wiring                    | Exports `periodize`; riskiest task — full gate required, **including `npm run build`**. |
| 10  | Race form fields + stages          | `RacesSection` props are `{ races, hideHeading? }` — no `sports` prop.         |
| 11  | `WeekRationale` + shortfall line   | Renders reasons already in `plan_adjustments`.                                 |
| 12  | `EventReadiness`                   | Page computes `assessFeasibility` itself; Task 8 deliberately does not judge.  |

**Owed at Task 9/12:** `weeksToGrow` returns `Infinity` when `currentWeeklyHours`
is zero (not merely null). The verdict maths resolves sanely, but the raw field
is returned and the UI stub in the plan renders
`` `${Math.max(feasibility.volumeWeeksNeeded, …)} weeks` `` — which would print
**"Infinity weeks"** to the athlete. Not reachable yet, since nothing called
`assessFeasibility` until Task 12.

Then: final whole-branch review (**Opus**), then
`superpowers:finishing-a-development-branch`.

## Both open decisions are SETTLED and IMPLEMENTED (Task 13)

The user delegated both ("take the lead on both and proceed"). They were
**coupled** — fixing the ladder without fixing the pricing would have been
incoherent. Do not reopen either.

**1. The FTP ladder is now continuous.** `FTP_FRACTION` step bands became
`FTP_FRACTION_ANCHORS` (3h→0.85, 5h→0.75, 8h→0.68), linearly interpolated and
**flat outside the range**. Same three fractions; only how they are reached
changed. The cliff is gone: 114km/116km predicted 4.985h/5.424h, now
4.981h/5.081h.

**The flat tail above 8h is load-bearing, not laziness.** Extrapolating the
decline out to a 42-hour "ride" would produce a sustainable fraction no rider
has been measured at. The 8h anchor position is **new and Low confidence** — it
is a reading of what the old `>5h` band meant, not a published figure.

**2. A multi-day event is priced per DAY, not as one continuous ride.** The
ladder models *within-ride* fatigue, and riders sleep between stages. Charging
an 8-day tour the deep-fatigue fraction it would earn by riding 42 hours
without sleeping was a category error.

**Cumulative cross-day fatigue is real and deliberately NOT modelled.** There
is no published magnitude for it in the evidence base, and inventing one by
mispricing the duration is worse than omitting it. If it is ever added, it
belongs as its own explicit term, not folded into the duration.

Numbers after, computed independently **three times** — coordinator,
implementer and reviewer all matched to four decimals:

| quantity                 | before | after  |
| ------------------------ | ------ | ------ |
| fondo 130km/4000m        | 6.82h  | 6.57h  |
| tour day 112.5km/2500m   | 4.92h  | 4.90h  |
| tour total (8 days)      | 42.09h | 39.18h |
| tour weeklyHours         | 16.8   | 15.68  |
| fondo weeklyHours        | 11.4   | 10.95  |
| whole-block 900km/20000m | 42.09h | 42.09h |

Fondo and century still sit inside the published 8–12 h/week band. **The tour
still exceeds the ceiling and still reports the athlete under-prepared — that
conclusion is robust to both changes.**

**The satisfying part, and the lesson.** Task 3 had to *overturn* the original
plan's assertion that the staged and unstaged paths agree within 0.05h — they
were 0.283h apart, because the two paths were priced on different fatigue
bands. With per-day pricing the gap is **0.012h and the original assertion is
restored and passes.** The plan author's instinct was right; the model was
wrong. When a test and a model disagree, the model is worth suspecting too.

Convergence was checked, since a continuous fraction could in principle
oscillate where coarse bands could not: a sweep of ~9,000 combinations of
distance × elevation × FTP × mass, 3-pass loop against 40-pass, found **zero
oscillations**, all traces monotone toward the fixed point, worst-case residual
0.0497h at an unrealistic 25km/4000m case and thousandths of an hour on
realistic rides. `POWER_ITERATIONS = 2` stays.

## What the model does now — settled, research-backed

```text
ratio(days) = 0.60 × days ^ 0.686
weeklyHours = totalEventHours / ratio(days)
then: max(floor 0.6 × peak), then min(ceiling 1.3 × peak)
```

Anchors, both published: **0.60 at one day** (a 200–350 TSS sportive against
~630 sustainable weekly TSS at CTL 90, cross-checked against 8–12 h/week century
plans) and **2.50 at eight days** (CTS: "a multi-day event is likely 2-3 times
your normal weekly training load"). A reviewer re-derived the exponent:
`ln(2.5/0.6)/ln(8) = 0.68630`, so `0.686` is plain rounding of the two anchors,
**not tuned toward any output**.

| Event              | Total | Raw   | Final           | Literature |
| ------------------ | ----- | ----- | --------------- | ---------- |
| 8-day alpine tour  | 42.1h | 16.8h | 11.6h (ceiling) | —          |
| 1-day alpine fondo | 6.8h  | 11.4h | 11.4h           | 8–12       |
| Flat century ~5h   | 5.6h  | 9.4h  | 9.4h            | 8–12       |
| Local crit         | 1.3h  | 2.1h  | 5.3h (floor)    | n/a        |

**Do not tune these constants to match the athlete's own estimate of what they
can manage.** The tour asking 16.8h against 9h of actual training means the
event is 4.7× their weekly load where 2–3× is normal — they are under-prepared
by the published guideline, and surfacing that is the entire point of the
feasibility verdict.

`HEADROOM = 1.3` is the ACWR safe-zone upper bound (0.8–1.3, danger >1.5, worst
≥2.0). `MAINTENANCE_FLOOR = 0.6` comes from detraining research (50–75% of
volume preserves VO₂max) and exists so a criterium cannot prescribe a
detraining week. `REAL_WORLD_FACTOR` and `CLIMB_GRADIENT` have **no published
basis at all** and are flagged Low confidence in both documents.

**Still contested, and a judgement call rather than a blocker:**
`LONGEST_RIDE_FRACTION`. Gran fondo coaching calls the long ride the single
biggest predictor at 70–80% of event distance; CTS says there is nothing
magical about it and 3h rides can prepare you for a century. Spec §1.6 now says
the longest-ride gap may soften a verdict by one step but can **never** produce
"not realistic" on its own.

## Invariants later tasks must not break

- **Floor first, then ceiling.** The ceiling wins any direct conflict — it is
  the ACWR bound, and prescribing above it is the one outcome that can injure
  someone. A floor above a ceiling means the athlete's own recent peak binds.
- **`ceilingHours` is level-INDEPENDENT** and non-null whenever any usable
  hours history exists, *including* while `source` is `"calibrating"`. It is
  null only when there is no usable hours history at all. Task 6 relies on this.
- **`floorHours` is null exactly when `ceilingHours` is null.** Both derive
  from the same `peakHours` in the same function, which is why the floor lives
  in `athlete-level.ts` and not in a later wiring task.
- **Availability is a ceiling, never a target.** Surplus availability stays
  free. This is also what JOIN does, and it was explicitly decided.
- `bandFor` must not fail open on non-finite input, and `peakOf` must not
  return `NaN` — `NaN` is *not* nullish, so `ceilingHours ?? fallback` would
  carry it into arithmetic instead of falling back. Both are guarded and tested.

## Design decisions already settled — do not reopen

1. Race demand computed from distance + elevation, editable override.
2. Availability is a ceiling, never a target.
3. Shortfall → plan what you have, and state the gap and its cost.
4. Changes take effect at the next rollover; the current week is untouched.
5. One spec, two phases; Phase 1 (volume) ships alone.
6. Structured workouts as templates rendering at any duration (Phase 2).
7. Four levels derived from a rolling 12-week peak of hours AND CTL,
   whichever is lower. Slow by construction, no state machine.
8. **Architecture A** — derive at rollover, store nothing as truth.

Levels were deliberately demoted: they are a label plus a template-difficulty
input. The volume ceiling is continuous (`peakHours × 1.3`), because four
buckets would map 5.1h and 8.9h athletes to the same ceiling with cliffs at
the band edges.

## What the reviews have taught us on this branch

Worth reading before dispatching Task 7 — these are the failure shapes that
actually occurred, all of them in the plan rather than the code.

- **Task 2:** `t_climb + t_flat` billed climbing kilometres twice. Fixed with
  `CLIMB_GRADIENT` and an overlap subtraction capped at total distance.
- **Task 3:** the brief asserted `estimateRidingHours` is additive. It is not,
  by construction — it picks its FTP fraction from the duration of the call it
  is handed, so two stages on separate days each sit in a shallower band than
  one long block. The **test** was wrong; it was replaced with a stronger
  assertion (staged total strictly lower, and within 5%).
- **Task 5:** the module's central guarantee — level is the *lower* of the
  hours and CTL verdicts — was untested in the CTL-restricts direction. A
  regression deleting CTL from the decision would have passed all 8 tests.
- **Task 6:** `floorHours` had **no producer**. The feature would have shipped
  green and silently done nothing.

The pattern: **passing tests proved very little about whether the feature
worked.** Three of the four were found by reviewers reading for intent, not by
the suite. Keep reviewers pointed at "would this actually do the thing", and
tell them plainly when a finding contradicts something the coordinator decided
— two of these were caught because the reviewer was explicitly invited to
disagree.

## Traps that have already bitten

- **Dev DB password is `devpass`, not `recover`:**
  `postgres://recover:devpass@localhost:5435/recover`. Port **5434 is LIVE
  user data** — never point tests at it.
- **Never edit `.env` / `.env.local`.** They point at the dev copy
  deliberately. Override per-process only. `.env.live-restore` holds the live
  URL for read-only inspection. `BETTER_AUTH_URL` must be overridden
  per-process only — the https value forces secure-cookie mode and silently
  drops sessions over http.
- **`npm run build` must be in the gate.** `tsc` does not model the
  `"use server"` constraint that every export be an async function; only the
  build catches it. This has already caused one broken release.
- **New Vitest files importing `@/lib/db` need `describe.skipIf(!hasDb)`** or
  CI crashes instead of skipping.
- **A migration missing from `drizzle/meta/_journal.json` silently never
  runs.** The container applies migrations on boot.
- Read `node_modules/next/dist/docs/` before writing Next.js code — this is
  not the Next.js in training data (`proxy.ts`, not `middleware.ts`).
- **`.superpowers/sdd/` accumulates `task-N-*.md` across plans and they
  actively mislead.** 39 stale files were archived to
  `archive-pre-race-volume/` after a reviewer read a stale `task-8-brief.md`
  from an unrelated plan. Check a report file is actually yours before trusting
  it.

## Deferred Minors, for the final fix wave

- **`riding-time.ts` has no test targeting the overlap correction's extremes** —
  no hill-climb-time-trial saturation case, no assertion that the result never
  falls below the pure climbing time. That correction is exactly the bug Task 2
  uncovered, so it is the single piece of logic most deserving a regression
  guard. A reviewer swept ~81,600 input combinations and found no oscillation,
  negative or non-finite result, so this is a coverage gap rather than a live
  defect.
- `climbDistanceKm` is recomputed on every loop pass though it depends only on
  elevation — efficiency nit.
- `tests/race-demand-schema.test.ts` asserts `toContain("1")` on a column
  default, which would also pass for `10`, `21` or `100`.
- `demand.ts`'s `usable` stage filter admits a stage with elevation but no
  distance, yet `estimateRidingHours` requires `distanceKm > 0` and returns
  null for it — such a stage is silently dropped from the sum.
- `demand.ts`: `overrideWeeklyHours: 0` silently falls back to computed rather
  than winning outright. Untested product decision.
- Corrupt input and "no history yet" share `source: "calibrating"` in
  `athlete-level.ts`. A reviewer judged this acceptable — Task 6 has no signal
  to treat them differently — but it means two `"calibrating"` results can
  differ in shape.
- `athlete-level.ts`'s `fromHours == null || fromCtl == null` branch is **dead
  code**: `peakOf` already nulls non-finite peaks, and the earlier
  `peakHours`/`peakCtl` null check returns first, so `bandFor` only ever sees
  finite input. Predates this branch, harmless, but it should either go or be
  made reachable.
- `dedupeActivities` only collapses **different-provider** pairs within 30 min
  and 10% duration; it never touches same-provider pairs. So a turbo session
  and an outdoor ride from the same provider are never merged (correct), but
  the "genuinely separate rides" test cannot exercise the cross-provider risk
  it names.

## Open items beyond this plan

- **Phase 2** (structured workout templates + the `fitToBlock` compression
  rewrite) is specified but has no implementation plan yet.
- `fitToBlock` still overwrites `durationMins` and leaves `description`
  stale — a live bug on every compress, fixed structurally in Phase 2.
- The athlete has **three `status='active'` training plans**; the engine picks
  most-recent-created so there is no bug today, but two should be archived.
- The `<input type="time">` picker has still never been exercised by a human
  on any engine (owed since v0.26.0).
- Constants still lacking a published basis — `REAL_WORLD_FACTOR` 0.85,
  `CLIMB_GRADIENT` 0.07, `LONGEST_RIDE_FRACTION` 0.8 (contested), the level
  bands — are heuristics calibrated on one athlete and two anchors. They are
  isolated in tested constants objects so tuning is a one-line change. **They
  need real tuning against more events.** `HEADROOM` 1.3 and
  `MAINTENANCE_FLOOR` 0.6 are no longer in this list; both now have evidence.
