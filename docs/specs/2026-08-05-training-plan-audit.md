# Training plan pipeline — end-to-end audit

**Date:** 2026-08-05 · **Trigger:** an athlete training for a 6-day Dolomites
gran fondo found their week strip marking a completed ride as _missed_. Pulling
that thread produced a plan made entirely of running workouts, and the audit
below.

Every finding is verified against the code, and where a live claim is made it
is verified against the production database.

## The pattern behind almost all of it

**An unrecognised value silently becomes a plausible default instead of an
error.** `?? "Run"`. `=== "Bike"` falling through to a catch-all. A null demand
quietly reverting to a typed-in figure. Nothing throws, nothing logs, and the
output is always _a_ plan — just the wrong one.

This is why the defects were found by riding rather than by reading. A plan
full of running workouts is indistinguishable, in the database and in every
test, from a plan that was supposed to be running.

The remedy that recurs below is the same each time: **make the unrecognised
case loud.**

---

## Critical

### F1 — Three silent `→ Run` defaults

| Site                       | Defect                                                                                                   |
| -------------------------- | -------------------------------------------------------------------------------------------------------- |
| `training-plan.ts:203`     | `inferSports` returns an explicit override **verbatim** — no canonicalisation                            |
| `training-plan.ts:385-388` | `sports[0] === "Bike"` is a raw equality; everything else falls to `return generateRunningWorkouts(...)` |
| `materialize.ts:243`       | `raceWeekWorkouts(input.sports[0] ?? "Run", raceIdx)`                                                    |

`canonicalSport("Ride") → "Bike"` has existed since v0.27.0, but was only ever
wired into _activity matching_, never into the planner's own input.

**Live consequence:** plan `34a69f25` (created 2026-08-04, race
`gran_fondo` 2026-09-13) stores `constraints.sports = ["Ride"]` — the provider
word, not the planner's. All six training blocks, 24 sessions, are `sport: Run`.
The three archived plans all say `["Bike"]` and were correct.

The weekly rollover re-reads `constraints.sports` on every materialisation, so
this reproduces itself weekly until the stored value is corrected.

### F2 — Cross-sport training books to nowhere, and it compounds

`runDailyAdaptation` (`week-plan/service.ts`) books activity load in exactly
two branches:

1. yesterday's status is `planned`/`moved`/`adapted` → match on **that slot's
   sport**; on a match, book the load
2. yesterday's status is `rest`/`race` → match **any** activity, book as
   `unplannedLoad`

**There is no third branch.** A day that had a planned session, done as a
different sport, matches neither: `yesterdayCompleted = false` marks it missed,
and `matched` stays null, so the work is booked **nowhere** — not even as
`unplannedLoad`.

`weekActuals` sums `actualLoad + unplannedLoad` (`service.ts:133`), so the week
under-reports by exactly the lost work. When it closes with a total of zero,
`materialize.ts:44` fires:

```ts
if (!taperWeek && prevWeek && prevWeek.actualLoad === 0) {
  return { load: Math.round(skeletonTarget * MISSED_WEEK_RESTART), ... } // 60%
}
```

**Live consequence:** on 2026-08-04 the athlete rode 131 min, load 136
(`intervals_icu`, sport `Ride`) against a planned Tempo **Run**. Every day of the
open week reads `actualLoad: null, unplannedLoad: null`. The week will close at
`actualLoad 0` and cut week 2's target from **630 to 378**.

This is the same compounding collapse v0.27.0 diagnosed and fixed, reached
through a different door. Note that F1 and F2 are independent: fixing the sport
vocabulary makes this athlete's rides match again, but any cross-sport day — a
cyclist who runs, a planned run done as a ride — still loses the work.

### F3 — The race-demand model is cycling-only, and is applied to every sport

`estimateRidingHours` (`race/riding-time.ts`) is the drag equation: `CdA`,
air density, an FTP fraction ladder, and `massKg` documented as _"Rider plus
bike plus kit"_. `volume-inputs.ts:198` calls `eventDemand` for whatever race is
the target, **with no sport check anywhere in the path**.

- A runner **with** an FTP (any cyclist who also runs, or an eFTP synced from
  intervals.icu): a 42.2 km marathon is priced as roughly 1.2 h of _cycling_
  against a real 3–4 h run. Demand is understated by a factor of ~3.
- A runner **without** an FTP: `eventDemand` returns `null`, so `volume.ts`
  takes its `ceilingHours == null || raceDemandHours == null` branch and the
  entire race-driven volume feature silently reverts to
  `constraints.hoursPerWeek`.
- A triathlon: the swim and run legs priced as a bike ride.

Harmless for the reporting athlete (cyclist, FTP 310). Wrong for everyone else,
and silent in both directions.

---

## Important

### F4 — Two authorities for triathlon

`generateWorkouts` routes triathlon off **raceType** (`isTriathlon(raceType)`)
but cycling off the **sports list**. A race whose sport says Triathlon but whose
raceType is not in `isTriathlon`'s substring list — a duathlon, an aquabike, or
simply an unusual spelling — fails the first test, fails `=== "Bike"`, and
produces a running plan.

Found while checking whether triathlon plans include swim sessions. They do:
`generateTriathlonWorkouts` splits Swim 20 % / Bike 40 % / Run 40 % and emits a
dedicated Tuesday swim plus Run/Swim fill days.

### F5 — `constraints.hoursPerWeek` is written once and never updated

The only writer is `training-plan.ts:856`, at plan creation. It is the fallback
target for every case where demand or ceiling is null — that is, it matters
most exactly when the derived path has given up.

### F6 — A tool parameter documents behaviour that does not exist

`generate_training_plan`'s `sports` parameter is described as _"Override sports
list. Defaults to athlete profile."_ **There is no athlete profile sport
anywhere in the schema.** The description describes nothing, and this is the
parameter through which `["Ride"]` entered.

### F7 — Two vocabularies for race type

`races.race_type` is free text (live value: `GranFondo`), while
`generate_training_plan`'s `raceType` is a closed 13-value enum (live value:
`gran_fondo`). Sport inference runs against both spellings.

---

## Lower

### F8 — No swim branch in `generateWorkouts`

A swim-only plan produces running workouts. Closed by v0.42's decision to
restrict the sport set to what the generator actually supports.

### F9 — Availability blocks can silently drop a discipline

Block matching tests `s.sports === null || s.sports.includes(w.sport)`. A
triathlete whose evening blocks are marked bike-only loses swim sessions with
no signal. Not reachable for the reporting athlete (blocks are `sports: null`).

### F10 — `trailingWeeklyAverages` is dead code that would grade ~2× high

Zero production callers. It does not dedupe, and every ride exists twice
(intervals.icu + Strava). Wiring it up as-is would read the athlete's trailing
volume as double.

### F11 — `CLIMB_GRADIENT` is the demand model's largest hardcoded lever

Measured on the live race (6 days, 719 km, 19 550 m, FTP 310, 77.5 kg), varying
one constant at a time:

| Constant         | Current | Plausible range | Weekly-hours swing         |
| ---------------- | ------- | --------------- | -------------------------- |
| `CLIMB_GRADIENT` | 0.07    | 0.05 – 0.10     | **3.41 h** (14.44 → 17.86) |
| kit mass         | +8 kg   | +5 – +15        | **1.31 h** (16.00 → 17.31) |
| `CdA`            | 0.32    | 0.24 – 0.40     | **1.29 h** (15.70 → 16.98) |

`CLIMB_GRADIENT` is the assumed steepness of an event's _climbing_ sections,
used for the overlap correction. It is a single global constant applied
identically to an alpine stage race and a flat century, and it outweighs mass
and CdA combined.

Kit mass and CdA are both genuinely **per-athlete** properties (a 6.8 kg race
bike versus a 12 kg gravel setup; a tuck versus sitting up) and are addressed
in v0.45. `CLIMB_GRADIENT` is a **per-race** property and needs its own design.

**These matter more than their size suggests:** this athlete's ceiling is
`13.44 h peak × 1.3 = 17.47 h` and their computed demand is 16.39 h — _below_
the ceiling, so the demand figure binds rather than being clamped away. The
constants above move the prescribed volume directly.

---

## Sequenced releases

| Release                             | Findings                    | Rationale                                              |
| ----------------------------------- | --------------------------- | ------------------------------------------------------ |
| **v0.42 — One sport, decided once** | F1, F4, F6, F8              | One root cause: sport has no single authority          |
| **v0.43 — No training is lost**     | F2                          | Independent root cause; needs its own tests            |
| **v0.44 — Demand knows its sport**  | F3, F7                      | Requires a running/tri demand model — real design work |
| **v0.45 — Equipment profile**       | part of F11 (mass, CdA)     | Per-athlete accuracy, once the above are right         |
| Backlog                             | F5, F9, F10, F11 (gradient) | Real, not urgent                                       |

**Ordering principle:** fix what is wrong by 100 % before what is wrong by 5 %.
Demand accuracy (v0.45) is refinement of a number currently computed for the
wrong sport (F3), fed into a plan of the wrong sport (F1), scored against
actuals that silently read zero (F2).

**One item does not wait for a release.** F2 harms the reporting athlete before
v0.42 can ship: the open week closes at zero and cuts week 2 to 378 regardless
of what lands afterwards. The data repair — book the lost ride, regenerate the
plan as cycling — is independent of the release work and should happen first.
