# CTL/ATL/TSB and Readiness — Ownership Design (Phase 2c, fourth number slice)

## Scope

Two subsystems named together by the roadmap bullet; investigated
separately.

### Readiness: already single-owner, no change needed

`computeReadiness()` (`src/lib/readiness.ts`) is the sole producer,
called from exactly one place (`computeDailyMetrics()` in
`src/lib/metrics.ts`, the daily job that writes `daily_metrics`). Every
surface (dashboard, Train, Body trends, `get_readiness`, coach context,
push, weekly/monthly reports) reads the persisted `dailyMetrics.readiness`
— none recompute it. Confirmed clean; out of scope for this slice beyond
adding a mutation test if genuinely absent (checked: absent — added).

### CTL/ATL/TSB: two real, fixable issues found

**1. The EMA recurrence itself is duplicated three times** (same
mathematical step, `x = x + (load - x) / days`, re-derived independently
rather than shared):

- `training-load.ts`'s `nativeLoadMetrics()` — the canonical historical
  fill, one day at a time from real activities.
- `race/forecast.ts`'s `walk()` — the same recurrence, applied to
  hypothetical future planned loads. Its own header comment already says
  it "reuses the exact EMA recurrence of the honest load engine" — intent
  to share was already there, just never extracted into one function.
- `morning-insight.ts`'s race-day projected-TSB line — a decay-only step
  (`load = 0`), written as the algebraically-equivalent
  `prev * (1 - 1/days)` instead of the same recurrence with `load: 0`.

Not a behavior bug today (all three correctly use the same `CTL_DAYS`/
`ATL_DAYS` constants), but exactly the "no consumer recomputes it"
criterion-2 violation: a future fix or constant change to the recurrence
itself would need three synchronized edits, and nothing would catch a
missed one.

**2. Two MCP tools read the wrong table — a real, athlete-facing bug**:
`get_fitness_summary` and `get_training_load_summary` query
`wellness_daily.ctl`/`.atl` directly and return them as-is, with no
fallback. `wellness_daily` only has values when intervals.icu has synced
them. `daily_metrics.ctl`/`.atl` (written by `computeDailyMetrics()` via
`resolveEffectiveLoad()`) is the resolved figure — provider value if
present, else the native engine's honest computation, already proven to
run for manual-only athletes (`activity-write.ts` calls
`computeDailyMetrics()` on every manual log). The dashboard already reads
`daily_metrics`.

**Effect**: a manual-only or Strava-only athlete asking the coach about
their fitness gets `ctl: null, atl: null, tsb: null` from these two
tools — the same "manual-only athlete gets nothing" defect class v0.10
(Honest Load) fixed for the dashboard, recurring in the coach-facing
tools that were never migrated. No comment anywhere documents this as
deliberate; it looks like these two tools simply predate
`daily_metrics`/`resolveEffectiveLoad` and were never updated.

## Fix

1. **`advanceLoadEma(prev, load)`** in `training-load.ts`: the one
   function owning the recurrence step. `nativeLoadMetrics()`,
   `race/forecast.ts`'s `walk()`, and `morning-insight.ts`'s projected-TSB
   line all call it. Behavior-preserving — same arithmetic, same
   constants, verified via existing test suites passing unchanged.
2. **`get_fitness_summary`/`get_training_load_summary`**: switch from
   `wellnessDaily.ctl`/`.atl` to `dailyMetrics.ctl`/`.atl`/`.tsb` (already
   resolved, already includes `tsb`, so the manual `+(ctl-atl)` derivation
   in `get_fitness_summary` also goes away).
3. **`schema.ts`**: document `wellness_daily.ctl`/`.atl` as the raw
   provider value (present only when synced) and `daily_metrics.ctl`/
   `.atl`/`.tsb` as the resolved cache/authority every consumer should
   read, cross-referencing `resolveEffectiveLoad()`.
4. Tests: `advanceLoadEma` unit tests; new test files for both MCP tools
   (currently zero coverage) proving a manual-only athlete (no
   `wellness_daily` row) now gets real numbers from `daily_metrics`.

## Out of scope

- Readiness: already correct, no change beyond a mutation test.
- `daily_metrics`'s own computation (`computeDailyMetrics`,
  `resolveEffectiveLoad`) — already the established, tested authority
  from v0.10; not being changed, only being read from correctly by the
  two MCP tools.
- Any UI/dashboard change — already reads `daily_metrics` correctly.
