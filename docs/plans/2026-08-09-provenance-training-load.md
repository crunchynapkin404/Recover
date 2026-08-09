# Provenance — Training-Load Constants Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add source, confidence and scope to `src/lib/training-load.ts`'s 8
exported constants, following `src/lib/plan-constants.ts`'s pattern — the
second slice of Phase 2a (`docs/ROADMAP.md`). Smaller than slice 1
(`docs/plans/2026-08-09-provenance-athlete-level-week-plan.md`) by design:
this file's constants needed real research to source honestly (the CTL/ATL
EMA time constants are the load-bearing definitional choice of the entire
training-load engine), and that research is worth doing carefully rather
than batching more files into one slice.

**Architecture:** Documentation-only, same discipline as slice 1: no
exported constant's **value** changes. Each constant gets a JSDoc comment
stating what it is, its source, and an explicit
`Confidence: High|Medium|Low.` sentence.

**Tech Stack:** TypeScript 5. No behavior change, so no new tests — the
existing `training-load.test.ts` (and any other test importing these
constants) must pass byte-for-byte unchanged.

Spec: `docs/specs/2026-07-18-v0.10-honest-load-design.md` (the original
design that introduced these constants — it documents the _reasoning_
behind several, though without external citations for most).

## Findings — before writing this plan

`src/lib/training-load.ts` exports 8 constants. None have an existing
evidence doc (unlike slice 1's `athlete-level.ts`, which reused
`docs/specs/2026-07-28-training-volume-evidence.md` wholesale) — each was
assessed individually against `docs/specs/2026-07-18-v0.10-honest-load-design.md`
(the file's origin spec) and, where that fell short, a broader repo search
for any citation.

- **`CTL_DAYS = 42`, `ATL_DAYS = 7`** — the exponentially-weighted
  moving-average time constants defining "CTL" and "ATL" at all. These are
  the industry-standard values every mainstream training-load tool
  (TrainingPeaks, WKO, intervals.icu) uses, tracing to Dr. Andy Coggan's
  adaptation of Banister's original impulse-response ("TRIMP") model —
  `docs/specs/2026-08-06-periodize-evidence.md` (a different, already-shipped
  evidence doc) independently states the same thing in passing while
  justifying an unrelated constant ("CTL is an exponentially weighted moving
  average of daily TSS with a 42-day [constant]... the Banister model").
  Widely-adopted convention, not a head-to-head-validated optimum over other
  time constants (nobody has published "42/7 beats 40/9"). **Confidence:
  Medium** — same reasoning `plan-constants.ts` already applies to
  `CTL_TO_WEEKLY_LOAD` ("sound arithmetic on the Banister/TRIMP model, not
  an empirical claim").
- **`LTHR_HRR_FRACTION = 0.85`** — the origin spec states "LTHR ≈ 85% of
  HRR" as a design assumption, with no external citation given there or
  anywhere else in the repo (searched). A real, recognized physiological
  relationship (lactate threshold heart rate as a fraction of heart-rate
  reserve), but a coaching convention, not a cited study. **Confidence:
  Low** — do not invent a citation this repo's own design doc didn't give.
- **`MIN_LOAD_DAYS = 7`, `MAX_HR_IF = 1.15`, `DURATION_TSS_PER_HOUR = 40`,
  `DEDUP_START_WINDOW_MS`, `DEDUP_DURATION_TOLERANCE`** — five engineering
  thresholds (a calibration-gate day count, a bad-data sanity cap, a
  deliberately-conservative default intensity, and two cross-provider
  deduplication tolerances). None are physiological claims; all are
  **Invented** per the roadmap's own instruction, Confidence: Low. Each
  already has a one-line functional comment in the file (kept verbatim,
  provenance appended).

## Global Constraints

- **No value changes.** Every constant keeps its exact current number.
- **No new confidence tier invented** — `High`, `Medium`, or `Low` only.
- **Do not invent a citation.** `LTHR_HRR_FRACTION` in particular: the
  origin spec asserts "LTHR ≈ 85% of HRR" without naming a source. Say
  exactly that — a stated physiological convention, no cited study — rather
  than attaching a paper name that was never actually checked.
- **Preserve every existing functional comment's content.**
- Run `npm run typecheck && npm test` after the edit — comment-only, zero
  test diffs expected.

---

### Task 1: `src/lib/training-load.ts`'s exported constants

**Files:**

- Modify: `src/lib/training-load.ts`

**Interfaces:** Consumes: `docs/specs/2026-07-18-v0.10-honest-load-design.md`
(design rationale), `docs/specs/2026-08-06-periodize-evidence.md` (the
CTL/Banister-model framing, already on record for a different constant).
Produces: nothing new — comment-only change.

- [ ] **Step 1: Implement**

Replace the block from `export const CTL_DAYS = 42;` through
`export const DEDUP_DURATION_TOLERANCE = 0.1;` (the file's opening constant
block, immediately after the top-of-file doc comment) with:

```ts
/**
 * The exponentially-weighted moving-average time constants that define
 * "CTL" and "ATL" as those terms are used throughout this codebase and the
 * training-load field generally (TrainingPeaks, WKO, intervals.icu all use
 * these same defaults). Trace to Dr. Andy Coggan's adaptation of Banister's
 * original impulse-response ("TRIMP") model. Changing either value would
 * mean computing a different metric, not a differently-tuned CTL/ATL.
 * Source: Coggan/Banister exponentially-weighted training-load model,
 * industry-standard time constants.
 * Confidence: Medium (widely-adopted convention; no head-to-head study
 * validates 42/7 as optimal over other time constants).
 */
export const CTL_DAYS = 42;
export const ATL_DAYS = 7;
/**
 * Fewer distinct activity days than this in the trailing CTL window →
 * calibrating.
 * Source: Invented — a design threshold for "enough recent data to trust
 * the number," not evidence-based.
 * Confidence: Low.
 */
export const MIN_LOAD_DAYS = 7;
/**
 * LTHR assumed at this fraction of heart-rate reserve for the HR rung.
 * The origin design spec (docs/specs/2026-07-18-v0.10-honest-load-design.md)
 * states "LTHR ≈ 85% of HRR" as a design assumption, without citing an
 * external source — a recognized coaching convention, not a validated
 * study.
 * Source: Coaching convention (uncited).
 * Confidence: Low.
 */
export const LTHR_HRR_FRACTION = 0.85;
/**
 * Intensity-factor cap — bad HR data must not mint a 200-TSS easy jog.
 * Source: Invented — a data-quality sanity cap, not a physiological claim.
 * Confidence: Low.
 */
export const MAX_HR_IF = 1.15;
/**
 * TSS per hour for the duration rung: an unlabeled hour counts as easy
 * zone-2. A deliberately conservative default (implies IF ≈ 0.63) — the
 * fallback rungs in this file err low on purpose (see the file's top-of
 * -file comment); fabricating intensity upward is the defect class this
 * engine exists to remove.
 * Source: Invented — deliberately conservative default, not evidence-based.
 * Confidence: Low.
 */
export const DURATION_TSS_PER_HOUR = 40;
/**
 * Different-provider activities starting within this window may be the
 * same workout.
 * Source: Invented — a cross-provider deduplication heuristic.
 * Confidence: Low.
 */
export const DEDUP_START_WINDOW_MS = 30 * 60 * 1000;
/**
 * ...when their durations also agree within this fraction.
 * Source: Invented — a cross-provider deduplication heuristic.
 * Confidence: Low.
 */
export const DEDUP_DURATION_TOLERANCE = 0.1;
```

- [ ] **Step 2: Run tests to confirm zero behavior change**

Run:

```bash
grep -rl 'from "@/lib/training-load"\|from "\./training-load"' src tests | xargs npx vitest run
```

Expected: PASS, same test counts as before this change.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`

- [ ] **Step 4: Commit**

```bash
git add src/lib/training-load.ts
git commit -m "docs(provenance): source and confidence for training-load.ts constants"
```

---

### Task 2: Release housekeeping

**Files:**

- Modify: `package.json`
- Modify: `CHANGELOG.md`
- Modify: `docs/ROADMAP.md`

- [ ] **Step 1: Bump the version**

In `package.json`, change `"version": "0.74.0"` to `"version": "0.75.0"`.

- [ ] **Step 2: Add the CHANGELOG entry**

Insert at the top of `CHANGELOG.md`, above the existing `## v0.74.0` entry:

```markdown
## v0.75.0 — 2026-08-09 — Provenance: training-load constants

Second slice of Phase 2a (`docs/ROADMAP.md`): source, confidence, and scope
for `src/lib/training-load.ts`'s 8 exported constants. No values changed —
documentation only.

- `CTL_DAYS = 42` and `ATL_DAYS = 7` — the industry-standard Coggan/Banister
  EMA time constants every mainstream training-load tool uses. Confidence:
  Medium (widely-adopted convention, not head-to-head validated as optimal).
- `LTHR_HRR_FRACTION = 0.85` — the origin design spec states this without
  citing a source; labelled a coaching convention rather than attaching an
  invented citation. Confidence: Low.
- The remaining 5 constants (`MIN_LOAD_DAYS`, `MAX_HR_IF`,
  `DURATION_TSS_PER_HOUR`, `DEDUP_START_WINDOW_MS`,
  `DEDUP_DURATION_TOLERANCE`) are engineering thresholds with no
  physiological claim — labelled **Invented**, Confidence: Low.

Remaining Phase 2a backlog: ~53 constants across ~25 other files.
```

- [ ] **Step 3: Update the roadmap**

In `docs/ROADMAP.md`, find the 2a section and read its current exact text
first. Extend the note recording that v0.75.0 shipped this second slice.
Do not check 2a's box.

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
git commit -m "chore(release): v0.75.0 — provenance, training-load constants"
```

Do **not** merge, tag, or push — leave that decision to whoever requested
this plan, per `docs/RELEASING.md`.
