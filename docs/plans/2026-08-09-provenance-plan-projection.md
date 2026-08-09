# Provenance: plan/prediction engine constants (v0.80.0)

**Date:** 2026-08-09
**Phase:** 2a — Provenance (`docs/ROADMAP.md`)
**Slice:** seventh. Second slice into the long tail. Groups four files
that are all "how much data (or session length) before this number can be
trusted" gates inside the plan/prediction engine, rather than the
single-athlete health metrics v0.79.0 covered.

## Scope

`src/lib/insights/correlations.ts` (3), `src/lib/week-plan/anchors.ts`
(`ANCHOR_CONSTANTS`, 3), `src/lib/week-plan/ctl-projection.ts` (1),
`src/lib/training-plan.ts` (5, excluding `PURPOSE_BY_TYPE`). 12 exported
constants total.

`training-plan.ts`'s `PURPOSE_BY_TYPE` (`Record<string, Purpose>`) is
excluded — a categorical workout-type → purpose-enum mapping, not a
numeric behavioral claim. Same exclusion category as `blood-pressure.ts`'s
`BP_LABELS` (v0.79.0) and `race/demand.ts`'s `DEMAND_UNAVAILABLE_COPY`
(v0.77.0 Findings).

## Findings — before writing this doc

- **`insights/correlations.ts`** (3): `MIN_EVENTS` (5), `WINDOW_DAYS`
  (90), `MIN_EVENTS_FOR_EVIDENCE` (10). `docs/specs/2026-07-17-v0.9.4-deeper-insights-design.md`
  states both `MIN_EVENTS` ("a tag needs ≥5 events to appear at all
  (unchanged)") and `WINDOW_DAYS` ("90-day window kept from v1") are
  retained from an earlier version, not freshly derived here.
  `docs/specs/2026-07-15-v0.7-score-integrity-design.md` independently
  references `MIN_EVENTS = 5` by name as the established honesty-gate
  precedent `MIN_BASELINE_DAYS` deliberately follows. `MIN_EVENTS_FOR_EVIDENCE`
  has no design-doc coverage found anywhere — a stricter data-sufficiency
  bar for a "finding" vs. merely appearing in a list. All three
  **Invented**, Confidence: Low.
- **`week-plan/anchors.ts`** (`ANCHOR_CONSTANTS`, 3): `WINDOW_DAYS` (180),
  `MIN_RUN_KM` (5), `MIN_SWIM_M` (400). The file's own header already
  states "Both are LOW confidence" as a blanket disclaimer, and
  `docs/specs/2026-08-07-race-demand-evidence.md`'s summary table
  (already published, from earlier work covering this same file) rates
  all three "Low" with specific per-field reasoning ("wider than the
  12-week volume-peak window because threshold moves slowly"; "Riegel
  needs a reference within a few multiples of the target"; "below this,
  warm-up dominates pace") — this slice transcribes that existing rating
  into the explicit `Confidence: Low.` sentence the roadmap's contract
  requires, changing no wording of the existing accurate prose.
- **`week-plan/ctl-projection.ts`** (1): `MIN_HISTORY_DAYS` (28). No
  design doc found citing this specific file or value (a repo-wide search
  for "MIN_HISTORY_DAYS" + "28" + "ctl-projection" turned up nothing). The
  file's own comment is the only reasoning available ("Below this much
  load history no verdict is honest enough to show") — a data-sufficiency
  gate in the same family as `readiness.ts`'s `MIN_BASELINE_DAYS` (14) and
  `overtraining.ts`'s same-named-but-different-value `MIN_HISTORY_DAYS`
  (21, a different file/domain — noted to avoid confusion). **Invented**,
  Confidence: Low.
- **`training-plan.ts`** (5): `MIN_LONG_BOUND_MINS` (120),
  `ABSOLUTE_LONG_BOUND_MINS` (360), `MIN_EFFECTIVE_EASY_MINS` (30),
  `EASY_RUN_CAP_MINS` (60), `NO_DEMAND_LONG_BOUND_MINS` (240). All five
  already carry extensive in-code reasoning; this slice adds only the
  missing explicit Confidence sentence to each, without altering existing
  prose. `docs/specs/2026-07-29-cycling-session-distribution-design.md`
  has a dedicated evidence table for the first two: "cycling guidance"
  (uncited by author/study) puts effective endurance rides "longer than
  two hours and shorter than six" for a moderately experienced rider —
  real coaching convention, but not a named, citable source the way
  `training-load.ts`'s Coggan/Banister constants are, so **Low** (not
  Medium) to stay consistent with how this initiative has treated other
  uncited "coaching convention" values (e.g. `training-load.ts`'s
  `LTHR_HRR_FRACTION`, `plan-constants.ts`'s `PHASE_SHARE_*`).
  `MIN_EFFECTIVE_EASY_MINS` and `EASY_RUN_CAP_MINS` are both explicitly
  described in-code as retained legacy values that "introduce no new
  claim" — plausible physiological floors, never freshly validated.
  `NO_DEMAND_LONG_BOUND_MINS` is a retained fallback cap for the
  null-demand path, deliberately chosen over an unbounded ceiling. All
  five **Invented**, Confidence: Low.

## Global constraints (same as every prior Phase 2a slice)

- **No value changes.** Verified by diffing every `export const NAME = ...`
  value line before and after — must be empty.
- Every touched constant gets an explicit `Confidence: High|Medium|Low[,
qualifier].` sentence. Existing accurate prose is preserved, not
  rewritten — only the missing source/confidence statement is added where
  absent.
- Full test suite must show identical pass counts before/after.

## Out of scope

- `training-plan.ts`'s `PURPOSE_BY_TYPE` (categorical mapping).
- Any other long-tail file — the final slice.

## Remaining Phase 2a backlog after this slice

Precisely re-surveyed (not carried forward as an approximation):
`coach-memory.ts` (`MEMORY_MAX_ENTRIES`, `MEMORY_MAX_CONTENT_CHARS` — 2),
`recall.ts` (`RECALL_DEFAULT_LIMIT`, `RECALL_MAX_LIMIT` — 2),
`debrief/lifecycle.ts` (`DEBRIEF_MIN_DURATION_S`, `DEBRIEF_FRESH_HOURS` —
2), `debrief/ride-review.ts` (`REVIEW_MAX_ATTEMPTS` — 1), `race/debrief.ts`
(`DEBRIEF_NO_DATA_HOURS` — 1), `weekly-review.ts` (`FALLBACK_REVIEW_HOUR`
— 1; `WEEKLY_THREAD_TITLE` is a thread-matching identifier string, likely
excluded — to be confirmed when scoped), `athlete-curves.ts`
(`CURVES_TTL_MS` — 1), `availability/types.ts` (`MAX_SESSIONS_PER_DAY` — 1
certain; `PURPOSE_FLOORS` maps purposes to minute floors, a numeric claim,
likely in scope — to be confirmed; `ENERGY_CEILING`/`SUBSTITUTE_TO` are
categorical mappings, likely excluded), `export/export-user.ts`
(`EXPORT_VERSION` — a schema/format version number, likely out of
category like the original survey's route-config exclusions — to be
confirmed), `components/plan/wheel-column.tsx` (`ITEM_HEIGHT` — a UI
layout pixel value, likely out of category like `CHART_TOKENS` — to be
confirmed). Roughly 10-12 constants across 10 files, closing out Phase 2a
entirely once shipped.
