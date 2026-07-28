# Handoff — Race-Driven Training Volume, Phase 1

**Written 2026-07-28.** Everything a fresh session needs to resume without
re-deriving anything. Read this, then the ledger, then the plan.

## Resume in three commands

```bash
cd /home/vscode/recover
git checkout feat/race-driven-volume        # HEAD 7b5eb76
tail -40 .superpowers/sdd/progress.md       # the ledger is authoritative
```

**Tasks the ledger marks complete are DONE. Do not re-dispatch them.** After
any compaction, trust the ledger and `git log` over recollection.

## State

| | |
| --- | --- |
| Branch | `feat/race-driven-volume` (off `docs/race-driven-volume-spec`, off `main`) |
| Spec | `docs/specs/2026-07-28-race-driven-volume-design.md` (approved) |
| Plan | `docs/plans/2026-07-28-race-driven-volume-phase1.md` (12 tasks) |
| Ledger | `.superpowers/sdd/progress.md` (gitignored — recover from `git log` if lost) |
| Done | Tasks 1 and 2, both reviewed clean |
| Next | **Task 3 — unified event demand model** |

Prerequisite **v0.27.0 is already shipped and live** — the sport-vocabulary
fix. Nothing here depends on further deployment.

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
# dispatch implementer (model: sonnet) with the brief path + report path
"$SKILL/scripts/review-package" <BASE_BEFORE_IMPLEMENTER> HEAD
# dispatch reviewer (model: sonnet) with brief + report + package paths
```

BASE is the commit recorded **before** dispatching the implementer — never
`HEAD~1`, which silently truncates multi-commit tasks.

**User preference: executing subagents run on Sonnet 5.** The final
whole-branch review is the exception — dispatch that on Opus.

## Remaining tasks

| # | Task | Notes |
| --- | --- | --- |
| 3 | Unified event demand model | Depends on Tasks 1–2. Bands already recalibrated against the corrected physics. |
| 4 | Dedupe trailing weekly averages | **Breaks 4 existing test fixtures** — Step 1 updates them first, deliberately. |
| 5 | Athlete level + continuous ceiling | Rolling 12-week peak. |
| 6 | `weeklyTargetHours` | The rollout-safety property lives here. |
| 7 | Feasibility verdict | Imports `RAMP_CLAMP_PCT` from `week-plan/types.ts`. |
| 8 | `assembleVolumeInputs` | The only DB-touching module of the five. |
| 9 | Rollover wiring | Exports `periodize`; the riskiest task — full gate required. |
| 10 | Race form fields + stages | `RacesSection` props are `{ races, hideHeading? }` — no `sports` prop. |
| 11 | `WeekRationale` + shortfall line | Renders reasons already in `plan_adjustments`. |
| 12 | `EventReadiness` | Page computes `assessFeasibility` itself; Task 8 deliberately does not judge. |

Then: final whole-branch review (Opus), then
`superpowers:finishing-a-development-branch`.

## What Task 2 already taught us

The TDD cycle caught a genuine modelling bug in the spec, not a
transcription error. The original formula charged the whole distance at flat
speed **and** added the climbing time — but a rider covers ground while
climbing, so ascending kilometres were billed twice. A 130km/4,000m alpine
fondo came out at 8.6h for a 3.9 W/kg rider who rides it in about 6:30.

Fixed with a `CLIMB_GRADIENT` constant and an overlap subtraction, capped at
the total distance so a hill-climb time trial cannot go negative. Verified
against both anchors:

```text
tour   900km/20,000hm, 8 days  ->  42.09h  ->  5.26 h/day  ->  9.21 h/week
fondo  130km/4,000hm,  1 day   ->   6.82h               ->  11.94 h/week
```

**The single fondo asks more per week than the 8-day tour, and that is
correct.** The tour averages 112km/2,500m per day, an easier day than the
fondo. The tour's extra demand is repetition, met by back-to-back long rides
(Phase 2 §2.5) rather than weekly volume. The reasoning is written into the
test so nobody "fixes" it later.

`as const` on `DEMAND_CONSTANTS` pins `INITIAL_FTP_FRACTION` to the literal
`0.75`, so `let fraction: number` needs its explicit annotation.

## ⛔ BLOCKING — the demand formula is wrong. Fix before Task 3.

**Do not implement Task 3 as written.** The user spotted this and they are
right: the formula makes a bigger event ask for LESS training.

`weeklyHours = (totalEventHours / eventDays) × 7 × TRAINING_FRACTION` keys off
the AVERAGE DAILY duration and discards total event load. The 8-day tour is 42
riding hours; the single fondo is 6.8 — a 6× difference — yet the tour comes out
LOWER (9.2h vs 11.9h) purely because its average day is easier. Averaging is the
error: eight consecutive days are cumulative, and the capacity to ride day six is
built by chronic weekly volume.

The spec's claim that "multi-day demand is met by plan shape, not volume" (§1.1,
§2.5) was used to justify having no multi-day term at all. That was
rationalisation — the coaching sources say the decisive quality is recovering day
after day, which is built by volume AND structure.

**Research pass done — see `docs/specs/2026-07-28-training-volume-evidence.md`.**
It replaces several guesses with published anchors (ACWR for the ceiling,
detraining literature for a new floor, CTS's 2-3× rule for multi-day) and flags
which constants remain unsourced. Read it before amending the formula.

STILL OPEN: the single-day path has no clean quantitative anchor, and the two
coaching sources actively disagree on whether the long-ride rule matters.

**Earlier proposed fix** (superseded in part by the research):

```text
weeklyHours = dailyRate × 7 × 0.20 × (1 + MULTI_DAY_SLOPE × ln(days))
              TRAINING_FRACTION 0.25 → 0.20,  MULTI_DAY_SLOPE ≈ 0.25
```

| event | total | /day | current | proposed |
| --- | --- | --- | --- | --- |
| 8-day alpine tour | 42.1h | 5.26 | 9.2h | **11.2h** |
| 1-day alpine fondo | 6.8h | 6.82 | 11.9h | **9.6h** |
| 3-day stage race | 13.6h | 4.53 | 7.9h | 8.1h |
| local crit | 1.3h | 1.28 | 2.2h | 1.8h |

**Second hole, exposed by the same check: a criterium prescribes 1.8 h/week.**
The model is volume-only, so a short intense event reads as almost no demand and
the plan would DETRAIN the athlete. Needs a floor tied to what they already do —
most naturally the rolling peak from Task 5 — so entering a short race can never
prescribe less than maintaining current fitness.

Both need a spec amendment (§1.1) and a plan amendment (Task 3's formula,
constants and test bounds) before Task 3 is dispatched. Tasks 1 and 2 are
unaffected: `estimateRidingHours` returns event hours and is independent of how
those become a weekly target.

## Design decisions already settled — do not reopen

1. Race demand computed from distance + elevation, editable override.
2. Surplus availability stays free. **Availability is a ceiling, never a
   target** — this is also what JOIN does, and it was explicitly decided.
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

## Traps that have already bitten

- **Dev DB password is `devpass`, not `recover`:**
  `postgres://recover:devpass@localhost:5435/recover`. Port **5434 is LIVE
  user data** — never point tests at it.
- **Never edit `.env` / `.env.local`.** They point at the dev copy
  deliberately. Override per-process only. `.env.live-restore` holds the live
  URL for read-only inspection.
- **`npm run build` must be in the gate.** `tsc` does not model the
  `"use server"` constraint that every export be an async function; only the
  build catches it. This has already caused one broken release.
- **New Vitest files importing `@/lib/db` need `describe.skipIf(!hasDb)`** or
  CI crashes instead of skipping.
- **A migration missing from `drizzle/meta/_journal.json` silently never
  runs.** The container applies migrations on boot.
- Read `node_modules/next/dist/docs/` before writing Next.js code — this is
  not the Next.js in training data (`proxy.ts`, not `middleware.ts`).

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

## Open items beyond this plan

- **Phase 2** (structured workout templates + the `fitToBlock` compression
  rewrite) is specified but has no implementation plan yet.
- `fitToBlock` still overwrites `durationMins` and leaves `description`
  stale — a live bug on every compress, fixed structurally in Phase 2.
- The athlete has **three `status='active'` training plans**; the engine picks
  most-recent-created so there is no bug today, but two should be archived.
- The `<input type="time">` picker has still never been exercised by a human
  on any engine (owed since v0.26.0).
- Constants (`TRAINING_FRACTION` 0.25, `HEADROOM` 1.3,
  `LONGEST_RIDE_FRACTION` 0.8, `CLIMB_GRADIENT` 0.07, the level bands) are
  heuristics calibrated on one athlete and two anchors. They are isolated in
  tested constants objects so tuning is a one-line change. **They need real
  tuning against more events.**
