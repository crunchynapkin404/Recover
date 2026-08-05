# v0.42 — One Sport, Decided Once

Closes findings **F1, F4, F6, F8** of
`docs/specs/2026-08-05-training-plan-audit.md`.

## The gap

An athlete entered a six-day Dolomites gran fondo and received a training plan
made entirely of running workouts — all six blocks, twenty-four sessions. No
error, no warning. The plan was internally consistent and every test passed.

The cause is that **no single thing decides a plan's sport**, and three
independent code paths fall back to running when they cannot tell:

| Site                       | Defect                                                                                                           |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `training-plan.ts:203`     | `inferSports` returns an explicit override **verbatim** — no canonicalisation                                    |
| `training-plan.ts:385-388` | `sports[0] === "Bike"` is a raw equality; everything else falls through to `return generateRunningWorkouts(...)` |
| `materialize.ts:243`       | `raceWeekWorkouts(input.sports[0] ?? "Run", raceIdx)`                                                            |

The plan stored `constraints.sports = ["Ride"]` — the _provider's_ word for
cycling, not the planner's. `canonicalSport("Ride") → "Bike"` has existed since
v0.27.0, but was only ever wired into activity matching, never into the
planner's own input. So the override bypassed the race-type inference that
would have been correct (`"gran_fondo".includes("fondo")` → `["Bike"]`), then
failed a raw equality, and produced running.

The weekly rollover re-reads `constraints.sports` on every materialisation, so
this reproduces itself weekly until the stored value is corrected.

## Design

### The race decides

`races.sport` becomes the source of truth for the sport of any plan targeting
that race.

This is close to free: `generateTrainingPlan` **already creates a race when it
is given none** (`training-plan.ts:834`), so every plan has a race and the
authority is always available. There is no "what if there is no race" branch to
design.

`training_plans.constraints.sports` continues to hold the derived canonical
value, because the weekly rollover reads it rather than re-deriving from the
race.

### A closed set, matching what the generator can actually build

`races.sport` becomes `Bike | Run | Triathlon`, `NOT NULL`, **with no database
default**. A default is a silent decision, which is the thing this release
removes.

Those three are exactly what `generateWorkouts` supports. Swim is deliberately
absent: there is no swim-only branch, so offering it would produce running
workouts — the same defect wearing a different label (**F8**). A swim-only
athlete is not served by this app today, and the honest expression of that is
an absent option rather than one that silently misbehaves.

Triathlon _does_ include swim training. `generateTriathlonWorkouts` splits the
week Swim 20 % / Bike 40 % / Run 40 %, with a dedicated swim session and
Run/Swim fill days, and `canonicalSport` already maps `swim`/`openwaterswim`/
`swimming` so a synced pool session books against it.

### Values from outside are canonicalised; unknowns are refused

Anything arriving from the coach or an import passes through `canonicalSport()`,
so `Ride`, `VirtualRide`, `GravelRide`, `cycling` and `Bike` all become `Bike`.
A value that does not land in the closed set is **refused, not defaulted**.

### Dispatch on sport, and throw on anything else

Today triathlon is routed by **raceType** while cycling is routed by the
**sports list** — two authorities for one decision. A race whose sport says
Triathlon but whose raceType is not in `isTriathlon`'s substring list (a
duathlon, an aquabike, an unusual spelling) fails the first test, fails
`=== "Bike"`, and produces running (**F4**).

Replace both with one explicit dispatch:

```ts
switch (canonicalSport(sport)) {
  case "Triathlon": return generateTriathlonWorkouts(...);
  case "Bike":      return generateCyclingWorkouts(...);
  case "Run":       return generateRunningWorkouts(...);
  default: throw new Error(`unsupported plan sport: ${sport}`);
}
```

The trailing catch-all `return generateRunningWorkouts(...)` is **deleted** — it
is the bug. `materialize.ts:243`'s `?? "Run"` is deleted for the same reason.

`isTriathlon(raceType)` survives only to _pre-select_ the dropdown at race
creation. It stops being an authority and becomes a hint.

Because the set is closed and the column is `NOT NULL`, the `default` branch
should be unreachable in production. It exists so that if it ever _is_ reached,
it is loud. That is the release's premise: a wrong plan must fail, not ship.

### Two write surfaces

**The form.** A required `<select>` on both the add-race form and
`RaceDemandEditor`, pre-selected from the typed race type via the existing
inference — "gran fondo" pre-selects Bike — but visible and changeable. Nothing
is decided silently, and nobody retypes the obvious. This reuses exactly the
surface v0.41 established for `goalNote`.

**`upsert_race`.** `sport` becomes a required enum **on create** and
optional-means-unchanged **on update** — the identical contract v0.41 shipped
for `goalNote`, so the tool stays internally consistent.

### `generate_training_plan` loses its `sports` parameter

It is the parameter through which `["Ride"]` entered. Its documented behaviour
— _"Defaults to athlete profile"_ — describes something that **does not exist
anywhere in the schema** (**F6**). And with the race authoritative it is now a
second way to say the same thing, differently, which is how the two diverge.

This is a deliberate capability removal. The coach sets sport by setting it on
the race, which is where a human can see and correct it.

### Migration

1. Backfill `races.sport` from `inferSports(race_type)`, canonicalised. One live
   row: `GranFondo` → `Bike`.
2. A row whose race type infers nothing usable gets `Run` **only if** the
   existing generated plan is already running — otherwise the migration fails
   loudly rather than guessing. (No such row exists live; the rule exists so a
   dev or restored database cannot be silently mangled.)
3. Add the `NOT NULL` constraint.

## Data repair

Regenerate the athlete's Dolomites plan through the corrected path so the
remaining weeks are cycling, and rebuild the open week. Completed history is
preserved; the forward skeleton is replaced.

## Out of scope, stated deliberately

- **F2, cross-sport work booking to nowhere** — v0.43. Independent root cause,
  needs its own tests. Fixing sport makes this athlete's rides match again but
  does not close the gap for any genuinely cross-sport day.
- **F3, the cycling-only demand model** — v0.44. Needs a running/tri demand
  model, which is real design work.
- **F11, equipment profile and climb gradient** — v0.45 and backlog.
- **No change to how volume is derived from a race**, beyond the sport it is
  derived _for_.
- **No athlete-profile sport field.** The race answers the question.

## Verification

- A test proving a `gran_fondo` race with `sport: Bike` generates cycling
  workouts across every block — the case that failed live.
- A test proving `sports: ["Ride"]` can no longer reach the generator at all
  (the parameter is gone) and that a `Ride`-valued race sport canonicalises to
  `Bike` rather than falling through.
- A test proving an unsupported sport **throws** rather than producing running.
  This is the release's central claim and must be watched failing first.
- A test proving `sport = Triathlon` with a non-triathlon race type generates
  triathlon workouts including a swim — the F4 case, which today produces
  running.
- A test proving the weekly rollover's race-week path uses the plan's sport
  rather than `?? "Run"`.
- A test that the sport can be changed on an existing race through the edit
  surface, not only set at creation.
- The migration run against a copy of live, asserting the Dolomites race lands
  on `Bike`.

## Risk

**The `NOT NULL` constraint is the sharp edge.** Every writer of `races` must
supply a sport, including `importUserData`. v0.39's `Carried<>` type will catch
a missing column at compile time on the import path, but a _restored_ export
written before this release carries no sport, so the import path needs an
explicit canonicalise-or-infer step rather than inheriting the column. That is
the one place where "refuse loudly" would break a legitimate restore, so the
importer infers from race type there and records that it did.
