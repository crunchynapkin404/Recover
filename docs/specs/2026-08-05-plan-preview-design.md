# v0.44 — The plan you can see before you get it

Adds a preview-and-confirm step to plan generation, and makes the commit
transactional.

Assumes **v0.42** has landed: `races.sport` is the sport authority and
`inferSports` is gone.

## The gap

`generateTrainingPlan` (`training-plan.ts:765-901`) is destructive before it is
verified. In order, from a single LLM tool call:

1. computes the skeleton
2. **archives every existing `active` plan** (`:824-832`)
3. creates a race if none was given, at a hardcoded `priority: "A"` (`:834-843`)
4. inserts the plan row
5. **writes the athlete's standard week** via `seedAvailabilityDefaults`
   (`:860`) from an LLM-supplied `hoursPerWeek` that defaults to 8. Not
   destructive — it is `onConflictDoNothing` per weekday, so existing rows
   survive — but a brand-new athlete acquires a standard week they never
   agreed to, derived from a number nobody measured
6. inserts every training block
7. rolls the live week over

There is no dry run, and no point at which a human sees the result before it is
the athlete's plan. Two consequences:

**Nothing catches a wrong plan.** F1 in the audit — a cyclist given twenty-four
running sessions — sat in the database, internally consistent, until the
athlete went for a ride. A rendered skeleton showing `sport: Run` would have
been obvious in seconds to someone who knows nothing about `canonicalSport`.

**A failure leaves the athlete with nothing.** The archive at step 2 precedes
the inserts at steps 4 and 6. Any error between them leaves zero active plans.

This is not a hypothetical class of problem. In the intervals.icu Annual
Training Plan Builder thread, orphaned plan targets left behind by a deletion
drove one athlete's ATL to 116 instead of ~70, and only deleting the targets by
hand fixed it (post 148); plans cannot be edited at all, only deleted and
recreated (posts 21, 87, 150); and opening the generator wipes sport and timing
from existing plans (post 165).

## Design

### A draft is a plan that has not been chosen yet

`training_plans.status` gains `"draft"`. This needs **no database migration**:
the column is plain `text` with a TypeScript-level enum and no `CHECK`
constraint (verified against `drizzle/*.sql`).

A draft is written exactly like a real plan — the row plus its
`training_blocks` — and is inert:

- `getActivePlan` filters on `status = "active"`, so a draft is invisible to
  every consumer, including the ambiguity log line in `active-plan.ts`
- it archives nothing, creates no race, seeds no availability, triggers no
  rollover
- **one draft per user.** Generating a new one deletes the previous draft and
  its blocks, so abandoned drafts cannot accumulate

Persisting the draft, rather than returning a computed object and recomputing
on confirm, is deliberate: `startingCtl` and availability are read from live
data, so a recompute at confirm time could commit a plan the athlete never saw.

### Confirmation is one transaction

`confirmTrainingPlan(userId, planId)`, inside a single `db.transaction`:

1. re-read the draft; refuse unless it is still `status = "draft"` and owned by
   this user
2. archive existing `active` plans
3. flip the draft to `active`
4. seed availability defaults, unchanged — `onConflictDoNothing` per weekday
   already leaves an existing standard week alone. It moves inside the
   transaction so it cannot land for a plan that then fails to activate

`rolloverWeekPlan` runs after the transaction commits, keeping its existing
`try`/`catch`: a rollover failure must not roll back a good plan.

Archive and activate now happen in the same transaction, so the window in
which an athlete has no active plan does not exist.

### The race is chosen, never conjured

Silent race creation at `priority: "A"` becomes an explicit line in the
preview: _"Will create **Dolomites Gran Fondo**, 2026-09-13, as an A race."_
When `raceId` is supplied the preview names the existing race instead.

With v0.42 making `races.sport` the sport authority, a plan's race is also its
sport authority — one more reason it must be a visible decision rather than a
side effect.

### The preview is arithmetic first

The ATP thread's single largest source of confusion was phase arithmetic that
did not reconcile — "Feb 2 to Jul 12 shows 16 weeks instead of 23" (post 32),
"only 2 peak weeks instead of 3" (post 46), "16 instead of 20" (post 47), and
an outright request for documentation (post 34). The cause is that recovery
weeks are not counted in phase totals. `periodize` has the same trap: phase
lengths come from `Math.max(2, round(weeksTotal * 0.4))` and recovery weeks are
substituted inside them.

So `phases` is a first-class field whose rows must visibly sum to
`weeksTotal`, with recovery as its own row:

```ts
interface PlanPreview {
  planId: string; // the draft row
  sport: "Bike" | "Run" | "Triathlon";
  race: {
    id: string | null; // null = will be created
    name: string;
    date: string;
    priority: "A" | "B" | "C";
  };
  startDate: string;
  weeksTotal: number;
  /** Rows sum to weeksTotal. Recovery is its own row, not folded into a phase. */
  phases: { phase: Phase; weeks: number; weekNumbers: number[] }[];
  weeks: {
    weekNumber: number;
    phase: Phase;
    targetLoad: number;
    targetHours: number;
    raceName: string | null;
  }[];
  /** "default" means no CTL was found and 30 was assumed. */
  startingCtl: { value: number; source: "wellness" | "default" };
  feasibility: FeasibilityResult | null;
  volume: { source: VolumeResult["source"]; shortfall: Shortfall | null };
  warnings: PreviewWarning[];
}
```

`startingCtl.source` exists because `wellness?.ctl ?? 30`
(`training-plan.ts:800`) currently cannot be told apart from a real CTL of 30 —
the same silent-default pattern as F1, in the fitness input. Fixing it is
v0.47; naming it is free here.

`feasibility` reuses `race/feasibility.ts` unchanged, and `volume` reuses
`assembleWeeklyTarget`. Neither is new work.

### Warnings are a closed set

Each is one plain sentence, and the set is exhaustive — an unrecognised
condition is a bug, not a missing warning.

| Warning                     | Fires when                                                   |
| --------------------------- | ------------------------------------------------------------ |
| `no_ctl_history`            | `startingCtl.source === "default"`                           |
| `volume_fallback`           | `volume.source === "fallback"` — the derived path gave up    |
| `availability_binds`        | `volume.shortfall != null`                                   |
| `feasibility_tight`         | verdict is `tight`                                           |
| `feasibility_not_realistic` | verdict is `not_realistic`                                   |
| `race_created`              | `race.id == null`                                            |
| `availability_seeded`       | the athlete is missing weekday rows; confirming creates them |
| `short_horizon`             | fewer than 4 weeks to the race                               |

### A close race scales instead of refusing

`throw new Error("Race too soon for a plan")` at `weeksTotal < 4` is replaced
by a plan of the weeks that actually exist — taper only, if that is all that
fits — plus a `short_horizon` warning. Refusing to plan is worse than planning
honestly, and Domestique reached the same conclusion (auto-scaling when dates
are unrealistic).

`weeksTotal > 52` keeps throwing. That is a different failure — a mistyped date
— and the existing message is actionable.

### The surface is three decisions

A card on `/train`: sport, race, the phase table, the week list, warnings. Three
affordances and no more:

- **Start this plan**
- **Change days per week** (3–7)
- **Change hours per week**

Either change regenerates the draft in place. Nothing else is editable.
Periodization internals get an explanation, not a control — the only long-term
user to leave a competitor in the whole landscape survey left over
configuration burden, not missing features, and intervals.icu's
twelve-parameter generator produced six separate posts of people unable to
reconcile their own week count.

### Tools

`generate_training_plan` returns a `PlanPreview` and commits nothing. A new
`confirm_training_plan` takes the draft's `planId`. Both keep `scope:
"write:plan"` — a draft is still a write.

## Testing

Pure, no database:

- **phases reconcile** — property test over plan lengths 1–52: `sum(phases[].weeks) === weeksTotal`, and every week number appears in exactly one phase row
- **short horizon** — a 2-week race yields a plan plus `short_horizon`, not a throw
- **each warning** fires on its own fixture, and does not fire otherwise

Database-gated (`describe.skipIf(!hasDb)` per repo convention, verified with
`DATABASE_URL` unset before pushing):

- **preview writes nothing but the draft** — no rows in `races`,
  `availability_defaults`, `week_plans`; no existing plan changes status
- **drafts are invisible** — `getActivePlan` ignores a draft, and the
  multiple-active log line does not fire
- **confirm is atomic** — a forced failure after the archive leaves the
  previous plan `active`
- **one draft per user** — a second generate replaces the first, blocks included
- **an existing standard week survives confirmation**

## Out of scope

- The season timeline (v0.48).
- Fixing `startingCtl ?? 30` (v0.47) — this release only makes it visible.
- Changing any periodization constant (v0.45).
- Editable periodization parameters, drag-and-drop, a workout library.

## Risks

**A new lifecycle state has readers we have not enumerated.** `active-plan.ts`
is the single reader for "the athlete's plan", which bounds this, but
`export-user` / `import-user`, the admin view, and any `training_plans` query
without a status filter need a pass before this lands.

**Preview could drift from commit.** Mitigated by persisting the draft rather
than recomputing — the row confirmed is the row shown.
