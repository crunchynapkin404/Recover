# Visual polish — slice 6: the named offenders

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uncrowd the availability day row, and bring the sheet's choice load
down without taking anything away from the athlete.

**Spec:** `docs/specs/2026-08-30-visual-polish-and-motion-design.md`, Design 6.

**Branch:** `feat/finish-the-design-system`.

## The two offenders

Both are in one row of `src/components/week/availability-timeline.tsx`, and
both were named in the v0.124.0 handoff rather than discovered here:

1. **The row is crowded at 390px.** Day name, block summary, `Pinned ×`, `+`
   and "edit precisely" share one flex line, and the summary — which carries
   the actual clock times, since the pills are deliberately unlabelled —
   **truncates on a two-block day**.
2. **`Pinned ×` is a status that happens to be pressable**, up to seven times
   on one sheet. The sheet's choice load rose 17 → 31 in v0.124.0 and this is
   the largest single contributor.

## A correction to the handoff's justification

The handoff proposes demoting the badge to a non-interactive mark plus one
week-level "back to standard" control, and says this "would cut six without
removing any capability."

**That last clause is wrong, and the plan changes because of it.** Per-day
unpin exists nowhere else. `BlockSheet` — the spec's own "precise and
assistive path" — has no unpin control at all (`grep -n
"unpin\|override\|standard week" src/components/week/block-sheet.tsx` returns
nothing). Demoting the badge and adding only a week-level control would take
away the ability to unpin **one** day: an athlete who overrode Tuesday and
wants only Tuesday back on the standard week would have to clear the whole
week and re-override the rest.

So this slice moves that capability rather than deleting it: **`BlockSheet`
gains "Back to your standard day"**, which is where precision already lives,
and the row keeps a mark instead of a button.

## Global Constraints

- **No capability may be lost.** Per-day unpin must remain reachable, and the
  slice's acceptance is that every unpin possible before is possible after.
- **The `Pinned` mark must stay announced.** It is real state; demoting it to
  a `<span>` must not make it invisible to a screen reader, and the existing
  `aria-label` text ("Pinned — {day}, back to your standard week") describes
  an action that will no longer be there.
- **Watch WCAG 2.5.3 (Label in Name).** The current button's visible text is
  "Pinned ×" and its accessible name was already regressed once on this
  component and fixed — see the flow inventory's slice 3 defect list.
- **Zero confirmed axe violations** stays the ceiling.

---

### Task 1: per-day unpin moves into BlockSheet

Do this **first**. Removing the row button before its replacement exists would
leave a commit in history with no way to unpin one day.

**Files:**
- Modify: `src/components/week/block-sheet.tsx`
- Modify: `src/components/week/intake-form.tsx` (pass the handler through)
- Test: `src/components/week/block-sheet.test.tsx`

- [ ] **Step 1: Write the failing test** — a pinned day's sheet offers to
  restore the standard day; an unpinned day's does not.

- [ ] **Step 2: Thread `pinned` and `onUnpin` into `BlockSheet`**, which
  already receives the day index. `intake-form.tsx` holds both
  (`overrideDates`, `unpin`).

- [ ] **Step 3: Render the control** only when that day is pinned, using
  `PendingButton` so it speaks the vocabulary slice 2b established.

- [ ] **Step 4: Tests, types, lint. Commit.**

---

### Task 2: the badge becomes a mark

**Files:**
- Modify: `src/components/week/availability-timeline.tsx`
- Test: `src/components/week/availability-timeline.test.tsx`

- [ ] **Step 1: Write the failing test** — the row renders no button whose
  accessible name starts "Pinned", and still exposes the pinned state as text.

- [ ] **Step 2: Replace the button with a span**

```tsx
{pinned && (
  <span
    className="shrink-0 rounded-full border border-hairline bg-surface-overlay px-2 py-0.5 text-label font-bold text-chart-3"
  >
    Pinned
  </span>
)}
```

The `×` goes with the button — it promised an action. Keep the word, which is
the status.

- [ ] **Step 3: Check the row actually got its width back**

Measure, do not assume: at 390px, with a two-block day, confirm the summary no
longer truncates. `docs/2026-08-26-flow-inventory.md`'s method and
[[recover-layout-measurement]] both apply — measure the content box in a real
browser rather than eyeballing a screenshot.

- [ ] **Step 4: Commit.**

---

### Task 3: one week-level control

**Files:** `src/components/week/intake-form.tsx`, plus a bulk action.

- [ ] **Step 1: Decide where the loop lives.** `clearDayOverride(date)` is
  per-date (`src/app/plan/actions.ts:370`). Either call it once per pinned
  date from the client, or add `clearWeekOverrides(dates)` beside it. **Prefer
  the server action**: seven sequential round-trips from the client is a
  visible stall, and the existing action already re-validates the date shape
  and the user on every call.

- [ ] **Step 2: Render it only when at least one day is pinned**, as a
  `PendingButton` labelled "Back to your standard week".

- [ ] **Step 3: Confirm the count moved.** Re-measure the sheet's choice load
  with the flow inventory's method. The handoff predicts **31 → ~25**; record
  what it actually is, and if it is not ~25 say so rather than adjusting the
  prediction after the fact.

- [ ] **Step 4: Commit.**

---

### Task 4: prove it

- [ ] **Step 1: Suite, types, lint.**

- [ ] **Step 2: Seed and capture.** `train-availability` is the surface, and
  it **photographs blank tracks without seeding** — the defect that nearly
  shipped in v0.124.0-rc.1:

```bash
SEED_DEMO=1 npx tsx scripts/seed-availability.ts
SCREENSHOT_BASE_URL=http://localhost:3210 npx tsx scripts/verify-surfaces.ts polish-slice6 --only=train
```

- [ ] **Step 3: Drive a pin, then unpin it both ways.** A capture shows the
  row at rest; it cannot show that unpinning still works. Exercise the
  BlockSheet control and the week-level control in a browser.

- [ ] **Step 4: Update the flow inventory** with a sixth dated section: the
  sheet's choice load before and after, and the row-crowding fix.

- [ ] **Step 5: Tick and commit.**

## What this slice does not do

- **It does not touch the pill labels.** The v0.124.0 handoff records that the
  in-fill duration rendered as `1h 00…` at every width the 44px touch floor
  produces, and that the numbers live in the day summary instead. This slice
  gives that summary its width back, which is the fix that was chosen.
- **It does not add energy or sport to the timeline.** That is inherited work
  named in the handoff, not a named offender.

## Next

`docs/plans/2026-08-31-polish-slice7-sweep.md` — the last arbitrary type size
inventoried, every ceiling re-pinned, the `it.fails` flipped, and
`design-system.md` rewritten prescriptive.
