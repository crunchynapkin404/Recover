# Provenance — Sleep & Readiness Window Constants Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add source, confidence and scope to the 11 exported constants
across `src/lib/readiness.ts`, `src/lib/sleep-debt.ts`,
`src/lib/sleep-insights.ts`, and `src/lib/sleep-history.ts` — the third
slice of Phase 2a (`docs/ROADMAP.md`).

**Architecture:** Documentation-only, same discipline as slices 1 and 2: no
exported constant's **value** changes. Each constant gets a JSDoc comment
stating what it is, its source, and an explicit
`Confidence: High|Medium|Low.` sentence.

**Tech Stack:** TypeScript 5. No behavior change — existing tests for all
four files must pass byte-for-byte unchanged.

Spec: `docs/specs/2026-07-15-v0.7-score-integrity-design.md` (readiness
baseline windows), `docs/specs/2026-07-16-v0.9.0-honest-body-intelligence-design.md`
Part 2 (sleep debt's origin), `docs/specs/2026-08-08-v0.62-sleep-debt-confidence-design.md`
(sleep debt confidence tiers — already shipped, not touched here),
`docs/specs/2026-07-18-v0.12-sleep-intelligence-design.md` (sleep
consistency/chronotype).

## Findings — before writing this plan

11 constants across 4 files, all read individually against their origin
design specs. **Ten of eleven land at Low confidence** — this domain has
almost no cited external research behind its specific numbers, the same
honest outcome `docs/specs/2026-08-06-periodize-evidence.md` predicted for
`plan-constants.ts` ("the honest expectation is that most of these land at
Low").

- **`readiness.ts`'s `MIN_BASELINE_DAYS = 14` and
  `BASELINE_WINDOW_DAYS = 60`** — both design trade-offs, not cited
  research. `docs/specs/2026-07-15-v0.7-score-integrity-design.md` documents
  the trade-off precisely without naming an external source: a 60-day
  window means "five days of flu put five crushed HRV values into the
  trailing baseline for the next two months" (long enough to smooth noise,
  long enough that contamination lingers); over-flagging bad days drops the
  surviving baseline below the 14-day floor, correctly degrading to
  `calibrating` rather than a confident wrong number. Real, documented
  design reasoning — no external citation. **Confidence: Low** for both,
  same category as `athlete-level.ts`'s `PEAK_WINDOW_WEEKS` in slice 1.
- **`sleep-debt.ts`'s `DEFAULT_SLEEP_NEED_SECS = 28800` (8h)** — the one
  constant in this slice with real external backing: 8 hours sits inside
  the commonly-cited 7-9h/night recommended range for adults. But the
  origin spec (`docs/specs/2026-07-16-v0.9.0-honest-body-intelligence-design.md`
  Part 2) is explicit that this is deliberately "a target the athlete can
  change, not a claim about them" — an editable default, not a
  personalized measurement. **Confidence: Medium** — real guidance exists
  for the range, but the exact default point-value within it, and its
  status as an overridable default rather than a claim, keep it short of
  High.
- **`sleep-debt.ts`'s `DEBT_WINDOW_DAYS`, `MIN_DEBT_DAYS`,
  `MAX_NIGHTLY_PAYBACK_SECS`, `MIN_BEDTIME_SAMPLES`** — all Invented, but
  three have real documented design rationale worth preserving (not
  research, but not arbitrary either): `MAX_NIGHTLY_PAYBACK_SECS` exists
  because "six hours of debt cannot be repaid tonight, and recommending a
  01:00 bedtime shift would be advice no one follows" (actionability, not
  physiology). **Confidence: Low** for all four.
- **`sleep-insights.ts`'s `MIN_CONSISTENCY_NIGHTS`, `MAX_SD_MINUTES`,
  `MIN_CHRONOTYPE_SIDE`** and **`sleep-history.ts`'s
  `SLEEP_HISTORY_NIGHTS`** — data-sufficiency gates and one UI display
  amount, no external research found in
  `docs/specs/2026-07-18-v0.12-sleep-intelligence-design.md` or elsewhere.
  **Confidence: Low** for all four.
- **Not touched:** the sleep-debt confidence tiers themselves (`none` /
  `low` 7-9 nights / `medium` 10-12 / `high` 13-14, from
  `docs/specs/2026-08-08-v0.62-sleep-debt-confidence-design.md`) are not
  separate exported constants — they're inline thresholds inside
  `computeSleepDebt`'s confidence logic, out of this slice's scope (which
  covers only top-level `export const` declarations, matching every prior
  slice's boundary).

## Global Constraints

- **No value changes.** Every constant keeps its exact current number.
- **No new confidence tier invented** — `High`, `Medium`, or `Low` only.
- **Do not invent a citation for `DEFAULT_SLEEP_NEED_SECS`.** State the
  7-9h range as commonly-cited public guidance, not a specific named study,
  and preserve the origin spec's own framing that it's an editable default,
  not a personalized claim.
- **Preserve every existing functional comment's content.**
- Run `npm run typecheck && npm test` after each file — comment-only, zero
  test diffs expected.

---

### Task 1: `src/lib/readiness.ts`'s window constants

**Files:**

- Modify: `src/lib/readiness.ts`

- [ ] **Step 1: Implement**

Replace:

```ts
export const MIN_BASELINE_DAYS = 14;
export const BASELINE_WINDOW_DAYS = 60;
```

with:

```ts
/**
 * Fewer than this many days of HRV *and* of RHR baseline history →
 * "calibrating" (see the file's top-of-file comment). A design trade-off
 * between requiring enough data to trust a baseline and not gatekeeping a
 * new athlete too long — see
 * docs/specs/2026-07-15-v0.7-score-integrity-design.md, where flagging
 * enough bad days to drop the surviving baseline below this floor is the
 * intended, honest degrade path (a confident wrong number is worse than
 * "calibrating").
 * Source: Invented — a design trade-off, not cited research.
 * Confidence: Low.
 */
export const MIN_BASELINE_DAYS = 14;
/**
 * How far back each athlete's own HRV/RHR baseline mean and SD are
 * computed from. A design trade-off between baseline stability and
 * adaptability: docs/specs/2026-07-15-v0.7-score-integrity-design.md notes
 * the cost directly — "five days of flu put five crushed HRV values into
 * the trailing baseline for the next two months" — long enough to smooth
 * day-to-day noise, long enough that contamination from illness or travel
 * lingers, which is what that release's day-flagging feature exists to fix.
 * Source: Invented — a design trade-off, not cited research.
 * Confidence: Low.
 */
export const BASELINE_WINDOW_DAYS = 60;
```

- [ ] **Step 2: Run tests to confirm zero behavior change**

Run:
`grep -rl 'from "@/lib/readiness"\|from "\./readiness"' src tests | xargs npx vitest run`

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`

- [ ] **Step 4: Commit**

```bash
git add src/lib/readiness.ts
git commit -m "docs(provenance): source and confidence for readiness.ts baseline window constants"
```

---

### Task 2: `src/lib/sleep-debt.ts`'s constants

**Files:**

- Modify: `src/lib/sleep-debt.ts`

- [ ] **Step 1: Implement**

Replace:

```ts
export const DEBT_WINDOW_DAYS = 14;
/** Below this many recorded nights, report nothing rather than a thin number. */
export const MIN_DEBT_DAYS = 7;
/** One night cannot repay a week. Cap the recommendation at something doable. */
export const MAX_NIGHTLY_PAYBACK_SECS = 3600;
/** A target the athlete can change — not a claim about them. */
export const DEFAULT_SLEEP_NEED_SECS = 28800; // 8h
```

with:

```ts
/**
 * How many trailing nights the debt accounting window covers.
 * Source: Invented — a design choice, not cited research.
 * Confidence: Low.
 */
export const DEBT_WINDOW_DAYS = 14;
/**
 * Below this many recorded nights, report nothing rather than a thin number.
 * Source: Invented — a data-sufficiency gate.
 * Confidence: Low.
 */
export const MIN_DEBT_DAYS = 7;
/**
 * One night cannot repay a week. Cap the recommendation at something
 * doable: six hours of debt cannot be repaid tonight, and recommending a
 * 01:00 bedtime shift would be advice no one follows (see
 * docs/specs/2026-07-16-v0.9.0-honest-body-intelligence-design.md Part 2).
 * Source: Invented — an actionability design choice, not a physiological
 * claim.
 * Confidence: Low.
 */
export const MAX_NIGHTLY_PAYBACK_SECS = 3600;
/**
 * A target the athlete can change — not a claim about them (see
 * docs/specs/2026-07-16-v0.9.0-honest-body-intelligence-design.md Part 2:
 * "sleepNeedSecs defaults to 8h legitimately... not a claim about them").
 * 8h sits inside the commonly-cited 7-9h/night range recommended for
 * adults.
 * Source: Sleep-health guidance (7-9h/night adult range), as an editable
 * default rather than a personalized measurement.
 * Confidence: Medium.
 */
export const DEFAULT_SLEEP_NEED_SECS = 28800; // 8h
```

Then replace:

```ts
/** Below this many real bedtimes, fall back to the wake-time anchor. */
export const MIN_BEDTIME_SAMPLES = 5;
```

with:

```ts
/**
 * Below this many real bedtimes, fall back to the wake-time anchor.
 * Source: Invented — a data-sufficiency gate.
 * Confidence: Low.
 */
export const MIN_BEDTIME_SAMPLES = 5;
```

- [ ] **Step 2: Run tests to confirm zero behavior change**

Run:
`grep -rl 'from "@/lib/sleep-debt"\|from "\./sleep-debt"' src tests | xargs npx vitest run`

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`

- [ ] **Step 4: Commit**

```bash
git add src/lib/sleep-debt.ts
git commit -m "docs(provenance): source and confidence for sleep-debt.ts constants"
```

---

### Task 3: `src/lib/sleep-insights.ts` and `src/lib/sleep-history.ts`

**Files:**

- Modify: `src/lib/sleep-insights.ts`
- Modify: `src/lib/sleep-history.ts`

- [ ] **Step 1: Implement — `sleep-insights.ts`**

Replace:

```ts
export const MIN_CONSISTENCY_NIGHTS = 5;
/** Midpoint scatter at or beyond this (minutes SD) scores 0 consistency. */
export const MAX_SD_MINUTES = 120;
/** Chronotype needs at least this many nights on each of weekday/free-day. */
export const MIN_CHRONOTYPE_SIDE = 2;
```

with:

```ts
/**
 * Consistency score needs at least this many real bed/wake nights, else
 * returns null.
 * Source: Invented — a data-sufficiency gate.
 * Confidence: Low.
 */
export const MIN_CONSISTENCY_NIGHTS = 5;
/**
 * Midpoint scatter at or beyond this (minutes SD) scores 0 consistency.
 * Source: Invented — a design choice for the scoring floor, not cited
 * research.
 * Confidence: Low.
 */
export const MAX_SD_MINUTES = 120;
/**
 * Chronotype needs at least this many nights on each of weekday/free-day.
 * Source: Invented — a data-sufficiency gate.
 * Confidence: Low.
 */
export const MIN_CHRONOTYPE_SIDE = 2;
```

- [ ] **Step 2: Implement — `sleep-history.ts`**

Replace:

```ts
/** How many nights the history strip offers. */
export const SLEEP_HISTORY_NIGHTS = 14;
```

with:

```ts
/**
 * How many nights the history strip offers.
 * Source: Invented — a UI display-amount choice, not cited research.
 * Confidence: Low.
 */
export const SLEEP_HISTORY_NIGHTS = 14;
```

- [ ] **Step 3: Run tests to confirm zero behavior change**

Run:

```bash
grep -rl 'from "@/lib/sleep-insights"\|from "\./sleep-insights"\|from "@/lib/sleep-history"\|from "\./sleep-history"' src tests | xargs npx vitest run
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`

- [ ] **Step 5: Commit**

```bash
git add src/lib/sleep-insights.ts src/lib/sleep-history.ts
git commit -m "docs(provenance): source and confidence for sleep-insights.ts and sleep-history.ts constants"
```

---

### Task 4: Release housekeeping

**Files:**

- Modify: `package.json`
- Modify: `CHANGELOG.md`
- Modify: `docs/ROADMAP.md`

- [ ] **Step 1: Bump the version**

In `package.json`, change `"version": "0.75.0"` to `"version": "0.76.0"`.

- [ ] **Step 2: Add the CHANGELOG entry**

Insert at the top of `CHANGELOG.md`, above the existing `## v0.75.0` entry:

```markdown
## v0.76.0 — 2026-08-09 — Provenance: sleep & readiness window constants

Third slice of Phase 2a (`docs/ROADMAP.md`): source, confidence, and scope
for 11 exported constants across `readiness.ts`, `sleep-debt.ts`,
`sleep-insights.ts`, and `sleep-history.ts`. No values changed —
documentation only.

- 10 of 11 constants are design trade-offs or data-sufficiency gates with
  no cited external research — labelled **Invented**, Confidence: Low,
  including `readiness.ts`'s `MIN_BASELINE_DAYS`/`BASELINE_WINDOW_DAYS`
  (both have real documented design reasoning in
  `docs/specs/2026-07-15-v0.7-score-integrity-design.md`, just not an
  external citation).
- `DEFAULT_SLEEP_NEED_SECS` (8h) is the exception: 8 hours sits inside the
  commonly-cited 7-9h/night range recommended for adults, though the
  origin spec is explicit it's an editable default, not a personalized
  claim. Confidence: Medium.

Remaining Phase 2a backlog: ~42 constants across ~21 other files.
```

- [ ] **Step 3: Update the roadmap**

In `docs/ROADMAP.md`, find the 2a section and read its current exact text
first. Extend the note recording that v0.76.0 shipped this third slice. Do
not check 2a's box.

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
git commit -m "chore(release): v0.76.0 — provenance, sleep & readiness window constants"
```

Do **not** merge, tag, or push — leave that decision to whoever requested
this plan, per `docs/RELEASING.md`.
