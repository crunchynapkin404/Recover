# Uncertainty Vocabulary — Body / Health Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate biological age (`LabsTiles`, `BioAgeCard`) and the Estimated
Energy card (`BodyBatteryCurve`) to the `Figure<T>` uncertainty vocabulary —
the fourth slice of Phase 2b.3.

**Architecture:** `LabsTiles.bioAge` and `BioAgeCard.result` change from the
raw `BioAgeResult | BioAgeInsufficient` union to `Figure<BioAgeResult>`,
wrapped once in `src/app/body/page.tsx`'s `LabsTab` and passed to both
components (generalizes the vitals grid's `VitalTile.value: Figure<string>`
shape to a compound value, rather than a bare string). `BodyBatteryCurve.current`
changes from `number | null` to `Figure<number>`, wrapped in the same file's
`SleepTab` using the existing `calibrationProgress()` helper
(`src/lib/calibration.ts`, already shared with Today's hero) for the
calibrating state's `have`/`need` — the first use of `Figure.calibrating`
outside the 90-day correlations surface. `SleepTab`'s
`{battery.current != null && (...)}` guard is removed so the card (and its
now-typed calibrating message) actually renders — see Findings.

**Tech Stack:** Next.js 16 (server components `src/app/body/page.tsx`'s
`LabsTab`/`SleepTab`), React 19, TypeScript 5, Vitest (`renderToString` from
`react-dom/server`, no jsdom — all three components here are presentational).

Spec: `docs/specs/2026-08-08-uncertainty-vocabulary-design.md`. Continues
`docs/plans/2026-08-08-uncertainty-vocabulary.md`'s "Body / Health" backlog
item — corrected after verification, same as the prior two slices.

## Findings — before writing this plan

The original backlog named 5 files: `bio-age-card.tsx`, `labs-tiles.tsx`,
`biological-age.ts`, `race/forecast.ts`, `body-battery.tsx`. Unlike the
Dashboard/Today and Train groups, **no dead components turned up here** — all
five are live. But two corrections, one in each direction:

- **`src/lib/race/forecast.ts`'s "insufficient" kind has no remaining call
  site to migrate.** `forecastForm()` is invoked in exactly two places
  (`src/app/page.tsx`, `src/app/train/page.tsx`), both feeding a
  `RaceCountdownProps.outlook` consumed by exactly one component,
  `src/components/today/race-chip.tsx`. Its `formLabel()` already returns
  `null` for any non-`"projection"` outlook (comment: "anything calibrating
  drops the form clause entirely rather than inventing a number") — there is
  no "insufficient" text rendered anywhere for this value. `RaceChip` already
  handles it the same honest-by-omission way the last two slices found
  `today-hero.tsx`'s calibrating state and `milestones-card.tsx`'s
  zero-streak dash already handle their own conditions correctly. Nothing to
  fix. `src/lib/race/forecast.ts`, `RaceCountdownProps`, and
  `race-countdown.tsx` are untouched by this plan.
- **`src/components/dashboard/body-battery.tsx`'s "not enough data" branch
  exists, is tested, and is unreachable in production.** Its one call site,
  `src/app/body/page.tsx`'s `SleepTab`, guards the render with
  `{battery.current != null && (<BodyBatteryCurve .../>)}` — when readiness
  is still calibrating, the athlete sees no card at all, not the "Not enough
  data yet…" message the component (and `body-battery.test.tsx`) were written
  to show. This is the same class of wiring gap `body-battery.ts`'s own
  top-of-file comment already documents once (v0.63 computed a sleep-debt
  penalty and a tag, then never passed the value) — a second instance in the
  same feature, this time in its caller rather than its engine. **Fixing it
  is in scope for this plan**: it is the literal "when it does not know, it
  says so" case the goal names, not a new figure or a visual redesign, and
  the message/test already exist — they were simply never reachable.

What's left, and genuinely warranted: `bio-age-card.tsx` + `labs-tiles.tsx`
(both render `biologicalAge()`'s `BioAgeInsufficient` state via a
hand-written "Add: X, Y." sentence) and `body-battery.tsx` (render
`computeBodyBattery()`'s `current: null` state, once its call site actually
reaches it). `src/lib/biological-age.ts` needs no code change — like
`forecastForm`, its discriminated-union return is already the right shape;
only its two renderers change.

## Global Constraints

- **No new figures, no IA changes** — Phase 2's standing constraint.
- **The one intentional visible change beyond wording: the Estimated Energy
  card will render in a state where it currently renders nothing at all**
  (see Findings). Everywhere else, no visual regression — `LabsTiles`' and
  `BioAgeCard`'s available-state layout, and `BodyBatteryCurve`'s
  available-state curve, are pixel-identical to today.
- **Confidence claims must be defensible, not invented.** Both `biologicalAge()`
  and `computeBodyBattery()` are deterministic formulas over already-known
  signals (no black-box model, no interval) — the same reasoning
  `correlationFigure` (`src/lib/insights/correlations.ts`) already applies to
  a "strong" correlation finding and the vitals/fitness tiles apply to
  CTL/ATL/TSB: `"high"` throughout. Do not invent a lower tier that isn't
  backed by anything.
- **No `title`/`sr-only` accessibility pattern needed here**, unlike the
  vitals and fitness tiles. That pattern exists because those tiles show a
  bare `"—"` glyph and carry the reason _only_ in a `title` tooltip. All
  three components here already render their unavailable reason as visible
  body text (a `<p>`, not a truncated glyph) — there is no hidden
  information to surface. Do not add a `title`/`sr-only` pair where the text
  is already on the page.
- **Do not touch `src/lib/biological-age.ts` or `src/lib/body-battery.ts`**
  (the pure engines) — their existing discriminated-union returns are
  already the right shape, matching the established `forecastForm`-stays-
  untouched precedent from the Train slice.
- **Do not re-add the `battery.current != null &&` guard.** Removing it is
  the deliberate fix in Task 2 — confirm it stays gone in that task's manual
  sanity check.
- Test convention: co-locate `<name>.test.ts(x)` beside its source file;
  `renderToString` from `react-dom/server`, no jsdom. `bio-age-card.tsx` and
  `labs-tiles.tsx` have no existing test file — add one for each.
  `body-battery.test.tsx` already exists — update its existing cases in
  place rather than adding a parallel set.
- Run everything with Node 22 on PATH; none of this plan's tests touch the
  database.

---

### Task 1: Biological age → `Figure<BioAgeResult>`

**Files:**

- Create: `src/components/health/bio-age-card.test.tsx`
- Create: `src/components/body/labs-tiles.test.tsx`
- Modify: `src/components/health/bio-age-card.tsx`
- Modify: `src/components/body/labs-tiles.tsx`
- Modify: `src/app/body/page.tsx`

**Interfaces:**

- Consumes: `Figure` (type + value) from `@/lib/uncertainty`;
  `unavailableMessage` from `@/components/ui/unavailable` (both shipped in
  v0.67.0); `BioAgeResult` (type-only, already exported) from
  `@/lib/biological-age`.
- Produces: `BioAgeCard`'s `result` prop and `LabsTiles`' `bioAge` prop both
  become `Figure<BioAgeResult>`.

- [ ] **Step 1: Write the failing tests**

Create `src/components/health/bio-age-card.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { Figure } from "@/lib/uncertainty";
import type { BioAgeResult } from "@/lib/biological-age";
import { BioAgeCard } from "./bio-age-card";

const estimate: BioAgeResult = {
  bioAge: 34.2,
  deltaYears: -1.8,
  components: [{ key: "hrvMs", label: "HRV", offsetYears: -1.2 }],
};

describe("BioAgeCard", () => {
  it("renders the estimate and its components when available", () => {
    const html = renderToString(
      <BioAgeCard result={Figure.available(estimate, "high")} />
    );
    expect(html).toContain("34.2");
    expect(html).toContain("HRV");
  });

  it("names what's missing instead of inventing an estimate", () => {
    const html = renderToString(
      <BioAgeCard result={Figure.missingInput("Birth year, VO₂max")} />
    );
    expect(html).toContain("Needs Birth year, VO₂max");
    expect(html).not.toContain("34.2");
  });

  it("drops the headline but keeps the missing detail when hideHeadline is set", () => {
    const html = renderToString(
      <BioAgeCard result={Figure.missingInput("Birth year")} hideHeadline />
    );
    expect(html).not.toContain("Not enough inputs yet");
    expect(html).toContain("Needs Birth year");
  });
});
```

Create `src/components/body/labs-tiles.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { Figure } from "@/lib/uncertainty";
import type { BioAgeResult } from "@/lib/biological-age";
import { LabsTiles } from "./labs-tiles";

const estimate: BioAgeResult = {
  bioAge: 34.2,
  deltaYears: -1.8,
  components: [],
};

describe("LabsTiles", () => {
  it("renders the biological age when available", () => {
    const html = renderToString(
      <LabsTiles
        bioAge={Figure.available(estimate, "high")}
        biomarkerCount={3}
        lastDraw="2026-07-01"
      />
    );
    expect(html).toContain("34");
    expect(html).toContain("3 biomarkers");
  });

  it("names what's missing instead of a bare 'not enough inputs' sentence", () => {
    const html = renderToString(
      <LabsTiles
        bioAge={Figure.missingInput("Birth year, HRV")}
        biomarkerCount={0}
        lastDraw={null}
      />
    );
    expect(html).toContain("Needs Birth year, HRV");
    expect(html).not.toContain("34");
  });

  it("shows no draw recorded when lastDraw is null", () => {
    const html = renderToString(
      <LabsTiles
        bioAge={Figure.available(estimate, "high")}
        biomarkerCount={0}
        lastDraw={null}
      />
    );
    expect(html).toContain("no draw recorded");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/health/bio-age-card.test.tsx src/components/body/labs-tiles.test.tsx`
Expected: FAIL to compile — both components still take the raw
`BioAgeResult | BioAgeInsufficient` union, not `Figure<BioAgeResult>`.

- [ ] **Step 3: Implement — `bio-age-card.tsx`**

Replace the file's contents with:

```tsx
import type { BioAgeResult } from "@/lib/biological-age";
import type { Figure } from "@/lib/uncertainty";
import { unavailableMessage } from "@/components/ui/unavailable";

interface Props {
  result: Figure<BioAgeResult>;
  /**
   * Drops the headline figure, leaving only what drives it. Body's Labs
   * segment shows the estimate in its own tile, and printing the same age
   * twice on one screen is clutter.
   */
  hideHeadline?: boolean;
}

/**
 * Biological-age card (v0.13). Shows the estimate and its component
 * offsets, or an honest missing-input state naming what's needed — never
 * an invented number.
 */
export function BioAgeCard({ result, hideHeadline = false }: Props) {
  if (!result.available) {
    return (
      <div className="glass rounded-[2rem] p-6">
        <span className="label-micro">
          {hideHeadline ? "What's missing" : "Biological Age"}
        </span>
        {/* The tile above already says the estimate can't be made — don't
            say it twice, just say what would fix it. */}
        {!hideHeadline && (
          <p className="mt-3 text-sm text-white/70">Not enough inputs yet.</p>
        )}
        <p className="mt-2 text-[11px] text-white/50">
          {unavailableMessage(result)}
        </p>
      </div>
    );
  }

  const bioAge = result.value;
  const younger = bioAge.deltaYears < 0;
  return (
    <div className="glass rounded-[2rem] p-6">
      <span className="label-micro">
        {hideHeadline ? "What's driving it" : "Biological Age"}
      </span>
      {!hideHeadline && (
        <div className="mt-3 flex items-baseline gap-3">
          <span className="text-4xl font-bold tabular-nums text-white">
            {bioAge.bioAge}
          </span>
          <span
            className={`text-sm font-bold ${younger ? "text-emerald-400" : "text-amber-400"}`}
          >
            {younger ? "▼" : "▲"} {Math.abs(bioAge.deltaYears)} yr
            {younger ? " younger" : " older"}
          </span>
        </div>
      )}
      <div className="mt-4 space-y-1">
        {bioAge.components.map((c) => (
          <div
            key={c.key}
            className="flex items-center justify-between text-[11px]"
          >
            <span className="text-white/50">{c.label}</span>
            <span
              className={`tabular-nums ${c.offsetYears < 0 ? "text-emerald-400" : c.offsetYears > 0 ? "text-amber-400" : "text-white/40"}`}
            >
              {c.offsetYears > 0 ? "+" : ""}
              {c.offsetYears} yr
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Implement — `labs-tiles.tsx`**

Replace the file's contents with:

```tsx
import type { BioAgeResult } from "@/lib/biological-age";
import type { Figure } from "@/lib/uncertainty";
import { unavailableMessage } from "@/components/ui/unavailable";

interface Props {
  bioAge: Figure<BioAgeResult>;
  biomarkerCount: number;
  /** ISO date of the most recent draw, or null when there's been none. */
  lastDraw: string | null;
}

function drawLabel(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/**
 * The two Labs headline tiles (1g). Biological age keeps its honest
 * missing-input state — an estimate that can't be made says so rather than
 * printing a number, and the full breakdown stays in BioAgeCard below.
 */
export function LabsTiles({ bioAge, biomarkerCount, lastDraw }: Props) {
  const delta = bioAge.available ? bioAge.value.deltaYears : null;

  return (
    <div className="mb-3 grid grid-cols-2 gap-2">
      <div className="rounded-[16px] border border-white/[0.09] bg-white/[0.04] px-3.5 py-3">
        <p className="text-[8.5px] font-bold uppercase tracking-[0.15em] text-white/40">
          Biological age
        </p>
        {!bioAge.available ? (
          <p className="mt-2 text-[11px] text-white/50">
            {unavailableMessage(bioAge)}
          </p>
        ) : (
          <p className="mt-1.5 flex items-baseline gap-2">
            <span className="font-mono text-[22px] font-bold leading-none text-white">
              {Math.round(bioAge.value.bioAge)}
            </span>
            {delta != null && (
              <span
                className={`font-mono text-[11px] font-bold ${
                  delta < 0 ? "text-emerald-400" : "text-white/50"
                }`}
              >
                {delta < 0 ? "▼" : "▲"} {Math.abs(delta).toFixed(1)} yr
              </span>
            )}
          </p>
        )}
      </div>

      <div className="rounded-[16px] border border-white/[0.09] bg-white/[0.04] px-3.5 py-3">
        <p className="text-[8.5px] font-bold uppercase tracking-[0.15em] text-white/40">
          Labs
        </p>
        <p className="mt-1.5 text-[12.5px] font-semibold text-white">
          {biomarkerCount} biomarker{biomarkerCount === 1 ? "" : "s"}
        </p>
        <p className="mt-0.5 text-[10.5px] text-white/45">
          {lastDraw ? `last draw ${drawLabel(lastDraw)}` : "no draw recorded"}
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Implement — `src/app/body/page.tsx`**

Change the `biologicalAge` import:

```tsx
import { biologicalAge } from "@/lib/biological-age";
```

to:

```tsx
import { biologicalAge, type BioAgeResult } from "@/lib/biological-age";
```

Add `Figure`'s import alongside the other local-lib imports (right before the
`lucide-react` import):

```tsx
import { isBaselineExcluded, type DayFlag } from "@/lib/day-flags";
import { HeartPulse, Moon } from "lucide-react";
```

becomes:

```tsx
import { isBaselineExcluded, type DayFlag } from "@/lib/day-flags";
import { Figure } from "@/lib/uncertainty";
import { HeartPulse, Moon } from "lucide-react";
```

In `LabsTab`, wrap the existing `biologicalAge(...)` call's result instead of
passing it straight through. Change:

```tsx
  const bioAge = biologicalAge({
    chronologicalAge:
      prefs?.birthYear != null
        ? new Date().getFullYear() - prefs.birthYear
        : null,
    restingHr: latestWellness?.restingHr ?? null,
    hrvMs: latestWellness?.hrvMs ?? null,
    sleepConsistency: consistency?.score ?? null,
    vo2max:
      [...wellness].reverse().find((w) => w.vo2max != null)?.vo2max ?? null,
    bodyFatPct:
      [...wellness].reverse().find((w) => w.bodyFatPct != null)?.bodyFatPct ??
      null,
  });

  return (
    <div className="space-y-4 pb-10">
      <LabsTiles
        bioAge={bioAge}
        biomarkerCount={latest.length}
        lastDraw={biomarkerRows[0]?.measuredAt ?? null}
      />
      <BioAgeCard result={bioAge} hideHeadline />
```

to:

```tsx
  const bioAgeResult = biologicalAge({
    chronologicalAge:
      prefs?.birthYear != null
        ? new Date().getFullYear() - prefs.birthYear
        : null,
    restingHr: latestWellness?.restingHr ?? null,
    hrvMs: latestWellness?.hrvMs ?? null,
    sleepConsistency: consistency?.score ?? null,
    vo2max:
      [...wellness].reverse().find((w) => w.vo2max != null)?.vo2max ?? null,
    bodyFatPct:
      [...wellness].reverse().find((w) => w.bodyFatPct != null)?.bodyFatPct ??
      null,
  });
  // A deterministic formula over already-known signals, same reasoning
  // correlationFigure and the CTL/ATL/TSB tiles already use — never a
  // modelled interval, so "high" throughout.
  const bioAge: Figure<BioAgeResult> =
    "insufficient" in bioAgeResult
      ? Figure.missingInput(bioAgeResult.missing.join(", "))
      : Figure.available(bioAgeResult, "high");

  return (
    <div className="space-y-4 pb-10">
      <LabsTiles
        bioAge={bioAge}
        biomarkerCount={latest.length}
        lastDraw={biomarkerRows[0]?.measuredAt ?? null}
      />
      <BioAgeCard result={bioAge} hideHeadline />
```

Note what did **not** change: the `LabsTiles`/`BioAgeCard` JSX still passes a
variable named `bioAge` to both — only what that variable holds changed, from
the raw union to the wrapped `Figure`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/components/health/bio-age-card.test.tsx src/components/body/labs-tiles.test.tsx`
Expected: PASS, 6 tests total.

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 8: Manual sanity check**

Per `docs/BASELINE.md`'s structural lesson #2, confirm the wiring holds:
`grep -n "bioAge" src/app/body/page.tsx` should show `bioAgeResult` computed
once, `bioAge` wrapped once, and passed to both `<LabsTiles>` and
`<BioAgeCard>` exactly as before this task.

- [ ] **Step 9: Commit**

```bash
git add src/components/health/bio-age-card.tsx src/components/health/bio-age-card.test.tsx src/components/body/labs-tiles.tsx src/components/body/labs-tiles.test.tsx src/app/body/page.tsx
git commit -m "feat(uncertainty): migrate biological age to Figure<BioAgeResult>"
```

---

### Task 2: Estimated Energy → `Figure<number>` (and reachable at last)

**Context:** `src/components/dashboard/body-battery.tsx` (`BodyBatteryCurve`)
already has a "not enough data yet" branch and a test asserting it — but its
only call site, `src/app/body/page.tsx`'s `SleepTab`, wraps the render in
`{battery.current != null && (...)}`, so that branch never runs in
production. This task both migrates the branch's text to the shared
vocabulary and removes the guard that hid it (see plan Findings).

**Files:**

- Modify: `src/components/dashboard/body-battery.tsx`
- Modify: `src/components/dashboard/body-battery.test.tsx`
- Modify: `src/app/body/page.tsx`

**Interfaces:**

- Consumes: `Figure` (type + value) from `@/lib/uncertainty`;
  `unavailableMessage` from `@/components/ui/unavailable`; `calibrationProgress`
  from `@/lib/calibration` (shipped v0.11, already used by Today's hero).
- Produces: `BodyBatteryCurve`'s `current` prop becomes `Figure<number>`.

- [ ] **Step 1: Update the existing tests**

Replace `src/components/dashboard/body-battery.test.tsx`'s contents with:

```tsx
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { Figure } from "@/lib/uncertainty";
import { BodyBatteryCurve } from "./body-battery";

/**
 * v0.9.0 — the battery card previously drew a hardcoded SVG path that no
 * caller ever overrode, so every athlete saw the same fictional day. These
 * tests pin the contract: no data means no curve.
 */
describe("body battery card", () => {
  it("renders a typed calibrating reason instead of a placeholder curve", () => {
    const html = renderToString(
      <BodyBatteryCurve
        current={Figure.calibrating(4, 14, "days")}
        points={[]}
        tags={[]}
        checkpoints={[]}
      />
    );
    expect(html).toContain("Calibrating — day 4 of 14 days");
    expect(html).not.toContain("<path");
  });

  it("never contains the old hardcoded placeholder path", () => {
    const html = renderToString(
      <BodyBatteryCurve
        current={Figure.available(70, "high")}
        points={[
          { minutes: 0, charge: 90 },
          { minutes: 720, charge: 80 },
          { minutes: 1440, charge: 70 },
        ]}
        tags={[]}
        checkpoints={[]}
      />
    );
    expect(html).not.toContain("M0 40 Q50 30 80 45");
  });

  it("labels itself an estimate rather than a measurement", () => {
    const html = renderToString(
      <BodyBatteryCurve
        current={Figure.available(70, "high")}
        points={[{ minutes: 0, charge: 70 }]}
        tags={[]}
        checkpoints={[]}
      />
    );
    expect(html).toContain("Estimated Energy");
  });

  it("plots the real points it is given", () => {
    const html = renderToString(
      <BodyBatteryCurve
        current={Figure.available(50, "high")}
        points={[
          { minutes: 0, charge: 100 },
          { minutes: 720, charge: 50 },
        ]}
        tags={["rest day"]}
        checkpoints={[]}
      />
    );
    // 0min → x=0, charge 100 → y=0; 720min → x=200, charge 50 → y=90.
    expect(html).toContain("M0.0 0.0 L200.0 90.0");
  });

  it("renders day tags and checkpoints", () => {
    const html = renderToString(
      <BodyBatteryCurve
        current={Figure.available(45, "high")}
        points={[{ minutes: 0, charge: 45 }]}
        tags={["hard day", "sleep debt"]}
        checkpoints={[
          { label: "Morning", minutes: 420, charge: 45 },
          { label: "Midday", minutes: 780, charge: 30 },
          { label: "Evening", minutes: 1140, charge: 20 },
        ]}
      />
    );

    expect(html).toContain("hard day");
    expect(html).toContain("Morning");
    expect(html).toContain("30<!-- -->%");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/dashboard/body-battery.test.tsx`
Expected: FAIL to compile — `current` is still typed `number | null`.

- [ ] **Step 3: Implement — `body-battery.tsx`**

Change the imports at the top of the file:

```tsx
"use client";

import type { BatteryPoint, BodyBatteryCheckpoint } from "@/lib/body-battery";
```

to:

```tsx
"use client";

import type { BatteryPoint, BodyBatteryCheckpoint } from "@/lib/body-battery";
import type { Figure } from "@/lib/uncertainty";
import { unavailableMessage } from "@/components/ui/unavailable";
```

Change the `Props` interface's `current` field:

```tsx
interface Props {
  /** Current charge 0-100, or null when there is not enough data. */
  current: number | null;
```

to:

```tsx
interface Props {
  /** Current charge 0-100, or why the model can't run yet. */
  current: Figure<number>;
```

Change the component body's guard and empty-state branch:

```tsx
export function BodyBatteryCurve({
  current,
  points,
  tags,
  checkpoints,
}: Props) {
  if (current == null || points.length === 0) {
    return (
      <div className="glass rounded-[2rem] p-7">
        <span className="label-micro">Estimated Energy</span>
        <p className="mt-4 text-sm text-white/50">
          Not enough data yet — your readiness score needs more history before
          energy can be estimated.
        </p>
        {tags.length > 0 && (
```

to:

```tsx
export function BodyBatteryCurve({
  current,
  points,
  tags,
  checkpoints,
}: Props) {
  if (!current.available || points.length === 0) {
    return (
      <div className="glass rounded-[2rem] p-7">
        <span className="label-micro">Estimated Energy</span>
        <p className="mt-4 text-sm text-white/50">
          {current.available
            ? "Not enough data yet."
            : unavailableMessage(current)}
        </p>
        {tags.length > 0 && (
```

Further down, change the current-value readout:

```tsx
<span className="text-xs font-bold text-white/80">{current}% now</span>
```

to:

```tsx
<span className="text-xs font-bold text-white/80">{current.value}% now</span>
```

- [ ] **Step 4: Implement — `src/app/body/page.tsx`**

Add `calibrationProgress`'s import alongside the `Figure` import Task 1 added
(it is already present from that task — do not add it again):

```tsx
import { isBaselineExcluded, type DayFlag } from "@/lib/day-flags";
import { Figure } from "@/lib/uncertainty";
import { HeartPulse, Moon } from "lucide-react";
```

becomes:

```tsx
import { isBaselineExcluded, type DayFlag } from "@/lib/day-flags";
import { calibrationProgress } from "@/lib/calibration";
import { Figure } from "@/lib/uncertainty";
import { HeartPulse, Moon } from "lucide-react";
```

In `SleepTab`, wrap `battery.current` right after `computeBodyBattery` is
called. Change:

```tsx
  const now = new Date();
  const battery = computeBodyBattery({
    readiness: todayMetric?.readiness ?? null,
    wakeMinutes,
    bedMinutes,
    activities: todayActivities.map((a) => ({
      startMinutes:
        (a.startDateLocal ?? a.startDate).getHours() * 60 +
        (a.startDateLocal ?? a.startDate).getMinutes(),
      durationMin: (a.durationS ?? 0) / 60,
      load: a.load ?? 0,
    })),
    nowMinutes: now.getHours() * 60 + now.getMinutes(),
    // v0.63 gave computeBodyBattery a sleep-debt penalty and a "sleep debt"
    // tag, then never passed the value — both were dead in production while
    // `debt` sat computed 40 lines above.
    sleepDebtSecs: debt.debtSecs,
  });

  return (
    <div className="pb-10">
```

to:

```tsx
  const now = new Date();
  const battery = computeBodyBattery({
    readiness: todayMetric?.readiness ?? null,
    wakeMinutes,
    bedMinutes,
    activities: todayActivities.map((a) => ({
      startMinutes:
        (a.startDateLocal ?? a.startDate).getHours() * 60 +
        (a.startDateLocal ?? a.startDate).getMinutes(),
      durationMin: (a.durationS ?? 0) / 60,
      load: a.load ?? 0,
    })),
    nowMinutes: now.getHours() * 60 + now.getMinutes(),
    // v0.63 gave computeBodyBattery a sleep-debt penalty and a "sleep debt"
    // tag, then never passed the value — both were dead in production while
    // `debt` sat computed 40 lines above.
    sleepDebtSecs: debt.debtSecs,
  });
  // Same "day N of 14" count Today's hero uses (calibrationProgress reads
  // the readiness baseline signal, not the battery model itself).
  const batteryCalibration = calibrationProgress(
    wellness.map((w) => ({ hrvMs: w.hrvMs, restingHr: w.restingHr }))
  );
  const batteryFigure: Figure<number> =
    battery.current != null
      ? Figure.available(battery.current, "high")
      : Figure.calibrating(
          batteryCalibration.daysWithSignal,
          batteryCalibration.target,
          "days"
        );

  return (
    <div className="pb-10">
```

Then remove the render guard. Change:

```tsx
{
  battery.current != null && (
    <BodyBatteryCurve
      current={battery.current}
      points={battery.points}
      tags={battery.tags}
      checkpoints={battery.checkpoints}
    />
  );
}
```

to:

```tsx
<BodyBatteryCurve
  current={batteryFigure}
  points={battery.points}
  tags={battery.tags}
  checkpoints={battery.checkpoints}
/>
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/components/dashboard/body-battery.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Manual sanity check**

Per `docs/BASELINE.md`'s structural lesson #2: `grep -n "battery.current != null"
src/app/body/page.tsx` must return **nothing** — confirms the dead render
guard is actually gone, not merely relocated. Separately,
`grep -n "BodyBatteryCurve" src/app/body/page.tsx` should show it rendered
unconditionally, exactly once.

- [ ] **Step 8: Commit**

```bash
git add src/components/dashboard/body-battery.tsx src/components/dashboard/body-battery.test.tsx src/app/body/page.tsx
git commit -m "feat(uncertainty): migrate Estimated Energy to Figure<number>, fix its dead render guard"
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

In `package.json`, change `"version": "0.69.0"` to `"version": "0.70.0"`.

- [ ] **Step 2: Add the CHANGELOG entry**

Insert at the top of `CHANGELOG.md`, above the existing `## v0.69.0` entry:

```markdown
## v0.70.0 — 2026-08-09 — Uncertainty vocabulary (Body / Health)

The fourth slice of Phase 2b.3: biological age and the Estimated Energy
(body battery) card migrated to the `Figure<T>` vocabulary.

- `LabsTiles.bioAge` and `BioAgeCard.result` are now `Figure<BioAgeResult>`;
  the hand-written "Add: X, Y." sentence is now `unavailableMessage()`'s
  `missing_input` phrasing, computed once in `LabsTab` and shared by both
  components.
- `BodyBatteryCurve.current` is now `Figure<number>`, using
  `calibrationProgress()` (the same "day N of 14" helper Today's hero uses)
  for its `have`/`need` — the first use of `Figure.calibrating` outside the
  90-day correlations surface.
- Fixed: the Estimated Energy card no longer disappears entirely while
  readiness calibrates. `SleepTab` guarded its render with
  `battery.current != null`, so the component's own "not enough data"
  message — already written, already tested — was unreachable. Removed the
  guard; the card now always renders, honestly, per the goal's "when it does
  not know, it says so."
- Investigated `src/lib/race/forecast.ts`'s "insufficient" kind (named in
  the original backlog) and found nothing left to migrate: its one
  rendering path, `RaceChip`, already omits the form clause silently rather
  than showing a placeholder — the same honest-by-omission design the last
  two slices found in `today-hero.tsx` and `milestones-card.tsx`.
- No dead components found on this surface (unlike the first two slices).
```

- [ ] **Step 3: Update the roadmap**

In `docs/ROADMAP.md`, find the 2b.3 bullet's inline status note (extended in
v0.68.0 and v0.69.0) and read its current exact text first, since it may have
drifted. Extend the note to mention v0.70.0, still without checking the box
(Log/Activity, Coach/Journal, and Admin/misc surfaces remain, and per the
last three slices, their file lists need the same re-verification before
trusting them).

- [ ] **Step 4: Run the full local gate**

```bash
npm run typecheck && npm run lint && npm run format:check && npm test && npm run build
```

Expected: all green. If `format:check` fails, run
`npx prettier --write package.json CHANGELOG.md docs/ROADMAP.md` (only these
three files, not `npm run format`'s whole-repo form) and re-verify with
`format:check`.

- [ ] **Step 5: Commit**

```bash
git add package.json CHANGELOG.md docs/ROADMAP.md
git commit -m "chore(release): v0.70.0 — uncertainty vocabulary, Body/Health"
```

Do **not** merge, tag, or push — leave that decision to whoever requested
this plan, per `docs/RELEASING.md`.
