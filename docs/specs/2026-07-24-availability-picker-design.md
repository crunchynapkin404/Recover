# Availability Input Redesign — Design

## Problem

The "This week's availability" step (`src/components/plan/intake-form.tsx`)
asks for minutes-per-day across 7 days using raw `<input type="number">`
fields in a compact 7-column grid (`min=0 max=720 step=5`). On mobile —
this app's primary surface — that means typing digits on the numeric
keyboard, or nudging a native stepper by 5 at a time, for every day of the
week. It works but is slow and fiddly for a step every plan run passes
through.

## Goals

- Replace the raw number inputs with a tap-to-open picker, while keeping
  the existing 7-up compact grid shape (all 7 days visible at once, no
  scrolling) — a cell is only ~40–45px wide, too narrow for an inline
  slider.
- Each grid cell becomes a tap target showing the day's value as a pill
  ("1h 30m", or "Rest" for 0). Tapping it opens a bottom sheet for that day.
- The sheet offers both speed and precision: a row of preset chips (`Rest,
  30m, 45m, 1h, 1h30, 2h, 2h30`) for one-tap common values, plus a
  two-column scroll-snap wheel (hours 0–12, minutes 0/15/30/45) for
  anything else. 15-minute granularity throughout, replacing today's 5-minute
  step.
- Auto-save: every chip tap or wheel settle writes immediately to that
  day's value. No Done button. Backdrop tap or swipe-down dismisses.
- Add a live weekly-total footer under the grid ("9h 15m this week") that
  updates as any day changes, using the sum that's already computed
  client-side.
- No new dependencies — the wheel picker is a small custom component built
  on CSS `scroll-snap`, not a library.

## Non-goals

- Changing the prefill algorithm (`src/lib/week-plan/availability.ts`) —
  out of scope, this spec only touches the input UI.
- A reusable/generic time-picker component for other parts of the app.
  Scoped to this form; if another surface needs the same control later,
  extracting it is a separate, small follow-up.
- Per-day busy/load indicators or color coding beyond the existing plain
  pill. Not asked for, would expand scope.
- A distinct desktop layout. The same compact-grid-plus-sheet design is
  used at all viewport widths; desktop just gets a mouse-usable version of
  the same sheet (drag-scroll or click-to-jump on the wheel columns).

## Design

### Grid cell (`intake-form.tsx`)

Each of the 7 columns keeps its day label. The `<input type="number">` is
replaced with a `<button>` styled as a pill, showing the formatted value
(`formatMins(v)` → "Rest" for 0, "45m" for <60, "1h 30m" otherwise).
Tapping the pill sets `openDay` state (day index or `null`) to open the
sheet for that day.

### Bottom sheet (`availability-sheet.tsx`, new)

Renders when `openDay !== null`, fixed-positioned, slides up from the
bottom with the existing `glass` rounded-card look. Structure:

- Header: the day's full name (`Wednesday`), derived from `openDay`.
- Preset chip row: `Rest · 30m · 45m · 1h · 1h30 · 2h · 2h30`. Tapping a
  chip both writes the value (calling the parent's `onChange(openDay,
  mins)`) and scrolls the wheel columns to match.
- Wheel: two side-by-side scrollable columns (hours 0–12, minutes
  0/15/30/45), each `scroll-snap-type: y mandatory` with each option a
  `scroll-snap-align: center` block. The centered option is read via
  `scroll` events (debounced) checking each column's `scrollTop` against
  option offsets — no IntersectionObserver dependency needed since it's a
  single small scroll container. On settle, computes `hours*60 + minutes`
  and calls `onChange(openDay, mins)`, clamped to `[0, 720]`.
  - Minutes value has no cap: with a max hour of 12, hour=12 always pairs
    with minutes=0 (matching the existing `max=720` behavior); the minutes
    column is visually disabled/skipped when hours is already 12.
- Backdrop: full-screen semi-transparent overlay behind the sheet; tapping
  it (or a swipe-down gesture on the sheet) sets `openDay` back to `null`.
  No separate save step — the value is already live in parent state from
  every chip tap / wheel settle.

### State (`intake-form.tsx`)

`mins: string[]` (existing) stays the source of truth. The sheet doesn't
own its own copy — it reads `mins[openDay]` to initialize wheel position
on open, and calls the same setter the old `onChange` used per keystroke.
The hidden purpose of the per-day `<input type="number" name={mins-${i}}>`
fields (form submission via server action) is preserved by keeping them in
the DOM as visually-hidden inputs whose `value` mirrors `mins[i]` — the
`<form action={formAction}>` submission mechanism is unchanged.

### Weekly total footer

Below the grid, above the "Confirm week" button: a small centered line,
`{formatDuration(mins.reduce(sum))} this week`, recomputed on every render
from the same `mins` array — no new state.

## Error handling / edge cases

- Rapid double-tap on a preset chip: idempotent, same value written twice.
- Sheet closed mid-scroll before a column's snap settles: the scroll
  `scrollend` (or debounced `scroll`) handler still fires and commits
  whatever is nearest-centered at that moment — consistent with "every
  settle auto-saves," just resolved before the close animation finishes.
- Existing stored values not on a 15-minute boundary (e.g. old data saved
  under the previous 5-minute step): on sheet open, the wheel snaps to the
  *nearest* 15-minute value for display, but doesn't silently rewrite
  `mins[i]` until the user actually interacts with that day's sheet.
- Touch vs. mouse: scroll-snap columns work with native touch scroll on
  mobile and wheel/drag-scroll on desktop without separate code paths;
  desktop additionally supports click-on-an-option-to-jump.
- `openDay` pointing at a day removed/out of range: not reachable — the
  grid always renders exactly 7 fixed days.

## Testing

- `formatMins` / duration-formatting helper: unit tests for 0 ("Rest"),
  <60 ("45m"), exact hours ("2h"), and mixed ("1h 30m").
- Wheel scroll-position → minutes conversion: unit test the pure function
  independent of the DOM scroll mechanics (given a scrollTop/offset, which
  hour/minute option is centered).
- `AvailabilitySheet`: component test that tapping a preset chip calls
  `onChange` with the right value and updates displayed wheel position;
  that backdrop tap closes without additional writes.
- `IntakeForm`: existing behavior (hidden inputs still carry `mins-${i}`
  values into `formAction`) stays covered by current tests; add one
  covering the weekly-total footer's sum text updates when a day changes.
- No changes needed to `availability.test.ts` (prefill logic untouched).
