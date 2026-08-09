# Provenance: sync/polling domain constants (v0.78.0)

**Date:** 2026-08-09
**Phase:** 2a — Provenance (`docs/ROADMAP.md`)
**Slice:** fifth. Follows v0.74.0 (`athlete-level.ts` + `week-plan/types.ts`),
v0.75.0 (`training-load.ts`), v0.76.0 (`readiness.ts` + sleep files),
v0.77.0 (`race/taper.ts` + `race/forecast.ts` + `race/feasibility.ts` +
`race/triathlon-legs.ts`).

## Scope

The sync/polling domain named in
`docs/plans/2026-08-09-provenance-athlete-level-week-plan.md`'s Findings:
`src/lib/sync/activity-poll.ts`, `src/lib/sync/wellness-refresh.ts`,
`src/lib/sync/strava-webhook.ts`, `src/lib/sync/intervals-backfill.ts`. 11
exported constants total. No other sync/ file (`scheduler.ts`,
`intervals-sync.ts`, `oura-sync.ts`, `withings-sync.ts`,
`apple-health-ingest.ts`, `wellness-changed.ts`, `whoop-sync.ts`,
`strava-sync.ts`) exports an `[A-Z_]+`-named constant — confirmed by
grepping the whole directory for the original survey's own regex.
`scheduler.ts`'s `SYNC_HOUR = 5` is referenced repeatedly by name in this
slice's constants' own reasoning but is itself a non-exported (`const`, not
`export const`) module-private value, so it is correctly out of scope —
same exclusion category as `intervals-backfill.ts`'s own
`DEFAULT_CHUNK_DELAY_MS` (also non-exported).

## Findings — before writing this doc

Every constant here already has a paper trail in an existing design doc; no
fresh research was needed.

- **`activity-poll.ts`** (4): `POLL_INTERVAL_MIN` (15),
  `POLL_LOOKBACK_HOURS` (24), `POLL_QUIET_START_HOUR`/`POLL_QUIET_END_HOUR`
  (23/6). The file's own header comment explains the quiet window ("the
  05:00 full sync covers the night"); `docs/specs/2026-08-02-wellness-sync-interval-design.md`
  independently corroborates the 15-minute cadence and 23:00–06:00 window
  as an established, deliberately-untouched precedent ("Activity poll:
  Untouched. Its 15-minute cadence and 23:00–06:00 quiet window stay as
  they are"). None of the four numbers trace to external research — all
  are engineering judgement balancing near-real-time ride detection
  against being a considerate client of a free, single-developer service.
  All labelled **Invented**, Confidence: Low.
- **`wellness-refresh.ts`** (5): `DEFAULT_WELLNESS_POLL_INTERVAL_MIN` (30),
  `WELLNESS_POLL_INTERVAL_CHOICES` (`[0, 15, 30, 60]`),
  `WELLNESS_REFRESH_START_HOUR` (5), `WELLNESS_REFRESH_END_HOUR` (23),
  `WELLNESS_REFRESH_DAYS` (3). All five are directly discussed in
  `docs/specs/2026-08-02-wellness-sync-interval-design.md` (the v0.34
  redesign) and, for the 3-day range, in the earlier
  `docs/specs/2026-08-02-intervals-wellness-expansion-design.md` (v0.33's
  original design: "Range: last 3 days — covers the bed-date attribution
  and any late Companion backfill without depending on resolving
  attribution precisely"). The default of 30 minutes is explicit product
  reasoning ("preserves roughly v0.33's cadence, so upgrading an instance
  never silently increases load on intervals.icu"), and the four allowed
  choices are a deliberately closed, tested set — but none of the five
  numbers are externally sourced; they are operational/product judgement
  calls specific to running against a free, single-developer API. All
  labelled **Invented**, Confidence: Low.
- **`strava-webhook.ts`** (1): `INTERVALS_CATCHUP_DELAY_S` (90). The file's
  own comment states the reasoning ("intervals.icu ingests from Strava on
  its own delayed cadence; give it a head start before we pull, or the
  sync will just miss the new ride"), and
  `docs/specs/2026-07-26-event-driven-sync-triggers-design.md` references
  the same "+90s" figure as established context in three places — but no
  document anywhere derives or measures why 90 specifically (vs. 60 or
  120). Labelled **Invented**, Confidence: Low.
- **`intervals-backfill.ts`** (1): `MAX_BACKFILL_YEARS` (20). Both the
  file's own comment and
  `docs/specs/2026-08-02-wellness-history-backfill-design.md` state the
  reasoning identically: a generous safety ceiling ("No athlete has 20
  years of intervals.icu history, and an endless walk against a free
  service is worse than a truncated backfill"), confirmed necessary in
  practice by a production dry run that found 3,111 rows of pre-2019
  CTL/ATL-only filler data an account can carry. Not externally sourced —
  an engineering safety bound, same category as `ADHERENCE_CEIL`
  (v0.77.0) or `RAMP_CLAMP_PCT` pre-correction. Labelled **Invented**,
  Confidence: Low.

## Global constraints (same as every prior Phase 2a slice)

- **No value changes.** Verified by diffing every `export const NAME = ...`
  value line (including the `WELLNESS_POLL_INTERVAL_CHOICES` array
  literal) before and after — must be empty.
- Every touched constant gets an explicit `Confidence: High|Medium|Low[,
qualifier].` sentence. Existing accurate prose is preserved, not
  rewritten — only the missing source/confidence statement is added where
  absent.
- Full test suite must show identical pass counts before/after.

## Out of scope

- `sync/scheduler.ts`'s `SYNC_HOUR` and `intervals-backfill.ts`'s
  `DEFAULT_CHUNK_DELAY_MS` — both non-exported, out of the audit's own
  scope definition.
- Any other Phase 2a backlog file (the long tail) — future slices.

## Remaining Phase 2a backlog after this slice

Per the running count after v0.77.0 (~31 constants/~18 files, which
included this slice's 11 constants across 4 files as part of the
"sync/polling" line item), the long tail now remaining: `biological-age.ts`,
`blood-pressure.ts`, `body-battery.ts`, `overtraining.ts`,
`insights/correlations.ts`, `training-plan.ts`, `week-plan/anchors.ts`,
`week-plan/ctl-projection.ts`, `coach-memory.ts`, `recall.ts`,
`debrief/lifecycle.ts`, `debrief/ride-review.ts`, `race/debrief.ts`,
`weekly-review.ts`, `athlete-curves.ts`, `availability/types.ts`,
`export/export-user.ts`, `components/plan/wheel-column.tsx` — ~20
constants across ~14 files.
