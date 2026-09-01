# Structured cycling workouts — assigning real sessions to training days

Written 2026-08-31, against `main` at v0.125.0. Supersedes the proposal in
`docs/2026-08-27-structured-workouts-roadmap.md` for the cycling slice; that
document's four-stage framing and its non-goals still stand except where this
spec explicitly reverses one, below.

Today Recover plans _"Intervals · 95 min · Z4–Z5"_. The athlete is told how
long and roughly how hard and decides the rest. This spec makes Recover plan
the session — _"5 × 5 min at 88–94% FTP, 5 min recovery"_ — show it, let the
athlete download it, and write it to their intervals.icu calendar, from where
their own device sync carries it to the head unit.

---

## Decisions taken before the design, and by whom

These were settled by the athlete/owner in conversation and are **not**
relitigated below:

1. **Cycling only**, for now.
2. **A real curated library**, JOIN-style, 100+ hand-authored workouts. This
   deliberately reverses a recorded non-goal — see the next section.
3. **The planned day wins.** `purpose` and `durationMins` stay authoritative;
   the library is indexed so a workout is found to fit them. The plan never
   bends to the workout.
4. **Delivery is both** — visible and downloadable inside Recover, _and_
   written to intervals.icu.
5. **Targets are authored in %FTP**, never absolute watts.
6. **One source of truth.** The library is typed data in a pure module; every
   other representation is derived from it.
7. **Export pins.** Nothing is stored until the athlete exports it; exporting
   writes the chosen workout's id onto the **session**, and Recover then marks
   it stale if that session subsequently changes.

## The reversal, recorded

`docs/2026-08-27-structured-workouts-roadmap.md:127-135` lists, under a
heading reading _"Named so they are not smuggled in later"_:

> **A curated library.** JOIN advertises 400+ hand-made workouts. Recover
> generates from the athlete's own baselines; a library would be a different
> product with a different epistemic basis.

**That non-goal is reversed here, deliberately and with the reason stated**,
in the way this repo reverses its own earlier claims rather than deleting
them (`docs/ROADMAP.md:82-84`, `:300-303`).

### How it passes the roadmap's admission gate

`docs/ROADMAP.md:24` makes one sentence a hard gate: _"A proposal that does
not serve that sentence does not belong on this roadmap."_ The sentence
(`:16-17`) is:

> Every figure traces to a source with a stated confidence. **Baselines are
> the athlete's own, not population norms.** When it does not know, it says so.

A first reading says a curated library is population norms by construction.
**That reading is too strong, and the distinction matters enough to write
down.** The clause governs _baselines_ — FTP, max HR, threshold pace. A
library authored in `%FTP` supplies no baseline whatever: every watt an
athlete ever sees is `pctFtp × their own FTP`, indoor or outdoor as
appropriate. What the library supplies is **shape**.

What is genuinely conceded is narrower: the _choice_ of shape — that a
threshold day is served by `4 × 8 min at 95%` rather than `3 × 12 at 90%` —
is a coaching convention rather than a derivation from this athlete. The repo
already has a vocabulary for exactly that, and 102 of 120 exported engine
constants sit at `Confidence: Low` without embarrassment. So:

**Every library workout carries a `source` field naming its provenance and a
confidence label, and says what would raise it** — the convention
`plan-constants.ts` uses. A workout with no provenance does not ship.

The third clause of the gate — _"when it does not know, it says so"_ — is
served by refusal: a day with no matching workout keeps today's prose and band.
Nothing is invented to fill a gap.

---

## Design 1 — Storage: derive at read time, pin on export

**Nothing is stored on a planned day until the athlete exports it.**
`matchWorkout(library, session, date)` is a pure function over the library,
called on every read. The library is a **parameter, not an import** — that is
what lets the matcher be built and tested against a stub before slice 2
authors a single workout.

### Why this, and not a field on `PlannedWorkout`

`exercises?: StrengthExercise[]` is stored because a 1RM-derived load is a
snapshot of an athlete anchor that changes between weeks. **A %FTP interval
structure is not**: it is a pure function of `(purpose, durationMins)`, so
storing it buys only staleness.

And staleness would be expensive here, because the engine rewrites a planned
day in at least six places. Verified directly:
`src/lib/week-plan/adapt-day.ts:505-507` is
`tWorkout.durationMins = Math.round(tWorkout.durationMins * RED_ENDURANCE_SCALE)`
— a red-readiness day silently becomes 70% as long. `:169` redistributes
minutes within a day; `:483` replaces a session with recovery outright.

Deriving at read time discharges, without a line of engine change:

- nothing to invalidate when any of those six sites fires;
- nothing to duplicate into `plan_adjustments`' before/after snapshots
  (`src/lib/week-plan/service.ts`), which are written on every adaptation;
- nothing for `projectWeek` to reproduce byte-identically, which
  `computeWeekRepair`'s `stableStringify` diff would otherwise treat as a
  changed week and rewrite;
- no DDL, no jsonb shape change, no import/export concern
  (`src/lib/export/import-user.ts` copies `days` verbatim).

### Why pinning nevertheless exists

Export makes a workout real outside Recover. Once it is on the athlete's
intervals.icu calendar and has synced to their head unit, a silent re-derive
means **Recover disagrees with the device**, and the athlete finds out
mid-ride.

So exporting writes the pin onto the **session** — the one moment pinning is
genuine. From then on Recover renders the pinned workout,
and if `(purpose, durationMins)` no longer match what it was chosen for,
shows it as **stale** with a re-export action. The roadmap anticipated
exactly this: _"a prescription pinned in the morning and adapted at noon has
to re-prescribe, **or be pinned deliberately and marked stale**."_

**What export stores, and why it is four fields rather than two.** An earlier
draft of this spec stored only `workoutId` and `exportedAt`, and defined
staleness as "the day no longer matches what the workout was chosen for". That
is unimplementable from those two fields: the only available test is
re-deriving and comparing ids, and **re-derivation has a wider dependency
footprint than the day itself.**

An earlier draft made that point about neighbouring days, on the strength of
selection avoiding recent picks. Selection no longer does — it is a date-seeded
spread over the candidates, depending on nothing outside the day — so **that
particular argument has expired, and the conclusion it supported has not.** The
dependency that remains is larger and less avoidable: re-derivation depends on
**the library**, and the library grows. Slice 2 ships 30 workouts and slice 5
takes it past 100. Every workout added changes how the date seed lands, so a
release that only adds content would re-derive a different workout for every
day an athlete had already exported, and mark all of them stale at once —
telling the athlete their whole calendar drifted when nothing about their plan
moved. A pin that survives its own library's growth cannot be derived from
that library.

So export stores `workoutId`, `exportedAt`, and **`purpose` and `durationMins`
as they were at export**. Staleness is a direct comparison against the
session's current values, with no dependency on anything outside it.

**Where the pin lives, and why not on the day.** An earlier draft of this spec
wrote those four fields "onto the day". That is a level too high, and it does
not typecheck against the domain: `purpose` and `durationMins` are properties
of a `PlannedWorkout` (`src/lib/training-plan.ts:76-93`), while a `DaySlot`
holds `workouts: ScheduledWorkout[]` — "Up to MAX_SESSIONS_PER_DAY sessions"
(`src/lib/week-plan/types.ts:29`), which is **2**
(`src/lib/availability/types.ts:31`). On a day carrying a morning recovery spin
and an evening threshold session — both cycling, both `LibraryPurpose` — a
day-level pin cannot say which session it pins, and "the day's current values"
has two answers.

The repo has already been bitten by exactly this shape and recorded it:

```ts
// src/lib/week-plan/service.ts:818-826
// A day can now genuinely hold two sessions (MAX_SESSIONS_PER_DAY). This
// signature only names a day, not which of its sessions to move, so a
// multi-session source is refused rather than guessed at…
if (from.workouts.length > 1) return "invalid";
```

So the pin goes on `ScheduledWorkout`, beside `exercises?: StrengthExercise[]`
— the precedent this design has been comparing itself to all along, which was
never a day-level field either. That also makes staleness a same-object
comparison, which is the whole point of storing the two extra fields, and it
makes the pin die with the session it belongs to: the red-readiness swap at
`adapt-day.ts:461-494` rebuilds the day as `{ ...day, workouts: [...] }`, so a
day-level pin would outlive the session it described while the very same code
is careful to clear `exercises`.

This is the only stored state the feature adds, and it is added at the one
point where the athlete has externalised something.

## Design 2 — The shape

`src/lib/interval/types.ts`, pure, type-only imports — the same contract
`src/lib/strength/prescription.ts` holds.

```ts
import type { Purpose } from "@/lib/availability/types";

/**
 * The five purposes a cycling library workout can answer. Keyed off the
 * engine's own vocabulary via Extract, never a parallel union — dropping a
 * member from Purpose is a compile error here rather than a silent hole.
 * "brick" is multi-sport; "strength" has strength/prescription.ts.
 */
export type LibraryPurpose = Extract<
  Purpose,
  "recovery" | "aerobic_base" | "long" | "threshold" | "vo2max"
>;

/** Targets are ALWAYS % of FTP, never watts. 88 means 88% FTP. */
export interface Step {
  secs: number;
  lo: number;
  hi: number;
  /** Ramp linearly lo→hi across the step. Absent = hold the range. */
  ramp?: true;
  rpm?: number;
}

/**
 * `repeat: 1` is a plain section; `repeat: n` is intervals.icu's
 * "Main set 5x" and Zwift's <IntervalsT Repeat="5">. Deliberately ONE level
 * deep — an over-under is authored as an unrolled body inside one repeat,
 * which every renderer already handles.
 */
export interface Block {
  name: string;
  repeat: number;
  steps: Step[];
}

export interface LibraryWorkout {
  /** Stable, hand-assigned, never renumbered — it is the sort key. */
  id: string;
  name: string;
  purpose: LibraryPurpose;
  /**
   * "sweet-spot" | "over-under" | "30-30" | … Rotation avoids repeating a
   * FAMILY, not merely an id: `purpose` was built for scheduling, not for
   * describing a stimulus, so (purpose, duration) alone collapses 100
   * workouts onto two axes and the same shape would recur under two names.
   */
  family: string;
  /** One sentence of coaching intent. Becomes the .zwo/ICU description. */
  why: string;
  /**
   * Provenance. REQUIRED — this is what carries the reversal above. Names
   * where the shape comes from, its confidence, and what would raise it.
   * A workout without one does not ship.
   */
  source: string;
  blocks: Block[];
}
```

Deliberately **cut**: `sport` (the module is cycling-only; the matcher refuses
non-Bike once rather than 100+ literals repeating a constant — which means
`sport` is an input to `matchWorkout`, on the session, even though it is not a
field on a workout), `durationMins`
(derived), `intensity` (derived from the peak main-set target through the zone
table already shipped in `get-workout-syntax.ts`), per-step text prompts, free
blocks, cadence _ranges_, nested repeats.

## Design 3 — Fitting: how "the day wins" becomes literally true

Each workout has exactly one **flex step**: the longest step in any
`repeat === 1` block, ties broken by the last, which puts a cooldown ahead of
an equal-length warmup.

**Authoring guidance, because this sentence sets the library's size.** An
earlier draft added "in practice a warmup or cooldown" here. That is true of
`threshold` and `vo2max`, where the main set _is_ the workout and nothing else
is stretchable — and false, expensively, everywhere else. A workout covers
exactly the span its flex step can absorb, so a 10-minute warmup buys 10
minutes of coverage; authoring every purpose that way needs **70 workouts** to
tile the range, against slice 2's budget of 30, and the guard would fail the
build with no hint as to why.

For `recovery`, `aerobic_base` and `long` the longest `repeat === 1` step is
the **endurance body**, and stretching it is precisely what those sessions
tolerate. Sized that way the same range needs **20**:

| purpose        | flex step                              | one workout covers | n   |
| -------------- | -------------------------------------- | ------------------ | --- |
| `recovery`     | 35 min — the easy body itself          | 23–58 min          | 2   |
| `aerobic_base` | 80 min — the endurance body            | 55–135 min         | 2   |
| `threshold`    | 15 min — warmup; the main set is fixed | 68–83 min          | 7   |
| `vo2max`       | 15 min — warmup; the main set is fixed | 53–68 min          | 6   |
| `long`         | 150 min — the endurance body           | 95–245 min         | 3   |

**Choose the flex step for the span the purpose must cover**, not by position.
Twenty tiles the range; forty gives every duration two families to rotate
between, which is what `family` needs to mean anything.

Fitting adjusts **only** that step, within a bounded tolerance expressed as a
fraction of its authored length. The main set, which is what the workout _is_,
is never touched. The guarantee is exact:

> `rendered total === round(session.durationMins × 60)`, always.

A 75-minute `Sweet Spot 3×12` whose flex step is a 600 s warmup ramp (bounded
to 300–900 s) therefore covers days of 70–80 minutes, and is not a candidate
outside that band.

### Coverage is continuous, not banded

An earlier draft asked the guard to prove "every `(purpose, duration band)` has
a candidate". **That is the wrong claim and would have passed over real
holes.** The engine does not emit banded durations: base durations are
`Math.round(totalMins × FRACTION)` of the athlete's own weekly volume
(`training-plan.ts:977`, `:988`, `:1010`), so they are arbitrary integers
before any adaptation touches them, and redistribution is capped at
`±DAY_REDISTRIBUTE_CAP_PCT`, `0.25` (`week-plan/types.ts:215`).

**So the guard asserts the union of every workout's flex span covers the
continuous integer range of durations reachable for that purpose.** Authoring
to round numbers is exactly the instinct that would leave the holes. **Coverage
is a property of the library, not of the matcher** — which is what makes
"author 100+" the real cost and the code the easy part.

### Which durations are actually reachable, per purpose

**A second draft got this wrong too, and the error would have shaped the whole
library.** It said a 95-minute threshold day "becomes 67 on red, 81 on amber
and 119 redistributed". Only the third is right, and the first cannot happen at
all.

Readiness adaptation branches on `isQuality`, which is keyed off `type`, not
purpose: `QUALITY_TYPES = ["Intervals", "Tempo", "Brick"]`
(`week-plan/types.ts:140`), and `PURPOSE_BY_TYPE` maps `Tempo → threshold` and
`Intervals → vo2max` (`training-plan.ts:95-103`). So:

- **Red on a quality day does not scale it — it replaces it.**
  `adapt-day.ts:432` sends any `isQuality` session to a full recovery session
  at `RED_RECOVERY_MINS`, `30` (`week-plan/types.ts:233`). A threshold day
  never becomes a 67-minute threshold day; it becomes a 30-minute recovery
  ride. `RED_ENDURANCE_SCALE` is reachable **only** by `recovery`,
  `aerobic_base` and `long`.
- **Amber on a quality day changes its purpose as well as its length.**
  `adapt-day.ts:526-535` takes `STEP_DOWN` — `{Intervals: "Tempo",
Tempo: "Endurance"}` — and passes the result through `withPurpose`, which
  re-derives `purpose` from the new `type`. So that 81-minute session is an
  **`aerobic_base`** session. It belongs in `aerobic_base`'s coverage range,
  not threshold's.
- **Amber on a non-quality day keeps its purpose** and only scales by
  `AMBER_SCALE`, `0.85` (`:227`) — `steppedType` falls through to
  `tWorkout.type` for anything not quality.

Which gives the set each purpose must cover:

| purpose        | receives                                                                                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vo2max`       | its own base durations, and those redistributed up to `×1.25`. Nothing steps down _to_ vo2max, and it is never scaled down — so this is the narrowest range in the library            |
| `threshold`    | its own base; `round(0.85 × a vo2max base)` from amber step-downs; those `×1.25`                                                                                                      |
| `aerobic_base` | its own base; `×0.7` on red; `×0.85` on amber; `round(0.85 × a threshold base)` from amber step-downs; those `×1.25` — **the widest range, and the one a naive reading under-covers** |
| `long`         | its own base; `×0.7`; `×0.85`; those `×1.25`                                                                                                                                          |
| `recovery`     | its own base; `×0.7`; `×0.85`; **a fixed 30** from every red quality day; those `×1.25`                                                                                               |

### Readiness is not the only thing that sets a duration

**Two drafts of this section described readiness adaptation as though it were
the whole story. It is not, and the path it omits is probably the commoner
one.** `fitToBlock` (`week-plan/slots.ts:131-171`) fits a session to the room
its availability block actually has:

- room at or above the purpose's floor → the session is **compressed to exactly
  `roomMins`**, keeping its purpose. `roomMins` is whatever the athlete's block
  is, so this is an arbitrary integer, produced with no readiness event at all.
- room below the floor → it walks `SUBSTITUTE_TO` (`availability/types.ts:70`)
  down to the first purpose whose floor fits, and creates that purpose's session
  at `roomMins`. This is the one place `SUBSTITUTE_TO` changes a purpose;
  amber uses `STEP_DOWN` instead, and confusing the two is easy.

`fill.ts` does the same from the other side: `:238-245` grows a session to
`min(blockMins, ceiling, …)`, and `:305-317` adds one at
`min(slot.mins, ceiling, …)` — refusing outright when that is under the floor
(`if (mins < PURPOSE_FLOORS[purpose]) continue`).

**So every integer from a purpose's `PURPOSE_FLOORS` value upward is reachable,
directly.** That makes the floors the real lower bound the library must reach,
and the guard asserts each covered range starts at or below its purpose's
floor rather than trusting a hand-typed number. That assertion immediately
caught `recovery` being covered from 21 when compression reaches 20 — a hole
the library happened to fill anyway, which is exactly the kind that survives
until someone edits the workout that was covering it by accident.

**The guard must derive this from the engine's own exported constants rather
than restate it in prose**, or it becomes a third copy of a table that has now
been wrong twice. `RED_ENDURANCE_SCALE`, `AMBER_SCALE`,
`DAY_REDISTRIBUTE_CAP_PCT`, `RED_RECOVERY_MINS`, `QUALITY_TYPES`, `STEP_DOWN`
and `PURPOSE_BY_TYPE` are all already exported; the guard lives in a
`.test.ts`, which the purity scan skips, so importing them costs nothing.

### A triathlon plan sizes its bike days differently

**The reachable set above was derived from the cycling generator alone — twice
over, in two separate corrections of this section, and it was still
incomplete.** A `Triathlon` plan does not use `BIKE_LONG_FRACTION` or
`BIKE_EASY_FRACTION` at all. Its Sunday ride is
`round(totalMins × TRI_SPLIT.bike × 0.5)` and its Thursday bike day is
`round(totalMins × TRI_SPLIT.bike × TRI_SECONDARY_FRACTION)`
(`training-plan.ts:1055-1135`), and neither fraction appears anywhere in the
reasoning that produced the table above.

Measured across 3–20 h/week, six of those sessions fall outside what the
library covers:

| volume   | session            | length      | outcome                                                              |
| -------- | ------------------ | ----------- | -------------------------------------------------------------------- |
| 3 h/week | Sunday long ride   | 36 min      | refused — under `long`'s covered range                               |
| 3 h/week | Thursday intervals | 22 min      | refused — under `vo2max`'s, and under `PURPOSE_FLOORS.vo2max` itself |
| 17–20 h  | Thursday intervals | 122–144 min | refused — over `vo2max`'s ceiling                                    |

**The ceiling is not raised to swallow the top three.** A 144-minute session
the engine labels `vo2max` is an endurance ride with intervals in it — its own
generated description is "4×5min above threshold, 3min recovery" — and
authoring a four-hour VO₂max workout so a guard goes green would be the guard
driving the coaching, which is what the ceiling exists to prevent. Those days
keep today's prose and band.

The bottom two are a different thing worth noticing on its own: **the generator
emits sessions below their own `PURPOSE_FLOORS` value** — a 22-minute `vo2max`
day against a floor of 40, a 36-minute `long` against a floor of 90 — because
nothing clamps generated durations to `minEffectiveMins`. That is the engine's
business rather than this library's, but it is why "the floor is the lower
bound" is not quite true, and the guard asserts the measured outcomes rather
than that rule.

All six are pinned in `coverage-guard.test.ts`, deriving the durations from the
same constants the generator uses rather than hard-coding them, so which days
fall back to prose cannot change silently.

### Where coverage stops, and why it stops there

The reachable set above is technically right and partly absurd. Redistribution
applies `×1.25` to whatever a day already holds, so a 20 h/week athlete makes a
**270-minute `vo2max` day** and a **450-minute `recovery` day** genuinely
reachable. Covering those means hand-authoring a four-and-a-half-hour VO2max
session, which nobody should ride — and authoring it only to satisfy a guard
would be the guard driving the coaching instead of the reverse.

So **the library covers each purpose up to a stated ceiling, and refuses
above it.** The day keeps today's prose and band, which the spec already calls
the honest path rather than a gap:

| purpose        | covered | ceiling is                                                                                |
| -------------- | ------- | ----------------------------------------------------------------------------------------- |
| `recovery`     | 21–90   | beyond this it is an endurance ride, not a recovery spin                                  |
| `aerobic_base` | 21–210  | beyond this the plan calls it a long ride                                                 |
| `long`         | 48–300  | `ABSOLUTE_LONG_BOUND_MINS` is 360; 300 is the last length worth authoring a structure for |
| `threshold`    | 27–120  | a threshold session past two hours is an endurance ride with efforts in it                |
| `vo2max`       | 32–120  | same                                                                                      |

Source: coaching convention, chosen by the athlete/owner. Confidence: Low.
What would raise it: nothing available — it is a judgement about what is worth
authoring, not a measurable quantity.

**This is what makes slice 2's thirty workouts sufficient rather than exactly
exhausted.** Tiling the capped ranges takes **17** workouts; **34** gives every
duration two families to rotate between. Against the uncapped ranges it takes
31 to tile once and ~62 for two families, so thirty would have covered
everything exactly once and left `family` rotation with nothing to choose
between — the machinery would have been dead weight until slice 5.

### Selection

`matchWorkout` returns one of three things, and the third is not a failure
mode to be engineered away:

- `matched` — a candidate fits. Among candidates the pick is **deterministic
  and seeded by the day's own date**, so the same week never re-picks a
  different workout on a re-render.
- `refused` — the session is not cycling, its `purpose` is not one a library
  workout answers, or no candidate fits. The day keeps today's prose and band.

**How variety actually works, which an earlier draft overstated.** That draft
promised "recent ids _and recent families_ are avoided" from a signature
carrying no history. The two cannot both hold: avoiding what a nearby day
picked requires knowing it, and the only ways to know are to take a `recent`
argument — reintroducing exactly the neighbouring-day dependency the staleness
fix removed from the pin — or to store something.

So variety is **spread, not avoidance**. The date seeds a pick among the
candidates that fit, and the pick is **family-first**: choose the family, then
choose within it. Picking ids uniformly would let a family holding five
workouts outvote one holding a single workout, which is the opposite of what
`family` exists for. Two days a fortnight apart can still draw the same
workout; nothing promises otherwise, and the promise is not worth the coupling.

**Any candidate inside its flex bound is acceptable by construction** — that
is what bounding the flex is _for_ — so the pick does not also rank by how
little a workout stretches. Ranking that way would collapse variety outright:
the nearest-fitting workout would win every time for a given duration, and
rotation would stop happening at all.

**`synthesized` is not in the union.** The earlier draft reserved it as a third
result. Slice 1 can never return it, and a variant that is unreachable is dead
code with a type to maintain; it goes in when something actually synthesizes.

**Refusal is the honest path, not a gap.** It is how `strengthPrescription`
already degrades when a 1RM is unset, and it is the gate's third clause in
code.

### Indoor vs outdoor FTP — a question the matcher does not ask

The roadmap names getting this wrong as a non-goal in itself: _"a step
targeting 105% of the wrong one is worse than a zone band."_ An earlier draft
answered it by having resolution _"pick the FTP matching the session's
context"_ and refuse where context is unknown. **Both halves of that were
wrong, and together they would have shipped a feature that never fires.**

**There is no session context to pick from.** A `PlannedWorkout` is
`day, sport, type, durationMins, intensity, description, purpose,
minEffectiveMins, exercises?` (`src/lib/training-plan.ts:76-93`). Nothing on a
planned session says whether it will be ridden indoors. Context is therefore
unknown on every day, and a rule that refuses on unknown context refuses
everything.

**And v0.118.0 is not a symmetric pair to choose between.** The schema is
explicit that indoor is a fallback, not a peer:

```ts
// src/lib/db/schema.ts:589-595
/**
 * v0.118: the indoor/trainer FTP, distinct from the outdoor one above.
 * null = not set. Used ONLY as a fallback anchor when ftpWatts is null —
 * races have no indoor concept in this app, so this can never mean "use it
 * for race day" directly.
 */
ftpWattsIndoor: integer("ftp_watts_indoor"),
```

**The question dissolves once you notice no renderer needs an FTP.** `renderIcu`
emits `88-93%` and `renderZwo` emits `0.88`; intervals.icu resolves the
percentage against the athlete's own settings and Zwift against theirs, each
already knowing whether the ride is indoors in a way Recover does not. Matching
is on `(purpose, durationMins)`. So FTP is not a matcher input and not a
refusal condition — it is not part of this design at all.

It returns only if slice 3 chooses to show absolute watts in-app. If it does,
it resolves with v0.118's real precedence — `ftpWatts ?? ftpWattsIndoor` — and
labels the number when it came from the fallback, which is the gate's third
clause applied where it actually bites.

## Design 4 — Every representation derived

`blocks` is the single source of truth. Four renderers, each pure:

| Renderer            | Output                                | Notes                                                                                                                                                                                                                    |
| ------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `renderIcu`         | intervals.icu structured-workout text | Goes in the `description` of a WORKOUT event. Syntax already shipped verbatim in `get-workout-syntax.ts`; `%` and `X-Y%` are native                                                                                      |
| `renderZwo`         | `.zwo` XML                            | Plain text, no auth, no third party. **Narrows a range to its midpoint** — Zwift's `SteadyState` takes one power, so `88-93%` ships as `0.905`. The one place a representation is lossy, recorded rather than discovered |
| `renderProfile`     | the in-app interval shape             | Hand-rolled SVG, the repo's existing convention                                                                                                                                                                          |
| `renderDescription` | the human-readable line               | **Replaces** today's hand-written `description` for library days                                                                                                                                                         |

That last row is the point. The roadmap named the failure to avoid:
_"What happens to `description`? It should be **derived** from the steps
rather than kept in parallel, or the two drift — the same class of defect as
v0.122.0's duplicated event count."_

`.fit` is explicitly **not** in the first slice: it needs a real binary
encoder, and intervals.icu already reaches Garmin, Wahoo and Zwift on the
athlete's behalf — one write buying most of the coverage that costs JOIN four
integrations.

## Design 5 — Where this sits on the roadmap

**Not a `## Phase 8`.** `docs/ROADMAP.md` runs Phase 5 → 6 → 7 →
`## Not scheduled` with no gaps, so the only slot for a numbered phase is
after Phase 7 — and appending it there **encodes queueing**, which both source
documents deny. Stage 4 of the original proposal _is_ Phase 7's third bullet
applied to a session instead of a race; they are one body of work seen from
two ends.

Two further facts constrain the edit:

- **Phase 6 is not complete.** Information architecture is `- [ ]` at
  `docs/ROADMAP.md:188`, parked on telemetry by design. The original proposal
  sequences itself behind it: _"Phase 6 finishes first."_
- **Every open item in that file is 1–3 lines** and points at its spec. The
  multi-paragraph entries are all `[x]` records written after shipping.

So: **one checkbox-free bullet in `## Not scheduled`**, between the ICS-export
bullet and the MCP-contract-freeze bullet, naming the pillar it answers to
(`docs/ROADMAP.md:28` requires it) and pointing here.

**The same edit fixes two stale figures**, since an insert that leaves them
makes the wrongness look freshly asserted: line 3 reads `v0.121.0` against a
shipped `0.125.0`, and line 68 reads `3204 tests` against `3337 passed, 1
skipped`.

**The demand table needs one correction too.** Row 155, _"Add length filter
when browsing workouts"_, is answered `n/a — no workout library`. That answer
stops being true. Rows 107 and 45 are workout-**player** requests and stay
`n/a` — a player remains a non-goal, and a phase that quietly answered all
three would have adopted two non-goals instead of one.

---

## Slices

| #   | Slice                     | Ships                                                                                                                                                                                                                                    |
| --- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | **Shape + renderers**     | `types.ts`, `renderIcu`, `renderZwo`, `renderDescription`, tested against hand-written expected output. No library, no matcher, nothing user-visible                                                                                     |
| 1   | **The matcher**           | `match.ts` with fit/flex/refuse, deterministic date-seeded selection, family-first spread. Tested against a stub library                                                                                                                 |
| 2   | **The library, first 30** | The capped integer range covered per purpose — 17 workouts tile it, 30 gives most durations two families. Each with `source` and confidence. Coverage asserted by a guard that derives the reachable set from the engine's own constants |
| 3   | **The surface**           | Workout name, profile and targets in the Week open-day block                                                                                                                                                                             |
| 4   | **Export**                | `.zwo` download route + the intervals.icu WORKOUT write, and the four-field pin on `ScheduledWorkout` with its stale marker                                                                                                              |
| 5   | **The library, to 100+**  | Pure content. No code change — which is the test of whether slices 0–2 got the shape right                                                                                                                                               |

Slices 0–2 are the design work; 3–4 are largely plumbing; 5 is authoring.

## Risks

| Risk                                                  | Mitigation                                                                                                                                                                                                                                          |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Coverage gaps mean days silently fall back to prose   | Slice 2 ends with a guard asserting the **union of flex spans covers the continuous integer range** per purpose — see "Coverage is continuous". A gap fails the build, it does not degrade quietly                                                  |
| 100 hand-authored workouts is 100 coaching judgements | Each carries `source` and a confidence label. The reversal above is what makes that acceptable, and it is recorded                                                                                                                                  |
| A pinned workout and a re-planned day disagree        | The pin is explicit, the staleness marker is explicit, and re-export is one action. It lives on the session, so it dies with the session it described. The alternative — silent disagreement with the head unit — is the failure being designed out |
| Determinism breaks and the week re-picks on re-render | Selection is seeded by the day's date, never by a clock or a random. Asserted in slice 1                                                                                                                                                            |
| `%FTP` resolved against the wrong FTP                 | Nothing in this design resolves one. Renderers emit `%` and fractions; intervals.icu and Zwift resolve against the athlete's own settings, each knowing the indoor/outdoor answer Recover does not — see "a question the matcher does not ask"      |
| `description` drifts from the steps                   | It is derived, not stored. Slice 0 asserts it — including on an unrolled over-under, which is the case that broke the first implementation                                                                                                          |

## What has NOT been verified

Stated plainly rather than implied, because the design was produced by a
17-agent workflow of which **7 agents died on a session limit**: all three
judges and all four adversarial attackers.

**The adversarial pass has since been done by hand and is recorded in
`docs/2026-08-31-cycling-workouts-adversarial-pass.md`.** It found eleven
confirmed defects and cleared three lenses; every fix is folded into the text
above. Four of the eleven were in the two fixes applied earlier the same day —
the pin and the coverage claim — which is the second piece of evidence in two
days that attacking this document repays the time. Notably:

- the pin was stored a level above the fields it stores (`DaySlot` holds two
  sessions), fixed in Design 1;
- the flex-step guidance aimed authors at the warmup, which would have needed
  70 workouts to tile a range that 20 covers, fixed in Design 3;
- the indoor/outdoor FTP rule refused every day, because no planned session
  carries the context it tested — and no renderer needs an FTP at all. Removed
  from Design 3 entirely.

**~~NO CAPTURE HAS EVER PHOTOGRAPHED THIS FEATURE, and none can today.~~
CLOSED 2026-09-01 (#220).** v0.126.0 shipped with 100 Soak PNGs and an axe
ratchet reporting `0 confirmed`, not one of which contained the block: every
seeded plan was `raceType: "marathon"`, the race decides the plan's sport, and
this feature answers cycling days only. It was not that today happened to be a
rest day — a cycling-only feature was structurally unphotographable.

Fixed the way `surfaces.yml` already records for `capture-first-run`: **a
fourth job, with its own seeded owner and its own throwaway Postgres**, which
cannot collide with the demo owner by construction. Changing the demo athlete's
plan to cycling would have fixed the capture and broken `train-race-pacing`,
`train-fitness`, the race chip, threshold pace and Today's session cards.
`scripts/seed-cycling-owner.ts` confirms a gran-fondo plan and then proves the
state it exists to produce, refusing unless a session yields a structured
workout; `train-workout` drives `/train` onto a day that has one and refuses
rather than capturing the ordinary Train tab under a second name.

The note is corrected rather than deleted: the gap was real, it shipped a
release, and the reason it existed — a fixture that could not express the thing
being tested — is worth keeping visible.

**The judges did not run, and nothing has replaced them.** The pass attacked
the winning design; it did not re-score the three rivals against `fitsRepo` /
`survivesAdaptation` / `authoringCost` / `noDrift`, and the cached run's
`result.tally` is still `{}`. Two of three independent designs converged on
derive-at-read-time, and the code claim they rest on was verified by hand
(`adapt-day.ts:505-507`) — but the comparison remains **unscored**.

**If that workflow is ever resumed, re-seed it first.** Its Verify phase builds
its prompt from the cached `result.winningDesign`, never from this file, and
that cache predates every fix above — its own `weakness` field still reads "I
have made pinning impossible". Resuming as-is spends seven agents attacking a
design nobody is going to build.
