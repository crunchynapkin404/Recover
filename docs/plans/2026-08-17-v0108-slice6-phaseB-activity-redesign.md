# v0.108.0 — slice 6 phase B, the Activity redesign — implementation plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking.
> Execute task-by-task, committing at the end of each.

**Goal:** Migrate the six Activity surfaces' 102 remaining class sites onto the
v0.99 type/ink/surface tokens, and turn `activity-detail`'s 240 _indeterminate_
axe nodes into computable ones.

**Architecture:** Three moves, in dependency order. (1) Extend the contrast
guard so the mesh-gradient composite — not just the flat surface tokens — is a
proven backdrop, which is what makes the header's un-carded text defensible.
(2) Swap every translucent `bg-white/[0.0N]` card for an **opaque**
`bg-surface-raised`, which is what makes axe able to compute a ratio at all.
(3) Migrate type, ink and accent utilities to tokens file by file.

**Tech Stack:** Next.js 15 App Router · Tailwind v4 (`@theme inline`) ·
vitest · Playwright-driven `scripts/verify-surfaces.ts` + axe-core.

**Spec:** `docs/plans/2026-08-17-v0108-slice6-phaseB-HANDOFF.md` (inherited
context) and `docs/v0.99-redesign-handoff.md` (the per-slice recipe).
**Both contain errors corrected below — this plan's measurements supersede
them.**

## Global Constraints

- **12px is a hard floor.** `--text-label` (12px) is the smallest type that
  exists. Nothing may be smaller, in any unit.
- Type scale, exact: `text-label` 12 · `text-caption` 14 · `text-body` 16 ·
  `text-title` 20 · `text-heading` 24 · `text-figure` 30 · `text-hero` 44.
- Ink ramp, exact: `text-ink-primary` · `text-ink-secondary` ·
  `text-ink-muted` (**the floor for text**) · `border-hairline`
  (**never text**).
- Surfaces: `bg-surface-base` · `bg-surface-raised` · `bg-surface-overlay` ·
  `bg-surface-selected`. All four are **opaque** in both themes.
- Accent: `bg-accent` + `text-accent-foreground`. Never `bg-emerald-500` with
  `text-black` — that is correct in dark only (`--accent-foreground` is
  `#ffffff` on `#047857` in light, `#000000` on `#10b981` in dark).
- **Do not touch `.glass`, `.label-micro`, or `.mesh-gradient` definitions.**
  They are shared by ~20 files across surfaces this slice does not own.
  `.glass`'s translucency is a slice 9 sweep concern.
- **Do not lift `forcedTheme="dark"`.** That is slice 9, in one commit.
- Both `it.fails` ratchets in `tests/type-scale-guard.test.ts` must be re-pinned
  tight at the end (`RATCHET_SLACK` is 25 and the ratchet is two-sided).

---

## Corrections to the handoff, measured 2026-08-17

Measured with the guard's **own exported patterns**
(`src/lib/design/type-scale-patterns.ts`) over the guard's own file filter
(`src/**/*.{ts,tsx}`, excluding `*.test.*`). Reproduce with
`npx vitest run tests/type-scale-guard.test.ts`.

| Class                                | Handoff | **Real** | Verdict                    |
| ------------------------------------ | ------: | -------: | -------------------------- |
| arbitrary type (`ARBITRARY_TYPE`)    |      27 |   **27** | correct                    |
| ad-hoc ink (`ADHOC_INK`)             |      54 |   **54** | correct                    |
| default scale (`text-xs`/`text-2xl`) |      13 |   **13** | correct                    |
| bare `text-white`/`text-black`       |      50 |    **8** | **wrong — 6× overcounted** |
| **total class-site edits**           |    ~144 |  **102** |                            |

The handoff's per-file "bare white" column double-counts the alpha sites
already in its own ad-hoc-ink column. The **warning** it attaches to that
column is still correct and still matters: no guard matches bare
`text-white`, so those 8 sites are invisible to `tests/type-scale-guard.test.ts`
and to any grep that only copies `ADHOC_INK`. Use
`\b(text|bg|border|fill|stroke|ring|divide)-(white|black)\b(?!/)`.

The 8 bare sites, in full — there is no need to re-derive them:

| File                    | Line | Class                               |
| ----------------------- | ---: | ----------------------------------- |
| `debrief-sheet.tsx`     |  106 | `text-black` (RPE pill, selected)   |
| `debrief-sheet.tsx`     |  145 | `text-white` (note input)           |
| `debrief-sheet.tsx`     |  179 | `text-black` (Save button)          |
| `activity-log-form.tsx` |   22 | `text-white` (`INPUT_CLS`)          |
| `activity-log-form.tsx` |   63 | `text-white` (sport pill, selected) |
| `activity-log-form.tsx` |  246 | `text-black` (Log Activity button)  |
| `page.tsx`              |  121 | `text-white` (metric tile value)    |
| `laps-table.tsx`        |   33 | `text-white` (non-recovery lap row) |

**Five hardcoded chart colour literals the handoff's table omits entirely**
live in `page.tsx:142,150,158,167,170`. Four are exact duplicates of
`CHART_TOKENS.series` entries in `src/lib/charts.ts` and collapse to
references (Task 3).

**Arbitrary-size distribution — the handoff is exactly right here.** 20 of 27
sit below the floor: 6 × `[11px]`, 5 × `[11.5px]`, 3 × `[9.5px]`, 2 × `[10px]`,
2 × `[10.5px]`, 1 × `[9px]`, 1 × `[8.5px]`. The remaining 7: 2 × `[13px]`,
2 × `[12px]`, 1 × `[21px]`, 1 × `[14px]`, 1 × `[12.5px]`.

Target mapping: **≤12.5px → `text-label`** (23 sites) · **13–14px →
`text-caption`** (3) · **21px → `text-title`** (1).

---

## Why `activity-detail` reports 0 confirmed and 240 indeterminate

Not a property of the page's own colours. `AppShell`
(`src/components/app-shell.tsx:32-36`) wraps every authenticated surface in:

```tsx
<div className="mesh-gradient relative min-h-svh …">
  <div className="pointer-events-none fixed inset-0 z-0">
    <div className="… bg-emerald-500/5 blur-[120px]" />
    <div className="… bg-blue-500/5 blur-[120px]" />
```

`.mesh-gradient` (`globals.css:473-483`) is two 8% radial blooms over a final
`var(--surface-base)` stop. axe's `color-contrast` rule cannot resolve a
**non-uniform** backdrop, so it returns `contrastRatio: 0` and files the node
under `incomplete`, never `violations`. That is why the number is 0 — the rule
never ran, it did not pass.

Two populations, two different fixes:

- **Text inside a translucent card** (`bg-white/[0.03]`, `bg-white/[0.04]`,
  `bg-white/[0.06]`) — the metric tiles, laps table, stream charts, debrief
  section, the sheet's metric chip. Translucent means axe still sees the
  gradient through it. **Swapping to opaque `bg-surface-raised` makes these
  computable.** This is the bulk of the 240 and it is fixed as a side effect of
  the normal token migration.
- **Text sitting directly on the gradient** — the `<h1>`, the breadcrumb, the
  `sport · date · provider` line. No card, so no opaque backdrop exists to
  give them. Wrapping them in a card would be a visual redesign this slice has
  not been asked for.

Task 1 handles the second population by **proving** the inks clear 4.5:1
against the gradient's worst-case composite, rather than leaving it asserted in
prose. That converts an unverifiable indeterminate into a guarded fact and
follows the project's own stated preference for guards that _derive_ from the
code over prose that asserts what the code does.

---

## File Structure

| File                                                  | Responsibility this slice                                                  |
| ----------------------------------------------------- | -------------------------------------------------------------------------- |
| `tests/contrast-guard.test.ts`                        | **modify** — add mesh-gradient composite worst-case assertions             |
| `src/lib/design/mesh-composite.ts`                    | **create** — derive the gradient's worst-case composite from `globals.css` |
| `src/components/activity/stream-chart.tsx`            | opaque card, tokens                                                        |
| `src/components/activity/laps-table.tsx`              | opaque card, tokens, column widths for 12px                                |
| `src/app/activity/[id]/page.tsx`                      | header ink, opaque tiles, chart colours → `CHART_TOKENS`                   |
| `src/components/debrief/activity-debrief-section.tsx` | tokens                                                                     |
| `src/components/debrief/debrief-sheet.tsx`            | tokens, accent buttons (**shared with Today**)                             |
| `src/components/activity/activity-log-form.tsx`       | tokens, default scale, accent button                                       |
| `src/components/activity/delete-activity-button.tsx`  | one ink token                                                              |
| `scripts/verify-surfaces.ts`                          | `captureResolved` helper; stale `(5435)` comment                           |
| `tests/type-scale-guard.test.ts`                      | re-pin both ceilings                                                       |

---

### Task 1: Prove the mesh gradient as a contrast backdrop

The load-bearing task. Everything after it is mechanical.

**Files:**

- Create: `src/lib/design/mesh-composite.ts`
- Modify: `tests/contrast-guard.test.ts`

**Interfaces:**

- Produces: `compositeMeshWorstCase(css: string, theme: "light" | "dark"):
{ r: number; g: number; b: number }` — the darkest-in-light /
  lightest-in-dark composite an ink can land on, derived by alpha-compositing
  every `.mesh-gradient` radial stop and both `AppShell` blob layers over
  `--surface-base`.

- [ ] **Step 1: Write the failing test**

In `tests/contrast-guard.test.ts`:

```ts
import { compositeMeshWorstCase } from "@/lib/design/mesh-composite";

describe("mesh-gradient composite as a text backdrop", () => {
  // activity-detail's <h1>, breadcrumb and provenance line sit on the
  // gradient with no card behind them. axe files them as indeterminate
  // (contrastRatio 0) because the backdrop is non-uniform — the rule never
  // runs. It is asserted here instead, against the worst composite the
  // gradient can produce, so "indeterminate" stops meaning "unknown".
  for (const theme of ["light", "dark"] as const) {
    const ground = compositeMeshWorstCase(GLOBALS_CSS, theme);
    for (const ink of ["ink-primary", "ink-secondary", "ink-muted"]) {
      it(`${ink} clears 4.5:1 over the mesh composite in ${theme}`, () => {
        expect(
          contrastRatio(tokenValue(theme, ink), ground)
        ).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/contrast-guard.test.ts`
Expected: FAIL — `Cannot find module '@/lib/design/mesh-composite'`.

- [ ] **Step 3: Implement `mesh-composite.ts`**

Parse `.mesh-gradient`'s `background` declaration and `AppShell`'s two blob
utilities out of the source rather than hardcoding them, so the guard cannot
drift from the code it describes. Alpha-composite each layer over
`--surface-base` with `out = src·α + dst·(1−α)`, and return the extreme.

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run tests/contrast-guard.test.ts`
Expected: PASS.

**If any ink fails**, that is a real defect, not a test bug — record the
measured ratio and treat raising that ink to clear it as part of this slice.

- [ ] **Step 5: Commit**

```bash
git add src/lib/design/mesh-composite.ts tests/contrast-guard.test.ts
git commit -m "test(contrast): prove the mesh gradient as a text backdrop"
```

---

### Task 2: `stream-chart.tsx` and `laps-table.tsx`

Smallest two files; they establish the opaque-card pattern the rest copy.

**Files:**

- Modify: `src/components/activity/stream-chart.tsx:48,51,52`
- Modify: `src/components/activity/laps-table.tsx:13,14,17,26,33,35`

- [ ] **Step 1: `stream-chart.tsx` — card and labels**

```tsx
// was: rounded-[18px] border border-white/[0.08] bg-white/[0.03] p-4
className="rounded-[18px] border border-hairline bg-surface-raised p-4"
// was: text-[11px] font-bold
<h3 className="text-label font-bold">{label}</h3>
// was: text-[9.5px] font-bold uppercase tracking-[0.15em] text-white/40
<span className="text-label font-bold uppercase tracking-[0.15em] text-ink-muted">
```

- [ ] **Step 2: `laps-table.tsx` — card, header row, body**

The header row goes 9px → 12px, a **33% widening** on six columns inside
`min-w-[300px]`. Drop `tracking-[0.15em]` on that row — at 12px the uppercase
treatment reads as a label without it, and the tracking is what overflows the
fixed `w-10`/`w-11`/`w-12` columns. Widen the numeric columns one step.

```tsx
<div className="overflow-x-auto rounded-[18px] border border-hairline bg-surface-raised p-4">
  <h3 className="mb-2 text-label font-bold">Laps &amp; intervals</h3>
  <table className="w-full min-w-[340px] text-left">
    <thead>
      <tr className="text-label font-bold uppercase text-ink-muted">
        <th className="w-[22px] py-1.5">#</th>
        <th className="py-1.5">Label</th>
        <th className="w-14 py-1.5 text-right">Time</th>
        <th className="w-14 py-1.5 text-right">Dist</th>
        <th className="w-12 py-1.5 text-right">HR</th>
        <th className="w-16 py-1.5 text-right">Power</th>
```

Body: `font-mono text-[10.5px]` → `font-mono text-label`; the row ternary
`text-white/75` / `text-white` → `text-ink-secondary` / `text-ink-primary`;
`text-white/35` on the index cell → `text-ink-muted` (`/35` is below the text
floor and has no token — it must come up to the floor, not stay).

- [ ] **Step 3: Verify the guard patterns no longer match either file**

```bash
grep -nE 'text-\[[^]]*(px|rem|em)\]|\b(text|bg|border|fill|stroke|ring|divide)-(white|black)(\b(?!/)|/)' \
  src/components/activity/stream-chart.tsx src/components/activity/laps-table.tsx
```

Expected: no output.

- [ ] **Step 4: Typecheck and commit**

```bash
npx tsc --noEmit && npx vitest run tests/type-scale-guard.test.ts
git add src/components/activity/stream-chart.tsx src/components/activity/laps-table.tsx
git commit -m "feat(activity): migrate stream chart and laps table to tokens"
```

---

### Task 3: `app/activity/[id]/page.tsx`

**Files:** Modify `src/app/activity/[id]/page.tsx:84,89,97,119,121,124,129,142,150,158,167,170`

- [ ] **Step 1: Header — breadcrumb, title, provenance**

These three are the un-carded text Task 1 proved. Migrate ink to tokens; the
title is the one `text-title` in the slice.

```tsx
// breadcrumb — was text-[10px] … text-white/50 hover:text-white/80
className="mb-3 inline-flex items-center gap-1.5 text-label font-bold uppercase tracking-[0.15em] text-ink-secondary transition-colors hover:text-ink-primary"
// title — was text-[21px]
<h1 className="text-title font-bold tracking-[-0.03em]">
// provenance — was text-[9.5px] … text-white/40
<p className="mt-1 text-label font-bold uppercase tracking-[0.15em] text-ink-muted">
```

- [ ] **Step 2: Metric tiles — opaque, and the 8.5px label**

`text-[8.5px]` → `text-label` is a **41% widening**, the largest in the slice,
on labels inside a `grid-cols-3` tile. "Avg Power" is the longest. Drop
`tracking-[0.15em]` here for the same reason as the laps header.

```tsx
<div className="rounded-[14px] border border-hairline bg-surface-raised px-3 py-2.5">
  <p className="font-mono text-caption font-bold leading-none text-ink-primary">
    {s.value}
    {s.unit && (
      <span className="ml-0.5 text-label font-medium text-ink-muted">{s.unit}</span>
    )}
  </p>
  <p className="mt-1.5 text-label font-bold uppercase text-ink-muted">{s.label}</p>
```

**Check this one in the screenshot at 390px.** If "Avg Power" still wraps, the
editorial cut is to shorten the label to "Power" — the tile already sits beside
"Avg HR", so the average is unambiguous from context.

- [ ] **Step 3: Chart colours → `CHART_TOKENS`**

Four of the five literals are already in `CHART_TOKENS.series`
(`src/lib/charts.ts:21-33`) with matching semantic comments. Import and
reference by index; add a named export so the indices are not magic numbers:

```ts
// src/lib/charts.ts — alongside CHART_TOKENS
export const STREAM_COLORS = {
  heartrate: CHART_TOKENS.series[5], // #f87171 red-400
  power: CHART_TOKENS.series[6], // #a78bfa violet-400
  pace: CHART_TOKENS.series[7], // #22d3ee cyan-400
  elevation: CHART_TOKENS.series[2], // #34d399 emerald-400
} as const;
```

`fill="rgba(52,211,153,0.15)"` is `#34d399` at 15% — express it from the same
constant rather than restating the channels.

- [ ] **Step 4: Typecheck, guard, commit**

```bash
npx tsc --noEmit && npx vitest run tests/type-scale-guard.test.ts
git add src/app/activity/\[id\]/page.tsx src/lib/charts.ts
git commit -m "feat(activity): migrate the detail page to tokens and chart constants"
```

---

### Task 4: `activity-debrief-section.tsx`

**Files:** Modify `src/components/debrief/activity-debrief-section.tsx:70,74,81,86,88,93`

- [ ] **Step 1: Migrate**

The card keeps its emerald tint (it is a semantic state, not a surface), but
its text moves to tokens. `text-white/40` on the `<h3>` and on the
"not generated yet" line are both below the text floor.

```tsx
<h3 className="text-label font-bold uppercase tracking-[0.15em] text-ink-muted">
<span className="text-label font-bold text-emerald-400">   {/* answer */}
<p className="mt-2 text-label italic leading-snug text-ink-secondary">
<div className="mt-3 border-t border-hairline pt-3">
<p className="whitespace-pre-wrap text-label leading-[1.55] text-ink-secondary">
<p className="text-label text-ink-muted">
```

- [ ] **Step 2: Typecheck, guard, commit**

```bash
npx tsc --noEmit && npx vitest run tests/type-scale-guard.test.ts
git add src/components/debrief/activity-debrief-section.tsx
git commit -m "feat(debrief): migrate the activity debrief section to tokens"
```

---

### Task 5: `debrief-sheet.tsx` — shared with Today

**Files:** Modify `src/components/debrief/debrief-sheet.tsx` (11 arbitrary, 17
ink, 3 bare)

**This file renders on Today too** (`src/components/today/sheet-host.tsx`).
Slice 1 signed Today off as clean in v0.100.0; this task moves it.
**Re-measure Today in Task 9 — do not assume.**

- [ ] **Step 1: Migrate type and ink**

Every `text-[11px]` / `text-[11.5px]` / `text-[12px]` / `text-[12.5px]` →
`text-label`; `text-[13px]` → `text-caption`. `text-white/50`, `/70`, `/40`,
`/60`, `/35` → the ink ramp (`/35` and `/40` are below the floor → `ink-muted`).
Card chips `border-white/[0.08] bg-white/[0.03]` → `border-hairline
bg-surface-raised`; unselected pills `bg-white/[0.06] text-white/60` →
`bg-surface-selected text-ink-secondary`.

- [ ] **Step 2: The three accent buttons**

```tsx
// RPE pill selected — was bg-emerald-500 text-black
? "bg-accent text-accent-foreground"
// Save — was bg-emerald-500 … text-black
className="flex-1 rounded-full bg-accent py-3 text-caption font-bold text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
// Skip — was border-white/10 bg-white/5 … text-white/70
className="rounded-full border border-hairline bg-surface-raised px-6 py-3 text-caption font-semibold text-ink-secondary disabled:opacity-50"
```

The note input's bare `text-white` → `text-ink-primary`, and
`placeholder:text-white/35` → `placeholder:text-ink-muted`.

- [ ] **Step 3: Run the sheet's existing tests**

```bash
npx vitest run tests/debrief
```

Expected: PASS. `tests/seed-demo-activity-streams.test.ts` locks the invariant
that the pending debrief and the streamed activity are different rows — do not
disturb it.

- [ ] **Step 4: Typecheck, guard, commit**

```bash
npx tsc --noEmit && npx vitest run tests/type-scale-guard.test.ts
git add src/components/debrief/debrief-sheet.tsx
git commit -m "feat(debrief): migrate the debrief sheet to tokens"
```

---

### Task 6: `activity-log-form.tsx` and `delete-activity-button.tsx`

**Files:**

- Modify: `src/components/activity/activity-log-form.tsx` (15 ink, 13 default
  scale, 3 bare)
- Modify: `src/components/activity/delete-activity-button.tsx:31`

This file holds all 13 default-scale sites — `text-2xl` on the heading,
`text-xs` on nine field labels, `text-sm` on the inputs, pills and status row.

- [ ] **Step 1: Migrate**

```tsx
// heading — was text-2xl
<h2 className="text-heading font-bold tracking-tighter">Log Activity</h2>
// sub — was text-xs text-white/50
<p className="mt-1 text-label text-ink-secondary">
// INPUT_CLS — was border-white/10 bg-white/5 … text-sm text-white … placeholder:text-white/30
const INPUT_CLS =
  "w-full rounded-xl border border-hairline bg-surface-raised px-3 py-2 text-caption text-ink-primary outline-none placeholder:text-ink-muted focus:border-accent";
// nine field labels — was text-xs font-medium text-white/60
className="mb-1 block text-label font-medium text-ink-secondary"
// sport pill — was … text-white / bg-white/5 text-white/60 hover:bg-white/10
selectedSport === s.label
  ? "bg-accent/20 ring-2 ring-accent text-ink-primary"
  : "bg-surface-selected text-ink-secondary hover:bg-surface-overlay"
// submit — was bg-emerald-500 … text-black … hover:bg-emerald-400
className="flex w-full items-center justify-center gap-2 rounded-2xl bg-accent px-6 py-3 font-bold text-accent-foreground transition-all hover:opacity-90 disabled:opacity-50"
```

`delete-activity-button.tsx:31`: `text-white/40` → `text-ink-muted`.

- [ ] **Step 2: Typecheck, guard, commit**

```bash
npx tsc --noEmit && npx vitest run tests/type-scale-guard.test.ts
git add src/components/activity/activity-log-form.tsx src/components/activity/delete-activity-button.tsx
git commit -m "feat(activity): migrate the manual log form to tokens"
```

---

### Task 7: Collapse the three resolve/capture blocks (inherited debt)

**Files:** Modify `scripts/verify-surfaces.ts`

The handoff asks for this and says slices 7–9 will add more call sites.
`coach-thread`, `activity-detail` and `debrief-sheet` each carry a
near-identical resolve / capture / catch / record block, ~90 lines total.

- [ ] **Step 1: Extract `captureResolved(name, resolvePath)`**

One helper taking the surface name and its resolver, doing the capture,
catch and record identically for all three.

- [ ] **Step 2: Fix the stale comment at `scripts/verify-surfaces.ts:1141`**

It says "Run `scripts/seed-demo.ts` against the dev DB (**5435**) first."
**5435 is the restore-only soak stack** (`recover-rc-db-1`). The dev DB is
**5434** (`recover-db-1`), which is what `.env` names. Following that comment
seeds the wrong database. Correct it to 5434.

- [ ] **Step 3: Commit**

```bash
git add scripts/verify-surfaces.ts
git commit -m "refactor(verify): collapse three resolve/capture blocks into one helper"
```

---

### Task 8: Re-pin the ratchets and clear inherited debt

**Files:** Modify `tests/type-scale-guard.test.ts`,
`src/components/settings/notifications-card.tsx:155`,
`src/components/settings/body-prefs-card.tsx:145`

- [ ] **Step 1: Re-pin both ceilings**

Projected from this plan's measurements — **confirm against the suite's own
reported figure, do not paste these blind**:

| Ceiling                                | Was | Expected after |
| -------------------------------------- | --: | -------------: |
| `"arbitrary type sizes"`               |  52 |         **25** |
| `"ad-hoc white/black alpha utilities"` | 127 |         **73** |

Both gaps (27 and 54) exceed `RATCHET_SLACK` (25), so re-pinning is **forced**,
not optional. Write the per-file arithmetic into the comment above each
ceiling, matching the established style.

- [ ] **Step 2: Fix the two knowingly-false comments**

Both claim the accent swap is "byte-identical" to `bg-emerald-500`. Tailwind v4
ships that as `oklch(69.6% 0.17 162.48)` against `--accent`'s `#10b981` —
visually indistinguishable, **not** identical. One line each.

- [ ] **Step 3: Full suite, then commit**

```bash
npx vitest run
```

**Do not source `.env` first** — with it sourced, vitest writes real rows to
the dev database and leaves `*@example.invalid` users behind.

```bash
git add tests/type-scale-guard.test.ts src/components/settings/notifications-card.tsx src/components/settings/body-prefs-card.tsx
git commit -m "test(guard): re-pin both ratchets after the Activity migration"
```

---

### Task 9: Capture, audit, and **open the PNGs**

- [ ] **Step 1: Start a dev server on a free port**

**Port 3100 is occupied** by `recover-rc-app-1`, the v0.106.0-rc.1 soak stack.
The recipe in `docs/v0.99-redesign-handoff.md` and
`scripts/verify-surfaces.ts:198` both still say 3100 — following them either
fails to bind or, worse, silently captures **the RC container instead of your
code**. Use 3200, and set `TRUSTED_ORIGINS` or Better Auth refuses every login.

```bash
BETTER_AUTH_URL=http://localhost:3200 TRUSTED_ORIGINS=http://localhost:3200 \
  npx next dev -p 3200
```

- [ ] **Step 2: Seed, then capture**

Seed against **5434**. Export `DATABASE_URL` _after_ any `. ./.env`, never
before — sourcing overwrites it.

```bash
SCREENSHOT_BASE_URL=http://localhost:3200 \
OWNER_EMAIL=demo@recover.local OWNER_PASSWORD=recover-demo \
CHROME_PATH=$HOME/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell \
LD_LIBRARY_PATH=$HOME/.cache/chromium-sysdeps/root/usr/lib/x86_64-linux-gnu:$HOME/.cache/chromium-sysdeps/root/lib/x86_64-linux-gnu \
npx tsx scripts/verify-surfaces.ts slice6b
```

Every run captures **every** surface (~30–45 min); the argument is the output
directory, not a filter. A non-zero exit is expected while `admin` carries its
debt. To wait on it, use `pgrep -fa "tsx.*verify-surfaces\.ts"` — never
`pgrep -f "verify-surfaces"`, which matches the watcher itself and never exits.

- [ ] **Step 3: Count nodes, not rules, and assert nothing was skipped**

`confirmed` is a list of **rule** objects each holding its own `nodes` array.
`len(confirmed)` counts rules and under-reports badly — it once reported
`admin` as 4 when the truth was 208, and that number reached a shipped
CHANGELOG. A skipped combo has no `confirmed` key, scores 0, and is
indistinguishable from a clean pass.

Required, for all 4 theme/viewport combos of each surface:

| Surface                                          |        Baseline confirmed |                                      Target |
| ------------------------------------------------ | ------------------------: | ------------------------------------------: |
| `activity-log`                                   |                        46 |                                           0 |
| `activity-detail`                                | 0 (**240 indeterminate**) | 0 confirmed **and indeterminate well down** |
| `debrief-sheet`                                  |                        43 |                                           0 |
| `today` + `today-evening` + `today-post-session` |                re-measure |                               no regression |

- [ ] **Step 4: Open the screenshots**

Not optional, and not satisfied by the run emitting files. Every slice that ran
this step found something axe could not see: a near-invisible sync label on a
gradient, day labels colliding into "MOTUWETHFRSASU" once the floor widened
them, a `DISCONNECT` pill clipped off-screen behind a clean `confirmed: 0`.

This slice's specific suspects, all created by the 23-site collapse onto 12px:
the metric-tile labels at 390px ("Avg Power"), the laps header row's six
columns, and the RPE pills' `size-[29px]` circles now holding 12px digits.

---

### Task 10: Whole-branch review, then release

- [ ] **Step 1: Whole-branch review on the most capable model**

Non-negotiable, per both handoffs. Twenty-four commits of per-task review once
missed all five Criticals a single whole-branch review then caught — every one
a seam or scope question invisible from inside one task.

- [ ] **Step 2: Release**

Version bump, CHANGELOG written **from the diff**, roadmap updated (**do not
tick 2b.4 — it closes at slice 9, not here**), then
`./scripts/release.sh 0.108.0 <pr>`.

**Blocked for an agent in auto mode as of 2026-08-17:** `gh pr merge` is
refused by the permission classifier. `scripts/release.sh:13-17` asserts that
limit "was re-tested on 2026-08-12 and is dead" — it is **not**; it is back.
A human must run the merge, or grant a Bash permission rule. Update that
comment with the re-test date rather than leaving the stale claim standing.

---

## Outstanding, carried forward

- **7 `*@example.invalid` users on the dev DB (5434)** still need clearing; the
  classifier blocks the DELETE for an agent.
  ```bash
  docker exec recover-db-1 psql -U recover -d recover \
    -c "delete from users where email like '%@example.invalid';"
  ```
- `src/components/ui/inline-markdown.tsx:31`'s `text-[0.95em]` — relative em,
  no fixed-step equivalent, deliberately left since slice 4.
- Today's light-only `text-white` readiness sentence — 2 nodes per state, 6
  total, for the slice 9 sweep.
- `admin` is 182–208 confirmed depending on data state, against the 147 its
  baseline records. Slice 7 must re-measure rather than trust either number.
- `.glass` is still translucent and still defeats `color-contrast` on every
  surface that uses it (~20 files). Slice 9.
