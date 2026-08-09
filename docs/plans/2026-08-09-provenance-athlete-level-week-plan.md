# Provenance — Athlete Level & Week-Plan Constants Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add source, confidence and scope to `src/lib/athlete-level.ts`'s
`LEVEL_CONSTANTS` and `src/lib/week-plan/types.ts`'s exported constants,
following `src/lib/plan-constants.ts`'s pattern — the first slice of Phase
2a (`docs/ROADMAP.md`). Also settles the roadmap's named "correction owed
since 2026-08-05": `HEADROOM` and `RAMP_CLAMP_PCT` must read **Low**
confidence, not the High an ACWR anchor previously (and incorrectly)
justified.

**Architecture:** Documentation-only. No exported constant's **value**
changes — per `docs/specs/2026-07-28-training-volume-evidence.md`'s own
conclusion, "the values stay; the justification changes." Each constant
gets a JSDoc comment stating what it is, its source, and an explicit
`Confidence: High|Medium|Low.` sentence, matching `plan-constants.ts`'s
style exactly (prose per constant, not a separate table). Two files, no
new evidence doc: `athlete-level.ts`'s constants already have rows in the
existing `docs/specs/2026-07-28-training-volume-evidence.md`; `week-plan/types.ts`'s
adaptive-week constants have no research to cite (confirmed by checking
`docs/plans/2026-07-17-v0.9.2-adaptive-week.md`, their origin) and are
labelled **Invented** per the roadmap's own instruction — "an acceptable
answer, and far better than silence."

**Tech Stack:** TypeScript 5. No behavior change, so no new tests — the
existing test suites for both files (`athlete-level.test.ts`,
`materialize.test.ts`, `adapt-day` tests, etc.) must pass byte-for-byte
unchanged, which itself is the verification that no value moved.

Spec: `docs/specs/2026-08-06-every-number-has-a-source-design.md` (the v0.45
design that produced `plan-constants.ts`), `docs/specs/2026-07-28-training-volume-evidence.md`
(the existing research for `athlete-level.ts`'s constants).

## Findings — before writing this plan

Surveyed all `export const [A-Z_]+` numeric/object constants across `src/`
(91 matches, 41 files) to scope Phase 2a's "77 constants, 28 files" claim.
Excluded from "engine constants" as out of category: `maxDuration` (a
Vercel route-segment config), `CHART_TOKENS` (visual/color tokens, not a
behavioral claim), `logger`, `icuEventOptionalFields` (a field-name map, not
a tuning knob), `proxy.ts`'s `config` (infra), and the two already-done
exemplars (`plan-constants.ts`, `race/demand-constants.ts`).

This slice covers two files, chosen because they're both directly named or
implicated by the roadmap's own "correction owed" bullet, and because
`athlete-level.ts`'s constants are the only remaining ones with an
_existing_, already-researched evidence doc to transcribe from — no new
research needed to start:

- **`src/lib/athlete-level.ts`**'s `LEVEL_CONSTANTS` (5 entries:
  `PEAK_WINDOW_WEEKS`, `HEADROOM`, `MAINTENANCE_FLOOR`, `HOURS_BANDS`,
  `CTL_BANDS`). Four of five already have a row in
  `docs/specs/2026-07-28-training-volume-evidence.md`'s summary table;
  `PEAK_WINDOW_WEEKS` does not and is labelled Invented here (a hysteresis
  design choice — long enough that a bad fortnight can't reclassify an
  athlete, short enough that real detraining eventually does — not a
  number any source pins).
- **`src/lib/week-plan/types.ts`**'s 11 exported numeric constants
  (`RAMP_CLAMP_PCT`, `LOW_ADHERENCE_PCT`, `LOW_ADHERENCE_BUMP`,
  `SUPPRESSED_READINESS_DAYS`, `SUPPRESSED_REDUCTION`, `MISSED_WEEK_RESTART`,
  `GENERATOR_CAP_SHORTFALL_PCT`, `DAY_REDISTRIBUTE_CAP_PCT`,
  `RED_ENDURANCE_SCALE`, `AMBER_SCALE`, `RED_RECOVERY_MINS`). Only
  `RAMP_CLAMP_PCT` has evidence-doc backing (same "empirical guard-rail, not
  an ACWR" correction as `HEADROOM`). The other 10 are v0.9.2 adaptive-week
  design thresholds with no cited research — confirmed by reading that
  feature's plan doc, which documents design _reasoning_ for some (e.g.
  `MISSED_WEEK_RESTART` exists to avoid the ramp clamp's zero-actual-load
  degenerate case) but no external evidence for any. All ten are labelled
  **Invented**, Confidence: Low.

**Remaining Phase 2a backlog after this slice** (not touched here): the
other ~61 constants across ~26 files from the survey — grouped roughly by
domain for whoever picks up the next slice: training-load tuning
(`training-load.ts`'s `CTL_DAYS`/`ATL_DAYS`/etc.), sleep/readiness windows
(`sleep-debt.ts`, `readiness.ts`, `sleep-insights.ts`, `sleep-history.ts`),
race/taper (`race/taper.ts`, `race/feasibility.ts`, `race/forecast.ts`),
sync/polling intervals (`sync/activity-poll.ts`, `sync/wellness-refresh.ts`,
`sync/strava-webhook.ts`, `sync/intervals-backfill.ts`), and a long tail of
single-file domain constants (`biological-age.ts`, `blood-pressure.ts`,
`body-battery.ts`, `overtraining.ts`, `insights/correlations.ts`,
`training-plan.ts`, `week-plan/anchors.ts`, `week-plan/ctl-projection.ts`,
`coach-memory.ts`, `recall.ts`, `debrief/lifecycle.ts`,
`debrief/ride-review.ts`, `race/debrief.ts`, `weekly-review.ts`,
`athlete-curves.ts`, `availability/types.ts`, `export/export-user.ts`,
`components/plan/wheel-column.tsx`). Same re-verification discipline as the
2b.3 series applies: check for an existing evidence doc before assuming a
constant needs fresh research, and check whether the file's git history or
an adjacent plan doc documents a design rationale before labelling
something Invented with no explanation at all.

## Global Constraints

- **No value changes.** Every constant keeps its exact current number. This
  is the one constraint every other decision defers to — a wrong confidence
  label is a paperwork problem; a changed load ceiling is an injury-risk
  problem.
- **No new confidence tier invented.** Use exactly `High`, `Medium`, or
  `Low`, matching `plan-constants.ts`'s vocabulary — do not invent a
  fourth tier or a numeric confidence score.
- **Transcribe, don't re-derive.** Where `docs/specs/2026-07-28-training-volume-evidence.md`
  already states a confidence and reasoning, use it verbatim in spirit — do
  not re-litigate the ACWR correction or invent new reasoning for constants
  that already have researched reasoning on record.
- **"Invented" means exactly that — say so plainly, don't dress it up** as
  a false convention or a fake citation. Per the roadmap: "an acceptable
  answer, and far better than silence."
- **Preserve every existing functional comment's content** (what the
  constant does) — this plan adds source/confidence, it does not replace
  or shorten the existing behavioral explanation.
- Run `npm run typecheck && npm test` after each file — a comment-only
  change must produce zero test diffs; if any test's expected value
  changes, something was edited that shouldn't have been.

---

### Task 1: `src/lib/athlete-level.ts`'s `LEVEL_CONSTANTS`

**Files:**

- Modify: `src/lib/athlete-level.ts`

**Interfaces:** Consumes: `docs/specs/2026-07-28-training-volume-evidence.md`'s
existing research. Produces: nothing new — comment-only change.

- [ ] **Step 1: Implement**

Replace the `LEVEL_CONSTANTS` object's contents with:

```ts
export const LEVEL_CONSTANTS = {
  /**
   * How far back the rolling peak looks, in weeks. Long enough that illness
   * or a holiday cannot reclassify an athlete; short enough that real
   * detraining eventually does. A hysteresis design choice — no external
   * source pins 12 weeks specifically over, say, 10 or 16.
   * Source: Invented. Confidence: Low.
   */
  PEAK_WINDOW_WEEKS: 12,
  /**
   * Weekly-hours ceiling as a multiple of the rolling peak: 30% above this
   * athlete's own 12-week peak. Previously justified as sitting inside the
   * acute:chronic workload ratio's 0.8-1.3 "safe zone" and rated High —
   * that anchor does not hold. Impellizzeri et al. 2020 (IJSPP), _Acute:
   * Chronic Workload Ratio: Conceptual Issues and Fundamental Pitfalls_,
   * finds no evidence supporting ACWR for load management (the ratio is
   * mathematically coupled — the acute week sits inside the chronic
   * window — which produces spurious correlation). Separately, HEADROOM
   * was never an ACWR to begin with: an ACWR is acute 7-day load over
   * chronic 28-day rolling load, while this is this week's hours over a
   * 12-week rolling PEAK — a different ratio that never inherited the ACWR
   * definition it was described against.
   * Source: Empirical guard-rail, calibrated against one athlete — a
   * useful brake, not a validated injury threshold.
   * Confidence: Low (downgraded from High — see
   * docs/specs/2026-07-28-training-volume-evidence.md §1, corrected
   * 2026-08-06).
   */
  HEADROOM: 1.3,
  /**
   * Weekly-hours floor as a fraction of the rolling peak. Detraining
   * research: a 70% volume reduction with intensity maintained preserves
   * VO2max, and 50-75% of normal volume shows no aerobic loss. 0.6 sits
   * inside that band, so the floor never prescribes less than holding
   * fitness.
   * Source: Detraining literature (see
   * docs/specs/2026-07-28-training-volume-evidence.md §2).
   * Confidence: High.
   */
  MAINTENANCE_FLOOR: 0.6,
  /**
   * Upper bound of each band, in trailing weekly hours. `max` is exclusive
   * (bandFor uses value < max), so a value exactly at a boundary — e.g.
   * 9 hours — falls into the next-higher band, not this one.
   * Source: Elite riders 14.7-19.7 h/wk; competitive amateurs ~9.8 h/wk;
   * elite junior/masters competitive at 6-12 h/wk (see
   * docs/specs/2026-07-28-training-volume-evidence.md, "Level hours
   * bands").
   * Confidence: Medium.
   */
  HOURS_BANDS: [
    { max: 3, level: "recreational" as AthleteLevel },
    { max: 5, level: "amateur" as AthleteLevel },
    { max: 9, level: "intermediate" as AthleteLevel },
    { max: Infinity, level: "advanced" as AthleteLevel },
  ],
  /**
   * Upper bound of each band, in CTL. `max` is exclusive, same as
   * HOURS_BANDS above — a value exactly at a boundary belongs to the
   * next-higher band.
   * Source: CTS coaching data — fondo riders 40-100 CTL, competitors
   * 70-120 CTL (see docs/specs/2026-07-28-training-volume-evidence.md,
   * "Level CTL bands").
   * Confidence: Medium.
   */
  CTL_BANDS: [
    { max: 35, level: "recreational" as AthleteLevel },
    { max: 55, level: "amateur" as AthleteLevel },
    { max: 80, level: "intermediate" as AthleteLevel },
    { max: Infinity, level: "advanced" as AthleteLevel },
  ],
} as const;
```

- [ ] **Step 2: Run tests to confirm zero behavior change**

Run: `npx vitest run src/lib/athlete-level.test.ts`
Expected: PASS, same test count as before this change — a comment-only
edit cannot change a single expectation.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`

- [ ] **Step 4: Commit**

```bash
git add src/lib/athlete-level.ts
git commit -m "docs(provenance): source and confidence for LEVEL_CONSTANTS"
```

---

### Task 2: `src/lib/week-plan/types.ts`'s exported constants

**Files:**

- Modify: `src/lib/week-plan/types.ts`

**Interfaces:** Consumes: `docs/specs/2026-07-28-training-volume-evidence.md`
(for `RAMP_CLAMP_PCT` only); `docs/plans/2026-07-17-v0.9.2-adaptive-week.md`
(design rationale for the rest, where documented). Produces: nothing new —
comment-only change.

- [ ] **Step 1: Implement**

Replace the block from `// ── materializeWeek constants ──` through the
`STEP_DOWN` constant (inclusive of the comment header, exclusive of
`STEP_DOWN` and anything after it — leave `STEP_DOWN` and later code
untouched) with:

```ts
// ── materializeWeek constants ───────────────────────────────────────────
/**
 * Week-over-week load may move at most this fraction vs previous actual.
 * Previously justified as the acute:chronic workload ratio's week-over-week
 * brake and rated High — that anchor does not hold (see HEADROOM's comment
 * in athlete-level.ts for the full correction; the same ACWR critique
 * applies here, and this was never an ACWR calculation either).
 * Source: Empirical brake on week-over-week change, calibrated against one
 * athlete — not a validated injury threshold.
 * Confidence: Low (downgraded from High — see
 * docs/specs/2026-07-28-training-volume-evidence.md §1, corrected
 * 2026-08-06).
 */
export const RAMP_CLAMP_PCT = 0.2;
/**
 * Below this adherence, next week builds on actual load, not the skeleton.
 * Source: Invented — a design threshold for "meaningfully off-plan," not
 * evidence-based.
 * Confidence: Low.
 */
export const LOW_ADHERENCE_PCT = 70;
/**
 * Multiplier on previous actual load when adherence was low.
 * Source: Invented.
 * Confidence: Low.
 */
export const LOW_ADHERENCE_BUMP = 1.1;
/**
 * ≥ this many amber-or-worse days in the last 7 = suppressed trend.
 * Source: Invented — a majority-of-week heuristic (4 of 7 days), not
 * evidence-based.
 * Confidence: Low.
 */
export const SUPPRESSED_READINESS_DAYS = 4;
/**
 * Target reduction when the readiness trend is suppressed.
 * Source: Invented.
 * Confidence: Low.
 */
export const SUPPRESSED_REDUCTION = 0.85;
/**
 * A fully missed week (actual 0) restarts at this fraction of skeleton.
 * Exists to avoid a degenerate case: the ±20% ramp clamp (RAMP_CLAMP_PCT)
 * divides by the previous week's actual load, which is undefined at zero
 * (see docs/plans/2026-07-17-v0.9.2-adaptive-week.md's spec-deviation
 * note). 0.6 matches MAINTENANCE_FLOOR's value (athlete-level.ts) for
 * consistency, not because the same research backs both.
 * Source: Invented (design workaround for a zero-load edge case).
 * Confidence: Low.
 */
export const MISSED_WEEK_RESTART = 0.6;
/**
 * How far generateWorkouts' own duration caps (long session 240min/180min
 * for runs, filler sessions 90min/60min for runs — see training-plan.ts) may
 * fall short of the week's target before materializeWeek must say so. Raising
 * those caps to close the gap is explicitly out of scope: it would change
 * every existing user's prescribed workouts as a side effect of a legibility
 * branch, and the generator rewrite is separately scoped Phase 2 work. This
 * threshold exists so the deficit is at least explained, not silent.
 * Source: Invented — a reporting threshold, not a claim about the athlete.
 * Confidence: Low.
 */
export const GENERATOR_CAP_SHORTFALL_PCT = 0.1;

// ── adaptDay constants ──────────────────────────────────────────────────
/**
 * Redistribution may add at most this fraction to a day's load.
 * Source: Invented.
 * Confidence: Low.
 */
export const DAY_REDISTRIBUTE_CAP_PCT = 0.25;
/**
 * Red readiness: endurance duration multiplier.
 * Source: Invented.
 * Confidence: Low.
 */
export const RED_ENDURANCE_SCALE = 0.7;
/**
 * Amber readiness: duration multiplier (with one intensity step down).
 * Source: Invented.
 * Confidence: Low.
 */
export const AMBER_SCALE = 0.85;
/**
 * Red readiness replacement session duration (mins); less room = rest.
 * Source: Invented — a round, convenient number, not evidence-based.
 * Confidence: Low.
 */
export const RED_RECOVERY_MINS = 30;
/** One intensity step down. Endurance stays endurance (duration handles it). */
export const STEP_DOWN: Record<string, string> = {
  Intervals: "Tempo",
  Tempo: "Endurance",
  Brick: "Endurance",
};
```

- [ ] **Step 2: Run tests to confirm zero behavior change**

Run:
`npx vitest run src/lib/week-plan/materialize.test.ts src/lib/week-plan/fill.test.ts`
(and any other test file that imports from `./types` — grep
`from "@/lib/week-plan/types"` or `from "./types"` first to find the full
set).
Expected: PASS, same test counts as before.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`

- [ ] **Step 4: Commit**

```bash
git add src/lib/week-plan/types.ts
git commit -m "docs(provenance): source and confidence for week-plan/types.ts constants, settle the ACWR correction for RAMP_CLAMP_PCT"
```

---

### Task 3: Release housekeeping

**Files:**

- Modify: `package.json`
- Modify: `CHANGELOG.md`
- Modify: `docs/ROADMAP.md`

- [ ] **Step 1: Bump the version**

In `package.json`, change `"version": "0.73.0"` to `"version": "0.74.0"`.

- [ ] **Step 2: Add the CHANGELOG entry**

Insert at the top of `CHANGELOG.md`, above the existing `## v0.73.0` entry:

```markdown
## v0.74.0 — 2026-08-09 — Provenance: athlete level & week-plan constants

First slice of Phase 2a (`docs/ROADMAP.md`): source, confidence, and scope
for `athlete-level.ts`'s `LEVEL_CONSTANTS` and `week-plan/types.ts`'s 11
exported constants. No values changed — documentation only.

- Settles the correction owed since 2026-08-05: `HEADROOM` and
  `RAMP_CLAMP_PCT` now read Confidence: Low in the code itself, not just in
  prose docs — the ACWR anchor that previously justified High confidence
  doesn't hold (not supported by the literature, and never actually an ACWR
  calculation to begin with).
- `MAINTENANCE_FLOOR`, `HOURS_BANDS`, and `CTL_BANDS` transcribed from
  already-existing research in
  `docs/specs/2026-07-28-training-volume-evidence.md` — Confidence:
  High/Medium/Medium respectively.
- The other 10 week-plan constants (adaptive-week tuning thresholds) have
  no research backing and are labelled **Invented**, Confidence: Low, per
  the roadmap's own instruction that this is "an acceptable answer, and far
  better than silence."

Remaining Phase 2a backlog: ~61 constants across ~26 other files — see
`docs/plans/2026-08-09-provenance-athlete-level-week-plan.md`'s Findings for
the grouped list.
```

- [ ] **Step 3: Update the roadmap**

In `docs/ROADMAP.md`, find the 2a section and read its current exact text
first. Add a status note under it (matching 2b.3's style of an inline
per-version note) recording that v0.74.0 shipped the first slice, settled
the named ACWR correction in-code, and that the remaining ~61 constants
across ~26 files are tracked in this plan's Findings. Do not check 2a's
box — this is one slice of many.

- [ ] **Step 4: Run the full local gate**

```bash
npm run typecheck && npm run lint && npm run format:check && npm test && npm run build
```

If `format:check` fails, run
`npx prettier --write package.json CHANGELOG.md docs/ROADMAP.md` and
re-verify.

- [ ] **Step 5: Commit**

```bash
git add package.json CHANGELOG.md docs/ROADMAP.md
git commit -m "chore(release): v0.74.0 — provenance, athlete level & week-plan constants"
```

Do **not** merge, tag, or push — leave that decision to whoever requested
this plan, per `docs/RELEASING.md`.
