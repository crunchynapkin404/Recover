# Athlete-chosen workouts — design

**Written 2026-09-03 against `main` at `3038f4c` (v0.135.0).**

Today Recover decides what you ride. If the engine leaves a day empty and you
want to ride anyway, your only lever is availability — and availability means
"when the auto-assigner may place things", not "I am doing this". So there is
no way to plan the ride, and no way to get a structured workout for it. The
athlete asked for exactly this:

> "add access to the library to select a training on a day myself when not
> getting assigned one and i still want to do one"

and, on being shown an availability-based design:

> "The availability slider is only for automatic assignment, if i want to do a
> ride it should just add it. i do not need to set availability"

This spec is that feature: the whole 103-workout library, browsable on an empty
day, with recommendations inside it, placed as a real session the engine reads
and never writes.

## What exists already

- `LIBRARY` (`src/lib/interval/library.ts`) — 103 hand-authored cycling
  workouts, 22 families, each carrying a `source` with a confidence label.
- `workoutForDay` (`src/lib/interval/for-day.ts`) — a planned session in, a
  rendered workout out. Derives from `purpose` + `durationMins` + a date seed.
- `flex.ts` — a workout has no authored duration. One step absorbs ±50%
  (`FLEX_FRACTION`), floored at `FLEX_FLOOR_SECS`, so each workout covers a
  *range*.
- `WorkoutPin` (`src/lib/interval/pin.ts`) — set ONLY on export to a head unit.
- `ScheduledWorkout.blockIdx` — an index into the day's `availableBlocks`.

## What is missing

There is **no manual add-session path anywhere in the app**.
`src/lib/week-plan/service.ts` exposes move, swap and markDayDone; nothing
creates a session. `unplannedLoad` (`actuals.ts:119`) is written only from a
*completed activity* on a day the plan did not ask for — post-hoc accounting of
"you rode anyway", not a way to plan it.

## Decisions taken, and by whom

Both forks below were put to the athlete and answered.

**1. A plan, not just a ride.** A pick writes a real `ScheduledWorkout`. It
shows on Today and Train, exports to the head unit, and counts toward planned
load and the race forecast. It carries an athlete-chosen stamp so adaptation
may *warn* about it but never silently swaps or drops it.

Rejected: handing over the workout while the plan still says rest, booking load
to `unplannedLoad` afterwards. Cheaper, but only a small step past what the
athlete already has — they can already ride on a rest day. The ask is for the
app to *answer* the day.

**2. The whole library, open, with recommendations inside it.** All 103
workouts, filterable, every one pickable. Recover marks the ones it would
choose today rather than gating the rest behind a second tap.

Rejected: a shortlist with the full library one tap further. That is the app
deciding for the athlete on the exact surface built for the athlete to decide.
It is also the "second door" shape `docs/2026-08-26-ia-inventory.md` flagged.

**3. Availability is not the mechanism.** A pick does not write an availability
block. Availability is the auto-assigner's input; a synthetic block inside
`availableBlocks` would let the fill rung stack a second session into the
athlete's ride and would leave the day reading as available forever after.

## Design 1 — The placement type

`ScheduledWorkout` stops carrying a bare `blockIdx` and carries a placement
that fuses *where it sits* with *who chose it*:

```ts
export interface AthleteChoice {
  /** The library workout the athlete picked. */
  workoutId: string;
  /** ISO instant. Recorded for the athlete, never compared. */
  chosenAt: string;
}

export type Placement =
  | { kind: "block"; blockIdx: number }
  | { kind: "athlete"; choice: AthleteChoice };
```

**Fused, not two optional fields.** `placement: "athlete"` with no workout is
an unrenderable session; fusing deletes that state at compile time. This scope
is library picks only — not a freehand "add a 60 min run" — so nothing is lost.

**`choice` is not `pin`.** `WorkoutPin` means *this reached a head unit*; its
four fields exist to answer staleness against a day that moved. Precedence in
`workoutForDay` becomes **pin → choice → derived**: a workout that was picked
*and* exported still renders what the device holds, which is the whole reason
the pin exists.

**Everything else stays derived.** `purpose` comes from the workout; `type` is
its inverse through `PURPOSE_BY_TYPE` (recovery→Recovery, aerobic_base→
Endurance, long→Long, threshold→Tempo, vo2max→Intervals — all five
`LibraryPurpose` members have one); `description` and `profile` come from
`renderDescription`/`renderProfile`. Nothing is stored in parallel with
something derivable — the drift defect this repo has recorded three times.

`training-plan.ts:108`'s comment on `withPurpose` names `blockIdx` explicitly
and is updated with the walk.

## Design 2 — The engine contract

**The engine reads athlete-placed sessions and never writes them.**

*Reads.* Planned load, the CTL projection, the week's load target, the race
forecast, `MAX_SESSIONS_PER_DAY` (still 2) and `isQuality` all see them. The
engine will therefore decline to place its own Intervals session next to a
chosen quality session, since quality sessions do not sit on consecutive days.

*Never writes.* Every mutating rung skips them: `replan.ts` (keep/move/drop),
`adapt-day.ts` (redistribute, shrink, swap, red-recovery), `fill.ts`
(placement and cap counting), `service.ts` (move, swap).

**This is session-level immunity, not day-level `locked()`.** A day holding a
chosen ride still has real availability the engine may legitimately use for its
own second session; locking the whole day would silently cost the athlete that.

*Instead of writing, it says something.* A rung that would have changed the
session records an adjustment rather than staying silent. Two union
extensions:

- `AdjustmentTrigger` gains `"athlete_choice"`
- `AdjustmentAction` gains `"kept"`

`AdjustmentRecord` already carries `reason`, `reasonCode` and `context`, so the
coach surfaces and logs get it unchanged.

**The known cost.** This is the structured-workouts strand's own open question
— *"a prescription pinned in the morning and adapted at noon has to
re-prescribe, or be pinned deliberately and marked stale"* — which that
document calls "the question most likely to be underestimated". The answer here
is *pinned deliberately, and the engine argues in the adjustment log*. On a red
readiness day Recover states its disagreement and leaves the session standing.

## Design 3 — Storage, back-compat and rollback

`week_plans.days` is `jsonb` with no runtime validation, so **every stored week
in production carries the old shape**. Three parts:

1. **Read-time fallback.** A `normalizePlacement` at the jsonb→`DaySlot`
   boundary maps a legacy `{ blockIdx: n }` to `{ kind: "block", blockIdx: n }`.
   Idempotent.
2. **Dual write for one release — a serialization concern, not a type one.**
   `Placement` stays the union above in TypeScript; `blockIdx` exists only
   inside the `"block"` variant. What is written to jsonb for a block-placed
   session additionally carries a **top-level `blockIdx`** alongside
   `placement`, so v0.135.0 code reading a v0.136.0 week still finds the index
   it expects. Nothing in the app reads that top-level copy — only the
   normalizer's legacy branch does, and only for rows written before this
   release.
3. **A backfill script** (`scripts/backfill-placement.ts`), following
   `scripts/backfill-day-load.ts`, to normalize existing rows so the dual write
   can be dropped in a later release.

**The rollback hazard, stated plainly.** An *athlete-placed* session has no
`blockIdx` by construction, so rolled-back code would read `undefined` and
`adapt-day.ts:168`'s `blockCapacity = block ? blockMins(block) : 0` would set
its duration to **0 minutes**. The blast radius is bounded to sessions added
through this feature between deploy and rollback. It is accepted and recorded
rather than designed away, because the alternative — a legacy `blockIdx` on a
session that occupies no block — is the sentinel this design exists to avoid.

`repair.ts` leaves `completed`/`missed`/`race` days byte-identical. Those days
keep the legacy shape until the backfill runs, which the read-time fallback
handles.

## Design 4 — Eligibility and refusals

A pure `canAddWorkout(day, today) → { ok: true } | { ok: false; reason }`:

| reason | when |
| --- | --- |
| `day_settled` | status is `completed`, `missed` or `race` — historical fact |
| `day_full` | already at `MAX_SESSIONS_PER_DAY` |
| `past_day` | the date is before the athlete's local today |

`restIntent: "pre_race"` is **not** a refusal. The athlete asked for agency;
Recover warns loudly and complies. Same for a red readiness band.

**No FTP is not a refusal either.** Library targets are always % of FTP
(`types.ts`: "Targets are ALWAYS % of FTP, never watts"). Without an FTP the
picker renders percentages and says the targets cannot be shown in watts —
matching how the app already treats an athlete with no anchor set, and the
reason `docs/ROADMAP.md` records that every running figure is Low confidence by
construction.

## Design 5 — Recommendation

A pure `recommendWorkouts(library, context) → Recommendation[]`, where context
is the readiness band, days since the last quality session, the week's load so
far against target, the plan phase, and recently-ridden families.

**It ranks; it never filters.** Every workout stays pickable. A recommendation
carries a `why` sentence built from the same vocabulary the engine already uses.

**Every new constant is coaching convention and says so**, in the voice
`plan-constants.ts` and `library.ts` use: a `source` naming provenance, a
`Confidence: Low` label, and what would raise it. No constant introduced here
claims more than the ones it is built from — the recommendation inherits the
confidence of its inputs exactly, as `pacing-result.ts` does.

## Design 6 — The surface

Entry points: an empty, eligible day in Train ▸ Week, and Today when today is
empty. A sheet, matching the block sheet and Races sheet.

Contents, in one scrolling list:

- **Recommended today** — a marked group, not a separate screen.
- Filters: purpose (5), duration, family (22).
- Each row: name, purpose, `renderDescription`'s sentence, `renderProfile`'s
  shape, and the workout's own `why`.
- A duration control per workout, bounded by its flex range, defaulting to the
  recommended length.
- Warnings rendered inline on the pick, not as a grey subtitle: a `pre_race`
  rest day, a red readiness band, a pick that pushes the week past its load
  target.

## Testing

- Pure modules (`canAddWorkout`, `recommendWorkouts`, `normalizePlacement`)
  are tested directly, no database.
- **The immunity branch is mutation-tested.** Deleting the
  `kind === "athlete"` skip in `adapt-day.ts` must turn a test red. A guard
  never seen to fail is not a guard — `docs/2026-09-01-structured-workouts-handoff.md`.
- `npx tsc --noEmit` after every task. A green vitest run is not evidence the
  branch compiles: that handoff records 47/47 passing on a branch with seven
  type errors.
- A capture entry for the picker sheet, added to the `--except` lists in
  **both** `.github/workflows/surfaces.yml` and `.github/workflows/soak.yml`.
  `0.127.0-rc.1` died in the Soak for updating only one.
- The cycling capture owner (`scripts/seed-cycling-owner.ts`) is the fixture —
  a marathon-plan owner cannot exercise a cycling library.

## Non-goals

- **Freehand sessions.** "Add a 60 min run" is not this. The library is
  cycling-only and this feature is a library picker.
- **Replacing an assigned session.** The ask is explicitly about days with
  nothing on them. Swapping what the engine chose is a different feature with a
  different argument.
- **Running and swimming libraries.** `LibraryPurpose` is cycling; a run
  equivalent needs a threshold pace, which no production user has ever set.
