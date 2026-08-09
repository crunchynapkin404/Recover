# Uncertainty Vocabulary — Train Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the Train page's fitness tiles (CTL/ATL/TSB) and the day-actions preview's "insufficient" state to the `Figure<T>` uncertainty vocabulary — the third slice of Phase 2b.3.

**Architecture:** `FitnessTile.value` changes from a pre-formatted `string` to `Figure<string>`, mirroring the vitals-grid migration (v0.68.0) exactly, including its accessibility pattern (visible `"—"` unchanged, `title` + `sr-only` span carrying the typed reason). `DayActions`' preview renders its "not enough history" state via `unavailableMessage()` directly instead of a bare sentence.

**Tech Stack:** Next.js 16 (server component `src/app/train/page.tsx`; client component `src/components/plan/day-actions.tsx`), React 19, TypeScript 5, Vitest (`renderToString` for Task 1; jsdom + `act`/`createRoot` for Task 2 — `day-actions.tsx` is a client component with internal state, and its existing test file already uses this heavier interactive pattern).

Spec: `docs/specs/2026-08-08-uncertainty-vocabulary-design.md`. Continues
`docs/plans/2026-08-08-uncertainty-vocabulary.md`'s "Train" backlog item —
corrected after verification, same as the prior two slices.

## Findings — before writing this plan

The original backlog named 3 files: `src/app/train/page.tsx`,
`src/components/train/season-timeline-card.tsx`,
`src/components/plan/day-actions.tsx`. Unlike the last two surfaces, **all
three are live** — no dead components found here. But two of the three
dialect strings in the backlog turned out to be entangled with a value the
roadmap already has separate, dedicated plans for:

- **`season-timeline-card.tsx`'s `"unknown"`/`"—"` (target load, target vs.
  actual chart) and `src/app/train/page.tsx`'s remaining-weeks skeleton
  `"—"` (line ~1042, `b.targetLoadTotal`)** both read
  `trainingBlocks.targetLoadTotal` — the exact column `docs/ROADMAP.md`
  names as Phase 2c's **first** number slice: "3 producers, 43 + 36 + 8 read
  sites. First because it caused four shipped bugs, and because settling
  ownership is what makes the hidden week quick actions decidable."
  `docs/BASELINE.md`'s structural lesson #5 ("layer confusion... the week
  quick actions are the fourth instance") is about this exact value. Touching
  its rendering now, before 2c assigns it one owner, risks becoming the
  fifth instance. **Left alone — deferred to Phase 2c**, not this plan.
  `season-timeline-card.tsx`'s "Season adherence" `"—"` is also derived from
  `targetLoad` (`latestAdherencePct`) and is excluded for the same reason.
- **`src/app/train/page.tsx`'s readiness header chip** (`{readiness != null
? ... : "calibrating"}`, line ~349) is a terse band-verdict label — the
  same category as `today-hero.tsx`'s `BAND_VERDICT.calibrating` that the
  previous plan (v0.68.0) already excluded for the same reason: a compact
  state indicator, not a value placeholder. No adjacent duplication risk
  here specifically, but no real value in wrapping a single word in the full
  type either. Left alone.

What's left, and genuinely warranted: the Train page's own CTL/ATL/TSB
fitness tiles (a separate value from `targetLoadTotal` — these read
`daily_metrics.ctl`/`.atl`, the same source the vitals grid's Form · TSB
tile already migrated in v0.68.0), and `DayActions`' preview state, which
shares `forecastForm`'s `.insufficient` flag with the vitals grid's TSB tile
and the live `RaceChip` (both already established `missing_input` as the
right kind for "not enough training-load history" in v0.68.0).

## Global Constraints

- **No new figures, no IA changes** — Phase 2's standing constraint.
- **No visual regression.** Every tile renders the exact same `"—"` glyph,
  same styling, same layout as before. `DayActions`' preview renders the
  same paragraph element with the same classes — only its text content
  changes from a bare sentence to `unavailableMessage()`'s output.
- **Confidence claims must be defensible.** CTL/ATL/TSB are direct
  computations on logged/synced training data (same reasoning already
  applied to the vitals grid's Form · TSB tile in v0.68.0) — `"high"`
  throughout.
- **Accessibility from the start, not as a follow-up.** v0.68.0's final
  review found that a bare `title` attribute doesn't reach touch or
  screen-reader users; that review added an `sr-only` span alongside it
  afterward. Build both in from Task 1's first commit here.
- **Do not touch `trainingBlocks.targetLoadTotal`'s rendering** (see
  Findings) — not in `season-timeline-card.tsx`, not in `train/page.tsx`'s
  remaining-weeks table. That's Phase 2c's first number slice.
- Test convention: co-locate `<name>.test.ts(x)`; `renderToString` for
  presentational components (Task 1); `day-actions.tsx` is a client
  component with existing interactive jsdom tests (Task 2) — follow that
  file's established pattern (`@vitest-environment jsdom`, `createRoot`,
  `act`, mocked `previewPlanChange`), don't introduce a different one.

---

### Task 1: Fitness tiles → `Figure<string>`

**Files:**

- Modify: `src/components/train/fitness-tiles.tsx`
- Test: `src/components/train/fitness-tiles.test.tsx`
- Modify: `src/app/train/page.tsx`

**Interfaces:**

- Consumes: `Figure` (type + value) from `@/lib/uncertainty`;
  `unavailableMessage` from `@/components/ui/unavailable` (both shipped in
  v0.67.0).
- Produces: `FitnessTile` with `value: Figure<string>`.

- [ ] **Step 1: Write the failing test**

Create `src/components/train/fitness-tiles.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { Figure } from "@/lib/uncertainty";
import { FitnessTiles, type FitnessTile } from "./fitness-tiles";

function tile(overrides: Partial<FitnessTile>): FitnessTile {
  return {
    label: "Fitness · CTL",
    value: Figure.available("62", "high"),
    color: "#60a5fa",
    context: null,
    ...overrides,
  };
}

describe("FitnessTiles", () => {
  it("renders an available value", () => {
    const html = renderToString(
      <FitnessTiles tiles={[tile({ value: Figure.available("62", "high") })]} />
    );
    expect(html).toContain("62");
  });

  it("renders a dash and a reason for a missing value", () => {
    const html = renderToString(
      <FitnessTiles
        tiles={[tile({ value: Figure.missingInput("training-load history") })]}
      />
    );
    expect(html).toContain("—");
    expect(html).toContain("Needs training-load history");
  });

  it("makes the missing-value reason available to screen readers, not only via title", () => {
    const html = renderToString(
      <FitnessTiles
        tiles={[tile({ value: Figure.missingInput("training-load history") })]}
      />
    );
    expect(html).toContain('class="sr-only"');
  });

  it("renders no sr-only reason when the value is available", () => {
    const html = renderToString(
      <FitnessTiles tiles={[tile({ value: Figure.available("62", "high") })]} />
    );
    expect(html).not.toContain("sr-only");
  });

  it("still renders the context line for an available value", () => {
    const html = renderToString(
      <FitnessTiles
        tiles={[
          tile({
            value: Figure.available("62", "high"),
            context: "▲ +4 in 28d",
            contextColor: "#34d399",
          }),
        ]}
      />
    );
    expect(html).toContain("▲ +4 in 28d");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/train/fitness-tiles.test.tsx`
Expected: FAIL — `FitnessTile.value` is still typed `string`.

- [ ] **Step 3: Implement — `fitness-tiles.tsx`**

Replace the file's contents with:

```tsx
import type { Figure } from "@/lib/uncertainty";
import { unavailableMessage } from "@/components/ui/unavailable";

export interface FitnessTile {
  /** "Fitness · CTL" */
  label: string;
  /** The reading, or why it isn't available yet. */
  value: Figure<string>;
  color: string;
  /** One line of context under the value; null when there's nothing honest to say. */
  context: string | null;
  /** Tints the context line (the CTL block delta reads as a gain). */
  contextColor?: string;
}

/**
 * CTL / ATL / TSB as three tiles above the PMC chart (1e). The chart shows
 * the shape; these show today's number, which is what the athlete came for.
 */
export function FitnessTiles({ tiles }: { tiles: FitnessTile[] }) {
  return (
    <div className="mb-4 grid grid-cols-3 gap-2">
      {tiles.map((t) => (
        <div
          key={t.label}
          className="rounded-[14px] border border-white/[0.09] bg-white/[0.04] px-3 py-2.5"
        >
          <p className="text-[8.5px] font-bold uppercase tracking-[0.15em] text-white/40">
            {t.label}
          </p>
          <p
            className="mt-1 font-mono text-[20px] font-bold leading-none"
            style={{ color: t.color }}
            title={!t.value.available ? unavailableMessage(t.value) : undefined}
          >
            {t.value.available ? t.value.value : "—"}
            {!t.value.available && (
              <span className="sr-only">{unavailableMessage(t.value)}</span>
            )}
          </p>
          {t.context && (
            <p
              className="mt-1.5 text-[9.5px] font-medium"
              style={{ color: t.contextColor ?? "rgba(255,255,255,0.4)" }}
            >
              {t.context}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Implement — `src/app/train/page.tsx`**

`train/page.tsx` already imports `FitnessTiles`/`FitnessTile` from
`@/components/train/fitness-tiles` (unchanged import). Add alongside its
other `@/lib/...` imports:

```tsx
import { Figure } from "@/lib/uncertainty";
```

Replace the `tiles` array (currently three objects with
`value: ctl != null ? String(Math.round(ctl)) : "—"` etc.) with:

```tsx
const tiles: FitnessTile[] = [
  {
    label: "Fitness · CTL",
    value:
      ctl != null
        ? Figure.available(String(Math.round(ctl)), "high")
        : Figure.missingInput("training-load history"),
    color: "#60a5fa",
    // A flat block is flat — no arrow, no colour, no implied progress.
    context:
      ctlDelta == null
        ? null
        : ctlDelta === 0
          ? "level over 28d"
          : `${ctlDelta > 0 ? "▲ +" : "▼ −"}${Math.abs(ctlDelta)} in 28d`,
    contextColor:
      ctlDelta != null && ctlDelta > 0 ? "#34d399" : "rgba(255,255,255,0.4)",
  },
  {
    label: "Fatigue · ATL",
    value:
      atl != null
        ? Figure.available(String(Math.round(atl)), "high")
        : Figure.missingInput("training-load history"),
    color: "#f87171",
    context: weekLoad > 0 ? `7d load ${Math.round(weekLoad)}` : null,
  },
  {
    label: "Form · TSB",
    value:
      tsb != null
        ? Figure.available(
            `${tsb < 0 ? "−" : ""}${Math.abs(tsb).toFixed(1)}`,
            "high"
          )
        : Figure.missingInput("training-load history"),
    color: "#34d399",
    context:
      tsb == null
        ? null
        : tsb > 5
          ? "fresh"
          : tsb < -10
            ? "deep fatigue"
            : "neutral zone",
  },
];
```

Note what did **not** change: `ctl`/`atl`/`tsb`/`ctlDelta`/`weekLoad` are
computed exactly as before, above this array — only each tile's `value`
construction changed.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/components/train/fitness-tiles.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Manual sanity check**

Per `docs/BASELINE.md`'s structural lesson #2, confirm the wiring holds:
`grep -n "tiles" src/app/train/page.tsx` should show the `tiles` array still
passed into `<FitnessTiles tiles={tiles} />` exactly once, unchanged from
before this task.

- [ ] **Step 8: Commit**

```bash
git add src/components/train/fitness-tiles.tsx src/components/train/fitness-tiles.test.tsx src/app/train/page.tsx
git commit -m "feat(uncertainty): migrate the Train fitness tiles to Figure<string>"
```

---

### Task 2: `DayActions`' preview — typed reason instead of a bare sentence

**Context:** `src/components/plan/day-actions.tsx` shows a projected-form
preview after the athlete picks a move/swap/skip action. When
`previewPlanChange` reports `insufficient` (the same `forecastForm`
"not enough training-load history" signal the vitals grid's TSB tile and the
live `RaceChip` already carry), it renders the bare sentence
`"No projection — calibrating."`. This task replaces it with the shared
vocabulary's phrasing, consistent with how the vitals grid now phrases the
same underlying condition.

**Files:**

- Modify: `src/components/plan/day-actions.tsx`
- Modify: `src/components/plan/day-actions.test.tsx`

**Interfaces:**

- Consumes: `unavailableMessage` from `@/components/ui/unavailable` (shipped
  in v0.67.0).
- Produces: nothing new — this task only changes what one paragraph renders.

- [ ] **Step 1: Write the failing test**

`src/components/plan/day-actions.test.tsx` already has a
`describe("DayActions error rendering (interaction)", ...)` block with a
`renderComponent()` helper, a `click()` helper, and a `findButtonByText()`
helper (read the file to confirm these are still present and unchanged
before editing). Add this test inside that `describe` block, after its last
existing `it(...)`:

```tsx
it("shows a typed reason, not a bare 'calibrating' sentence, when the preview lacks enough load history", async () => {
  previewMock.mockResolvedValue({
    ok: true,
    insufficient: true,
    anchorDate: "2026-08-30",
    anchorRace: null,
    beforeTsb: null,
    afterTsb: null,
    beforeBand: null,
    afterBand: null,
    loadDelta: 0,
  });
  renderComponent();

  const targetSelect = container.querySelector(
    'select[aria-label="Target day"]'
  ) as HTMLSelectElement;
  await act(async () => {
    targetSelect.value = "2026-08-26";
    targetSelect.dispatchEvent(new Event("change", { bubbles: true }));
  });

  await act(async () => {
    click(findButtonByText("What if?"));
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(container.textContent).toContain(
    "Needs more training history to project form"
  );
  expect(container.textContent).not.toContain("No projection — calibrating.");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/plan/day-actions.test.tsx`
Expected: FAIL — the component still renders "No projection — calibrating."

- [ ] **Step 3: Implement**

In `src/components/plan/day-actions.tsx`, add to the top-level imports:

```tsx
import { unavailableMessage } from "@/components/ui/unavailable";
```

Change:

```tsx
          {preview.insufficient ? (
            <p className="text-[11px] text-white/50">
              No projection — calibrating.
            </p>
          ) : (
```

to:

```tsx
          {preview.insufficient ? (
            <p className="text-[11px] text-white/50">
              {unavailableMessage({
                kind: "missing_input",
                needs: "more training history to project form",
              })}
            </p>
          ) : (
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/plan/day-actions.test.tsx`
Expected: PASS, including all pre-existing tests in the file (unchanged).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`

- [ ] **Step 6: Commit**

```bash
git add src/components/plan/day-actions.tsx src/components/plan/day-actions.test.tsx
git commit -m "feat(uncertainty): give DayActions' insufficient-history state a typed reason"
```

---

### Task 3: Release housekeeping

**Files:**

- Modify: `package.json`
- Modify: `CHANGELOG.md`
- Modify: `docs/ROADMAP.md`

**Interfaces:** Consumes: the diff from Tasks 1–2. Produces: nothing
importable.

- [ ] **Step 1: Bump the version**

In `package.json`, change `"version": "0.68.0"` to `"version": "0.69.0"`.

- [ ] **Step 2: Add the CHANGELOG entry**

Insert at the top of `CHANGELOG.md`, above the existing `## v0.68.0` entry:

```markdown
## v0.69.0 — 2026-08-09 — Uncertainty vocabulary (Train)

The third slice of Phase 2b.3: the Train page's CTL/ATL/TSB fitness tiles,
and `DayActions`' preview, migrated to the `Figure<T>` vocabulary.

- `FitnessTile.value` is now `Figure<string>`, matching the vitals grid's
  v0.68.0 shape exactly, including its accessibility pattern (`title` +
  `sr-only` span, built in from the start this time rather than added in a
  follow-up).
- `DayActions`' preview now says "Needs more training history to project
  form." instead of the bare "No projection — calibrating." — the same
  underlying `forecastForm` signal the vitals grid's Form · TSB tile and the
  live `RaceChip` already treat as `missing_input`.
- Investigated `season-timeline-card.tsx`'s `"unknown"`/`"—"` and
  `train/page.tsx`'s remaining-weeks skeleton `"—"` and left both alone:
  both read `trainingBlocks.targetLoadTotal`, the value `docs/ROADMAP.md`
  names as Phase 2c's first number slice ("3 producers... caused four
  shipped bugs"). Touching its rendering before 2c assigns it one owner
  risks becoming the fifth instance of `docs/BASELINE.md`'s layer-confusion
  lesson. Also left alone: the Train page's readiness header chip, a terse
  band-verdict label like `today-hero.tsx`'s, not a value placeholder.
- No dead components found on this surface (unlike the last two slices).
```

- [ ] **Step 3: Update the roadmap**

In `docs/ROADMAP.md`, find the 2b.3 bullet's inline status note (extended in
v0.68.0) and read its current exact text first, since it may have drifted.
Extend the note to mention v0.69.0, still without checking the box (this
remains a partial migration — target-load-dependent sites are explicitly
deferred to 2c, not merely unmigrated).

- [ ] **Step 4: Run the full local gate**

```bash
npm run typecheck && npm run lint && npm run format:check && npm test && npm run build
```

Expected: all green. If `format:check` fails, run
`npx prettier --write package.json CHANGELOG.md docs/ROADMAP.md` (only these
three files, not `npm run format`'s whole-repo form — v0.68.0's release task
running the repo-wide form swept in unrelated drift from earlier tasks) and
re-verify with `format:check`.

- [ ] **Step 5: Commit**

```bash
git add package.json CHANGELOG.md docs/ROADMAP.md
git commit -m "chore(release): v0.69.0 — uncertainty vocabulary, Train"
```

Do **not** merge, tag, or push — leave that decision to whoever requested
this plan, per `docs/RELEASING.md`.
