# v0.41 — The Coach Can See The Race

## The gap

Two defects, both found by the athlete using the app rather than by reading
code: the coach could not read the day-by-day detail of an edited race, and
there was no way to give an existing race a goal when the coach asked for one.

### 1. `get_races` shows the coach less than the race knows

`src/lib/tools/get-races.ts` projects a hand-written field list:

```text
id, name, raceType, sport, date, priority, status, goalNote, daysToRace
```

The `races` table also holds `eventDays`, `distanceKm`, `elevationM` and
`demandHoursOverride`, and `race_stages` holds a row per day (`dayNumber`,
`name`, `distanceKm`, `elevationM`). **None of it reaches the coach.**

Every one of those columns was added by v0.28's race-driven volume work
(migration `0033_race_demand`) precisely so the planner could derive weekly
hours from what the event demands. The planner reads them; the coach that
discusses the plan does not. So an athlete can enter a four-day stage race with
per-day distance and climbing, ask the coach for advice on it, and get advice
formed without any of it.

This is the same defect class as v0.39's importer: a hand-maintained projection
that quietly stopped mirroring its table when columns were added. It went
unnoticed for the same reason — nothing fails. The coach simply answers with
less, fluently, and the omission is invisible unless you know what it should
have said.

### 2. A race's goal can only be set at creation

`goalNote` has a `name="goalNote"` input in the "+ Add race" form. The edit
path is `RaceDemandEditor`, which covers stages and demand and has no goal
field. Once a race exists, its goal cannot be set or changed — which is exactly
the wall the athlete hit when the coach asked what the goal was.

Both the coach's `get_races` and `upsert_race` already read and write
`goalNote`. The data path is complete; only the human's route to it is missing.

## Design

### `get_races` returns the whole race

Add `eventDays`, `distanceKm`, `elevationM`, `demandHoursOverride`, and a
`stages` array joined from `race_stages`, ordered by `dayNumber` ascending.
Each stage carries `dayNumber`, `name`, `distanceKm`, `elevationM`.

Stages are returned **inline rather than behind a new `get_race_stages` tool**.
They are a handful of rows per race, and a separate tool is a second call the
model may simply not make — which reproduces the current failure with extra
steps. The tool count stays at 56.

A single-day race returns `stages: []`. That is meaningfully different from
`eventDays > 1` with no stage detail on file, and the tool description should
say so, so the coach does not read an empty array as "no climbing."

### The goal becomes editable

Add the `goalNote` input to `RaceDemandEditor`, the surface that already exists
for editing a race. Same free-text field the add form uses, prefilled with the
current value, saved through the same action.

**Deliberately free text, not a structured target.** A schema for goals — target
time, target power, placing — is speculation until we know what an athlete
actually types. The coach reads prose perfectly well, and `goalNote` already
flows to it. If structured targets prove necessary, that is a later change made
with evidence.

### A guard, because this is a recurring class

The projection drifted from its table silently. A test asserts that every column
of `races` is either present in `get_races`' output or named in an explicit
exemption list with a reason — the same shape as the parity guard v0.39 settled
on, so a column added to `races` in a future release cannot vanish from the
coach's view unnoticed.

`id` is projected already and stays projected — the coach needs it to address a
race in `upsert_race`. Exemptions are expected to be `userId` (never leaves the
server), `resultActivityId`, `debriefedAt`, `createdAt` and `updatedAt` — each
recorded with why it is not coaching-relevant, and each a claim the
implementation should check rather than inherit from this list.

## Out of scope, stated deliberately

- **No prompt or memory changes.** Those belong to the coach-context project
  (C), which needs an audit of what data exists versus what the coach can reach
  before any design. This release fixes one known instance; it does not go
  looking for the others.
- **The other 55 tools are untouched.** Finding 1 is almost certainly not the
  only projection that has drifted, but auditing them is C's work, and widening
  this release to cover it would delay a fix the athlete is blocked on today.
- **No change to how volume is derived from a race.** This makes existing data
  visible; it does not change any calculation.
- **No structured goals.**

## Verification

- A test proving `get_races` returns day-ascending stages for a multi-day race,
  and `stages: []` for a single-day one.
- The parity guard above, watched failing — add a column to `races` and confirm
  the guard goes red before it is either projected or exempted.
- A test that the goal can be changed on an existing race through the edit
  surface, not only set at creation.

## Risk

The honest one: this widens what the coach receives on every `get_races` call,
which lengthens its context. Stages are small and races are few, so the cost is
minor — but if an athlete ever files a twenty-stage tour, the response grows
with it. Worth watching rather than pre-optimising; a cap would be guessing at a
number nobody has hit.
