# Flow and friction — structural map, and choice load

**Phase 6, strand 3.** The structural map came first; the measurement below
was added after, and the scope note that used to say "nothing here is
measured" no longer applies to the choice-load section.
Written 2026-08-26 against `main` at `659542c` (v0.121.0), following the same
inventory-before-proposal discipline the IA strand used.

**Read the scope limit first.** The structural sections below are read out of
the code: which actions exist, what wraps what, where a journey leaves its
surface. The **choice load** section at the end is measured in a real browser
and carries its own, different caveat — read that one before quoting its
numbers. Time-to-complete is still measured nowhere.

Two claims were drafted and withdrawn while writing it, both after checking
the file rather than trusting the grep. They are recorded below, because a
map that hides its own near-misses is not a map.

---

## The four named journeys

### 1. Confirm a week — `/train?tab=week`

```
no plan       → PlanEmpty → "Talk to the coach" → /coach   ← leaves the surface
draft exists  → PlanPreviewCard → Confirm | Regenerate
availability  → <section> → AvailabilityWeekSwitcher (when both weeks exist)
                          → IntakeForm ×2 (this week, next week)
                          → per-day button → BlockSheet (overlay)
rollover      → startWeek()
```

**The primary path starts by leaving Train.** An athlete with no plan meets
`PlanEmpty`, whose only action is a link to `/coach`. Getting a week therefore
begins on a different tab from the one that shows weeks.

`IntakeForm` is rendered twice — once for this week, once for next — behind a
switcher when both are available.

### 2. Plan a season — `/train?tab=season` and the Week tab's races

Season itself is **1.0 screen** (measured in the IA inventory): one card, three
stat tiles, a two-bar chart. The actual season work happens elsewhere:

- Races: `RacesSection` on the Week tab — `addRace`, `updateRaceDemand`,
  `setRaceStatus`, `removeRace`
- Plan changes: `previewPlanChange` → `applyPlanChange`
- Draft lifecycle: `confirmPlanAction`, `regeneratePreviewAction`

So the tab named Season is a report, and season _editing_ lives under Week.
That split is worth a decision, and it is not one this document makes.

### 3. Debrief a ride — an overlay, no route

`DebriefChip` on Today → `?sheet=debrief&activity=<id>` → `DebriefSheet`.
Two actions only: `submitDebrief`, `skipDebrief`. The sheet asks for perceived
exertion (1–10), how you felt, an optional note with dictation, then
"Save & get review".

**The tightest of the four**, and the only one that is a single overlay with a
single exit. Worth holding up as the shape the others are measured against.

### 4. Connect a provider — one label, three journeys

Six integrations sit under one "Integrations" section, and they do
structurally different things:

| Mechanism       | Providers               | Entry                                 |
| --------------- | ----------------------- | ------------------------------------- |
| OAuth redirect  | Strava, Whoop, Withings | `/api/connections/<name>`             |
| Credential form | intervals.icu, Oura     | `connectAction`                       |
| File upload     | Apple Health            | `uploadAction`, `<input type="file">` |

**Nothing tells the athlete which one they are about to enter.** Three of six
leave the app entirely and come back through a callback; one wants a file the
athlete has to export from another device first. The section's badge
summarises _what is connected_, never _what connecting will involve_.

This is the clearest friction finding in the set, and unlike the others it
needs no measurement to state.

---

## Choice load, measured

How many things an athlete can actually press on each surface. Measured in a
real browser at 390x844, counting only **visible and enabled** elements
(`button, a[href], input, select, textarea, [role=button]`), split three ways:

- **appChrome** — the fixed bottom bar / sidebar. Identical on every screen.
- **tabs** — the surface's own tab rows. Navigation, but part of this
  surface's structure rather than the app's.
- **surface** — everything else. What this screen puts in front of you.

| Surface                   | surface | tabs | appChrome | hidden/disabled | scroll (IA) |
| ------------------------- | ------: | ---: | --------: | --------------: | ----------: |
| **Body ▸ Journal**        |  **27** |    4 |         5 |              17 |         2.4 |
| **Train ▸ Week**          |  **21** |    4 |         5 |          **49** |     **4.7** |
| Settings ▸ baselines open |      19 |    0 |         5 |               6 |           — |
| Activity log              |      16 |    0 |         5 |              10 |         1.2 |
| Today                     |      13 |    0 |         5 |               8 |         1.6 |
| Coach                     |      10 |    0 |         5 |              10 |         1.2 |
| Settings (collapsed)      |       8 |    0 |         5 |               6 |         1.0 |
| Body ▸ Trends             |       5 |    4 |         5 |               6 |         1.0 |
| Train ▸ History           |       4 |    7 |         5 |               6 |         1.0 |
| Train ▸ Fitness           |       4 |    4 |         5 |               6 |         1.0 |
| Import                    |       3 |    0 |         5 |              11 |         1.0 |
| **Train ▸ Season**        |   **0** |    4 |         5 |               6 |     **1.0** |

**`appChrome` is 5 on every row.** That constancy is the method's own check:
it is the same bar everywhere, so any variation would have meant the buckets
were wrong. They were, in a first pass — see the caveat below.

### What it says

**Train ▸ Season has zero actions.** One screen of content, four tab
controls to reach it, and nothing on it to press. You can look; you cannot
act. That is a report wearing a tab's clothing, and it is _evidence_ for the
IA inventory's parked question about whether Season should be a tab at all —
not taste.

**Train ▸ History spends more controls on navigation than on content**: seven
tab controls (four Train tabs + three view tabs) against four surface
controls. It is the only surface where chrome outnumbers content.

**Train ▸ Week is worst on both axes at once** — 4.7 screens _and_ 21 visible
controls, with **49 more hidden or disabled**, by far the largest of any
surface. Those are the contents of its **four** collapsibles — "What changed
& why", "Standard week", "Races", "Remaining skeleton" — present in the DOM,
costed by assistive technology, and invisible until opened. Length and choice
load usually diverge; here they compound.

(The IA inventory says "three more collapsibles (Standard week, Races,
Remaining skeleton)". That is an undercount: "What changed & why" is a fourth,
at `src/app/train/page.tsx:928`. Corrected here rather than by editing a dated
document, per the convention the roadmap reset established.)

**Body ▸ Journal has the most visible controls of anything (27)** on a
2.4-screen surface, and the picture explains why: it is an explicitly
numbered multi-step form ("1. Subjective feeling", "2. Wellness sliders")
with five date circles, five feeling faces, ten tag buttons, a notes field
and a save. It is a _flow_ rendered as a page, which is exactly what this
strand exists to look at.

### The caveat that matters more than the numbers

**These figures are fixture-dependent, and the first run of them was wrong.**

Against the local dev database as it stood, `Train ▸ Week` measured
**surface = 1** — because that database had no training plan, so Week rendered
`PlanEmpty` and its single "Talk to the coach" link. A plausible number,
entirely an artifact of the seed. The table above was taken after seeding a
confirmed race plan with the same `scripts/seed-confirmed-race.ts` CI uses.

A second flaw in the same first pass: everything inside a `<nav>` was called
"chrome", but `SegmentedTabs` renders a `<nav>` too, so the app bar and each
surface's tab row landed in one bucket — "chrome" varied 5 to 12 when it can
only be 5. Hence the three-way split above, and hence checking that
`appChrome` is constant before quoting anything else.

Anyone re-running this must seed first and check the `appChrome` column.

---

## The fifth journey: adjusting a week, which has no path

`WeekAdjustmentSwitch` (v0.56–v0.60) is **deliberately not rendered**, and the
comment at `src/app/train/page.tsx:812` explains why in detail:

> Its action writes `trainingBlocks.targetLoadTotal`, but the open week the
> athlete actually trains is materialized from a target `periodize()`
> recomputes on the spot… That made the buttons worse than inert:
> `targetLoadTotal` IS read by the blocks table, `get_training_plan`,
> `get_plan_drift` and race forecasting, so the number moved everywhere the
> plan is reported and nowhere it is executed. A live press had already left
> one athlete's block at 0 against a real week of 259.

**This is a strand-3 item the codebase already named**, with the decision
stated: _"either the action re-materializes the open week, or the copy
describes the skeleton it actually edits."_ It is the one item here that comes
with its own specification of what choosing looks like.

`setWeekAdjustmentQuick` remains exported and tested. `submitWeekAdjustmentQuick`
has **zero references anywhere, including tests** — dead weight, though a
tidy-up rather than a defect.

---

## Two claims withdrawn while writing this

Recorded because the IA strand's most useful habit was checking before
claiming, and it paid off twice more here.

1. **"Three server actions are dead code."** `submitWeekAdjustmentQuick`,
   `setWeekAdjustmentQuick` and `setDayOverride` all showed zero `.tsx`
   callers. Reading the file that omits them showed a deliberate,
   thoroughly-reasoned switch-off — not rot. Only the `submit` wrapper is
   genuinely unreferenced.
2. **"Availability editing is three levels of nesting deep."** `IntakeForm`
   looked like it sat inside a `Collapsible` on a 4.7-screen tab. It does not:
   it is a plain `<section>` with a week switcher. The nesting claim was wrong
   and would have shaped a proposal around a problem that does not exist.

---

## What this document does not establish

- **No interaction counts.** Choice load is now measured, but that is how
  many controls a surface _offers_, not how many an athlete must _press_ to
  finish a journey. The second still needs a walkthrough per journey.
- **No abandonment evidence.** The v0.121.0 tab-level telemetry counts surface
  views, not journey completion. Nothing currently records that an athlete
  opened the debrief sheet and closed it without submitting.
- **No claim about which journey is worst.** "Connect a provider" is the most
  obviously fragmented, but fragmentation and friction are not the same thing,
  and only one of them has been observed here.

## Recommended next step

**Walk each journey in a browser and count the interactions**, the way the IA
strand measured scroll depth rather than describing it. The seeded demo owner
reaches three of the four; "connect a provider" needs care, because three of
its six paths leave for a third-party OAuth screen.

Then, and only then, a proposal.
