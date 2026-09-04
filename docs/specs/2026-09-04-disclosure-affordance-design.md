# The `ⓘ` — a disclosure affordance

Status: design, 2026-09-04. Written against v0.137.0.

## Why this exists

Three separately-specified things wait on a component that has never been
built. `grep -rn 'ⓘ' src/` returns zero.

- The week card's **totals line** (`5 sessions · 4.5h of 6.3h` with `ⓘ`) —
  specified in `2026-08-27-week-surface-redesign-design.md`, struck there
  2026-09-04 as never built.
- **`RaceChip` collapsing to one line**, with `EventReadiness` and the pacing
  prose behind the `ⓘ`.
- **`FuellingCard` shrinking to one line** inside the open day, its detail
  behind its own `ⓘ`.

It is also a named, measured shortfall rather than a matter of taste. v0.123.0
predicted the week card at **~1.2 phone screens** and delivered **1.84**, and
the roadmap says why in its own words: the session-fuelling card and the race
chip "still sit on the page, both assigned an `ⓘ` destination the spec
describes and this release does not build."

## The principle this serves

From the week-surface redesign, unchanged:

> A surface should be a set of summaries that link, not a set of drawers that
> expand. A drawer keeps its contents on the page; a link does not.

**The `ⓘ` is therefore a link, not a tooltip and not a popover.** A popover
would keep the content on the page and defeat the entire purpose — the goal is
fewer screens, and a drawer removes nothing.

## What measuring the ground changed

The design got substantially smaller than the spec implies, for two reasons
found by reading the code rather than the spec.

**1. The destination content already exists for two of the three.**
`src/app/train/page.tsx:1030` describes the `why-week` sheet as "the rationale,
the adjustments list, event readiness and the race-pacing prose, in that
order — everything the page used to only explain about this week's shape". So:

| `ⓘ`         | Explains                | Destination                                        | Content exists? |
| ----------- | ----------------------- | -------------------------------------------------- | --------------- |
| Totals line | planned vs target hours | `WeekRationale` in `why-week`                      | **yes**         |
| `RaceChip`  | readiness + pacing      | `EventReadiness` + race-pacing prose in `why-week` | **yes**         |
| Fuelling    | this session's fuelling | —                                                  | **no**          |

Two of the three need no new content and no new sheet. They need a link.

**2. The app already has an anchor vocabulary.** v0.134.0 established
`?open=…#fragment` deep links so "Set it" lands on the input rather than the top
of the page. An `ⓘ` landing on a _section_ of a sheet is the same problem, and
reusing that vocabulary is strictly better than inventing a `?topic=`
parameter — which is what an earlier draft of this design proposed before the
sheet's contents were read.

## The design

### 1. One component

`DisclosureLink` in `src/components/ui/`, beside the other primitives.

- Renders a **link**, not a button — it navigates.
- lucide `Info`, `aria-hidden`, with a visually-hidden accessible name.
  **Not the `ⓘ` character**: this repo's axe reporting files single-character
  text as `incomplete` for contrast (the same treatment its `▲`/`▼` trend
  arrows get), so a glyph would add indeterminate nodes for no benefit.
- **The accessible name says what it discloses, never "info".** "Why this
  week's volume", "Why this readiness", "How to fuel this session". A screen
  reader user tabbing a row of three identical "info" links learns nothing,
  which is the same defect the connector cards' `aria-describedby` fix closed
  in v0.124.0.
- Takes an `href` and a `label`. It owns no state and no data.

### 2. Destinations

| `ⓘ`         | `href`                            |
| ----------- | --------------------------------- |
| Totals line | `?sheet=why-week#week-volume`     |
| `RaceChip`  | `?sheet=why-week#event-readiness` |
| Fuelling    | `?sheet=fuelling&day=<ymd>`       |

`why-week` gains two anchor ids. `TRAIN_SHEETS` gains **one** entry, not two:
fuelling is per-day and per-session, so putting it in a sheet titled "Why this
week" would be a summary linking to something that does not explain it.

### 3. Slices, each measured

1. **`DisclosureLink` + `RaceChip` collapses.** The component, the two
   `why-week` anchors, and the race chip reduced to one line. Measure.
2. **The totals line.** Build the struck deliverable, with its `ⓘ`. Every
   input already exists on the page (`plannedMins(week.days)`, `offeredMins`,
   the session count off `week.days`). Measure.
3. **The fuelling sheet + `FuellingCard` collapse.** One new `TRAIN_SHEETS`
   entry, the card reduced to a line in the open day. Measure.

## Measurement, and a commitment about it

Measured at 390×844 with the flow-inventory method, before and after **each**
slice: **phone screens** and **visible controls**.

Baseline: Train ▸ Week is **1.84 screens / 17 visible controls**.

The honest prediction is that these move in _opposite_ directions. Each `ⓘ` is
a control, so three of them is **+3 controls**, while collapsing the race chip
and the fuelling card removes prose and should reduce screens toward the
original ~1.2.

**This spec commits to reporting the measured result even if it misses the
prediction, and to reporting it per slice rather than only at the end.** That
is not boilerplate: the ~1.2 prediction this whole strand exists to rescue was
itself missed and reported late, and slice 1 of the v0.123.0 work measured
_worse_ than what it replaced and was merged anyway, held back from release
until slice 2 existed. A slice that measures worse is a finding, not a failure —
but an unreported one is the failure.

## Non-goals

- **Not a tooltip or popover.** Stated twice on purpose; it inverts the
  principle.
- **Not a generic help system.** Three call sites, three destinations.
- **No new explanatory copy for the first two `ⓘ`s.** The content exists; this
  strand moves the reader to it. Writing new prose is a separate judgement.
- **Not the density work.** `--pad-card` and friends are a different struck
  deliverable, tracked separately under Not scheduled.

## Testing

- **Component:** `DisclosureLink` renders an anchor with an accessible name
  that is not "info"; the icon is `aria-hidden`.
- **Wiring at the surface, not the component.** Per `docs/RELEASING.md` step 4,
  a component test cannot prove the page hands it the right `href`. Assert the
  rendered `train` page contains each `ⓘ` pointing at its real destination.
- **The anchors must target something.** `body-prefs-card.test.tsx` exists
  because `?open=baselines#threshold-pace` targeted nothing. Same guard here:
  assert `why-week` renders elements carrying `#week-volume` and
  `#event-readiness`.
- **`sheet-param-validates.test.tsx`** must accept the new `fuelling` sheet and
  still reject unknown values.
- **Capture:** the collapsed week card and the new fuelling sheet both need a
  surface, and `?sheet=fuelling` shares a pathname with `/train` — so it needs
  a `sheetOpenGuard`, exactly like `train-availability`, or it silently
  photographs the ordinary Train tab under a promising name.
- **Axe ratchet stays at 0.** Non-negotiable; it is a ratchet, not a milestone.

## Risks

- **Three more controls on the app's busiest surface.** If slice 1 measures
  more controls and no fewer screens, the trade is not landing and the
  remaining slices should be reconsidered rather than completed on momentum.
- **`?sheet=fuelling` needs `?day=`**, so it can be opened for a day that has
  no session. It must refuse in the app's existing `missing_input`/`fix`
  vocabulary rather than rendering an empty sheet.
- **An `ⓘ` beside a figure invites "explain this number".** The two reused
  destinations explain the _week_, not the individual figure. If that reads
  wrong when opened, the fix is the sheet's content, not another sheet.
