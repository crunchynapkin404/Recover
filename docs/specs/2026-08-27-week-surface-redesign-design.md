# Train ▸ Week — surface redesign

**Phase 6, strand 3 (flow and friction). Design, 2026-08-27, against `main` at
`9112d10` (v0.122.0).**

The strand's inventory and measurement are
`docs/2026-08-26-flow-inventory.md`. This document is the proposal that
follows them, and it is the first Phase 6 change that moves behaviour rather
than copy.

Mockups: <https://claude.ai/code/artifact/bfce47bc-f3eb-4250-a669-031c694d6f0d>

---

## What is wrong, in numbers rather than taste

Measured on the v0.122.0 soak capture at 390×844, and by the choice-load pass
in the flow inventory:

|                          |   Today |             After |
| ------------------------ | ------: | ----------------: |
| Phone screens            | **4.8** |              ~1.2 |
| Sections on first paint  |  **17** |                 4 |
| Visible controls         |      21 |               ~14 |
| Hidden/disabled controls |  **49** | ~0 on first paint |

Nothing on the page is wrong. Every block is something the engine genuinely
knows, and the honesty of printing it is a feature. The fault is arrangement:
**roughly a screen and a half is prose the athlete reads once** — _why this
week_, race readiness, pacing reasoning — printed permanently at full length,
and another screen and a half is a 21-row plan table that exists only while a
draft is pending and pushes the actual week below the fold while it does.

The four `Collapsible`s at the bottom are the 49 hidden controls: present in
the DOM, costed by assistive technology, invisible until opened.

## The principle the redesign turns on

**A surface should be a set of summaries that link, not a set of drawers that
expand.** A drawer keeps its contents on the page; a link does not. This is
read off JOIN's home screen, where every section is `heading ⓘ ›` — a summary
with a destination — and where "Why this workout?" is _its own screen_ holding
a single paragraph.

Three supporting rules, same source:

1. **The verdict is the headline; the score is behind a chip.** JOIN opens
   with "You're fully ready, Jane" and hides the number. Recover opens with
   `54 · amber` and leaves the athlete to interpret it.
2. **Explanation attaches to the thing it explains, at the length of one
   line**, with `ⓘ` for the rest.
3. **One primary action, pinned.**

Three JOIN patterns are deliberately **declined**: the horizontal one-day
carousel (Recover's unit is the week, not the workout), colour-by-workout-type
(colour here already means state — amber readiness, accent, destructive), and
the chatty explainer paragraph atop every sheet (not this app's voice).

## Decisions taken during the brainstorm

Recorded with who chose what, because two went against the recommendation and
that should be legible later rather than smoothed over.

| Decision      | Chosen                                        | Note                                                                       |
| ------------- | --------------------------------------------- | -------------------------------------------------------------------------- |
| Season tab    | **Folded into Week, tab dropped**             | User's call; recommendation was to move the races list into Season instead |
| Week layout   | **A — one glyph row, one open day**           | User's call; recommendation was B (all seven listed)                       |
| Day strip     | **V2 — height is duration, ink is intensity** | Agreed; this is what pays option A's debt                                  |
| Availability  | **T — day timeline, blocks dragged**          | Agreed                                                                     |
| Standard week | **Dropped from the redesign entirely**        | User: "I adjust each week, there is never a real standard week"            |

**The standard week was cut after the mockups, and the reason matters.** It was
briefly designed as a third tense inside the availability sheet, then removed
on the athlete's own evidence: every week is edited, so the defaults are only
ever a seed for the first override. It stays in the data model — `resolveWeek`
merges standard week + overrides and nothing changes there — and it stays
editable from the Plan setup sheet. It simply stops being presented as
something the athlete maintains.

What replaces it is a nudge, not a surface: see **The Sunday reminder** below.

---

## The new Week, top to bottom

```
Train                                    [54 · amber]
Week   History   Fitness
"Thursday is your long one — you're ready for it."
⚑ Confirmed Race · 30d · form +17                    ⓘ
17% PROGRESS          5 WEEKS TO RACE
┌───────────────────────────────────────────────────┐
│ [ This week | Next week ]                         │
│ MO  TU  WE  TH  FR  SA  SU        ⏱ Availability  │
│ ▁   ▁   ▄   █   ▄   ▄   ▃                         │
│ 5 sessions · 4.5h of 6.3h                      ⓘ  │
│ ┌─ THU · Long · 95 min · Z1–Z2 ─────────────────┐ │
│ │ Fuelling: 30–50 g carbs before              ⓘ │ │
│ │ [Move] [Target day] [What if?] [No time today]│ │
│ └───────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────┘
Why this week · 4 changes                            ›
Races · 3                                            ›
Plan setup                                           ›
══════════════ [ Confirm week ] ══════════════  (pinned)
```

### 1. Verdict headline

Replaces the bare readiness chip as the page's first statement. One sentence,
generated from the same figures the chip carries plus the week's shape —
"Thursday is your long one — you're ready for it." The chip stays, top-right,
as the way to the number.

**This is new copy over existing data, and it must obey the uncertainty
vocabulary.** When readiness is `missing_input` or `calibrating`, the headline
says so in the same words the rest of the app uses (`<Unavailable>`), never a
cheerful sentence over an absent figure. `isFirstRun()` athletes get the
first-run voice v0.120.0 established.

### 2. Race line and progress numbers

`RaceChip` collapses to one line with an `ⓘ`. `EventReadiness` and the pacing
prose move behind that `ⓘ` — same destination as _Why this week_ (see below),
which keeps the sheet count down.

The folded-in Season tab becomes two figures: **progress through the plan**,
and **weeks to the next race**. Both already exist —
`SeasonTimelineCard`'s `points` and the race countdown. The timeline chart
itself moves to Fitness, which is where the other charts live; if it does not
earn a place there, it is deleted rather than parked, and this document says so
now so the decision is not made silently later.

### 3. The week card

One card, two tenses, `This week | Next week`. Contains, in order:

- **The day strip (V2).** Seven bars. **Height is duration** on a shared
  scale; **ink is intensity** — accent for endurance, `--warning-ink` for
  anything above threshold. No third colour is introduced: warm ink is already
  the app's "hard day" token. Today's bar carries the existing focus ring.

  **Rest days get an explicit glyph, not a short bar.** A 3 px bar and a
  20-minute recovery spin are indistinguishable, and "nothing planned" is a
  different statement from "something small planned".

  This mapping is corroborated rather than invented: JOIN's own help
  documentation describes their week overview as _"Color = expected effort ·
  Circle size = total duration · 😴 = rest day (no circle)"_ — the same two
  channels plus a rest glyph, arrived at independently. The deliberate
  divergence is the mark: they encode duration as **circle area**, this uses
  **bar height on a common baseline**, which is the more accurately comparable
  encoding. Their colour scale runs five steps (grey/blue/green/yellow/red,
  keyed to RPE bands); this stays at two, because a five-step effort palette
  would be a new colour language and colour here already means state.
  Each bar is a control that opens its day. Its accessible name is the full
  sentence — "Thursday, long ride, 95 minutes, zone 1 to 2" — because a bar
  chart is not a label, and the choice-load measurement counts it as a control
  either way.

- **The availability chip**, opening the timeline sheet.
- **The totals line** — `5 sessions · 4.5h of 6.3h` with `ⓘ`.
- **The open day.** One day expanded, defaulting to today: title, zones,
  fuelling line with its own `ⓘ`, and the existing day actions (`Move`,
  `Target day`, `What if?`, `No time today`). Tapping another bar opens that
  day; the open day is URL state (`?day=2026-08-27`) so it survives a reload
  and is linkable, matching how the app already treats sheets.

`FuellingCard` shrinks to the one line inside the open day; its detail moves
behind the `ⓘ`.

### 4. Three summary rows

Each replaces a `Collapsible` with a link:

| Row                         | Replaces                                                              | Destination |
| --------------------------- | --------------------------------------------------------------------- | ----------- |
| `Why this week · 4 changes` | `WeekRationale`, `What changed & why`, `EventReadiness`, pacing prose | Sheet       |
| `Races · 3`                 | `Races` collapsible (`RacesSection`, 743 lines)                       | Route       |
| `Plan setup`                | `PlanStyleSwitch`, `SeasonModeSwitch`, `Remaining skeleton`           | Sheet       |

**Sheets for what you return from, routes for what you browse** — the split
JOIN uses. `RacesSection` is a 743-line management surface with its own
add/edit/delete lifecycle; it is browsed, so it gets a route.

### 5. The draft plan preview

`PlanPreviewCard` (21 rows, ~1.5 screens) stops rendering inline. It becomes a
banner — _"A 21-week plan is ready · Review →"_ — opening a full-height sheet
that holds the table and the existing `Rebuild` / `Start this plan` actions.
The draft state is the one case where the page's job is not this week, and it
currently expresses that by burying this week.

### 6. Pinned action

`Confirm week` (or `Plan this week`, or `Set next week's availability` — one
per tense) pins to the bottom of the viewport while the card scrolls.

---

## The availability sheet (T)

The single biggest cut: two stacked `IntakeForm`s plus a modal per day become
one sheet.

**The model is unchanged.** `AvailabilityBlock` stays
`{ start, end, mins, energy, sports }`, days keep holding more than one block,
and every edit still commits through `validateBlocks`. This is a new _editor_
over the existing type, not a new type.

### Interaction

Each day is a track spanning **05:00–23:00**. A block is a pill on it:

- **Position** = start time. **Width** = duration. **Fill** = energy
  (`easy` / `normal` / `full gas`) — the same two-channel grammar as the day
  strip, learned once and used twice.
- Drag the body to move; drag either end to resize. **Snap to 15 minutes.**
- Tapping a block selects it and reveals resize handles _outside_ the pill's
  visual bounds, so the touch target is not the pill's rendered width.
- `+` on a row adds a second block. Overlap is prevented by the drag rather
  than rejected afterwards, and `validateBlocks` remains the authority on
  commit.
- Sport chips appear only where the plan gives a genuine choice — the rule
  `BlockSheet` already applies.

Two tenses in the sheet's own switcher: **This week · Next week**. Both edit
overrides and show the `Pinned` badge, with `clearDayOverride` reachable per
day exactly as now. The standard week is edited from Plan setup, and is not a
tense here — see the decision note above.

### The Sunday reminder

If every week is edited by hand, the thing that must not fail is the
_prompt_, not the defaults.

**This is already built and needs re-aiming, not writing.**
`shouldPromptAvailability` and `promptAvailability`
(`src/lib/week-plan/availability-prompt.ts`, v0.20) already send a push —
"How's your week looking? Confirm your training time so this week plans itself
around it." — through the daily scheduler, recording `availabilityPromptedAt`
before the send so a failed push cannot license five retries.

What it does today is nudge about the **open** week, from its Monday through
day 4. What the athlete asked for is a nudge on **Sunday, about the week that
is about to start**, which is the moment the answer is actually knowable and
the plan can still be built around it.

The change is to the window and the target week, not to the mechanism:

- Fire on the day before `weekStart` (age `-1`), targeting **next** week's
  availability, deep-linking to the availability sheet's `Next week` tense
  rather than to `/train`.
- Keep the existing "already prompted for this week" guard, keyed to the week
  being asked about.
- Keep the late window as a fallback for a week that starts unconfirmed, since
  a Sunday miss should not mean silence all week.

`shouldPromptAvailability` is pure and already tested; this is a test-first
change to its window arithmetic plus the copy and the deep link.

### The two costs, stated rather than discovered

1. **Touch targets.** Eighteen hours across a 390 px viewport is ~18 px per
   hour, so a one-hour block renders 18 px wide. Blocks therefore have a
   **minimum rendered width** (44 px) above which the scale is proportional
   and below which it is not — the label inside stays readable and the pill
   stays grabbable. The distortion is real and is accepted deliberately: an
   honest 18 px pill nobody can grab is worse than a 44 px one that overstates
   a short block.
2. **A drag-only control is unusable by keyboard and by screen reader.** Every
   block is a focusable element with an accessible name
   ("Thursday 17:30 to 19:45, full gas") and arrow-key adjustment (arrows move
   the start, shift+arrows resize, both in 15-minute steps). The numeric
   editor from `BlockSheet` is **kept**, reachable from the selected block, as
   the precise and assistive path. If the keyboard path is not done, the
   feature is not done.

---

## What moves where — the full mapping

Nothing is deleted. Every one of the seventeen sections has a destination.

| Today                                  | After                                                        |
| -------------------------------------- | ------------------------------------------------------------ |
| Header, readiness chip                 | Header + verdict headline                                    |
| `PlanStyleSwitch`, `SeasonModeSwitch`  | Plan setup sheet                                             |
| Tabs (4)                               | Tabs (3) — Season retired                                    |
| `PlanPreviewCard` (21 rows)            | Banner → Plan review sheet                                   |
| `WeekStrip`                            | Day strip V2                                                 |
| `WeekDayList`                          | The open day, one at a time                                  |
| Next-week summary                      | The `Next week` tense                                        |
| `FuellingCard`                         | One line in the open day, `ⓘ` for detail                     |
| `WeekRationale`                        | Why this week sheet                                          |
| `EventReadiness`                       | Why this week sheet                                          |
| `RaceChip` + pacing prose              | One line + `ⓘ`                                               |
| `What changed & why · 4`               | Why this week sheet                                          |
| Availability section (`IntakeForm` ×2) | Availability sheet, This/Next tenses                         |
| `Standard week`                        | Plan setup sheet — no longer surfaced as a thing to maintain |
| `Races · 3`                            | Races route                                                  |
| `Remaining skeleton · 5`               | Plan setup sheet                                             |
| `SeasonTab` (`SeasonTimelineCard`)     | Two figures on Week; chart to Fitness or deleted             |

## Data, actions, schema

**No schema change is expected.** Every action already exists:
`submitAvailability`, `clearDayOverride`, `startWeek`, `confirmPlanAction`,
`regeneratePreviewAction`, `previewPlanChange` / `applyPlanChange`, the race
actions, and the day actions behind `BlockSheet`. The redesign is a
recomposition of existing server components and actions.

Two non-visual consequences:

1. **Telemetry.** `TRAIN_TABS` in `src/lib/log-href.ts:89` drops `season`,
   taking the tab-level key set from 17 to 16 — a counter shipped one day
   earlier in v0.121.0. Rows already written as `train:season` must remain
   readable and labelled, the way `/admin` already labels pre-v0.121 rows
   `untabbed · before v0.121`. `telemetry.surfaces.test.ts` derives its count
   from `TRAIN_TABS` and will follow automatically; the retired key needs its
   own assertion so the history is not silently dropped.
2. **Routes.** `/train?tab=season` must not 404 or render an empty tab. It
   redirects to `/train?tab=week`.

## Testing

- **Unit (jsdom), test-first**, per file: the day strip's scale and accessible
  names; the verdict headline across `ok` / `missing_input` / `calibrating` /
  first-run; the open-day URL state; each summary row's destination.
- **The availability timeline gets its own suite**: drag maths (snap,
  minimum width, no overlap), keyboard adjustment, `validateBlocks` on commit,
  and the multi-block day. Every case that `BlockSheet`'s tests cover today
  must still be covered, since the model is unchanged.
- **Capture and axe.** `train`, `train-plan-preview` and the new sheet states
  need surfaces. **The fixture must render the states being changed** — the
  lesson v0.122.0 paid for, where a clean `0 confirmed` across 8/8 photographed
  none of the connector change because every fixture had all six connectors
  connected. A capture that passes over a state nobody has is not evidence.
- **Re-measure choice load** with the same method as the flow inventory and
  record the result. The 4.8 → ~1.2 claim in this document is a _prediction_
  until that pass runs.

## Slices

Three, in order, each shippable:

1. **Composition** — verdict headline, race line, progress figures, day strip
   V2, the open day, the three summary rows, pinned action, Season tab
   retirement and its telemetry/route consequences.
2. **Destinations** — Why this week sheet, Plan setup sheet, Races route, Plan
   review banner + sheet. Until this lands, slice 1's rows link to the
   existing collapsibles' content in place.
3. **The availability timeline** — the largest and the one with the real
   accessibility work. `BlockSheet` stays until this replaces it.

**The Sunday reminder is not in any of the three, and should ship first.** It
is a window change to a pure, already-tested function plus copy and a deep
link — an afternoon's work that delivers the thing the athlete actually asked
for ("remind me on Sunday"), and it is independent of every layout decision
above. Shipping it first also means the redesign's availability sheet arrives
with the nudge that points at it already in place.

## Risks

- **Slice 1 without slice 2 is a regression**, since the rows would point at
  nothing. They must ship in the same release, or slice 1's rows must link to
  the existing content in place.
- **The verdict headline is a new claim.** It is generated prose about the
  athlete's state, and this project's whole discipline is that the app does
  not claim more than it knows. It must degrade through the existing
  vocabulary, and its wording deserves the same scrutiny the first-run copy
  got.
- **The minimum-width floor distorts the timeline.** Accepted deliberately,
  documented above, and it should be visible in the component's own comment.
- **Option A's shape depends entirely on V2 carrying the week.** If the bars
  do not read at a glance in a real capture, the layout is worse than what
  ships today, and the honest response is to fall back to option B rather than
  to add taps.

## Out of scope

The other two Phase 6 items (Fitness/Sleep/Labs tab status, still parked on
telemetry), the visual-polish strand, and Phase 7. The `WeekAdjustmentSwitch`
question at `src/app/train/page.tsx:812` is untouched by this: it is a
correctness decision about what the action writes, not a layout one.
