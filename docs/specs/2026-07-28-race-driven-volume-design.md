# Race-Driven Training Volume & Structured Workouts

**Status:** drafted 2026-07-28, awaiting review — not yet approved
**Phases:** 1 (volume) ships independently; 2 (structure) follows
**Prerequisite:** v0.27.0, which made completed sessions visible to the planner

## The problem

An athlete training ~9 hours a week, offering 12.5 hours of availability, and
preparing for an alpine gran fondo was planned **4.9 hours**.

Three causes, in descending order of blame:

1. **The planner could not see the athlete train.** Fixed in v0.27.0 — the
   completion matcher compared the plan's `Bike` to the provider's `Ride`, never
   matched, and every week closed as "fully missed" and restarted at 60%. Out of
   scope here; it is the precondition that made the rest visible.
2. **Weekly hours are a number typed once and never revisited.**
   `constraints.hoursPerWeek` is set by the AI coach at plan creation
   (`generate-training-plan.ts`, default 8) and **no code path updates it**. It
   had read 10 since 15 July.
3. **A race contributes nothing to volume.** `races` stores name, type, sport,
   date, priority, status and a note. No distance, no elevation, no expected
   duration. To the engine, an alpine gran fondo and a Tuesday-night crit are
   identical; a race only triggers the taper.

Separately, and the reason Phase 2 is in the same spec: `fitToBlock` compresses
by overwriting `durationMins` and leaves `description` untouched, so a session
compressed 60→35min still reads "6×800m at 5K-10K pace". That fires on every
compress today.

## What this is not

**Availability will not drive volume.** It stays a ceiling
(`Math.min(hoursBudget, neededHours)`), which is also what JOIN does:

> Setting your availability to a certain number of hours on a day doesn't
> automatically mean you'll get a ride of that duration — it just means that's
> the maximum amount of hours you have at your disposal.

Making availability a target would mean a free Saturday overrides a recovery
week and the missed-week restart. The fix is to make the _demand_ number right
and to say out loud when the ceiling binds.

## Architecture

**Derive at rollover; store nothing as the source of truth.** `periodize()`
becomes a pure function of (target hours, plan's original `startingCtl`, weeks
remaining, race demand, volume ceiling). `rolloverWeekPlan` calls it fresh each
week rather than reading `training_blocks` as truth.

Chosen because this repo is repeatedly bitten by compute-once-and-store: v0.26.1
was a live-merge-vs-stored-snapshot disagreement, v0.26.0's C4 was a one-shot
migration inference that could not be re-run, and the bug in this document is a
number frozen in July. `periodize()` is already pure and cheap.

`startingCtl` stays fixed from the plan — a historical fact — so recomputation is
deterministic and the ramp only shifts when demand or ceiling genuinely shifts.
`training_blocks` continues to be written for audit and history, but is no longer
read as authority.

## Phase 1 — Volume

### 1.1 Race demand

Migration 0033 adds three nullable columns to `races`:

| Column                  | Type      | Meaning                                  |
| ----------------------- | --------- | ---------------------------------------- |
| `distance_km`           | `real`    | null on every existing race              |
| `elevation_m`           | `integer` | null on every existing race              |
| `demand_hours_override` | `real`    | athlete's own figure; wins over computed |

**Which race drives the plan:** highest priority (A→C), then nearest date —
reusing `racesForWeek`'s existing ordering so there is one rule, not two.

New pure module `src/lib/race/demand.ts`, no I/O.

**Step 1 — estimated finish time.** Physics, because the inputs already exist in
the database (`body_prefs.ftp_watts`, `wellness_daily.eftp`,
`wellness_daily.weight_kg`):

```text
t_climb = (mass_kg × 9.81 × elevation_m) / (power_W × 3600)   hours
t_flat  = distance_km / speed_kmh(power_W)                     hours
```

`speed_kmh` from a drag model (CdA 0.32, ρ 1.225) with a single named
`REAL_WORLD_FACTOR` covering wind, corners and rolling resistance.

`power_W` is a fraction of FTP that depends on time out: ~0.85×FTP at 2–3h, 0.75
at 4–5h, 0.68 at 6h+. Circular (duration needs power, power needs duration), so
resolved by **two fixed-point iterations**.

**Step 2 — event hours → weekly hours.**

```text
recommendedHours = eventHours × VOLUME_FACTOR        // ≈ 1.8
```

Calibrated against the one real anchor available: a ~5.5h alpine gran fondo,
which the athlete independently estimated at 9–12h/week. 5.5 × 1.8 = 9.9h.

### 1.2 Athlete level and the volume ceiling

Four levels, JOIN's vocabulary, but **derived rather than declared** — the
athlete's own CTL and history are better evidence than a self-assessment.

**Hysteresis without state.** Driven by a **rolling 12-week peak**, not the
current window:

```text
peakHours = max, over the last 12 weeks, of the 28-day trailing weekly average
peakCtl   = max CTL over the last 12 weeks
level     = min(levelFromHours(peakHours), levelFromCtl(peakCtl))
```

A bad fortnight cannot move the level, because the peak from ten weeks ago still
stands. Genuine detraining does, once the peak rolls off. Stateless — a pure
function of history, no `previousLevel` to thread through, which is what the
architecture wants.

This asymmetry ("sticky up") is safe **because the level only ever sets a
ceiling**. The week's actual load is still governed by the ramp guard at ±20% of
last week's actual, so a detrained athlete is held down by the ramp guard
regardless of whether the peak has rolled off. If the level set the target
directly, the rolling peak would be the wrong mechanism.

| Level        | Peak weekly hours | Peak CTL |
| ------------ | ----------------- | -------- |
| Recreational | < 3h              | < 35     |
| Amateur      | 3–5h              | 35–55    |
| Intermediate | 5–9h              | 55–80    |
| Advanced     | ≥ 9h              | ≥ 80     |

**The level does not do the volume arithmetic.** Discretising would map an
athlete at 5.1h/week and one at 8.9h/week to the same ceiling, and would put
arbitrary cliffs at the band edges. The ceiling is continuous off the same
rolling peak:

```text
ceilingHours = peakHours × HEADROOM          // HEADROOM ≈ 1.3
```

The level's remaining jobs are (a) the label the athlete reads and (b) the coarse
difficulty input for Phase 2's templates, where four buckets is enough
resolution.

**Override:** one nullable `body_prefs.level_override`. When set it wins
outright; the computed value is still displayed beside it.

**Dependency that must not be missed:** `trailingWeeklyAverages()` in
`src/lib/weekly-targets.ts` does **not** deduplicate. An athlete connected to
both intervals.icu and Strava has every ride stored twice
(`activities` is unique on `(provider, external_id)`, so cross-provider
duplication is by design). Fed raw, it reads ~9h/week as ~18h and grades the
athlete two levels too high. It must be wired through the existing
`dedupeActivities()` in `src/lib/training-load.ts` — do not write a second
implementation.

### 1.3 Volume derivation

New pure module `src/lib/week-plan/volume.ts`:

```ts
export function weeklyTargetHours(input: {
  raceDemandHours: number | null;
  ceilingHours: number | null;
  availabilityHours: number;
  fallbackHours: number; // constraints.hoursPerWeek
}): {
  hours: number;
  source: "race" | "ceiling" | "availability" | "fallback";
  shortfall: { wantedHours: number; offeredHours: number } | null;
};
```

```text
target    = ceilingHours == null
              ? fallbackHours                                  // see below
              : min(raceDemandHours ?? fallbackHours, ceilingHours)
planned   = min(target, availabilityHours)
shortfall = planned < target ? { target, availability } : null
```

`source` names whichever input bound the result, for the legibility surface in
§1.5.

**A null ceiling must suppress race demand, not bypass it.** `ceilingHours` is
null when there is too little history to compute a rolling peak (fewer than
`MIN_FALLBACK_ACTIVITY_DAYS` activity days). Writing this as
`min(demand, ceiling ?? Infinity)` would mean a brand-new athlete who logs an
alpine gran fondo is immediately prescribed ~10h/week on no evidence at all —
the largest injury risk in this design, handed to precisely the athlete least
able to absorb it. When there is no measured ceiling the plan falls back to
`constraints.hoursPerWeek` and the shortfall line explains that the event asks
for more than an uncalibrated plan will prescribe.

**Rollout safety — the critical property.** With no race demand set,
`raceDemandHours` is null and the function returns `fallbackHours`: exactly
today's behaviour. Phase 1 is a **no-op on every existing plan** until a race is
given a distance and elevation. Nothing is migrated, nothing is recomputed
behind the athlete's back.

### 1.4 Applying a change

Under pure derivation there is nothing to recompute _into_: every future week is
already derived fresh at its own rollover, so a change to race demand or ceiling
takes effect automatically from the next rollover onward. No propagation step,
no "recompute from week N" path, no risk of a missed trigger — which is the
whole reason for choosing this architecture.

Two consequences worth stating plainly:

- **The week in progress does not change.** `rolloverWeekPlan` is what calls
  `periodize()`, and it does not run mid-week. The athlete's current sessions
  stay put, which is the desired behaviour anyway.
- **Closed weeks are never revisited.** They keep the targets they were planned
  against, so historical adherence stays honest.

If a plan ever needs its future re-derived _immediately_ rather than at the next
rollover, that is a separate, explicit action — not a side effect of editing a
race.

### 1.5 Legibility

The engine already logs its reasoning accurately into `plan_adjustments` —
`"last week was fully missed — restarting at 60% of the skeleton target (244)"`,
`"3.1h available instead of 6.0h — week load lowered to 244"`. **Nothing renders
it.** That silence is why a 4.9h week reads as a bug rather than an explanation.

- **`WeekRationale`** — a surface on the week screen listing the open week's own
  `plan_adjustments` reasons, filtered to `weekly_rollover` and
  `availability_change` triggers.
- **Shortfall line** — when `weeklyTargetHours` returns a shortfall: "Dolomites
  asks about 11h a week; you're offering 7h — expect to complete it, not race
  it."

## Phase 2 — Structured workouts

### 2.1 Why it is in this spec

`fitToBlock` compresses with `{ ...w, durationMins: roomMins }` and leaves
`description` alone. Real interval structure cannot be bolted onto a planner that
resizes sessions by overwriting an integer — the two are one problem.

### 2.2 Parameterised templates

Templates render at **any** target duration rather than existing at fixed
lengths, because the engine resizes sessions to arbitrary minute values:

```ts
export interface WorkoutTemplate {
  purpose: Purpose;
  render(targetMins: number, level: AthleteLevel): WorkoutStructure | null;
}

export interface WorkoutStructure {
  steps: Step[]; // warmup, repeats, cooldown
  totalMins: number;
  description: string; // DERIVED from steps — never authored by hand
}
```

`description` being derived is what fixes the stale-description bug
**structurally**: it cannot disagree with the steps, because it is a function of
them.

### 2.3 Compression

`fitToBlock` calls `template.render(roomMins, level)` instead of overwriting
`durationMins`. Rendering shorter drops repeats or trims the warm-up per the
template's own rules. `render` returns `null` below the purpose floor, which
triggers the existing substitution path unchanged.

`materializeWeek`, `replanWeek` and `fitToBlock` change together — they share
the fitting rule today and must continue to.

### 2.4 Export

Structures render to intervals.icu structured-workout syntax, for which the
reference already exists in `src/lib/tools/get-workout-syntax.ts`. That is the
existing path to a head unit; no new integration.

## Constants

`VOLUME_FACTOR` (1.8), `HEADROOM` (1.3), the level bands, and the FTP fractions
are **coaching heuristics, not derived truth**, calibrated against one athlete
and one published anchor. They live in single exported constants objects with
unit tests pinning known cases, so tuning is a one-line change with tests that
fail loudly rather than a hunt through the engine.

## Testing

- Pure modules (`demand.ts`, `volume.ts`, `athlete-level.ts`, templates) get unit
  tests with real numbers pinned — including the calibration case: 5.5h event,
  8.9h peak, CTL 80 → Intermediate, ceiling 11.6h, demand 9.9h.
- Every new Vitest file touching `@/lib/db` needs
  `describe.skipIf(!hasDb)` or CI crashes instead of skipping.
- The verification gate must include `npm run build` — it is the only check that
  catches a sync export from a `"use server"` file, and it is not in the default
  gate.
- Migration 0033 is additive and nullable only: no backfill, no destructive
  change, no down migration needed.

## Out of scope

- A separate finish-vs-compete ambition field on races — level plus the editable
  override already cover it; adding a field before it is needed is speculative.
- An event library with pre-filled distance/elevation. Useful, not required.
- Strength training, nutrition, cycle tracking.
- Deleting duplicate activity rows. Read-time dedupe via the existing helper is
  sufficient and non-destructive.
