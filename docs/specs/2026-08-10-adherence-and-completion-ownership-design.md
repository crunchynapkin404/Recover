# Adherence and Completion — Ownership Design (Phase 2c, third number slice)

## Scope

Investigated broadly first (adherence and completion are two distinct
concepts the roadmap bullet names together):

- **Adherence** (`actualLoad` vs target, as a percentage): single owner
  already, `weekAdherencePct()` (`week-plan/volume.ts`) — resolves
  `effectiveTarget ?? blockTarget` via the shared `resolveWeekTarget()`
  helper (same one `weekTargetLoad()` uses). 2 read sites
  (`service.ts`'s rollover write, `weekly-review.ts`'s message), no
  duplication found anywhere else.
- **Completion** (sessions actually done): single owner already,
  `weekActuals()`/`deriveDayActuals()`/`bookWeekActuals()`
  (`week-plan/actuals.ts`) — the v0.44.0 fix (`docs/BASELINE.md`
  structural lesson) already made this the sole path from `activities` to
  a week's booked actuals. No consumer bypasses it.
- Persisted `trainingBlocks.actualLoad`/`actualSessions`/`adherencePct`:
  confirmed cache-only, written once at week close
  (`rolloverWeekPlan`), and every read site (`materialize.ts`'s
  low-adherence rail, `race/service.ts`, `race/debrief.ts`,
  `get-plan-drift.ts`, `insights/milestones.ts`, `get-training-plan.ts`)
  only reads CLOSED weeks — none reads it for the open week as if live.

**One real, different-shaped issue found**: `latestAdherencePct()` in
`src/components/train/season-timeline-card.tsx` computes a season-to-date
aggregate — a genuinely different question from `weekAdherencePct`'s
single-week figure (same relationship as `currentTargetLoad` was to
`weekTargetLoad` in the first slice), so this is not a criterion-2
duplication. It has a real criterion-5 bug instead:

```ts
function latestAdherencePct(points: SeasonTimelinePoint[]): number | null {
  const targetTotal = points.reduce((sum, p) => sum + (p.targetLoad ?? 0), 0);
  if (targetTotal <= 0) return null;
  const actualTotal = points.reduce((sum, p) => sum + p.actualLoad, 0);
  return Math.round((actualTotal / targetTotal) * 100);
}
```

A week with `targetLoad: null` (genuinely unknown, per
`seasonTimelinePoints()`'s own doc comment — "missing actual weeks become
0 load / 0 sessions, while null targets stay null") contributes 0 to the
target sum but its real `actualLoad` still lands in the actual sum
unconditionally. An athlete who trained during a week with no
materialized target has that work silently inflate the numerator without
a matching denominator contribution, overstating "Season adherence" —
exactly the "unknown treated as zero/counted anyway" class of bug this
whole initiative exists to remove, just not yet caught because this
function has zero existing test coverage.

## Fix

Exclude a week from BOTH sums when its target is unknown (pairwise, not
zero-fill) — an honest partial aggregate over only the weeks where both
halves of the ratio are known, rather than a distorted one over all weeks.

## Out of scope

- `weekAdherencePct`, `weekActuals`, `deriveDayActuals`, `bookWeekActuals`
  — already single-owner, no change needed.
- Renaming/restructuring `latestAdherencePct` itself — already a single,
  appropriately-scoped private function; the fix is to its null handling,
  not its shape.
