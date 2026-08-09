# Uncertainty Vocabulary — Log / Activity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate `PmcChart`'s "Not enough data yet for this range." empty
state to the `Figure<T>` uncertainty vocabulary — the fifth slice of Phase
2b.3. Small by design: verification found only one real call site on this
surface (see Findings).

**Architecture:** No prop-type change. `PmcChart` already derives its
own "not enough points to draw a line" check from the `wellness` array it's
already given — the fix replaces the hardcoded sentence with
`unavailableMessage()` called on a locally-built `calibrating` state, mirroring
`src/lib/insights/correlations.ts`'s `correlationFigure` (a thin sample is
`calibrating`, not a bespoke sentence).

**Tech Stack:** React 19 (presentational component), TypeScript 5, Vitest
(`renderToString` from `react-dom/server`, no jsdom).

Spec: `docs/specs/2026-08-08-uncertainty-vocabulary-design.md`. Continues
`docs/plans/2026-08-08-uncertainty-vocabulary.md`'s "Log / Activity" backlog
item — corrected after verification, same as every prior slice.

## Findings — before writing this plan

The original backlog named 3 files: `pmc-chart.tsx`, `wellness-trends.tsx`,
`laps-table.tsx`.

- **`src/components/log/wellness-trends.tsx` is a confirmed dead component.**
  Its export, `WellnessTrends`, has zero import sites anywhere in `src/`
  (verified 2026-08-09) — superseded by `BaselineTrendCard`
  (`src/components/body/baseline-trend-card.tsx`), which is what
  `src/app/body/page.tsx` actually renders for HRV/sleep trend lines today.
  Same disposition as the six components already found dead in the last two
  slices: belongs to Phase 2b.2's orphan cleanup, not this plan. Untouched
  here.
- **`src/components/activity/laps-table.tsx`'s em-dash fallbacks are live,
  but not a proportionate fit for the full `Figure<T>` treatment.** Each of
  its four nullable columns (label, duration, distance, HR, power) is a
  per-lap sensor field on a _historical_ activity — there is nothing an
  athlete can do to "fix" a ride that was recorded without a power meter
  (unlike `missing_input`'s `fix` link, or a vitals reading the athlete can
  sync tomorrow), and a table can have many rows: wrapping every cell in
  `title`/`sr-only` metadata would add real DOM/markup weight across
  potentially dozens of repeated cells for a convention ("—" = not recorded
  for this row) that is already unambiguous in a dense data table, unlike a
  headline tile. This is the same category of judgment call that excluded
  `milestones-card.tsx` and `checkin-sheet.tsx` in the vitals slice — read
  and found not to be the kind of claim this vocabulary is for. Left alone.
- **`src/components/log/pmc-chart.tsx`'s "Not enough data yet for this
  range." is live and genuinely warranted.** Its one call site
  (`src/app/train/page.tsx`'s Fitness tab) only renders `<PmcChart>` when
  `wellness.some(w => w.ctl != null)` is true; inside that gate, the
  narrower `nums.length < 2` branch (fewer than 2 non-null values across
  CTL/ATL/TSB combined) is still reachable — an athlete whose very first
  logged day produced a CTL but no matching ATL yet. Genuinely "not enough
  history for a two-point line," the same shape `correlationFigure` already
  gives `Figure.calibrating` for a thin sample.
- **Aside, not fixed here:** `PmcChart`'s `showStats` prop and the `Stat`
  rendering it gates are dead code — the file's only call site passes
  `showStats={false}` (Fitness's tiles above the chart already carry
  CTL/ATL/TSB, per the component's own doc comment). This is inert, not a
  wrong message like the last slice's render guard, and disposing of unused
  props is Phase 2b.2/general-cleanup territory, not 2b.3. Left alone.

## Global Constraints

- **No new figures, no IA changes** — Phase 2's standing constraint.
- **No visual regression** beyond the wording itself: same paragraph,
  same classes, same position.
- **Do not touch `laps-table.tsx` or `wellness-trends.tsx`** — see Findings.
- Test convention: co-locate `<name>.test.ts(x)`; `renderToString`, no
  jsdom. `pmc-chart.tsx` has no existing test file — add one.

---

### Task 1: `PmcChart`'s empty state → the shared vocabulary

**Files:**

- Create: `src/components/log/pmc-chart.test.tsx`
- Modify: `src/components/log/pmc-chart.tsx`

**Interfaces:**

- Consumes: `unavailableMessage` from `@/components/ui/unavailable` (shipped
  v0.67.0).
- Produces: nothing new — only the empty-state paragraph's text source
  changes.

- [ ] **Step 1: Write the failing test**

Create `src/components/log/pmc-chart.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { PmcChart } from "./pmc-chart";

describe("PmcChart", () => {
  it("names the calibrating state instead of a bare sentence when fewer than 2 points exist", () => {
    const html = renderToString(
      <PmcChart wellness={[{ date: "2026-08-09", ctl: 12, atl: null }]} />
    );
    expect(html).toContain("Calibrating — day 1 of 2 days");
    expect(html).not.toContain("Not enough data yet for this range.");
  });

  it("draws the chart once at least 2 points exist", () => {
    const html = renderToString(
      <PmcChart
        wellness={[
          { date: "2026-08-08", ctl: 12, atl: 8 },
          { date: "2026-08-09", ctl: 13, atl: 9 },
        ]}
      />
    );
    expect(html).toContain("<svg");
    expect(html).not.toContain("Calibrating");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/log/pmc-chart.test.tsx`
Expected: FAIL — the component still renders the hardcoded sentence.

- [ ] **Step 3: Implement**

Add to `pmc-chart.tsx`'s top-level imports:

```tsx
import { unavailableMessage } from "@/components/ui/unavailable";
```

Change:

```tsx
if (nums.length < 2) {
  return (
    <p className="py-8 text-center text-sm text-white/40">
      Not enough data yet for this range.
    </p>
  );
}
```

to:

```tsx
if (nums.length < 2) {
  return (
    <p className="py-8 text-center text-sm text-white/40">
      {unavailableMessage({
        kind: "calibrating",
        have: nums.length,
        need: 2,
        unit: "days",
      })}
    </p>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/log/pmc-chart.test.tsx`
Expected: PASS, 2 tests.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/log/pmc-chart.tsx src/components/log/pmc-chart.test.tsx
git commit -m "feat(uncertainty): give PmcChart's thin-sample state a typed reason"
```

---

### Task 2: Release housekeeping

**Files:**

- Modify: `package.json`
- Modify: `CHANGELOG.md`
- Modify: `docs/ROADMAP.md`

- [ ] **Step 1: Bump the version**

In `package.json`, change `"version": "0.70.0"` to `"version": "0.71.0"`.

- [ ] **Step 2: Add the CHANGELOG entry**

Insert at the top of `CHANGELOG.md`, above the existing `## v0.70.0` entry:

```markdown
## v0.71.0 — 2026-08-09 — Uncertainty vocabulary (Log / Activity)

The fifth slice of Phase 2b.3 — small by design, per verification (see the
plan's Findings).

- `PmcChart`'s "Not enough data yet for this range." is now
  `unavailableMessage()`'s `calibrating` phrasing ("Calibrating — day N of 2
  days"), the same treatment `correlationFigure` already gives a thin
  sample.
- Investigated and left alone: `laps-table.tsx`'s per-cell em-dashes (a
  historical sensor absence with no "fix," and disproportionate to wrap at
  table-cell density — see the plan's Findings) and `PmcChart`'s dead
  `showStats` prop (inert, not a wrong message — general-cleanup territory,
  not 2b.3).
- Confirmed dead: `wellness-trends.tsx` (zero import sites, superseded by
  `BaselineTrendCard`) — belongs to Phase 2b.2's orphan cleanup.
```

- [ ] **Step 3: Update the roadmap**

In `docs/ROADMAP.md`, find the 2b.3 bullet's inline status note and read its
current exact text first. Extend it to mention v0.71.0, still without
checking the box (Coach/Journal and Admin/misc surfaces remain).

- [ ] **Step 4: Run the full local gate**

```bash
npm run typecheck && npm run lint && npm run format:check && npm test && npm run build
```

If `format:check` fails, run
`npx prettier --write package.json CHANGELOG.md docs/ROADMAP.md` (only these
three files) and re-verify.

- [ ] **Step 5: Commit**

```bash
git add package.json CHANGELOG.md docs/ROADMAP.md
git commit -m "chore(release): v0.71.0 — uncertainty vocabulary, Log/Activity"
```

Do **not** merge, tag, or push — leave that decision to whoever requested
this plan, per `docs/RELEASING.md`.
