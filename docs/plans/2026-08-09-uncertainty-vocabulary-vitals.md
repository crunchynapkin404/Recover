# Uncertainty Vocabulary — Vitals Grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the Today page's vitals grid (HRV/RHR/Sleep/Form·TSB tiles) to the `Figure<T>` uncertainty vocabulary shipped in v0.67.0 — the next slice of Phase 2b.3, continuing `docs/plans/2026-08-08-uncertainty-vocabulary.md`'s backlog.

**Architecture:** `VitalTile.value` changes from a pre-formatted `string` to `Figure<string>`; the renderer shows the same `"—"` glyph it always has when unavailable (no visual regression) but now backs it with a typed reason, surfaced via a `title` attribute. The sleep tile's low-confidence suffix (`"· limited data"`) becomes a `<ConfidenceChip>` in the delta slot instead of string concatenation.

**Tech Stack:** Next.js 16 (server component `src/app/page.tsx`), React 19, TypeScript 5, Vitest (`renderToString`, no jsdom).

Spec: `docs/specs/2026-08-08-uncertainty-vocabulary-design.md`. Continues
`docs/plans/2026-08-08-uncertainty-vocabulary.md`'s "Dashboard / Today" backlog
item — but that item's file list needed correcting first; see "Findings" below.

## Findings — before writing this plan

The original backlog entry named 7 files. Verifying which are actually live
(the same check that found `correlation-insights.tsx` dead last time) found
**5 more confirmed-dead components** in this one group alone:

| File | Status | Evidence |
| --- | --- | --- |
| `src/components/dashboard/hero-readiness.tsx` | Dead | Zero non-test imports |
| `src/components/dashboard/readiness-rings.tsx` | Dead | Only consumed by the dead `hero-readiness.tsx` |
| `src/components/dashboard/race-countdown.tsx` | Component dead, type alive | `RaceCountdownCard` has zero non-test imports; its exported type `RaceCountdownProps` is imported by `src/app/train/page.tsx:50` and `src/components/today/race-chip.tsx:2` — the roadmap's own "Trap" note about this file |
| `src/components/dashboard/recent-sessions-accordion.tsx` | Dead | Zero non-test imports |
| `src/components/dashboard/vitals-grid.tsx` | Dead | Zero non-test imports — superseded by `src/components/today/vitals-grid.tsx`, the file this plan actually touches |

None of these five are touched by this plan. Their disposal belongs to Phase
2b.2's orphan cleanup (`docs/ROADMAP.md`), same as `correlation-insights.tsx`.
That cleanup list is now at least 17 files, not the roadmap's stated 12 — worth
flagging when 2b.2 is actually scoped.

Of the remaining live files, three more turned out **not to be uncertainty
dialects** on closer reading, or not proportionate to fix here:

- **`src/components/dashboard/milestones-card.tsx`** (live, via
  `src/app/body/page.tsx:740`) — its `r.value ?? "—"` fires when a count is
  **zero** (`currentStreak > 0 ? ... : null`), not when it's unknown. The app
  knows the streak is 0; it's choosing not to print "0". Converting this to
  `Unavailable` would claim the opposite of what's true. Left alone.
- **`src/components/today/checkin-sheet.tsx`**'s slider `{v ?? "—"}` — the
  live current value of an interactive 1–10 form control before the athlete
  has touched it. Not an epistemic claim about the world; it's UI input
  state. Left alone.
- **`src/components/today/today-hero.tsx`**'s calibrating states — the centre
  ring's `"—"` and its `"Readiness calibrating"` sr-only text. Investigated
  giving this the same `Figure.calibrating` treatment as the tasks below, but
  `src/app/page.tsx` already renders a `<CalibrationProgress>` card
  immediately underneath the hero whenever `band === "calibrating"`, with its
  own accessible `role="progressbar"` and day-count. Adding the same
  day-count into the hero's sr-only text would be exactly the duplication
  `docs/ROADMAP.md`'s Phase 2b checklist warns reviewers to scan for. Left
  alone; the existing hero label + progress card split is already correct.

What's left, and genuinely warranted: the four vitals tiles' missing-reading
placeholders and the sleep tile's confidence suffix. One task.

## Global Constraints

- **No new figures, no IA changes** — Phase 2's standing constraint.
- **No visual regression.** Every tile must render exactly the same `"—"`
  glyph, in the same place, with the same styling, as before. The only
  observable changes are: a `title` attribute on unavailable tiles, and a
  `<ConfidenceChip>` appearing next to the sleep delta only when its
  confidence is `"low"` (identical to today's `"· limited data"` suffix
  condition).
- **Do not nest a `<Unavailable>` fix-link inside `VitalsGrid`'s tiles.** Each
  tile is already a `<Link href={t.href}>` wrapping its entire contents;
  nesting another `<Link>` (which `<Unavailable>` renders for a `missing_input`
  fix) would produce invalid nested anchors. Use `unavailableMessage()` (the
  plain-string function from Task 2 of the previous plan) directly instead of
  the `<Unavailable>` component.
- **Confidence claims must be defensible, not invented.** HRV/RHR/Sleep/TSB are
  direct readings or arithmetic on direct readings (not modelled estimates),
  so `"high"` is used throughout — same reasoning `race/demand.ts` already
  uses for athlete-stated numbers. Do not invent a confidence tier that isn't
  backed by anything.
- Test convention: co-locate `<name>.test.ts(x)`; `renderToString` from
  `react-dom/server`, no jsdom. No guard-test addition this time — nothing
  here retires a rendered string (the `"—"` glyph is kept, not replaced), so
  there's no regression for a guard to catch.

---

### Task 1: Vitals grid → `Figure<string>`

**Files:**

- Modify: `src/components/today/vitals-grid.tsx`
- Test: `src/components/today/vitals-grid.test.tsx`
- Modify: `src/app/page.tsx`

**Interfaces:**

- Consumes: `Figure`, `Confidence` (type) from `@/lib/uncertainty`;
  `unavailableMessage` from `@/components/ui/unavailable`; `ConfidenceChip`
  from `@/components/ui/confidence-chip` (all shipped in v0.67.0).
- Produces: `VitalTile` with `value: Figure<string>` and
  `delta?: { text: string; tone: "good" | "warn" | "muted"; confidence?: Confidence } | null`.

- [ ] **Step 1: Write the failing test**

Create `src/components/today/vitals-grid.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { Figure } from "@/lib/uncertainty";
import { VitalsGrid, type VitalTile } from "./vitals-grid";

function tile(overrides: Partial<VitalTile>): VitalTile {
  return {
    label: "HRV",
    value: Figure.available("62", "high"),
    unit: "ms",
    sparkPath: "",
    sparkColor: "#10b981",
    href: "/body?tab=trends",
    ...overrides,
  };
}

describe("VitalsGrid", () => {
  it("renders an available value with its unit", () => {
    const html = renderToString(
      <VitalsGrid tiles={[tile({ value: Figure.available("62", "high") })]} />
    );
    expect(html).toContain("62");
    expect(html).toContain("ms");
  });

  it("renders a dash and a reason for a missing reading", () => {
    const html = renderToString(
      <VitalsGrid tiles={[tile({ value: Figure.missingInput("an HRV reading") })]} />
    );
    expect(html).toContain("—");
    expect(html).toContain("Needs an HRV reading");
  });

  it("still shows the unit next to a missing reading", () => {
    const html = renderToString(
      <VitalsGrid
        tiles={[tile({ value: Figure.missingInput("an HRV reading"), unit: "ms" })]}
      />
    );
    expect(html).toContain("ms");
  });

  it("renders a confidence chip on a low-confidence delta", () => {
    const html = renderToString(
      <VitalsGrid
        tiles={[
          tile({
            delta: { text: "0:45 tonight", tone: "warn", confidence: "low" },
          }),
        ]}
      />
    );
    expect(html).toContain("0:45 tonight");
    expect(html).toContain("Low confidence");
  });

  it("omits the confidence chip when the delta has no confidence set", () => {
    const html = renderToString(
      <VitalsGrid tiles={[tile({ delta: { text: "▲ 7d 58", tone: "good" } })]} />
    );
    expect(html).toContain("▲ 7d 58");
    expect(html).not.toContain("confidence");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/today/vitals-grid.test.tsx`
Expected: FAIL — `VitalTile`'s `value` is still typed `string`, and
`Figure`/`Figure.available`/`Figure.missingInput` aren't used by the
component yet, so the "reason"/confidence-chip assertions fail.

- [ ] **Step 3: Implement — `vitals-grid.tsx`**

Replace the file's contents with:

```tsx
import Link from "next/link";
import type { Confidence, Figure } from "@/lib/uncertainty";
import { ConfidenceChip } from "@/components/ui/confidence-chip";
import { unavailableMessage } from "@/components/ui/unavailable";

export interface VitalTile {
  label: string;
  /** The reading, or why it isn't available yet. */
  value: Figure<string>;
  unit?: string;
  delta?: {
    text: string;
    tone: "good" | "warn" | "muted";
    /** Set only when the delta itself carries below-high confidence. */
    confidence?: Confidence;
  } | null;
  /** "" → no line drawn (fewer than two real points). */
  sparkPath: string;
  sparkColor: string;
  href: string;
}

const TONE: Record<"good" | "warn" | "muted", string> = {
  good: "text-emerald-400",
  warn: "text-amber-400",
  muted: "text-white/45",
};

/**
 * Today's vitals — 2×2 on phones, one row of four at lg+ (3a). Replaces the
 * RecoveryMetricsAccordion here. Each
 * tile is a tap target into Body's matching trend. Values are Geist Mono;
 * calibrating tiles show "—" with no sparkline (never an invented value).
 */
export function VitalsGrid({ tiles }: { tiles: VitalTile[] }) {
  return (
    <div className="mb-6 grid grid-cols-2 gap-2 lg:grid-cols-4">
      {tiles.map((t) => (
        <Link
          key={t.label}
          href={t.href}
          className="flex items-center justify-between rounded-xl border border-white/[0.09] bg-white/[0.04] px-3 py-2.5 transition-colors hover:bg-white/[0.06]"
        >
          <div className="min-w-0">
            <div className="text-[9px] font-bold uppercase tracking-wider text-white/40">
              {t.label}
            </div>
            <div
              className="mt-0.5 font-mono text-[19px] font-bold leading-none text-white"
              title={!t.value.available ? unavailableMessage(t.value) : undefined}
            >
              {t.value.available ? t.value.value : "—"}
              {t.unit && (
                <span className="ml-0.5 text-[10px] font-normal text-white/40">
                  {t.unit}
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            {t.delta && (
              <span
                className={`flex items-center gap-1 text-[9.5px] font-semibold ${TONE[t.delta.tone]}`}
              >
                {t.delta.text}
                {t.delta.confidence && (
                  <ConfidenceChip level={t.delta.confidence} />
                )}
              </span>
            )}
            {t.sparkPath && (
              <svg
                aria-hidden
                width={42}
                height={14}
                viewBox="0 0 100 20"
                preserveAspectRatio="none"
                className="sparkline-animate"
              >
                <path
                  d={t.sparkPath}
                  fill="none"
                  stroke={t.sparkColor}
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            )}
          </div>
        </Link>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Implement — `src/app/page.tsx`**

Add to the existing import block (`src/app/page.tsx` already imports several
`@/lib/...` modules near its top — add this alongside them):

```tsx
import { Figure } from "@/lib/uncertainty";
```

Replace the `vitals` array (currently four objects with `value: latest?.X != null ? ... : "—"`) with:

```tsx
  const vitals: VitalTile[] = [
    {
      label: "HRV",
      value:
        latest?.hrvMs != null
          ? Figure.available(String(Math.round(latest.hrvMs)), "high")
          : Figure.missingInput("an HRV reading"),
      unit: "ms",
      delta:
        latest?.hrvMs != null && avg7hrv > 0
          ? {
              text: `${hrvGood ? "▲" : "▼"} 7d ${Math.round(avg7hrv)}`,
              tone: hrvGood ? "good" : "muted",
            }
          : null,
      sparkPath: hrvSparkPath,
      sparkColor: "#10b981",
      href: "/body?tab=trends",
    },
    {
      label: "RHR",
      value:
        latest?.restingHr != null
          ? Figure.available(String(Math.round(latest.restingHr)), "high")
          : Figure.missingInput("a resting-heart-rate reading"),
      unit: "bpm",
      delta:
        latest?.restingHr != null && avg7rhr > 0
          ? {
              text: `${rhrGood ? "▼" : "▲"} 7d ${Math.round(avg7rhr)}`,
              tone: rhrGood ? "good" : "muted",
            }
          : null,
      sparkPath: rhrSparkPath,
      sparkColor: "#10b981",
      href: "/body?tab=trends",
    },
    {
      label: "Sleep",
      value:
        sleepHours != null
          ? Figure.available(hoursToClock(sleepHours), "high")
          : Figure.missingInput("a sleep reading"),
      delta:
        sleepDebt.debtSecs != null && sleepDebt.debtSecs > 0
          ? {
              text: fmtSleepDebt(sleepDebt.debtSecs),
              tone: "warn",
              confidence: sleepDebt.confidence === "low" ? "low" : undefined,
            }
          : null,
      sparkPath: sleepSparkPath,
      sparkColor: "#3b82f6",
      href: "/body?tab=sleep",
    },
    {
      label: "Form · TSB",
      value:
        tsb != null
          ? Figure.available(fmtTsb(tsb), "high")
          : Figure.missingInput("training-load history"),
      delta:
        todayCtl != null
          ? { text: `CTL ${Math.round(todayCtl)}`, tone: "muted" }
          : null,
      sparkPath: formSparkPath,
      sparkColor: "#8b5cf6",
      href: "/body?tab=trends",
    },
  ];
```

Note what did **not** change: `hrvSparkPath`/`avg7hrv`/`hrvGood`/`sleepDebt`/
`todayCtl`/`fmtTsb`/`fmtSleepDebt` etc. are all computed exactly as before,
above this array — only the `value` field's construction and the sleep
delta's confidence changed.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/components/today/vitals-grid.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors. `src/app/page.tsx` is large — if the typecheck surfaces
an unrelated pre-existing error elsewhere in the file, do not fix it; report
it as a concern rather than expanding this task's scope.

- [ ] **Step 7: Manual sanity check**

This file is a server component with real data dependencies; the automated
test only covers `VitalsGrid` in isolation. Per `docs/BASELINE.md`'s
structural lesson #2 ("a test that constructs the props it asserts on cannot
detect that nothing constructs them in production"), confirm the wiring
holds: `grep -n "vitals" src/app/page.tsx` should show the `vitals` array
still passed into `<VitalsGrid tiles={vitals} />` (or equivalent) exactly
once, unchanged from before this task.

- [ ] **Step 8: Commit**

```bash
git add src/components/today/vitals-grid.tsx src/components/today/vitals-grid.test.tsx src/app/page.tsx
git commit -m "feat(uncertainty): migrate the vitals grid to Figure<string>"
```

---

### Task 2: Release housekeeping

**Files:**

- Modify: `package.json`
- Modify: `CHANGELOG.md`
- Modify: `docs/ROADMAP.md`

**Interfaces:** Consumes: the diff from Task 1. Produces: nothing importable.

- [ ] **Step 1: Bump the version**

In `package.json`, change `"version": "0.67.0"` to `"version": "0.68.0"`.

- [ ] **Step 2: Add the CHANGELOG entry**

Insert at the top of `CHANGELOG.md`, above the existing `## v0.67.0` entry:

```markdown
## v0.68.0 — 2026-08-09 — Uncertainty vocabulary (vitals grid)

The second slice of Phase 2b.3: Today's vitals grid (HRV, RHR, Sleep,
Form · TSB) migrated to the `Figure<T>` vocabulary v0.67.0 shipped.

- `VitalTile.value` is now `Figure<string>` instead of a pre-formatted
  string; each tile still shows the same `"—"` it always has when a reading
  is missing, now backed by a typed reason surfaced as a `title` attribute
  instead of just a bare glyph.
- The sleep tile's low-confidence suffix (`"· limited data"`) is now a
  `<ConfidenceChip>` in the delta row instead of a string concatenation.
- No visual regression: same glyph, same layout, same conditions for when
  the confidence chip appears.
- Investigated three more sites in the same surface and left them alone,
  each for a documented reason (see
  `docs/plans/2026-08-09-uncertainty-vocabulary-vitals.md`): a milestones
  count where `"—"` means zero, not unknown; a form slider's own input
  state; and the Today hero's calibrating state, which already avoids
  duplicating the adjacent calibration-progress card.
- Found 5 more confirmed-dead components while verifying this surface
  (`hero-readiness.tsx`, `readiness-rings.tsx`, `race-countdown.tsx`'s
  component body, `recent-sessions-accordion.tsx`, dashboard's
  `vitals-grid.tsx`) — not touched here; tracked for Phase 2b.2's cleanup.
```

- [ ] **Step 3: Update the roadmap**

In `docs/ROADMAP.md`, find the 2b.3 bullet's inline status note (added in
v0.67.0) and extend it. Change:

```markdown
      **v0.67.0** shipped `src/lib/uncertainty.ts`, its rendering primitives,
      and migrated the first surface (90-day correlations). Five dialects
      and roughly 20 other call sites remain — backlog in
      `docs/plans/2026-08-08-uncertainty-vocabulary.md`.
```

to:

```markdown
      **v0.67.0** shipped `src/lib/uncertainty.ts`, its rendering primitives,
      and migrated the first surface (90-day correlations). **v0.68.0**
      migrated the Today vitals grid. Four dialects and roughly 15 other
      call sites remain — backlog in
      `docs/plans/2026-08-08-uncertainty-vocabulary.md`, with corrections in
      `docs/plans/2026-08-09-uncertainty-vocabulary-vitals.md` (5 more
      confirmed-dead components found; 3 sites investigated and excluded).
```

Also update the 2b.2 bullet's orphan note — read the current exact text
first (`docs/ROADMAP.md`, the bullet starting `- [ ] **2b.2 — Settle the
IA.**`), since it may have drifted since this plan was written. The line to
extend currently reads:

```markdown
      orphaned components, and make the directory tree match. Six of the twelve
      sit in `dashboard/`, the rest in `plan/`, `log/`, `journal/` — all
      superseded by `today/`, `body/`, `train/`. With PR #86's seven
      sleep-cards that is 19 orphans from one unfinished migration.
```

Append a new sentence after "19 orphans from one unfinished migration." (same
paragraph, do not renumber the 19 — it isn't verified whether these overlap
with that count):

```markdown
      orphaned components, and make the directory tree match. Six of the twelve
      sit in `dashboard/`, the rest in `plan/`, `log/`, `journal/` — all
      superseded by `today/`, `body/`, `train/`. With PR #86's seven
      sleep-cards that is 19 orphans from one unfinished migration.
      **Independently reconfirmed dead** while migrating other surfaces (not
      necessarily additional to the 19 — overlap unverified):
      `journal/correlation-insights.tsx`, `dashboard/hero-readiness.tsx`,
      `dashboard/readiness-rings.tsx`, `dashboard/race-countdown.tsx`
      (component body only — its `RaceCountdownProps` type stays live),
      `dashboard/recent-sessions-accordion.tsx`, `dashboard/vitals-grid.tsx`.
```

- [ ] **Step 4: Run the full local gate**

```bash
npm run typecheck && npm run lint && npm run format:check && npm test && npm run build
```

Expected: all green. If `format:check` fails on files this plan's tasks
touched, run `npm run format` and re-verify — do not hand-fix formatting.

- [ ] **Step 5: Commit**

```bash
git add package.json CHANGELOG.md docs/ROADMAP.md
git commit -m "chore(release): v0.68.0 — uncertainty vocabulary, vitals grid"
```

Do **not** merge, tag, or push — leave that decision to whoever requested
this plan, per `docs/RELEASING.md`.
