# Week Target Load — Ownership Design (Phase 2c, first number slice)

## The three producers

- **`trainingBlocks.targetLoadTotal`** (schema.ts:809) — the skeleton's
  un-tapered/laddered target for a week number within a block, produced
  fresh by `periodize()` every time a week rolls over or is previewed.
  `service.ts` says outright: "Recomputed fresh, never read as authority —
  a stored target is exactly how `hoursPerWeek` went stale in the first
  place." It is written once per week number (materialization, and again
  whenever a not-yet-open week is re-previewed) and is the only value that
  exists for a week that has not materialized yet.
- **`weekPlans.effectiveTarget`** (schema.ts:920) — the frozen, post-taper,
  post-adherence-rail figure locked in at materialization
  (`service.ts:392`). It only exists once a `weekPlans` row exists for that
  week.
- **`currentTargetLoad()`** (`week-plan/volume.ts:208`) — a small pure
  derivation (materialization-time rate × current minutes), 2 real call
  sites (race taper stat, season CTL projection). Not a producer in the
  same sense as the other two — it is already a "one function owns this"
  citizen and needs no ownership change, only a mention here for
  completeness.

## The bug pattern (why this is first in Phase 2c)

`targetLoadTotal` is read directly, as if current, by 43 sites across ~18
files — MCP tools (`get_training_plan`, `get_plan_drift`), the weekly
review, the season timeline, and race forecasting — while the code that
actually materializes and re-rolls the open week never reads it back
(`materialize.ts` only ever consumes it as a same-call parameter from a
fresh `periodize()` invocation, never from a stored row). This split
already caused four shipped bugs (v0.38.0 target-drift, v0.45.0 taper
ladder conflict, v0.44.0 lost actuals, v0.61 ramp-clamp regression — see
`docs/BASELINE.md`'s structural lessons) and is why the v0.56–v0.60 week
quick actions (Ease/Deload/Boost/Skip) are built but not rendered: they
write `targetLoadTotal` expecting it to reshape the open week, but
`materializeWeek` never looks at that row again, so the buttons would
change what other surfaces report while leaving the athlete's actual week
untouched (`train/page.tsx:770-777`'s comment documents this exactly).

One correct precedent already exists in the codebase:
`weekAdherencePct` (`volume.ts`) resolves `effectiveTarget ?? blockTarget`
with a documented reason (adherence must survive a week that hasn't
materialized, or predates the column). `race/service.ts` and others
duplicate similar fallback logic ad hoc instead of sharing it — exactly
the "no consumer recomputes it or reads a second store" violation
Phase 2c's rubric names.

## Ownership decision

**`effectiveTarget` is authoritative once a week has materialized (a
`weekPlans` row exists for it). `targetLoadTotal` is authoritative only
for weeks that have not materialized yet** (skeleton preview, future
weeks in a block). This is not a new invention — it generalizes
`weekAdherencePct`'s existing, already-correct fallback into a single
shared read path every other consumer migrates onto.

A new function in `week-plan/volume.ts`, alongside `weekLoadPerMin`/
`currentTargetLoad`/`weekAdherencePct`:

```ts
export function weekTargetLoad(input: {
  effectiveTarget: number | null;
  blockTarget: number | null;
}): Figure<number>;
```

Returns `Figure.available(value, "high")` when either input resolves a
value, `Figure.missingInput(...)` when both are null (criterion 5: the "I
do not know" state is explicit, using the `Figure<T>` vocabulary Phase
2b.3 already established rather than a bare `null`). Internally shares
its resolution with `weekAdherencePct` (which needs the raw number, not a
`Figure`) via a private helper — one function owns the resolution,
`weekAdherencePct`'s public behavior is unchanged.

**Explicitly deferred, not part of this initiative:** re-enabling the week
quick actions. Settling ownership makes that decision possible, but the
choice between "the action re-materializes the open week" and "the copy
describes the skeleton it actually edits" is a product decision, not a
technical one, and is tracked as a follow-up once read-site consolidation
ships.

## Slicing plan (each its own PR, matching Phase 2a's cadence)

1. **Core infrastructure** (this slice): `weekTargetLoad()` + tests,
   `weekAdherencePct` refactored to share the resolution helper
   (behavior-preserving), schema.ts column comments documenting cache vs
   authority (criterion 3), mutation coverage (criterion 6).
2. **Race domain**: `race/service.ts`, `race/debrief.ts` — the most
   fallback-logic-heavy consumers per the investigation.
3. **MCP tools + weekly review**: `get-training-plan.ts`,
   `get-plan-drift.ts`, `update-training-plan.ts`, `weekly-review.ts`.
4. **UI + export**: `train/page.tsx`, `season-timeline-card.tsx`,
   `import-user.ts`/`export-user.ts`, plus the criterion-4 "every surface
   asserted at the surface" audit and a `docs/BASELINE.md` update noting
   the quick-actions decision is now unblocked (still deferred).

Each slice re-verifies "no behavior change except a named, deliberate fix"
the same way Phase 2a verified "no value changes" — any site found reading
`targetLoadTotal` for an already-materialized week is a real bug fix, not
a refactor, and gets called out explicitly rather than folded in silently.

## Non-goals

- Re-enabling the week quick actions (see above).
- Touching `currentTargetLoad()`/`weekLoadPerMin()` — already single-owner.
- `assembleWeeklyTarget().hours` (the athlete-facing hours figure) — a
  deliberately different question per
  `docs/specs/2026-08-03-current-target-load-design.md`, out of scope.
