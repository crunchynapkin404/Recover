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
7. **Export pins.** Nothing is stored on a day until the athlete exports it;
   exporting writes the chosen workout's id onto the day, and Recover then
   marks it stale if the day subsequently changes.

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
served by refusal: an athlete with no FTP, or a day with no matching workout,
gets today's prose and band. Nothing is invented to fill a gap.

---

## Design 1 — Storage: derive at read time, pin on export

**Nothing is stored on a planned day until the athlete exports it.**
`matchWorkout(purpose, durationMins, date)` is a pure function over the
library, called on every read.

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

So exporting writes `workoutId` and `exportedAt` onto the day — the one
moment pinning is genuine. From then on Recover renders the pinned workout,
and if `(purpose, durationMins)` no longer match what it was chosen for,
shows it as **stale** with a re-export action. The roadmap anticipated
exactly this: _"a prescription pinned in the morning and adapted at noon has
to re-prescribe, **or be pinned deliberately and marked stale**."_

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
non-Bike once rather than 100+ literals repeating a constant), `durationMins`
(derived), `intensity` (derived from the peak main-set target through the zone
table already shipped in `get-workout-syntax.ts`), per-step text prompts, free
blocks, cadence _ranges_, nested repeats.

## Design 3 — Fitting: how "the day wins" becomes literally true

Each workout has exactly one **flex step**: the longest step in any
`repeat === 1` block — in practice a warmup or cooldown — ties broken by the
last, which puts a cooldown ahead of an equal-length warmup.

Fitting adjusts **only** that step, within a bounded tolerance expressed as a
fraction of its authored length. The main set, which is what the workout _is_,
is never touched. The guarantee is exact:

> `rendered total === round(session.durationMins × 60)`, always.

A 75-minute `Sweet Spot 3×12` whose flex step is a 600 s warmup ramp (bounded
to 300–900 s) therefore covers days of 70–80 minutes, and is not a candidate
outside that band. **Coverage is a property of the library, not of the
matcher** — which is what makes "author 100+" the real cost and the code the
easy part.

### Selection

`matchWorkout` returns one of three things, and the third is not a failure
mode to be engineered away:

- `matched` — a candidate fits. Among candidates, the pick is **deterministic**
  and seeded by the day's own date, so the same week never re-picks a
  different workout on a re-render. Recent ids _and recent families_ are
  avoided.
- `synthesized` — reserved, not built in the first slice.
- `refused` — no candidate fits, or the athlete has no FTP for this context.
  The day keeps today's prose and band.

**Refusal is the honest path, not a gap.** It is how `strengthPrescription`
already degrades when a 1RM is unset, and it is the gate's third clause in
code.

### Indoor vs outdoor FTP

`v0.118.0` keeps them apart, and the roadmap names getting this wrong as a
non-goal in itself: _"a step targeting 105% of the wrong one is worse than a
zone band."_ Resolution picks the FTP matching the session's context; where
context is unknown, it refuses rather than guessing.

## Design 4 — Every representation derived

`blocks` is the single source of truth. Four renderers, each pure:

| Renderer            | Output                                | Notes                                                                                                                               |
| ------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `renderIcu`         | intervals.icu structured-workout text | Goes in the `description` of a WORKOUT event. Syntax already shipped verbatim in `get-workout-syntax.ts`; `%` and `X-Y%` are native |
| `renderZwo`         | `.zwo` XML                            | Plain text, no auth, no third party                                                                                                 |
| `renderProfile`     | the in-app interval shape             | Hand-rolled SVG, the repo's existing convention                                                                                     |
| `renderDescription` | the human-readable line               | **Replaces** today's hand-written `description` for library days                                                                    |

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

| #   | Slice                     | Ships                                                                                                                                                |
| --- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | **Shape + renderers**     | `types.ts`, `renderIcu`, `renderZwo`, `renderDescription`, tested against hand-written expected output. No library, no matcher, nothing user-visible |
| 1   | **The matcher**           | `match.ts` with fit/flex/refuse, deterministic selection, family rotation. Tested against a stub library                                             |
| 2   | **The library, first 30** | Every `(purpose, duration band)` covered once, each with `source` and confidence. Coverage asserted by a guard                                       |
| 3   | **The surface**           | Workout name, profile and targets in the Week open-day block                                                                                         |
| 4   | **Export**                | `.zwo` download route + the intervals.icu WORKOUT write, and the `workoutId`/`exportedAt` pin with its stale marker                                  |
| 5   | **The library, to 100+**  | Pure content. No code change — which is the test of whether slices 0–2 got the shape right                                                           |

Slices 0–2 are the design work; 3–4 are largely plumbing; 5 is authoring.

## Risks

| Risk                                                  | Mitigation                                                                                                                                                                       |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Coverage gaps mean days silently fall back to prose   | Slice 2 ends with a guard asserting every `(purpose, band)` the engine can emit has ≥1 candidate. A gap fails the build, it does not degrade quietly                             |
| 100 hand-authored workouts is 100 coaching judgements | Each carries `source` and a confidence label. The reversal above is what makes that acceptable, and it is recorded                                                               |
| A pinned workout and a re-planned day disagree        | The pin is explicit, the staleness marker is explicit, and re-export is one action. The alternative — silent disagreement with the head unit — is the failure being designed out |
| Determinism breaks and the week re-picks on re-render | Selection is seeded by the day's date, never by a clock or a random. Asserted in slice 1                                                                                         |
| `%FTP` resolved against the wrong FTP                 | Indoor/outdoor kept apart per v0.118.0; unknown context refuses                                                                                                                  |
| `description` drifts from the steps                   | It is derived, not stored. Slice 0 asserts it                                                                                                                                    |

## What has NOT been verified

Stated plainly rather than implied, because the design was produced by a
17-agent workflow of which **7 agents died on a session limit**: all three
judges and all four adversarial attackers.

So this design has been **compared but not scored, and not attacked.** Two of
three independent designs converged on derive-at-read-time, and the code claim
they rest on was verified by hand (`adapt-day.ts:505-507`). But the strongest
objections recorded here are the designs' own self-stated weaknesses, not an
adversary's findings. **The adversarial pass is owed before slice 0 begins.**
