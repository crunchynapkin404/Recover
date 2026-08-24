# Strength training — design

`docs/ROADMAP.md`'s demand map, row "Strength training" — 155 votes as of a
live re-read on 2026-08-24 (up from 121 at the last read, and now the
highest-vote open row after the two Recover already leads or has flagged as a
Phase 3 gap). Genuinely absent: no second-sport load model, no strength
concept anywhere in the schema or the planner. Every claim below about
existing behaviour was read out of the file that implements it.

## What exists today

Strength activities already **sync in** — Strava/intervals.icu send a
`WeightTraining` (or generic `Workout`) discipline, which lands in
`activities.sport` as free text like any other row. Two things follow from
that, neither of them "absent":

- `canonicalSport()` (`src/lib/canonical-sport.ts`) only maps `Bike`/`Run`/
  `Swim`; an unmapped discipline "passes through unchanged... which is the
  honest outcome" per its own doc comment. A synced lift session can
  therefore never satisfy a planned session — correct today, since nothing
  plans one.
- `training-load.ts` has **no sport filter at all**. Its ladder (provider
  load → power TSS → HR TSS → duration estimate → none) runs on every
  activity regardless of discipline. A `WeightTraining` row with no power/HR
  data falls through to the duration rung and is counted as
  `DURATION_TSS_PER_HOUR` (40) of endurance zone-2 load — silently blended
  into CTL/ATL today. This design stops that miscount as a side effect of
  giving strength its own recognized sport, not as a separate fix.

There is no per-lift maximum anywhere (`bodyPrefs` has `ftpWatts`,
`ftpWattsIndoor`, `thresholdPaceSecPerKm` — nothing for resistance work), no
`Purpose` value for strength (`src/lib/availability/types.ts`'s `Purpose`
union is exhaustive over `recovery`/`aerobic_base`/`threshold`/`vo2max`/
`brick`/`long`), and no exercise/prescription concept in `PlannedWorkout`
(`src/lib/training-plan.ts`).

## Scope: structured, periodization-aware, big-4 only

Four decisions fix the shape by construction, made in that order:

1. **Structured prescription, not a reserved slot.** A planned strength
   session names sets, reps and a target load — the resistance-training
   analogue of a planned bike session's zone and duration, not a placeholder
   the athlete's own program fills in.
2. **1RM-anchored, refuse-when-unset.** Same contract as `ftpWatts`/
   `thresholdPaceSecPerKm`: an athlete-entered figure per lift, and no
   fabricated number when it's missing.
3. **Periodization-aware.** Volume and intensity follow the plan's existing
   per-week `phase` (`Block["phase"]`, `src/lib/training-plan.ts:242` —
   `"base" | "build" | "peak" | "taper" | "recovery"`, already computed for
   every week of every plan) rather than a fixed template or a standalone
   linear-progression counter. One phase drives both sports; there is no
   second "what week is it" to disagree with the first.
4. **Tightly coupled.** Strength sessions are placed by the same
   skeleton/materialize/fill pipeline Bike/Run/Swim already use — a new
   candidate type for existing machinery, not a parallel pipeline.

**Non-goals, explicitly:**

- **Accessory lifts, exercise selection, unilateral/bodyweight movements.**
  Squat, bench press, deadlift, overhead press only. A broader library is an
  exercise-catalog project, not this one.
- **RPE/auto-regulation.** Pure %1RM. No adjustment for how a set actually
  felt beyond the readiness-band substitution below.
- **Week-to-week progression within a phase.** The table below changes only
  at phase transitions. A StrongLifts-style weekly increment is a separate,
  later feature.
- **Blending strength load into endurance CTL/ATL.** Deliberately a second,
  separate figure — see "Completion and load" below.
- **Historical backfill.** Activities synced before this ships stay
  uncounted; no retroactive reclassification.

## Decisions

| #   | Decision                                                                                                                                                                       | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Four new nullable `bodyPrefs` columns: `squatOneRm`, `benchOneRm`, `deadliftOneRm`, `overheadPressOneRm` (kg)                                                                  | Additive migration, same shape as `ftpWattsIndoor`. No join table for a fixed four-lift v1 — YAGNI over a normalized exercise table nothing else needs yet.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| D2  | `Purpose` gains `"strength"` (`src/lib/availability/types.ts`); `PURPOSE_FLOORS.strength = 20`                                                                                 | A strength session is gated and floored by the same mechanism every other purpose already uses, not a bespoke check. 20 min matches `recovery`'s floor — the shortest big-4 session still worth doing. Confidence: Low, same uncited-convention labeling as its siblings.                                                                                                                                                                                                                                                                                                                                                                                                         |
| D3  | `ENERGY_CEILING.easy` does **not** admit `"strength"`; `.normal` and `.full` do. `SUBSTITUTE_TO.strength = "recovery"`                                                         | A fixed-load lift under low readiness is closer to `threshold`/`vo2max` risk-wise than to `aerobic_base` — excluded from `easy` for the same reason those are. Substituting to `recovery` (skip the lift, do an easy session instead) reuses the existing degrade-to-a-lesser-purpose mechanism exactly; no new intra-purpose intensity-reduction concept is needed. **This replaces an earlier, wrong instinct from the design discussion** — a bespoke `adaptDay` branch that scaled `pctOneRm` down a phase-row on amber readiness. That mechanism doesn't exist anywhere else in this codebase; `ENERGY_CEILING`/`SUBSTITUTE_TO` already solves the same problem more simply. |
| D4  | `PlannedWorkout` gains `sport: "Strength"` as a value and one new optional field, `exercises?: StrengthExercise[]`                                                             | Keeps every existing generic consumer (`DaySlot.workouts`, `blockFits`, any display that renders "a session") working untouched — a strength row is still a `ScheduledWorkout`. `description` carries the human-readable line; `exercises` carries the structured data for anything that reasons about it.                                                                                                                                                                                                                                                                                                                                                                        |
| D5  | New pure function `strengthPrescription(phase, oneRms)` returning `StrengthExercise[]`, keyed on the exact same `Block["phase"]` union the endurance skeleton already produces | One table, one input type — no second phase vocabulary to keep in sync with the endurance one. Per-lift: if that lift's 1RM is null, its `targetLoadKg` is null and the UI renders the refuse-state, but sets/reps still display (the prescription is not all-or-nothing per session).                                                                                                                                                                                                                                                                                                                                                                                            |
| D6  | `canonicalSport()` gains a `Strength` bucket: `weighttraining → Strength`. `workout` (Strava's generic catch-all) is **left unmapped**                                         | `weighttraining` is unambiguous. `workout` is not — it's Strava's fallback for anything it can't otherwise classify, and silently claiming all of it as strength would misclassify whatever else lands there. Judgment call, flagged for the implementer rather than assumed.                                                                                                                                                                                                                                                                                                                                                                                                     |
| D7  | Completed strength sessions get a flat per-session `actualLoad`, not a TSS-derived one, and are never summed into endurance CTL/ATL                                            | See "Completion and load" below — the provider payload cannot support anything more precise, and inventing one would be exactly the fabricated-number class this app refuses elsewhere.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| D8  | New MCP tool `get_strength_prescription`, scope `read`, additive only                                                                                                          | Mirrors `get_race_pacing`'s v0.116.0 addition. Tool surface count moves in `API-STABILITY.md`; no existing tool's schema changes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

## The prescription table

`strengthPrescription(phase, oneRms)`, keyed on `Block["phase"]`. An
uncited-but-standard linear-periodization scheme, same confidence labeling as
`plan-constants.ts`'s own phase constants:

| Phase      | Sets × reps | % 1RM | Confidence |
| ---------- | ----------- | ----- | ---------- |
| `base`     | 4×8         | 65%   | Low        |
| `build`    | 4×5         | 75%   | Low        |
| `peak`     | 3×3         | 82%   | Low        |
| `taper`    | 2×3         | 78%   | Low        |
| `recovery` | 2×8         | 55%   | Low        |

Frequency: **2×/week**, dropping to **1×/week** when `phase === "taper"` — a
separate constant from the table above, same confidence label. Placed by the
existing fill rung wherever a block fits, same as any other session type.

## Completion and load — an honesty boundary

`WeightTraining` activities from Strava/intervals.icu carry duration and
sometimes average HR — **never per-set reps or load**. So Recover can verify:

- that a strength session happened (sport + duration match, exactly the
  existing `sportMatches` check every other completion relies on)
- **not** that the athlete did what was prescribed rather than something
  else entirely

The UI states this directly: a completed strength day reads "Completed",
never "as prescribed" — the same restraint `pacing.ts` already applies to
anything it can't back with a real number. `actualLoad` for a completed
strength session is a flat, named constant, `STRENGTH_SESSION_LOAD = 30` —
below `DURATION_TSS_PER_HOUR`'s 40, since a lift session is shorter than the
duration rung's hour and this number must never be read as commensurate with
an endurance TSS. Confidence: Low, same uncited-convention labeling as
`training-load.ts`'s other fallback rungs. Tracked as its own figure per
session, never summed into `training-load.ts`'s CTL/ATL. Where it surfaces
(Fitness page, History, both) is left to the implementation plan; the
constraint that matters is that it never merges with the endurance number.

## Settings UI

`body-prefs-card.tsx`: a new "Strength maxes" group beside "Training
thresholds" — four optional kg fields (Squat, Bench, Deadlift, Overhead
Press), same visual treatment and the same "set your squat max to get a
target" refuse-state pattern as outdoor/indoor FTP. `body-actions.ts`'s
`setBodyPrefs` input and validation grow four fields, identical pattern to
the existing `ftpWatts`/`ftpWattsIndoor` checks (a `MIN_ONE_RM`/`MAX_ONE_RM`
pair, values TBD by the implementer against reasonable human lift ranges).

## Train UI

A strength row renders in the day list alongside Bike/Run/Swim rows, e.g.:

```
Squat 4×8 @ 65% (130kg) · Bench 4×8 @ 65% (68kg)
```

Same visual weight as an endurance session's `Endurance · 60 min Z1-Z2` line.
A lift with no 1RM set shows sets/reps with no load figure and a link to
Settings, not a blank or a fabricated number.

## Touch points with no design decision here

- `scripts/export-import-drill.ts`'s `Carried<>` fixture and
  `import-user.ts`'s field mapping need the four new columns touched, same as
  the indoor-FTP release. Named now so it isn't a surprise mid-implementation.
- Exactly where `actualLoad`'s flat constant surfaces in the UI (Fitness
  page, History, both, neither) is left to the implementation plan.
- `MIN_ONE_RM`/`MAX_ONE_RM`'s exact bounds are left to the implementer —
  the pattern (reject non-integer or out-of-band kg) is what's designed here,
  not the specific numbers.

## Migration

**Additive only.** One migration, four new nullable `body_prefs` columns, no
backfill. Old code ignores columns it doesn't know about — an image rollback
past this release is safe, same shape as v0.118.0's own migration.

## Testing

Per `docs/RELEASING.md` step 3, every new branch gets a mutation-checked
test — break it, confirm a test fails, revert:

- `strengthPrescription`'s five phase branches, each actually asserted to
  land on its own row (not just "the function returns something") — the same
  gap a reviewer had to catch by hand for `weakestOfTriathlonAnchors` in the
  indoor-FTP release, called out here so it's built in from task one.
- `canonicalSport`'s new `Strength` bucket, and that `sportMatches` now
  completes a planned strength session it previously could not.
- `ENERGY_CEILING`/`SUBSTITUTE_TO`'s new `strength` entries, exercised
  through `adaptDay` at each energy level, not just as data-table assertions.
- The refuse-state per lift (one 1RM set, others null) — a session must be
  able to show partial prescriptions, not all-or-nothing.
- No new capture surface for the prescription table itself (unit-testable
  more precisely than a screenshot); a new/extended `train*` surface is
  warranted once a strength row actually renders on Train, the same
  reasoning `train-race-pacing` was built on in v0.117.0.
