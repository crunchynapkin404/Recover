# Race-Driven Training Volume & Structured Workouts

**Status:** drafted 2026-07-28, awaiting review — not yet approved
**Phases:** 1 (volume) ships independently; 2 (structure) follows
**Prerequisite:** v0.27.0, which made completed sessions visible to the planner

## The problem

An athlete training ~9 hours a week, offering 12.5 hours of availability, and
preparing for an 8-day alpine tour (900km, 20,000hm) was planned **4.9 hours**.

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

An event may run over several days. A one-day event is not a separate case —
it is an event with `event_days = 1`, and the same arithmetic covers both.

Migration 0033 adds four columns to `races` — three nullable, one defaulted:

| Column                  | Type      | Meaning                                  |
| ----------------------- | --------- | ---------------------------------------- |
| `event_days`            | `integer` | default 1; null-safe for existing races  |
| `distance_km`           | `real`    | **total** across all days                |
| `elevation_m`           | `integer` | **total** across all days                |
| `demand_hours_override` | `real`    | athlete's own figure; wins over computed |

…and one optional table for per-day detail:

| `race_stages`                                                 |
| ------------------------------------------------------------- |
| `race_id`, `day_number`, `distance_km`, `elevation_m`, `name` |

**Stages are optional.** Enter totals plus a day count and every stage is
treated as the average day. Enter stages and the totals are derived by summing
them — which additionally yields the **queen stage**, the single hardest day.
The queen stage is what sets the longest-ride target in §1.6; without stage
detail it falls back to the average day, and the feasibility verdict says so
rather than pretending to know.

**Which race drives the plan:** highest priority (A→C), then nearest date —
reusing `racesForWeek`'s existing ordering so there is one rule, not two.

New pure module `src/lib/race/demand.ts`, no I/O.

**Step 1 — estimated riding time.** Physics, because the inputs already exist in
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

Applied per stage when stages exist, otherwise once over the totals.

**Step 2 — event hours → weekly hours.** One formula, every event shape.

An earlier draft averaged the event over its days and trained at a fixed share
of that daily rate. It was wrong: it discarded total event load, so a 42-hour
8-day tour asked for LESS weekly training than a 6.8-hour one-day fondo. Eight
consecutive days are cumulative, and the capacity to ride day six is built by
chronic weekly volume.

The replacement expresses one quantity — **the event's total load as a multiple
of a weekly training load** — with the multiplier growing as the event
lengthens. Both endpoints come from published sources (see
`docs/specs/2026-07-28-training-volume-evidence.md`):

| Event shape | Event ÷ weekly load | Source                                                                                                                                                                |
| ----------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 day       | **0.60**            | A long sportive is 200–350 TSS against ~630 sustainable weekly TSS at CTL 90 — about half a training week. Cross-checked against published 8–12 h/week century plans. |
| 8 days      | **2.50**            | CTS: "a multi-day event is likely 2-3 times your normal weekly training load".                                                                                        |

```text
ratio(days) = EVENT_TO_WEEKLY_1DAY × days ^ MULTI_DAY_EXPONENT
            = 0.60 × days ^ 0.686          // 0.686 fits both anchors exactly
weeklyHours = totalEventHours / ratio(days)
```

Validated against published plan volumes, with nothing fitted beyond the two
endpoint ratios:

| Event                               | Total | Raw weekly | Literature              |
| ----------------------------------- | ----- | ---------- | ----------------------- |
| 8-day alpine tour, 900km / 20,000hm | 42.1h | 16.8h      | —                       |
| 1-day alpine fondo, 130km / 4,000hm | 6.8h  | 11.4h      | 8–12 (intermediate)     |
| Flat century, ~5h                   | 5.6h  | 9.4h       | 8–12                    |
| Local criterium                     | 1.3h  | 2.1h       | n/a — floored, see §1.3 |

Both single-day cases land inside the published band on their own.

**On the tour's 16.8 hours.** The athlete trains ~9h/week, so that event is
**4.7× their weekly load where the literature calls 2–3× normal** — by the
published guideline they are under-prepared for it. §1.3's ceiling will cut the
prescription to what their chronic load safely supports, and §1.5 will say so.
**Do not tune these constants until the model agrees with an athlete's own
estimate of what they can manage.** An athlete's estimate describes their
calendar; the model describes the event. Making them agree by hand deletes the
only useful signal here.

**Multi-day demand is also met by plan shape.** Nobody trains 42 hours a week
for a 42-hour tour, which is why the ceiling exists. The remaining gap is
closed by **back-to-back long rides in the peak phase** (§2.5), per the coaching
consensus that stage events test overnight recovery above single-day strength.

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
demand    = max(raceDemandHours, floorHours)      // floor: see below
target    = ceilingHours == null
              ? fallbackHours                     // no measured ceiling
              : min(demand, ceilingHours)
planned   = min(target, availabilityHours)
shortfall = planned < target ? { target, availability } : null

floorHours   = MAINTENANCE_FLOOR × peakHours      // 0.6
ceilingHours = HEADROOM × peakHours               // 1.3
```

**The floor exists so a short event cannot detrain you.** The demand model is
volume-only, so a criterium reads as almost no demand — 2.1 h/week for an
athlete who trains 9. Prescribing that would be a detraining plan. The
detraining literature sets the level: **a 70% volume reduction with intensity
maintained preserves VO₂max**, and 50–75% of normal volume shows no aerobic
loss. `MAINTENANCE_FLOOR = 0.6` therefore never prescribes less than holding
current fitness.

**The ceiling is the acute:chronic workload limit.** `HEADROOM = 1.3` is not a
round number: the ACWR safe zone is **0.8–1.3**, danger begins above 1.5, and
**≥2.0 carries the greatest injury risk**. The ceiling is "the most this
athlete's chronic load supports", and when it binds — as it does for the 8-day
tour at 16.8h raw — that is a finding to report (§1.5), not a number to tune.

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

### 1.6 Can you finish it? — the feasibility verdict

New pure module `src/lib/race/feasibility.ts`. The question an athlete actually
has when entering a hard event, and the one nothing in the app answers today. Two independent gaps, both computable from
data already held:

| Dimension        | Requirement                           | Source                                      |
| ---------------- | ------------------------------------- | ------------------------------------------- |
| **Volume**       | `weeklyHours` from §1.1               | vs the rolling peak from §1.2               |
| **Longest ride** | `LONGEST_RIDE_FRACTION` × queen stage | vs longest single ride in the last 12 weeks |

Volume alone is not obviously enough: an athlete riding 11h a week as five
two-hour sessions may not be prepared for a seven-hour mountain stage. The queen
stage is why per-day detail is worth entering.

**But the sources disagree on how much this matters, so it must not by itself
produce a "not realistic" verdict.** Gran fondo coaching calls the long ride
_"the single biggest predictor of performance"_ at 70–80% of event distance;
CTS states the opposite — _"there is nothing magical about achieving a specific
percentage of the race or event distance in a single training ride… you can
absolutely develop the fitness necessary to complete a challenging century or
gran fondo with training rides that never exceed 3 hours."_ Given that conflict,
a rider with ample weekly volume and no single long ride reads as a **caution**,
not a refusal: the longest-ride gap may soften a verdict by one step
(ready → on track, on track → tight) but never drives it to "not realistic" on
its own. Volume does that.

Weeks needed to close each gap follows from the ramp guard, which already caps
growth at `RAMP_CLAMP_PCT` (±20%) per week:

```text
weeksNeeded = ceil( ln(required / current) / ln(1 + RAMP_CLAMP_PCT) )
```

Against `weeksUntilEvent`, that gives a four-state verdict:

| Verdict           | Meaning                                                 |
| ----------------- | ------------------------------------------------------- |
| **Ready**         | both requirements already met                           |
| **On track**      | the plan closes both gaps before event day              |
| **Tight**         | closes with no margin — one missed week and it does not |
| **Not realistic** | cannot close in the weeks remaining, at any adherence   |

"Not realistic" is the case worth building for and the one most tools avoid:
_"you have 7 weeks; you would need to add 40% volume and double your longest
ride. This is not reachable from here."_ Saying that early is worth far more
than a plan that quietly aims at something unattainable — and it is the same
honesty principle as the shortfall line above.

**Never a hard block.** The verdict informs; it never refuses to build a plan or
prevents entering an event. An athlete is allowed to attempt something ambitious
having been told plainly what it asks.

**Degradation.** With no stage detail the queen stage falls back to the average
day, and the verdict states that it is reasoning from an average rather than a
known hardest day. With no rolling peak (§1.2), no verdict is produced at all —
the same rule as the ceiling: absent evidence, say nothing rather than guess.

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

### 2.5 Back-to-back long rides for multi-day events

Where §1.1's multi-day demand is actually delivered. When the target event has
`event_days > 1`, the peak phase schedules **consecutive long sessions** rather
than one long day per week, because the quality a stage event tests is
recovering overnight and riding again.

The longest of those sessions builds toward `LONGEST_RIDE_FRACTION` × queen
stage, which is the same requirement §1.6's verdict measures — one number, used
both to judge readiness and to plan for it.

This is constrained by the availability engine like any other session: it
requires two adjacent days with enough room, and where the athlete does not have
them the plan falls back to a single long ride and the verdict reflects the
weaker preparation rather than silently claiming the same readiness.

## Constants

Every constant carries a confidence rating from the research pass
(`docs/specs/2026-07-28-training-volume-evidence.md`). They live in single
exported constants objects with unit tests pinning known cases, so tuning is a
one-line change with tests that fail loudly rather than a hunt through the
engine.

| Constant                | Value                 | Confidence                                                 |
| ----------------------- | --------------------- | ---------------------------------------------------------- |
| `CDA`                   | 0.32                  | **High** — measured hoods position is 0.316 m²             |
| `HEADROOM`              | 1.3                   | **High** — ACWR safe-zone upper bound                      |
| `MAINTENANCE_FLOOR`     | 0.6                   | **High** — 50–75% of volume preserves VO₂max               |
| `EVENT_TO_WEEKLY_1DAY`  | 0.60                  | Medium — 200–350 TSS event vs ~630 weekly                  |
| `MULTI_DAY_EXPONENT`    | 0.686                 | Medium — fits the 1-day and 8-day anchors                  |
| Level bands             | 3/5/9 h, 35/55/80 CTL | Medium                                                     |
| `FTP_FRACTION`          | 0.85/0.75/0.68        | Medium — CP decays ~10% after fatigue; our span is steeper |
| `LONGEST_RIDE_FRACTION` | 0.8                   | **Low — sources actively disagree**                        |
| `REAL_WORLD_FACTOR`     | 0.85                  | **Low — no source**                                        |
| `CLIMB_GRADIENT`        | 0.07                  | **Low — no source**                                        |

Two of these have **no published basis at all**. `REAL_WORLD_FACTOR` and
`CLIMB_GRADIENT` are empirical corrections that make finish times come out
plausible. They are kept because the model needs them and honest about what
they are.

`TRAINING_FRACTION` and `VOLUME_FACTOR` from earlier drafts are both deleted —
superseded by `ratio(days)`, which covers every event shape with anchors at
both ends.

## Testing

- Pure modules (`demand.ts`, `volume.ts`, `athlete-level.ts`, `feasibility.ts`,
  templates) get unit tests with real numbers pinned. Both calibration anchors
  are asserted:
  - **8-day, 900km, 20,000hm**, FTP 310, 79kg → ~50h event, 6.3h/day, **11.0h
    weekly** (athlete's own estimate: 9–12h)
  - **Single-day ~5.5h fondo** → **9.6h weekly**, and a `days = 1` event must
    take exactly the same code path as a multi-day one
  - Athlete at 8.9h peak, CTL 80 → **Intermediate**, ceiling **11.6h**
- Feasibility gets its own table-driven test over the four verdicts, including
  the boundary between "tight" and "not realistic".
- Every new Vitest file touching `@/lib/db` needs `describe.skipIf(!hasDb)` or
  CI crashes instead of skipping.
- The verification gate must include `npm run build` — it is the only check that
  catches a sync export from a `"use server"` file, and it is not in the default
  gate.
- Migration 0033 is additive: nullable columns plus one new table. No backfill,
  no destructive change, no down migration needed. `event_days` defaults to 1 so
  every existing race remains a valid single-day event.

## Out of scope

- **An event calendar of real events with their data prefilled.** JOIN has one,
  and it is the obvious next step once manual entry works — but manual entry has
  to be right first, and it is what makes the calendar's data useful rather than
  the other way round.
- A separate finish-vs-compete ambition field on races — level plus the editable
  override already cover it; adding a field before it is needed is speculative.
- Strength training, nutrition, cycle tracking.
- Deleting duplicate activity rows. Read-time dedupe via the existing helper is
  sufficient and non-destructive.
- Terrain, altitude and temperature as demand inputs. Coaching sources treat all
  three as real, and the physics model has natural places for them, but each
  needs its own calibration and none is required to fix the problem in hand.
