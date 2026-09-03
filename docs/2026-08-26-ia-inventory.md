# Information architecture — inventory

**Phase 6, strand 2. This is the inventory, not the proposal.** Written
2026-08-26 against `main` at `3bfd3ac` (v0.120.0). The handoff that opened
this strand said to map what is actually on each screen before designing
anything, because the first-run strand's largest win came from discovering in
the first ten minutes that its founding premise was wrong. This document is
that check.

Everything below was measured or read out of the file that implements it. The
scroll depths come from the capture artifacts of Actions run `32974982569` —
the real production build, seeded demo account, phone viewport 390×844 CSS px
at DPR 2. No figure here is an estimate.

---

## The nav, as defined

Five destinations, one list, two renderers (`src/lib/nav-items.ts:27-33`):

| Label | Route       | Icon            |
| ----- | ----------- | --------------- |
| Today | `/`         | `Clock`         |
| Train | `/train`    | `CalendarRange` |
| Coach | `/coach`    | `Sparkles`      |
| Body  | `/body`     | `Activity`      |
| Menu  | `/settings` | `Settings2`     |

`BottomNav` (below `lg`) and `SidebarNav` (`lg`+) render the same five and
never appear together. The comment above the list still calls this "Option B
IA (v0.21): one home per job".

**The fifth item is the only one whose label is not its route.** "Menu"
navigates to `/settings`, and `/settings`'s own `<h1>` reads "Menu"
(`src/app/settings/page.tsx:237`) — so the page renamed itself to match the
tab rather than the tab being named for the page. Whatever it is called, it is
the drawer: five collapsed accordions holding fifteen cards.

---

## Every destination, by depth

Level 1 is a nav tab. Level 2 is a segmented tab or an accordion within it.
Level 3 is a control that changes what level 2 shows.

```
/                       Today          — 3 clock-derived states, block-reordered
  ?sheet=checkin          Check-in sheet          (overlay, no route)
  ?sheet=debrief          Debrief sheet           (overlay, no route)
/train                  Train
  ?tab=week               Week           (default)
  ?tab=history            History
     &view=today|week|month              ← second tab row inside a tab
     &month=YYYY-MM                      ← trailing-6-month picker
  ?tab=season             Season
  ?tab=fitness            Fitness
     &range=30|90|180|365
/coach                  Coach
  ?thread=<uuid>          A conversation
  ?history=1              History panel (phone only; desktop reads it
                          from a header dropdown inside ChatInterface)
/body                   Body
  ?tab=trends             Trends         (default)
     &range=30|90|180|365                ← second row of chrome
  ?tab=sleep              Sleep
  ?tab=journal            Journal
  ?tab=labs               Labs
/settings               "Menu"
  ▸ Integrations          6 connector cards
  ▸ AI & Coach            2 cards
  ▸ Advanced / API        3 cards
  ▸ App                   4 cards  ← incl. BodyPrefsCard
  ▸ Data                  export JSON · import CSV

OFF-NAV — reachable only by link, never by a tab:
/import                 from Today, and from Settings ▸ Data (two doors)
/activity/log           from Train ▸ Week only
/activity/<uuid>        from Today's JustLandedCard, and Train ▸ History rows
/admin                  from Settings' identity row — an "Admin →" text link
                        above the accordions, owner-only (settings/page.tsx:266)
/login  /join/<code>    unauthenticated
/wellness               redirect → /body?tab=journal (kept for old bookmarks)
```

Five tabs at the top. **Twenty-one destinations beneath them** — 15 second-level
tabs and accordions, 2 overlay sheets, 4 off-nav routes. (Today's three states
are not counted: `?state=` only reorders blocks and `previewStateFrom` refuses
it outright in production, so they are one screen, not three. `/login`,
`/join/<code>` and the `/wellness` redirect are not counted either.)

---

## Measured scroll depth

Phone, light theme, production build, seeded demo athlete. "Screens" is CSS
height ÷ 844.

| Surface                    | CSS px | Screens |
| -------------------------- | -----: | ------: |
| Settings, connect-errors   |   6709 |     7.9 |
| **Settings, all expanded** |   6619 | **7.8** |
| **Train ▸ Week**           |   4004 | **4.7** |
| Settings, token created    |   2314 |     2.7 |
| Body ▸ Journal             |   2043 |     2.4 |
| Today, post-session        |   1924 |     2.3 |
| Admin                      |   1686 |     2.0 |
| Today, evening             |   1525 |     1.8 |
| Today, morning             |   1350 |     1.6 |
| Check-in / debrief sheets  |   1350 |     1.6 |
| Body ▸ Sleep               |   1310 |     1.6 |
| Login                      |   1242 |     1.5 |
| Activity detail            |   1198 |     1.4 |
| Coach (all four states)    |    972 |     1.2 |
| Activity log               |    969 |     1.2 |
| Train ▸ History            |    884 |     1.0 |
| Import                     |    876 |     1.0 |
| **Body ▸ Trends**          |    844 | **1.0** |
| **Body ▸ Labs**            |    844 | **1.0** |
| **Train ▸ Season**         |    844 | **1.0** |
| **Train ▸ Fitness**        |    844 | **1.0** |
| Settings, collapsed        |    844 |     1.0 |
| First run — all four tabs  |    844 |     1.0 |

844 CSS px is the viewport exactly: those surfaces **do not scroll at all**.
That is a real measurement, not a truncated capture — `screenshotStable()`
polls until height settles, and a page shorter than the viewport reports the
viewport height. Train ▸ Season was opened and confirmed by eye: one card,
three stat tiles, a two-bar chart, ending just past the halfway mark with a
full screen of empty gradient beneath it.

---

## What the numbers say

### 1. The four Train tabs are not four peers

Week is **4.7 screens**; Season and Fitness are **under one**, History is
exactly one. A segmented control asserts that its segments are siblings of
comparable weight. Here one segment carries roughly ten times the content of
two others, and it is also the default — so the tab row's main job in
practice is to let an athlete leave the only tab that has much on it.

Week's own stack, in render order (`src/app/train/page.tsx:791-1153`):
header with two switches and a week picker → the tab row → plan preview →
week strip → day list → fuelling → rationale → event readiness → race chip →
feasibility/adjustments → intake form → **three more collapsibles** (Standard
week, Races, Remaining skeleton). Eleven sections plus three drawers, on the
tab that opens by default.

### 2. Body has one inbound link in the entire application

Grepping every `href` in `src/app` and `src/components`, the only link to
`/body` from anywhere is Today's `href="/body?tab=journal"`
(`src/app/page.tsx`). **Trends, Sleep and Labs are reachable only by pressing
the Body tab and then a second tab.** Nothing in the app ever points an
athlete at their own HRV trend.

For contrast, counting only links from _other_ surfaces: `/train` gets three
(Today's `WeekRow` and `RaceChip`, the activity detail page), `/settings`
three (Today ×2, Coach's `ChatInterface`) plus the sidebar's pinned avatar
row, and `/coach` two (Today's `CoachBrief`, Train's `PlanEmpty`) plus three
of its own internal thread links. Body's one is the lowest in the app.

### 3. Body ▸ Trends spends two rows of chrome before its first number

Title row, then Trends/Sleep/Journal/Labs, then 30d/90d/180d/365d, then the
first card. On a 1.0-screen surface, roughly a quarter of the viewport is
navigation. Train ▸ History does the same thing one level deeper: the Train
tab row, then a Today/Week/Month row, then a six-month picker.

### 4. Settings is the depth problem, and it is not the landing screen

Collapsed it is 1.0 screen — five rows, perfectly legible. Expanded it is
**7.8 screens**. Both are true, and the second is what an athlete looking for
one control actually traverses, because the accordion labels do not predict
their contents well enough to open only one:

- **`BodyPrefsCard` is under "App"**, between notification settings and LLM
  usage. The handoff records an implementer losing real time to this. "App"
  is where it went because it is not an integration, not the coach, not an
  API and not data — it is the drawer's drawer.
- "Advanced / API" holds **Sessions**, which is where an athlete signs other
  devices out. That is a security action, not an advanced one.
  **Fixed in v0.134.0** — Sessions has its own "Security" section.
- **Import has two doors** — Today links `/import`, and Settings ▸ Data links
  `/import` — and Export has one, inside Data. The two halves of the same job
  are not in the same place.
  **STRUCK 2026-09-03, on reading the code.** This describes a shape the app
  does not have. Today's `/import` link (`src/app/page.tsx`) sits *inside*
  the `isFirstRun` branch, beside "Log manually" — it is the onboarding door
  for an athlete with no data at all, not a second door on Today. And
  Settings ▸ Data already renders Data export and Import CSV adjacent in one
  section, under the badge `Export · Import CSV`; the two halves are already
  together. Both doors are correct. Acting on this finding would have
  rerouted a working first-run affordance to fix nothing. See
  `docs/specs/2026-09-03-settings-navigability-and-anchors-design.md`.

### 5. Nothing knew which of these screens anyone uses — **fixed in this branch**

As found: `src/lib/telemetry.ts` recorded a closed set of **nine** surfaces:
`today, train, coach, body, settings, admin, import, activity, activity-log`.
The comment explains the closure — pathnames would make the table unbounded —
and it is right to be closed. But the set stopped at the route, so **no tab
was counted**. `recordSurfaceView(user.id, "body")` fired identically whether
the athlete opened Trends or Labs. Of the twenty-one destinations above, nine
had usage data and the eleven second-level ones — exactly those this inventory
calls unequal — had none.

This one is closed rather than logged, because every other finding here is a
judgement that wants evidence and this was the missing instrument:

- `recordSurfaceView` takes an optional third argument, typed against the
  surface it belongs to — `("body", "season")` does not compile. Train and
  Body now pass it, recording after the tab resolves rather than at the top
  of the render.
- Stored colon-joined (`body:labs`) in the existing `text` column, so **no
  migration**. `SURFACE_TABS` imports `TRAIN_TABS`/`BODY_TABS` from
  `log-href.ts` rather than restating them, so a tab cannot become navigable
  and uncounted.
- `SurfaceViewsCard` folds tab keys under their parent and labels the bare
  pre-v0.121 rows `untabbed · before v0.121`, so the discontinuity reads as a
  release boundary instead of a bug.

Seventeen keys instead of nine. **The counter now has to run for a while
before it answers anything** — that is the cost of the instrument arriving
after the question, and it is the reason this was worth doing before the
brainstorm rather than after.

---

## What did not turn out to be wrong

The first-run strand found its premise wrong in ten minutes. This one did
not, and that is worth stating plainly rather than manufacturing a reversal:

- **Today is in good shape.** Its blocks are ordered by a tested table
  (`src/lib/today/block-order.ts`), every state renders every block, and the
  order is asserted against the DOM by `assertBlockOrder`. It is the one
  surface with a structural contract.
- **The five-tab top level is not obviously wrong.** Today/Train/Coach/Body
  are four different questions, and no measurement here says otherwise. The
  strain is one level down.
- **Coach is uniformly ~1.2 screens across all four captured states** and has
  no sub-tabs at all — its old Inbox tab was already merged into History
  (`src/app/coach/page.tsx:23`, which redirects `?tab=inbox`). That
  consolidation is the shape the rest of the app has not had yet.

So the finding is narrower and duller than "the IA is wrong": **the top level
is sound and the second level is where features were bolted on.** Every
symptom above is a level-2 symptom.

---

## Open questions this inventory does not settle

1. **Should Train ▸ Season and Train ▸ Fitness be tabs at all** at one screen
   each, or sections of a scrolled surface? Cannot be answered by measuring —
   it depends on whether an athlete goes to Fitness deliberately, which is
   exactly what the telemetry cannot say.
2. **Where does `BodyPrefsCard` belong** — Body, or a Settings section that
   admits it holds preferences about the body? Moving it is a two-line change
   and a capture update; deciding it is the IA question.
3. **Does Body need four tabs** when three of them are one screen and nothing
   links to any of them?
4. **Is "Menu" a tab or a drawer?** It is the only nav item that is a
   container rather than a job, and it is the only one whose page had to
   rename itself to agree with the tab.

---

## Next step

The instrumentation this inventory called for is **done, in this branch** —
see finding 5. Questions 1 and 3 above are now answerable by waiting rather
than by arguing; nothing else here is.

So the next step is the **brainstorm on structure**, with one deliberate
asymmetry: questions 1 and 3 (are Season/Fitness/Sleep/Labs really tabs?)
should be **left open until the counter has data**, because they are precisely
the ones evidence can settle and a restructure decided this week would throw
that evidence away. Questions 2 and 4 — where `BodyPrefsCard` belongs, and
whether "Menu" is a tab or a drawer — cannot be settled by counting and are
ready to decide now.

That is a proposal about _how to decide_, not about the structure. The
structure itself still needs a brainstorm, and per the handoff the spec for it
should bind very little beyond "the axe ratchet does not regress" and "no
route 404s".
