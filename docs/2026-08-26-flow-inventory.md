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

---

## 2026-08-28 — Task 7: the redesign, measured against the same method

**Phase 6, strand 3, Task 7 of `.superpowers/sdd/2026-08-27-week-composition/`.**
Tasks 1–6 rebuilt Train ▸ Week: the Season tab retired, the season now reads
as two figures, the day strip carries duration/status/hard-day/rest, one day
opens at a time from `?day=`, a verdict headline leads, and the primary
action is pinned above the bottom nav. The spec that drove those tasks
predicted this surface would go from **4.8 screens / 21 visible + 49 hidden
controls to ~1.2 screens / ~14 visible + ~0 hidden**. That was a prediction.
This section is the measurement.

Branch `feat-week-composition` at `2364a6c`, based on `main` at `763ea63`
(right after the v0.122.0 release the earlier measurement predates). Seeded
with `SEED_DEMO=1 DEMO_EMAIL=dev@recover.local npx tsx
scripts/seed-confirmed-race.ts` against the local dev DB — the same script
and the same account (`OWNER_EMAIL=dev@recover.local`) `verify-surfaces.ts`
signs in as, so the surface measured is the one actually captured and
audited. `train-plan-preview` (the two-A-race draft preview) was **not**
seeded — only `seed-confirmed-race.ts` ran, matching the original
measurement's seed exactly, so the two numbers are comparable rather than
comparing a confirmed-plan week against a draft-preview one.

### Capture and axe

```
SCREENSHOT_BASE_URL=http://localhost:3210 npx tsx scripts/verify-surfaces.ts week-redesign --only=train,train-plan-preview
```

`train` captured cleanly at all 4 theme/viewport combinations.
`train-plan-preview` failed all 4 — expected, and by the script's own design:
that surface's `waitForTwoArcPreview` guard refuses to capture unless a
two-arc draft exists (`scripts/seed-two-race.ts`), which this measurement
deliberately did not run, for the seed-parity reason above. Not a defect in
the redesign.

**Axe: 0 confirmed defects, 125 indeterminate nodes**, all one rule
(`color-contrast`), all on `train`: 12 (light/phone), 51 (dark/phone), 11
(light/desktop), 51 (dark/desktop). Per `verify-surfaces.ts`'s own header,
this app's four gradient-background surfaces (today/train/coach/body)
structurally can never resolve that rule either way — the indeterminate
count is real and worth trending down, but it does not gate, and the
CONFIRMED number the task requires at zero is zero.

Screenshots opened in both themes at both viewports:
`.screenshots/week-redesign/train-{light,dark}-{phone,desktop}.png`. Visual
read: the redesign's new pieces (verdict headline, day strip, two season
figures) render correctly and match the spec's descriptions. But every
pre-existing card below them is still there, unchanged — see "What it says"
below for why that matters more than it sounds like it should.

### Choice load, measured

Same method, same selector, same three-way split, phone viewport (390×844).
Script: an ad hoc Playwright pass (not committed — this repo has no
committed choice-load counter, same as the first measurement), signed in as
`dev@recover.local`, using `document.querySelectorAll` (not a Playwright
locator) specifically so the Next.js dev-mode indicator — a shadow-DOM
custom element — cannot leak into the count. Buckets identified structurally
rather than by guesswork: `appChrome` = everything inside
`nav.fixed.bottom-8` (`BottomNav`); `tabs` = everything inside
`nav[aria-label="Train sections"]` (`TrainTabs`'s `SegmentedTabs`); `surface`
= everything else matching the selector. **`appChrome` came out 5 on every
row below** — the method's own check, satisfied.

| Surface                                                    | surface |  tabs | appChrome | hidden/disabled |   scroll |
| ---------------------------------------------------------- | ------: | ----: | --------: | --------------: | -------: |
| Train ▸ Week — **2026-08-26, before**                      |      21 |     4 |         5 |              49 |      4.7 |
| Train ▸ Week — **2026-08-28, after (default, no `?day=`)** |  **28** | **3** |         5 |          **55** | **3.28** |
| Train ▸ Week — after, `?day=` a non-today workout day      |      28 |     3 |         5 |              55 |     3.28 |
| Train ▸ Week — after, `?day=` a non-today rest day         |      25 |     3 |         5 |              54 |     3.18 |

The "default" row is the one to compare against the spec's prediction: no
`?day=` in the URL is exactly what an athlete gets from tapping Train, and
it already opens today (Task 4) — there is no "no day open" state left to
measure separately, which is itself a real structural change from the
before row.

The two `?day=` rows exist because Task 4 made which day is open part of
the URL, and the spec's 1.2-screen prediction was implicitly a claim about
_that_ shape too. Opening a different day with a session (Sunday, non-today)
produces **byte-identical** counts and pixel-identical scroll height to the
default — confirmed separately by reading the verdict headline text off each
page (`"Friday is your long one."` vs `"Sunday is an endurance session."`,
proving the param really took effect and this isn't a caching artifact).
Opening a rest/nothing-planned day (Monday) drops exactly three controls —
the per-day `Move/Swap/Skip` select, the `Target day…` select, and `No time
today` — because there is no session on that day to act on. That is a clean,
legible difference; nothing else about the open-day panel's control count
moves.

### What it says

**The prediction did not hold. Choice load went up, not down — 21 → 28
visible, 49 → 55 hidden — and scroll length dropped by roughly a third
(4.7 → 3.28 screens) rather than by three quarters (the predicted 4.7 →
~1.2).** Tabs did drop, 4 → 3, exactly as expected (Season retired, Task 1).
Everything else moved the wrong way or moved much less than promised.

**Why, and it is not a mystery once you scroll the screenshot.** Tasks 1–6
added a verdict headline, a day strip (7 new `<a>` day cells), two season
figures, and a pinned action — real, working, and correctly built. But
nothing removed or collapsed what was already on the page below them:
`SessionFuelling`, `WhyThisWeek`, the confirmed-race outlook card, the
`What changed & why` collapsible, the `This week`/`Next week` availability
switcher with its own per-day list (7 more day buttons, one per weekday —
`MonRest`, `TueRest`, `Wed1h 35m`... — sitting right underneath the
brand-new day strip, doing an overlapping job), and the `Standard week` /
`Races` / `Remaining skeleton`
collapsibles. The new day strip is additive, not a replacement: an athlete
now has three separate places to pick a day (the strip, the open-day panel,
and the availability form's own day list), where before there were two.

**This matches what this plan's own self-review already flagged, not a
surprise it hid.** The task-7 brief's self-review says outright: "Race line
and the ⓘ destinations → slice 2, not this plan (they need sheets)... Summary
rows → slice 2." The 4.7 → 1.2 screens prediction in the spec was a claim
about the _finished_ redesign — sheets and all. Tasks 1–6 are slice 1 of
that: the top of the surface, not the collapse of everything beneath it.
Measured honestly, slice 1 alone gets Train ▸ Week from 4.7 to 3.28 screens
(-30%) while _adding_ seven controls and six hidden ones — a real
improvement in what leads the page, bought without yet paying down the
length or choice load the spec's number was about. The 1.2-screen, ~14-
control claim is still ahead of this branch, gated on the sheet work slice 2
was always going to be.

**One genuine, unambiguous win the numbers do show:** the old "no day open"
state (a report you had to hunt through) is gone. Every visit to Train ▸
Week now opens exactly one day, today's by default, with a verdict sentence
that is honest about whether it's describing right now or a day you've
scrolled to. That part of the prediction — "one day, not seven flattened
into a scroll" — is true. It just isn't the part that drove the headline
screens/controls numbers down, because nothing else on the page shrank to
make room for it.

---

## 2026-08-28 — Task 7 of `.superpowers/sdd/2026-08-28-week-destinations/`: slice 2, the removal half, measured

**This is the section slice 1 was missing.** Slice 1 (tasks 1–6 of
`2026-08-27-week-composition`, measured above) added a verdict headline, a
day strip and two season figures, and removed nothing — choice load rose
21 → 28 and scroll only fell 4.7 → 3.28 screens against a 4.7 → ~1.2
prediction. Slice 2 (tasks 1–6 of `2026-08-28-week-destinations`) is the
other half: `Why this week`, `Plan setup`, `Races`, `Availability` and
`Plan review` moved off the page and behind `?sheet=` destinations, each
reachable from a one-line summary row. This section measures what that
actually bought, with the same method, against the same seed, so the three
rows are comparable.

Branch `feat-week-destinations` at `01ae34e`, based on `main` at `ba4f48c`
(v0.122.0, the commit slice 1 merged at). Seeded with
`SEED_DEMO=1 DEMO_EMAIL=dev@recover.local npx tsx
scripts/seed-confirmed-race.ts` against the local dev DB (`127.0.0.1:5434`)
— the same script, same account, same "confirmed race only, no draft" seed
shape as both earlier measurements, for the same reason: comparability.

**Availability, checked before trusting the number** (the brief's own
warning, from a real defect found earlier on this branch: a claim true of a
fixture with no availability and false of a real athlete, because
`NextWeekSummary` renders seven more day rows once next week has any).
`seed-confirmed-race.ts` does not touch availability at all — it doesn't
need to. The dev account already carries real `availability_defaults` rows
(Tue–Sat, 95 min each, Sun/Mon empty) from earlier work on this database,
confirmed by querying `availability_defaults` directly before and after
seeding. That's enough for `nextWeekHasAvailability` to be true: the closed
page's screenshot below shows the real "~5 sessions planned, 0 open · 5.7h
planned of 7.1h target / Show all 7 days (provisional) →" summary, not the
no-availability branch. Measured against the fixture the brief asked for,
not the one that would have hidden the regression.

### Capture and axe

```
SCREENSHOT_BASE_URL=http://localhost:3210 npx tsx scripts/verify-surfaces.ts week-slice2 --only=train,train-plan-preview
```

`train` captured cleanly at all 4 theme/viewport combinations:
`.screenshots/week-slice2/train-{light,dark}-{phone,desktop}.png`.
`train-plan-preview` failed all 4, for the identical, expected reason
recorded in the slice-1 section above: its `waitForTwoArcPreview` guard
refuses to capture without a two-arc draft, and `seed-two-race.ts`
deliberately did not run — running it after `seed-confirmed-race.ts` would
hand the athlete a live draft alongside a confirmed plan and switch `/train`
onto a different render branch entirely (`PlanPreviewCard`, per that
script's own file header), which would stop measuring the surface this
section is about. Not a defect in the redesign.

**Axe: 0 confirmed defects, 66 indeterminate nodes**, across 4 rule findings
(all `color-contrast`, all on `train`, none on the failed
`train-plan-preview`): 10 (light/phone), 24 (dark/phone), 8 (light/desktop),
24 (dark/desktop). Verified against `.screenshots/week-slice2/axe-report.json`'s
own `totals`: `{"confirmedNodes": 0, "indeterminateNodes": 66}`. Per
`verify-surfaces.ts`'s header, this app's four gradient-background surfaces
structurally can never resolve `color-contrast` either way, so the
indeterminate count is real but does not gate — the number the task
requires at zero (confirmed) is zero. **66 is down from slice 1's
comparable 125** (train's own four combos there: 12+51+11+51) — a real,
if secondary, improvement, not claimed as this task's target.

### Choice load, measured

Same method as both rows above: visible+enabled
`button, a[href], input, select, textarea, [role=button]`, split
appChrome / tabs / surface, `document.querySelectorAll` (not a Playwright
locator, for the dev-mode-indicator reason the slice-1 section gives),
phone viewport 390×844 CSS px at `deviceScaleFactor: 2`. Script: another ad
hoc Playwright pass (still not committed — this repo still has no committed
choice-load counter), signed in as `dev@recover.local`. Buckets identified
structurally: `appChrome` = everything inside `nav.fixed.bottom-8`
(`BottomNav`); `tabs` = everything inside
`nav[aria-label="Train sections"]` (`TrainTabs`); `surface` = everything
else matching the selector. **`appChrome` came out 5 on every row below,
including every sheet open** — the method's own check, satisfied six times
over, not once.

| Surface                                                        | surface | tabs | appChrome | hidden/disabled |   scroll |
| -------------------------------------------------------------- | ------: | ---: | --------: | --------------: | -------: |
| Train ▸ Week — **before** (2026-08-26)                         |      21 |    4 |         5 |              49 |      4.7 |
| Train ▸ Week — **slice 1** (2026-08-28, default)               |      28 |    3 |         5 |              55 |     3.28 |
| Train ▸ Week — **slice 2** (2026-08-28, default, no `?sheet=`) |  **17** |    3 |         5 |           **7** | **1.84** |
| … `?sheet=why-week` open                                       |      18 |    3 |         5 |               7 |    1.84¹ |
| … `?sheet=plan-setup` open                                     |      27 |    3 |         5 |              17 |    1.84¹ |
| … `?sheet=races` open                                          |      32 |    3 |         5 |               7 |    1.84¹ |
| … `?sheet=availability` open                                   |      28 |    3 |         5 |              45 |    1.84¹ |
| … `?sheet=plan-review` open                                    |    n/a² | n/a² |      n/a² |            n/a² |     n/a² |

¹ The sheet is `position: fixed; inset: 0`, not part of document flow, and
`document.body.style.overflow` is locked to `hidden` while it's open — so
`document.documentElement.scrollHeight` for the underlying page is
unchanged at 1557px/1.84 screens no matter which sheet sits on top of it.
That number describes the page, not what's actually in front of the
athlete, which is why the sheet's own scroll extent is reported separately
below.

² Not reachable against this fixture: `plan-review` is gated on a live
draft (`draftPreview`), and this seed — deliberately, for the comparability
reason above — never creates one. Confirmed directly: `?sheet=plan-review`
renders no `[role="dialog"]` at all, and the page is byte-identical to the
default row. The same limitation `train-plan-preview`'s capture failure
already names; not measured here for the same reason it wasn't captured.

**The sheet's own scrollable extent** (its `[role="dialog"]` panel,
`maxHeight: 92svh; overflow-y: auto` — `scrollHeight` ÷ `clientHeight`,
the same "how many screens of this to get through" question the page
number answers for the page):

| Sheet        | panel scrollHeight | panel clientHeight (visible) | sheet screens |
| ------------ | -----------------: | ---------------------------: | ------------: |
| why-week     |             1049px |                        774px |          1.36 |
| plan-setup   |              943px |                        774px |          1.22 |
| races        |              292px |                        292px |          1.00 |
| availability |              651px |                        651px |          1.00 |

**What "surface" on a sheet-open row actually counts.** The background page
is not made `inert` or `aria-hidden` while a sheet sits over it —
`progress.md` for this branch already names this as a deferred minor from
Task 4 ("the page-level and sheet-level PinnedActions are both mounted
while a sheet is open — invisible... but both in the tab order"). So each
sheet-open row's `surface` count is the closed page's 17 (still true,
still technically focusable, just visually covered by the scrim) **plus**
the sheet's own new controls — confirmed by reading the delta, not assumed:

| Sheet        |                                              Δ surface (new controls the sheet itself adds) |                                                                                                          Δ hidden (new hidden/disabled nodes) |
| ------------ | ------------------------------------------------------------------------------------------: | --------------------------------------------------------------------------------------------------------------------------------------------: |
| why-week     |                                                                                  +1 (Close) |                                                                                                                                            +0 |
| plan-setup   |                             +10 (Close, 2 style/season toggles, 7 "standard week" day rows) |                                                                                 +10 (the 7 days' own nested block editors, present, unopened) |
| races        | +15 (Close, status/edit/delete on the one confirmed race, 8 add-race form fields, Add race) |                                                                                                                                            +0 |
| availability |                         +11 (Close, This week/Next week switcher, 7 day rows, Confirm week) | +38 (the _other_ week's whole `IntakeForm` — its 7 day buttons and per-day block-edit fields — sitting hidden in the DOM behind the switcher) |

availability's +38 is the same pattern the pre-slice-2 page already had —
`AvailabilityWeekSwitcher` always mounted both `IntakeForm`s and hid
whichever week wasn't selected — now inherited by the sheet rather than
invented by it.

**A check the numbers above imply and is worth stating outright: the sheet
content is genuinely gone from the default page's DOM, not CSS-hidden.**
Read directly off the captured HTML for the default (`?sheet=` absent) page:
zero occurrences of `"Add race"`, `"Your standard week"`, `"What changed"`,
`"remaining skeleton"`, `role="dialog"`, or the add-race form's
`aria-label="Priority"`. Every one of those strings is on the page only once
its own `?sheet=` is in the URL. That is a structurally different claim
from what the **before** row's 49 hidden controls were: those were `<details>`
collapsibles, present in the DOM and costed by assistive technology on
every load, whether opened or not. Slice 2's sheets are Next.js
conditionally rendering the content in only when the query param names it —
nothing to page-load, nothing to walk past, until the athlete taps the row.

### What it says

**The default-state numbers are the ones to hold against the spec's
prediction (4.7 → ~1.2 screens, 21 → ~14 visible controls, ~0 hidden), and
they are close, not exact — but decisively better than slice 1's regression
alone claimed.**

- **Screens: 4.7 → 3.28 (slice 1) → 1.84 (slice 2).** Slice 2 alone took
  another 44% off slice 1's number, and 61% off the original before-row.
  The prediction's ~1.2 is still not reached — 1.84 is roughly half a
  screen over it — but this is the same order of magnitude, not the same
  kind of miss slice 1 posted.
- **Surface controls: 21 → 28 (slice 1) → 17 (slice 2).** Slice 2 does not
  just cancel slice 1's regression, it goes past the original before-row:
  17 is fewer controls on the default page than Train ▸ Week has ever
  measured at, including before either slice existed. The ~14 prediction is
  3 controls away, not the "went up instead of down" story slice 1 alone
  told.
- **Hidden/disabled: 49 (before) → 55 (slice 1) → 7 (default, slice 2).**
  This is the biggest single move in the whole progression, and the DOM
  check above explains why it's real rather than a counting quirk: the
  weight didn't move to a `hidden` attribute, it moved out of the response
  entirely. The ~0 prediction basically held — 7 is the sidebar's
  phone-hidden duplicate nav (5), a duplicate owner-avatar link, and one
  disabled `What if?` button, all pre-existing to this redesign and present
  on every surface in the whole document, not new weight slice 2 added.

**The prediction did not fully hold, but the shape of the miss changed.**
Slice 1 alone, measured honestly, made the page worse on two of three axes.
Slice 2, measured the same way, makes it better on all three — past the
original baseline on controls and hidden weight, most of the way there on
screens — without the sheets' own content having vanished: it is one tap
away, at a legible, mostly-sub-1.4-screen cost per destination (races and
availability fit in exactly one sheet-screen with no scrolling at all;
why-week's 1.36 is the longest, because a race with four change-log entries
and a pacing paragraph is genuinely that much content).

**What's left of the gap, and whose it is.** Two things stand between 1.84
and the ~1.2 predicted, and neither is invisible or mysterious:

1. **The confirmed-race card (`RaceChip`) still renders directly on the
   page**, not behind a sheet — it's the item labelled
   `"🏁 Confirmed Race (demo) · A r…"` in the surface list, sitting between
   the pinned action and the summary rows. It's shared with Today
   (`src/components/today/race-chip.tsx`), and folding it away was not in
   this task list's scope (`task-7-brief.md`'s self-review names Races as
   "Task 3 (as a sheet, deviation argued above)" — the race _list_ moved,
   the race _chip_ didn't).
2. **`SessionFuelling` (the "Before / During / After" carb-and-fluid card)
   and the availability summary's own next-week preview are still on the
   page**, un-sheeted, by design — nobody on this task list argued they
   should move, and this measurement isn't the place to invent that
   argument retroactively.

Both are real, nameable, and neither is slice 3's drag-timeline (which is
availability's own editing surface, not any of this). If Train ▸ Week is to
close the remaining ~0.6 screens, it's one of these two, not a re-run of
this same measurement finding a different number by accident.

**Verdict: partly held, and materially better than "partly."** The
screens/controls/hidden triple the spec predicted did not land exactly —
1.84 vs ~1.2, 17 vs ~14 — but every one of the three moved in the right
direction by a wide margin, one of the three (hidden) landed almost exactly
on the prediction for a structurally real reason, and the whole page is
provably lighter today than it has ever been measured at in this document,
including before either slice started. That is not the ~74% cut the spec
promised. It is a genuine, evidenced, roughly 60% cut on scroll length and
a real cut on control count, with the rest of the gap named rather than
hidden.
