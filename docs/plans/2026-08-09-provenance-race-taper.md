# Provenance: race/taper domain constants (v0.77.0)

> **Superseded for `taper.ts` only, 2026-08-19.** Six of its seven constants
> moved from Invented / Low to **Medium** once they were checked against the
> taper literature — see `docs/specs/2026-08-19-taper-evidence.md`. This
> document's finding was correct when written: no source had been connected.
> The ratings below for `forecast.ts`, `feasibility.ts` and
> `triathlon-legs.ts` stand unchanged, as does `OPENER_MAX_MINS`.

**Date:** 2026-08-09
**Phase:** 2a — Provenance (`docs/ROADMAP.md`)
**Slice:** fourth. Follows v0.74.0 (`athlete-level.ts` + `week-plan/types.ts`),
v0.75.0 (`training-load.ts`), v0.76.0 (`readiness.ts` + sleep files).

## Scope

The race/taper domain named in
`docs/plans/2026-08-09-provenance-athlete-level-week-plan.md`'s Findings:
`src/lib/race/taper.ts`, `src/lib/race/feasibility.ts`,
`src/lib/race/forecast.ts`. Plus one gap found while scanning the directory:
`src/lib/race/triathlon-legs.ts`'s `TRIATHLON_LEGS` exports
`[A-Z_]+`-named constants (so it matches the original 91-constant survey's
own regex) but was not listed in either the race/taper group or the
long-tail bucket — an oversight in the original survey, not a deliberate
exclusion. It is included here because it shares this directory and its
existing evidence doc.

`src/lib/race/debrief.ts`'s `DEBRIEF_NO_DATA_HOURS` is explicitly filed
under the long-tail bucket (not this domain) in the Findings doc and is
left for a future slice. `src/lib/race/demand.ts`'s
`DEMAND_UNAVAILABLE_COPY` is a `Record` of user-facing copy strings, not a
numeric tuning constant — same exclusion category as `CHART_TOKENS`
(design/copy, not a behavioral claim). `src/lib/race/demand-constants.ts`
is one of the two pre-existing exemplars and already done.

## Findings — before writing this doc

All four constants/groups below already have a paper trail; none required
fresh research.

- **`taper.ts`** (7 constants: `TAPER_WINDOW_LONG/MID/SHORT`,
  `TAPER_FRACTION_RACE_WEEK/WEEK_1/WEEK_2`, `OPENER_MAX_MINS`). Every value
  is restated verbatim in
  `docs/specs/2026-07-19-v0.14-race-ready-design.md`'s "Taper" section
  (21/14/10-day windows, ≈45/65/80% load fractions, ≤30 min opener cap) —
  that document is where the design was decided, but it states the numbers
  as a design choice, not a citation of taper physiology literature.
  Bosquet et al. 2007 (the taper-effects meta-analysis) is cited elsewhere
  in this repo's literature survey
  (`docs/specs/2026-08-08-goal-pillars-and-correctness-design.md`), but has
  never been connected to derive or validate these specific windows or
  fractions. Labelled **Invented**, Confidence: Low, citing the design doc
  for the decision record, not as external research.
- **`forecast.ts`** (`ADHERENCE_FLOOR = 0.5`, `ADHERENCE_CEIL = 1.5`). The
  same design doc states the floor explicitly ("recent adherence...
  floored at 0.5") but never mentions a ceiling. `ADHERENCE_CEIL` is an
  uncited, symmetric engineering bound preventing an overachieving
  athlete's trailing adherence ratio from projecting an implausibly steep
  forecast climb. Both **Invented**, Confidence: Low.
- **`feasibility.ts`** (`FEASIBILITY_CONSTANTS.LONGEST_RIDE_FRACTION = 0.8`,
  `TIGHT_MARGIN_WEEKS = 2`). `LONGEST_RIDE_FRACTION` already carries an
  extensive doc comment in-code plus a dedicated section in
  `docs/specs/2026-08-07-race-demand-evidence.md` (§6), whose own summary
  table rates it **"Low, unvalidated outside cycling"** verbatim — that
  exact phrase is what this slice adds as the explicit Confidence
  sentence the roadmap's contract requires; no other wording changes.
  `TIGHT_MARGIN_WEEKS` has no evidence-doc coverage anywhere — labelled
  Invented, Low.
- **`triathlon-legs.ts`** (`TRIATHLON_LEGS`). Already documented in-code as
  "definitional, not inference" (governing-body course lengths — Ironman /
  World Triathlon), and `race-demand-evidence.md`'s summary table rates it
  **"High — definitional"**. This slice adds the explicit Source/Confidence
  lines; the existing prose explaining why a lookup table is legitimate
  here is left untouched.

## Global constraints (same as every prior Phase 2a slice)

- **No value changes.** Verified by diffing every `export const NAME = ...`
  / object-literal value line before and after — must be empty.
- Every touched constant gets an explicit `Confidence: High|Medium|Low[,
qualifier].` sentence. Existing accurate prose is preserved, not
  rewritten — only the missing source/confidence statement is added where
  absent.
- Full test suite must show identical pass counts before/after (proves
  doc-only changes, matching CI's isolated-container run of `npm test`).

## Out of scope

- `race/debrief.ts`, `race/demand.ts`'s copy record, `race/demand-constants.ts`
  (already done) — see Scope section above.
- Any other Phase 2a backlog file (sync/polling, remaining long tail) —
  future slices.

## Remaining Phase 2a backlog after this slice

Per the original Findings survey (~61 constants/~26 files after v0.74.0,
minus v0.75.0's 8 and v0.76.0's 11, minus this slice's 4 files): sync/polling
intervals (`sync/activity-poll.ts`, `sync/wellness-refresh.ts`,
`sync/strava-webhook.ts`, `sync/intervals-backfill.ts`), and the long tail
(`biological-age.ts`, `blood-pressure.ts`, `body-battery.ts`,
`overtraining.ts`, `insights/correlations.ts`, `training-plan.ts`,
`week-plan/anchors.ts`, `week-plan/ctl-projection.ts`, `coach-memory.ts`,
`recall.ts`, `debrief/lifecycle.ts`, `debrief/ride-review.ts`,
`race/debrief.ts`, `weekly-review.ts`, `athlete-curves.ts`,
`availability/types.ts`, `export/export-user.ts`,
`components/plan/wheel-column.tsx`).
