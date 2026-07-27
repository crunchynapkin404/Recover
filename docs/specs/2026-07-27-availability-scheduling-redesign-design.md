# Availability & Scheduling Redesign — Design

## Problem

Availability and the sessions it produces don't behave the way an athlete
expects. Four defects, all structural:

1. **There is no standard week.** Availability exists only as seven numbers
   inside the open week's row (`weekPlans.days[].availableMins`). The only
   durable setting is `plan.constraints.hoursPerWeek` / `daysPerWeek` — a
   weekly total with no shape per weekday.

2. **Every ad-hoc change becomes permanent.** Next week's prefill copies
   last week's per-day minutes (`prefillAvailability`,
   `src/lib/week-plan/availability.ts:23`). Zero out one Wednesday because
   you're away and Wednesday is zero forever. This is the exact inverse of
   the behaviour it should have: a one-off should be a one-off, and the
   default should be the thing that persists.

3. **Changing one day regenerates the whole week.** `applyAvailability`
   calls `materializeWeek`, which re-runs `generateWorkouts` and re-places
   everything across the roomiest days
   (`src/lib/week-plan/materialize.ts:241`). Zeroing Wednesday can change
   Saturday's session type and duration.

4. **Time is measured per day, not per opportunity.** `availableMins` is a
   daily sum, so 45 min before work plus 60 min in the evening reads as
   "105 minutes available" and the engine schedules a 105-minute session
   that can never be ridden. When a session doesn't fit, the engine
   truncates it (`workout.durationMins = cap`,
   `src/lib/week-plan/materialize.ts:295`) — a 90-minute interval session
   becomes a 45-minute interval session and the purpose of the session is
   destroyed.

## Reference model

JOIN Cycling's availability model is the target, sourced from their
[help article](https://help.join.cc/hc/en-150/articles/4404769608721-Availability)
and their public feature board (313 requests, retrieved 2026-07-27 via
`https://joincycling.featurebase.app/api/v1/submission`). Their stated rule:

> Keep in mind that if you change your availability for a specific day, it
> will always overwrite the default availability that you may have set
> earlier for the entire week.

Their board also shows what they have _not_ built, which is where this
design goes further:

| Their item                                | Status there  | Votes |
| ----------------------------------------- | ------------- | ----- |
| Multiple availabilities per day           | Potential     | 279   |
| Plan activity further in the future       | Planned       | 196   |
| Availability beyond one week ahead        | In Review     | 152   |
| Add holiday (weeks with _more_ time)      | Canceled      | 82    |
| Complement energy level with availability | **Completed** | 31    |
| Running Y/N in weekly availability        | In Review     | 10    |

One item is a lesson in what not to copy: _Remove fixed rest day after
three days training_ (Canceled, 31 votes) reports that JOIN inserts a rest
day after three training days "independent of my training load in the
previous days or availability for the next days". The replan ladder below
looks ahead specifically to avoid that failure.

## Goals

- A standard week of availability per weekday, expressed as time blocks.
- Date-specific overrides that always beat the default and survive later
  default edits, settable arbitrarily far ahead.
- Sessions fit a _block_, never a daily sum; two blocks can carry two
  sessions.
- Each block carries an expected energy level and an optional sport
  restriction, both of which constrain what may be scheduled in it.
- Changing availability moves only what it has to, along a deterministic
  ladder, and preserves each session's training purpose rather than
  truncating it.
- A weekly prompt to keep availability current, and a warning grounded in
  the athlete's own CTL when the time given is too little.
- Unplanned bonus work never causes a planned session to be removed.

## Non-goals

- **Athlete level / abilities.** Today the only level signal is starting
  CTL at plan generation (`src/lib/training-plan.ts:517`). A real level
  model (experience, threshold power, progression tolerance) drives _which_
  workouts get generated and is a separate spec, to follow this one.
- **Recurring calendar items** (commutes, weekly club rides). The standard
  week covers the recurring _time_; naming a recurring _event_ is out.
- **Rewriting workout generation.** `generateWorkouts` keeps its current
  procedural shape; this spec adds metadata to what it produces
  (`purpose`, `minEffectiveMins`) and changes where the results are placed.
- **Google Calendar conflict detection.** Calendar stays the hint it is
  today (a suggestion that lowers a prefill). Blocks make real conflict
  detection possible later; building it now widens the spec.
- **A holiday/vacation period as its own concept.** Overrides far ahead
  already express "that week I have much more time".

## Design

### 1. Data model

Two new tables. Deliberately not a column on `weekPlans`: availability must
outlive any one week.

**`availability_defaults`** — one row per `(userId, weekday)`, `weekday`
0–6 with Monday 0, unique on `(userId, weekday)`. Column `blocks jsonb`.

**`availability_overrides`** — one row per `(userId, date)`, unique on
`(userId, date)`. Column `blocks jsonb`, plus `createdAt` / `updatedAt`.

Both carry the same shape:

```ts
interface AvailabilityBlock {
  start: string | null; // "HH:MM" local; null only on migrated legacy rows
  end: string | null;
  mins: number; // derived from start/end on write when both present
  energy: "easy" | "normal" | "full";
  sports: string[] | null; // null = any sport in the plan
}
```

`mins` is stored rather than always computed because migrated legacy rows
have no clock times. When `start` and `end` are both present, writes derive
`mins` from them, so the two can never disagree. One helper,
`blockMins(b)`, is the only reader.

**Why two tables rather than one with a flag:** JOIN's precedence rule
falls out for free. An override is a _complete replacement_ of that date,
never a delta, and editing defaults touches a different table entirely —
there is no code path that could corrupt the rule. An override either
exists or doesn't, which also makes "reset to standard" a row delete.

An override with `blocks: []` means "unavailable that day". This is
distinct from having no override row at all, which means "use the
default".

### 2. `DaySlot` changes

```ts
interface DaySlot {
  date: string;
  availableBlocks: AvailabilityBlock[]; // resolved for this date
  workouts: PlannedWorkout[]; // was: workout: PlannedWorkout | null
  availableMins: number; // derived sum, read-only compat
  unplannedLoad?: number; // bonus work, see §7
  // ...existing: status, movedFrom, activityId, actualLoad, raceName
}
```

`workout` → `workouts` is the largest ripple in this spec. Readers to
update: `week-strip.tsx`, `today-card.tsx`, `week-day-list.tsx`,
`day-actions.tsx`, `adapt-day.ts`, `materialize.ts`, `service.ts`,
`src/lib/race/forecast.ts`, and the coach tools `get-week-plan.ts` /
`icu-event-body.ts` / `icu-event-shape.ts`.

`availableMins` stays as the derived sum purely so existing displays and
the race forecast keep working. **No placement logic may read it** — that
is defect 4.

`PlannedWorkout` gains:

```ts
purpose: "recovery" |
  "aerobic_base" |
  "threshold" |
  "vo2max" |
  "long" |
  "brick";
minEffectiveMins: number;
```

Floors, applied at generation: recovery 20, aerobic_base 40, threshold 45,
vo2max 40, brick 60, long 90. Below its floor a session no longer delivers
its stimulus and must be substituted rather than shortened.

Purpose is derived from the existing `type` at generation, one-to-one:
Recovery→recovery, Endurance→aerobic_base, Long→long, Tempo→threshold,
Intervals→vo2max, Brick→brick. `type` stays as the display label; `purpose`
is what the engine reasons about.

**Migration of stored `weekPlans.days` jsonb**, in the same migration that
adds the tables:

- `workout: X` → `workouts: [X]`; `workout: null` → `workouts: []`
- `availableMins: N` where N > 0 → `availableBlocks: [{ start: null, end:
null, mins: N, energy: "normal", sports: null }]`; where N is 0 →
  `availableBlocks: []`, since a zero-minute block is not a real
  opportunity. `availableMins` is retained either way
- `purpose` / `minEffectiveMins` on legacy workouts are inferred from
  `type` via the same table generation uses

Null clock times on legacy blocks are intentional: the migration must not
invent times the athlete never gave.

### 3. Resolver

```ts
resolveDay(defaults: AvailabilityBlock[], override: AvailabilityBlock[] | null)
  : AvailabilityBlock[]
resolveWeek(userId, dates: string[]): Promise<Map<string, AvailabilityBlock[]>>
```

`resolveDay` is pure and holds the entire precedence rule: an override that
exists wins outright, including the empty array; otherwise the weekday
default. `resolveWeek` loads the seven defaults and the overrides for the
requested dates in two queries and maps `resolveDay` over them.

`prefillAvailability` is **deleted**, along with
`src/lib/week-plan/availability.test.ts`'s prefill cases — its "copy last
week" behaviour _is_ defect 2, and `resolveWeek` replaces it outright.
`formatAvailability` in the same file survives and moves to the block
formatting helpers. Rollover resolves the standard week plus any overrides
already set for those dates. The Google Calendar hint keeps its current role: on the
confirmation screen only, a heavily-booked day lowers the _suggestion_
shown, never what is stored.

### 4. Placement

`materializeWeek` stops sorting days by `availableMins` and instead builds
a flat slot list across the week:

```ts
interface Slot {
  dayIdx: number;
  blockIdx: number;
  mins: number;
  energy: Energy;
  sports: string[] | null;
}
```

Sorted by `mins` descending, then `dayIdx`, then `blockIdx` — deterministic,
as the current code is. A workout may occupy a slot when all hold:

- `slot.mins >= workout.durationMins`
- `slot.sports === null || slot.sports.includes(workout.sport)`
- the energy ceiling admits the workout's **purpose**:
  `easy` → recovery, aerobic_base, long; `normal` → adds threshold;
  `full` → adds vo2max and brick
- the existing quality-adjacency rule, evaluated per **day**: no quality
  session on a day adjacent to another quality day, and never two quality
  sessions on the same day
- at most two sessions per day

The existing `place()` step-down fallback (Intervals→Tempo→Endurance when
no non-adjacent day exists) is kept, and now also fires when the only
remaining slots are energy-capped.

The truncation at `materialize.ts:295` is deleted. A session that does not
fit any slot goes down the ladder in §5 instead.

### 5. Replan ladder

A new pure function, replacing the `materializeWeek` call inside
`applyAvailability`:

```ts
replanWeek(week: WeekState, resolved: Map<string, AvailabilityBlock[]>)
  : { week: WeekState; adjustments: AdjustmentRecord[] }
```

It never regenerates the week. It recomputes each day's slots from the new
availability, marks every session whose slot no longer admits it as
_displaced_, leaves every other session byte-identical, and walks each
displaced session down four rungs in order:

1. **Move** — the nearest free slot in the week that admits it whole.
   "Nearest" is the smallest absolute day distance from the session's
   original date; ties break toward the earlier day, then the earlier
   block.
2. **Compress** — same purpose, duration reduced to the largest fitting
   value, never below `minEffectiveMins`. The description is regenerated to
   match (e.g. `5×4min` → `4×4min`).
3. **Substitute** — a workout of a different purpose that _is_ effective at
   the available duration, stepping toward the nearest stimulus:
   `vo2max → threshold → aerobic_base → recovery`, `brick → threshold`,
   and `long → aerobic_base`. Each step re-checks the new purpose's floor,
   so a very small block lands on `recovery` or reaches rung 4.
4. **Drop** — removed, with an `AdjustmentRecord` saying so.

Each rung writes an `AdjustmentRecord` with the reason, so "What changed &
why" explains the whole chain.

**Look-ahead.** Rung 1 only considers days whose _resolved_ availability
has room — including days later in the week whose overrides are already
set. If the week's remaining capacity cannot hold the session whole, the
ladder skips rung 1 rather than moving it into a dead end, and goes
straight to compress. This is the specific failure the JOIN board reports
as _Remove fixed rest day after three days training_.

Days with status `completed` or `missed` stay locked, as
`applyAvailability` already does today.

### 6. Prompt and insufficient-time warning

**Prompt.** Rides the existing weekly-review slot in
`src/lib/sync/scheduler.ts` — no new infrastructure. A new column
`weekPlans.availabilityConfirmedAt timestamp` records confirmation. The
prompt fires once per week when the open week has no confirmation, as a
push notification via `src/lib/push.ts` plus a card on `/train`. Confirming
the week — even without changing anything — sets the column and silences
it.

**Warning.** Grounded in the athlete's own numbers, computed from the last
28 days of non-Strava activities:

```text
loadPerHour     = Σ load / Σ hours            (last 28d)
maintenanceLoad = latest CTL × 7
maintenanceHrs  = maintenanceLoad / loadPerHour
targetHrs       = effectiveLoad / loadPerHour
```

- offered hours < `maintenanceHrs` → "this is below what holds your fitness
  — CTL is projected to fall from X to Y this week"
- between `maintenanceHrs` and `targetHrs` → "you'll hold your fitness, but
  won't gain this week"
- at or above `targetHrs` → no warning

The projection uses a standard 42-day EWMA over the coming seven days, as a
new pure helper — CTL itself arrives from intervals.icu in `wellnessDaily`
and is never recomputed locally, only projected forward.

With fewer than 28 days of load history, or `loadPerHour` of zero, **no
warning is shown at all**. A fabricated threshold during calibration would
be worse than silence.

### 7. Bonus work does not cannibalise the plan

An activity landing on a day with no planned session, or exceeding a
completed session's planned load, is recorded as `DaySlot.unplannedLoad`.
It counts toward the week's actuals and CTL exactly as it does today, but
**the replan ladder is never triggered by load**. Sessions may only be
removed in response to availability (§5) or readiness (`adaptDay`). This is
a rule in `runDailyAdaptation`: it may attach load and flip status, never
delete a later session because the week's load ran ahead.

### 8. UI

**Standard week** — a new section, reachable from `/train` and `/settings`.
Seven rows, each listing that weekday's blocks with an add/remove control.
The block editor is a bottom sheet: start and end time, an energy chip row
(easy / normal / full), and sport chips when the plan has more than one
sport.

**Week availability** — the existing `IntakeForm` becomes a resolved view.
Each day shows its blocks, with a badge when that date is an override and a
"back to standard" action that deletes the override row. Tapping a day
opens the same sheet, editing that date's blocks. The existing
`availability-sheet.tsx` and `wheel-column.tsx` are reused as the sheet
shell and time control rather than rewritten.

The weekly total line under the grid gains the §6 warning when it applies.

**Day menu** — `day-actions.tsx` gains "Set this day to zero", writing an
override with `blocks: []`. This is JOIN's swap-menu reset.

### 9. Coach tools

`set_week_availability` currently takes seven integers. It gains a
block-shaped parameter and keeps accepting the integer form, mapping a
plain number to a single block with null times, `energy: "normal"`,
`sports: null`. Two new tools: `set_standard_week` and
`clear_availability_override`. `get_week_plan` returns `workouts` plural
and each day's resolved blocks.

## Error handling and edge cases

- **Overlapping blocks on one day** — rejected on write with a message; the
  editor prevents creating them.
- **`end` before `start`** — rejected on write. No overnight blocks; a
  session spanning midnight is out of scope.
- **Override far in the future, then the plan changes** — overrides are
  keyed by date and independent of any plan, so they simply apply when that
  week materializes.
- **Override on a past date** — kept in the table (it is history) but never
  applied; rollover only resolves dates from the week start onward.
- **Standard week edited mid-week** — takes effect at the next rollover, not
  retroactively. The open week keeps what it resolved, unless the athlete
  confirms the week again.
- **Two sessions on one day, one completed** — the completed slot locks;
  the other stays replannable.
- **A day whose blocks all shrink below every floor** — every session on it
  is dropped, with one adjustment record per session.
- **Legacy blocks with null times** — sortable and fittable by `mins`
  alone; the UI shows them as a bare duration until edited.

## Testing

Pure functions, unit-tested with no DB:

- `resolveDay` — override wins; empty-array override means unavailable;
  absent override falls through to default; editing a default does not
  change a resolved override
- `blockMins` — derived from times, and the legacy null-times path
- slot construction and ordering — determinism, the two-per-day cap
- energy ceiling and sport filter admission
- each ladder rung in isolation, and the full chain on a session that must
  compress then substitute
- look-ahead — a displaced session is not moved onto a day with no room
- compression floors and the substitution mapping
- CTL projection and the two warning thresholds, including the
  under-28-days silence

Component tests: the block editor sheet, the override badge and its
"back to standard" action, "set this day to zero", and the warning line.

Service-level tests (`applyAvailability`, `rolloverWeekPlan`,
`replanWeek` through the DB) follow the repo's guard —
`const hasDb = !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg"`
with `describe.skipIf(!hasDb)`, as in `src/lib/audit.test.ts:9`. Without
it a new DB-touching suite crashes CI instead of skipping.

Migration test: a stored week in the old shape reads back with `workouts`
plural, one legacy block, and inferred `purpose` / `minEffectiveMins`.
