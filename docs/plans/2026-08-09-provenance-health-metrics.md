# Provenance: health-metrics domain constants (v0.79.0)

**Date:** 2026-08-09
**Phase:** 2a — Provenance (`docs/ROADMAP.md`)
**Slice:** sixth. First slice into the "long tail" — the original survey's
named domain groups (athlete-level/week-plan, training-load,
sleep/readiness, race/taper, sync/polling) are now all done as of v0.78.0.
This slice groups four thematically-related long-tail files rather than
picking one file at a time.

## Scope

`src/lib/biological-age.ts`, `src/lib/blood-pressure.ts`,
`src/lib/body-battery.ts`, `src/lib/overtraining.ts` — grouped here because
all four are v0.9–v0.13 "honest health metrics" features (deliberately
transparent composites/detectors over wellness data, each with its own
"insufficient data" contract) rather than training-load/plan engines. 8
exported constants total.

`blood-pressure.ts`'s `BP_LABELS` (`Record<BpCategory, string>`) is
excluded — display copy (category names shown in the UI), not a numeric
behavioral claim. Same exclusion category as `race/demand.ts`'s
`DEMAND_UNAVAILABLE_COPY` (v0.77.0 Findings) and `CHART_TOKENS` (original
survey). The BP category thresholds themselves (180/140/130/120 systolic;
120/90/80 diastolic) are inline literals in `systolicCategory`/
`diastolicCategory`, not exported constants, so they are out of the
audit's own scope by definition — though the file's header comment already
states they follow "the 2017 ACC/AHA guideline", which is a real, findable
external source. `overtraining.ts`'s `HRV_SUPPRESSION_DAYS`,
`RHR_SPIKE_BPM`, `RHR_WINDOW` are likewise non-exported module-private
`const`s, correctly out of scope.

## Findings — before writing this doc

- **`biological-age.ts`** (2): `MIN_BIOAGE_COMPONENTS` (3),
  `MAX_OFFSET_YEARS` (12). `docs/specs/2026-07-18-v0.13-deep-biology-design.md`
  describes the mechanism (each of 5 possible signals — RHR, HRV, sleep
  consistency, VO2max, body-fat% — maps to a small +/− year offset from a
  neutral baseline, summed and clamped) but does not derive why 3-of-5 or
  why a ±12-year clamp specifically. Both **Invented**, Confidence: Low.
- **`blood-pressure.ts`** (1, excluding `BP_LABELS`): `MIN_BP_READINGS`
  (3). The same v0.13 design doc says `bpTrend` is "gated on a minimum
  count" but does not derive why 3. **Invented**, Confidence: Low.
- **`body-battery.ts`** (4): `AWAKE_DRAIN_TOTAL` (25), `DRAIN_PER_LOAD`
  (0.35), `DEFAULT_WAKE_MINUTES` (420), `DEFAULT_BED_MINUTES` (1380). The
  file's own header comment already states plainly: "The constants below
  are calibration choices, not measurements." Its cited design doc,
  `docs/specs/2026-07-16-v0.9.0-honest-body-intelligence-design.md`, goes
  further and calls the first two **"first-pass calibrations"** headed for
  revisiting once compared against real activity/readiness data (a v0.9.2
  correlation-engine question, per that doc's own hand-off section) — as
  direct an admission of Low confidence as this codebase makes anywhere.
  The two clock defaults (07:00 wake / 23:00 bed) are common-sense
  fallbacks for athletes who haven't set their own, not measured data. All
  four **Invented**, Confidence: Low.
- **`overtraining.ts`** (1): `MIN_HISTORY_DAYS` (21). Directly justified
  by `docs/specs/2026-07-15-v0.4b-proactive-engine-design.md`: the
  detector's two internal windows (≥7 consecutive days for HRV
  suppression, a 3-day mean for RHR spike) "both need ≥ 21 days of history
  and a non-calibrating baseline" — 21 is the umbrella minimum covering
  both windows plus a stable baseline, not an external citation.
  **Invented**, Confidence: Low.

## Global constraints (same as every prior Phase 2a slice)

- **No value changes.** Verified by diffing every `export const NAME = ...`
  value line before and after — must be empty.
- Every touched constant gets an explicit `Confidence: High|Medium|Low[,
qualifier].` sentence. Existing accurate prose is preserved, not
  rewritten — only the missing source/confidence statement is added where
  absent.
- Full test suite must show identical pass counts before/after.

## Out of scope

- `blood-pressure.ts`'s `BP_LABELS` (display copy) and its inline
  ACC/AHA-guideline category thresholds (not exported constants).
- `overtraining.ts`'s `HRV_SUPPRESSION_DAYS`/`RHR_SPIKE_BPM`/`RHR_WINDOW`
  (not exported).
- Any other long-tail file — future slices.

## Remaining Phase 2a backlog after this slice

`insights/correlations.ts`, `training-plan.ts`, `week-plan/anchors.ts`,
`week-plan/ctl-projection.ts`, `coach-memory.ts`, `recall.ts`,
`debrief/lifecycle.ts`, `debrief/ride-review.ts`, `race/debrief.ts`,
`weekly-review.ts`, `athlete-curves.ts`, `availability/types.ts`,
`export/export-user.ts`, `components/plan/wheel-column.tsx` — ~12
constants across ~10 files (exact count to be confirmed by whoever scopes
the next slice; not re-surveyed here).
