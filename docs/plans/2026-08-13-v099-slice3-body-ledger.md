# v0.99 slice 3 (Body) — execution ledger

**Tracked companion to `docs/plans/2026-08-13-v099-slice3-body.md`.** The plan says
what was intended; this says what happened. Modelled on
`docs/plans/2026-08-12-v099-slice2-train-ledger.md`, the same pattern this slice
follows. Created by Task 11 — no earlier Body task had started one, so this
backfills Tasks 1–10 from the guard's own re-pin comments and the commit log before
recording Task 11 itself.

Branch: `v0.102-body-at-the-floor`, off `main` at `cd97153` (the v0.101.1 Train
merge — Train's whole-branch-review-2 patch, which fixed the `sidebar-nav.tsx` /
`empty-state.tsx` sweep miss, is therefore already inherited by this slice).

---

## Ratchet history

`OFFENDER_CEILINGS` in `tests/type-scale-guard.test.ts`. Both numbers are read from
the guard's own failure message, never hand-counted, and may only go **down**. This
ratchet is app-wide (`src/**/*.tsx`), not Body-only, so the starting values below are
what Train's slice left behind.

| After                            | Arbitrary type sizes | Ad-hoc ink alphas   |
| -------------------------------- | -------------------- | ------------------- |
| slice start (v0.101.1)           | 212                  | 469                 |
| Task 2 (page chrome, tabs)       | 208                  | 461                 |
| Task 3 (baseline-trend-card)     | 204                  | 455                 |
| Task 4 (Sleep tab)               | 190                  | 428                 |
| Task 5 (body-battery)            | 185                  | 414                 |
| Task 6 (journal header/streak)   | 179                  | 403                 |
| Task 7 (journal rest)            | 169                  | 377                 |
| Task 8 (correlations/milestones) | 163                  | 366                 |
| Task 9 (Labs readouts)           | 150                  | 346                 |
| Task 10 (health entry forms)     | 137                  | 311                 |
| Task 11 (the sweep)              | **137 (unchanged)**  | **311 (unchanged)** |

Task 11 found `TOTAL 0 0` on its own sweep grep before touching anything — Tasks
1–10 genuinely left zero offenders in the two ratcheted patterns across the full
Body surface (`src/app/body/page.tsx`, `src/components/body/*.tsx`,
`src/components/app-shell.tsx`, `src/components/bottom-nav.tsx`,
`src/components/sidebar-nav.tsx`, `src/components/ui/empty-state.tsx`,
`src/components/ui/collapsible.tsx`). Two more unguarded literals outside both
regex patterns were still found and fixed in Task 11's own commit — see "What Task
11's sweep found" below — but neither one is a `text-[Npx]` or a `white`/`black`
alpha utility, so neither moves either ceiling.

## Task status

| Task                        | Commits              | What it did                                                                                                                                     |
| --------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — capture harness         | `097d644`            | Added capture for Sleep, Journal and Labs tabs, none of which any earlier verification run had ever seen                                        |
| 2 — page chrome             | `e580289`            | `page.tsx`'s header (h1, streak chip) plus two new components, `body-tabs.tsx` and `range-tabs.tsx`                                             |
| 3 — Trends cards            | `12b33dd`, `2b00565` | `baseline-trend-card.tsx` — one `tone` prop replacing two raw hex-string props (`color`/`bandFill`), resolved through `trend-tone.ts`           |
| 4 — Sleep tab               | `a9372b9`            | `sleep-night-card.tsx`, `sleep-history-strip.tsx` and `page.tsx`'s consistency/chronotype row — one stage palette shared by both card and strip |
| 5 — Body battery            | `8f04e02`            | `body-battery.tsx` — one `BatteryTags` component replacing two duplicated tag-pill branches                                                     |
| 6 — Journal header/streak   | `6c20434`, `62bccc0` | Deleted `JournalForm`'s own duplicate streak header/ring — the page header's chip is now the only streak on screen                              |
| 7 — Journal rest            | `6bc0d36`            | The manual-vitals panel, behavior tags, day flags, notes and submit button                                                                      |
| 8 — Correlations/milestones | `8867925`            | `correlation-rows.tsx` and `milestones-card.tsx`, with milestones' first test                                                                   |
| 9 — Labs readouts           | `c590b31`, `b372b76` | `labs-tiles.tsx`, `bio-age-card.tsx`, `blood-pressure-card.tsx`, `biomarker-list.tsx` — BP bands moved to tone tokens                           |
| 10 — Labs entry forms       | `4524b3a`            | `health-upload.tsx` and `health-manual-entry.tsx` folded behind `Collapsible`, reads-first ordering                                             |
| 11 — the sweep              | _(this task)_        | See below                                                                                                                                       |

Out-of-band: `d561bc7` is a plan-doc correction (task 10's original premise assumed
a closed `<details>` still renders its content; Base UI's `Collapsible` actually
unmounts it), landed ahead of Task 10's implementation commit.

## Task 11 — the sweep, and what it found

**Step 1 (grep the whole surface).** Ran the brief's exact script against
`src/app/body/page.tsx`, `src/components/body/*.tsx`, `src/components/app-shell.tsx`,
`src/components/bottom-nav.tsx`, `src/components/sidebar-nav.tsx`,
`src/components/ui/empty-state.tsx`, `src/components/ui/collapsible.tsx`. Confirmed
`page.tsx`'s import list pulls in nothing outside that file set (`EmptyState`,
`Collapsible`/`CollapsibleTrigger`/`CollapsiblePanel`, and `unavailableMessage` — the
string helper, not `<Unavailable>` — are the only `@/components/ui/*` imports
anywhere under `src/components/body/` or `page.tsx`). Result: `TOTAL 0 0`, both
before and after this task's edits.

**Two offenders outside both regex patterns, found and fixed:**

1. `src/components/body/journal-form.tsx:273` — the "Subjective feeling" step's
   `CheckCircle` completion badge carried `text-emerald-500`, a bare Tailwind
   palette colour neither guard pattern matches (`ARBITRARY_TYPE` only matches
   `text-[Npx|rem|em]`; `ADHOC_INK` only matches `white`/`black` alpha). Migrated to
   `text-chart-2` — the "good" tone token, consistent with the same icon's
   `text-emerald-400` treatment in `import-form.tsx`, the only other `CheckCircle`
   in the app.
2. `src/components/body/journal-form.tsx:296` — the mood-emoji picker buttons
   carried a bare `text-2xl`, an un-tokenised named Tailwind step (not an
   arbitrary bracket value, so also outside `ARBITRARY_TYPE`). `1.5rem` is
   byte-identical to `--text-heading`, so migrated to `text-heading` with zero
   visual change.

Both were found by a broader check beyond the brief's two regexes: grepping for any
remaining bare Tailwind size step (`text-xs|sm|base|lg|xl|2xl|3xl|…`) and any
remaining bare Tailwind palette-colour utility (`text-emerald-N`, `bg-blue-N`,
etc.) across the same file list. Zero of either remain after these two fixes.

**Confirmed left alone, as instructed:**

- **`.tag-active`** (`journal-form.tsx`'s tag pills and day-flag pills,
  `src/app/globals.css:530`) hardcodes the dark accent and does not follow the
  theme. Deliberate, recorded deferral to slice 9
  (`docs/v0.99-redesign-handoff.md`). Untouched.
- **`ui/unavailable.tsx`'s `text-white/50`** belongs to its `<Unavailable>`
  component. Verified `grep -rn "<Unavailable" src/` returns only
  `src/components/ui/unavailable.test.tsx` — no source file renders it. Body's
  four call sites (`labs-tiles.tsx`, `bio-age-card.tsx`, `blood-pressure-card.tsx`,
  `correlation-rows.tsx`, `sleep-night-card.tsx`) all call `unavailableMessage()`,
  the string helper, never the component. Left alone — belongs to whichever slice
  first renders `<Unavailable>`.
- **`app-shell.tsx`'s two depth-layer blooms** (`bg-emerald-500/5`,
  `bg-blue-500/5`, lines 35–36) — chromatic ambient background decoration behind
  every page in the app, not ink or a card surface. Matches the same pattern
  `.mesh-gradient` in `globals.css` already uses for its own two 8%-alpha blooms
  (`rgba(59,130,246,0.08)`, `rgba(16,185,129,0.08)`), which that file's own
  comment says are deliberately theme-blind and out of the token guard's scope
  ("a faint blue/green wash reads as intentional depth on a light surface exactly
  as it does on a dark one"). Not this task's job — shared chrome, chromatic, not
  named in the brief.

**Step 2 (duplicate-data walk), tab by tab:**

- **Trends** — 15 `BaselineTrendCard`s, one metric each (HRV, Resting HR, Weight,
  and 12 conditionally-rendered optionals). No figure repeats; each card reads a
  distinct wellness column.
- **Sleep** — `SleepHistoryStrip`, `SleepNightCard` (heading `"Last night · 7:30"`
  — confirmed via `sleep-night-card.tsx:102-103`, `{heading}{totalSecs != null &&
\` · ${clock(totalSecs)}\`}`), the consistency/chronotype row, `BaselineTrendCard`("Sleep duration", then conditionally "Sleep score"),`BodyBatteryCurve`. **The
third check** (brief): does the Sleep-duration trend card's current readout
repeat `SleepNightCard`'s `"7:30"`string in the same viewport? Confirmed no —`BaselineTrendCard`'s current reading always renders as
`current.toFixed(decimals)`+ the literal unit string`"h"`(decimals=1 for this
card, per its call site), e.g.`"7.5h"`, while `SleepNightCard`'s heading always
renders as `H:MM`with no letter suffix, e.g.`"7:30"`. The two formats are
structurally incompatible — one always ends in the letter `h`, the other never
  does — so they cannot coincide as strings for any input, not just today's data.
  Not a duplicate; no finding to record beyond confirming it stays that way.
- **Journal** — `CorrelationRows`, `JournalForm` (its synced HRV/RHR/weight/sleep
  values appear only as manual-entry defaults inside the form's own fields, not as
  a second on-screen reading of anything else on this tab), `MilestonesCard`
  passed `hideStreak`. **Streak**: page header chip only
  (`page.tsx:150-153`, `Streak {milestones.currentStreak}d ✓`, rendered once above
  the tab switch, common to all four tabs' headers) — `milestones-card.tsx`'s own
  streak row is fully suppressed when `hideStreak` is true (confirmed at the
  render-branch level, not just a hidden style). Confirmed exactly one streak
  figure per page.
- **Labs** — `LabsTiles` (biological-age tile + "N biomarkers · last draw …"
  tile), `BioAgeCard` passed `hideHeadline`, `BloodPressureCard`, `BiomarkerList`,
  then the two folded entry forms. **Biological age**: `LabsTiles` prints
  `Math.round(bioAge.value.bioAge)`; `BioAgeCard` with `hideHeadline` suppresses
  both its headline label ("Biological Age" → "What's driving it") and the entire
  figure+delta block (`{!hideHeadline && (...)}`), rendering only the per-component
  offset breakdown. Confirmed exactly once. **Biomarkers**: `LabsTiles`' count/
  last-draw summary and `BiomarkerList`'s per-row detail are a summary/detail pair,
  not a duplicate — `BiomarkerList` never re-prints a count or an overall last-draw
  date, and its rows don't render `measuredAt` at all (used only for sort order).
  **Blood pressure**: sourced from `wellness.systolic`/`diastolic` via `bpTrend()`,
  disjoint from `biomarkers` (the `BiomarkerList` source) — no overlap.

No duplicated figure found on any of the four tabs.

**Step 3 (ratchet re-pin).** Both ceilings unchanged at 137 / 311 — confirmed by
temporarily setting each to 0, reading the guard's own failure message (137 and 311
exactly, matching the pinned values), then restoring. Comments above both entries in
`tests/type-scale-guard.test.ts` now record Task 11's sweep and its exact file-list
scope, per the brief's instruction that a scope not written down is a scope nobody
can check.

**Gate:** full suite, typecheck, lint and build all green; the two `type-scale-guard`
`it.fails` remain failing-as-designed. See the task-11 report
(`.superpowers/sdd/task-11-report.md`, gitignored local tooling state — not
committed) for the literal command output.

## Still owed

- Whole-branch review for this slice, on a session that did not author the plan
  (Train precedent: `docs/plans/2026-08-12-v099-slice2-train-review.md`).
- Task 12 / final step: browser capture and axe pass (`scripts/verify-surfaces.ts`),
  same as Train's Task 13 — Body's four tabs are not yet in `SURFACES` any more
  reliably than Train's were before its own capture step added them.
- Release: version bump, CHANGELOG from the diff, roadmap update (2b.4 does not
  close until slice 9), `./scripts/release.sh`.

## Deferred to slice 9 (recorded here so a later sweep does not rediscover them as new)

1. `.tag-active` (`globals.css:530`) — hardcodes the dark accent, does not follow
   the theme. `docs/v0.99-redesign-handoff.md`.
2. Light mode is unreachable (`forcedTheme="dark"` in `theme-provider.tsx`); the
   `surface-raised == surface-overlay` collapse in light that Train's ledger flags
   as a slice-9 blocker applies identically to any active/inactive pill on Body.
3. `ui/unavailable.tsx`'s `<Unavailable>` component's one `text-white/50` — not
   rendered by Body, so not migrated here; whichever slice first renders it owns
   the fix.
