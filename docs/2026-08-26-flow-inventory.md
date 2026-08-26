# Flow and friction — structural map

**Phase 6, strand 3. This is a structural map, not yet a measurement.**
Written 2026-08-26 against `main` at `659542c` (v0.121.0), following the same
inventory-before-proposal discipline the IA strand used.

**Read the scope limit first.** The IA inventory
(`docs/2026-08-26-ia-inventory.md`) led with measured pixel heights from real
capture artifacts, and that is what made it worth trusting. **Nothing here is
measured that way yet.** What follows is read out of the code: which actions
exist, what wraps what, and where a journey leaves its surface. Interaction
counts and time-to-complete need a browser and are not in this document.

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

- **No interaction counts.** How many taps each journey costs, and how many
  are avoidable, needs a browser walkthrough per journey.
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
