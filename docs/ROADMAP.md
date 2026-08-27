# Roadmap

Current release: **v0.121.0**. History through v0.119 is preserved in
[`docs/archive/ROADMAP-through-v0.119.md`](archive/ROADMAP-through-v0.119.md) —
Phases 1–4, all complete. It is a record, not a plan.

The programme that roadmap encoded — prove the numbers, then close the
ranked gaps — is finished. What follows is organised differently, and the
reason is in "Where Recover stands" below.

## The goal

> **Recover is a self-hosted endurance training companion that plans around the
> time an athlete actually has, and never shows a number it cannot defend.**
>
> Every figure traces to a source with a stated confidence. Baselines are the
> athlete's own, not population norms. When it does not know, it says so.

The second clause is deliberately testable. Phase 2 made every exported
engine constant carry a source and a confidence; 102 of 120 are still
`Confidence: Low`. Phase 7 exists to earn the raises the evidence supports —
what the clause tests has changed, not whether it can be tested.

A proposal that does not serve that sentence does not belong on this roadmap.

## The three pillars

Every item here must name which pillar it answers to. They answer different
questions, and conflating them is what produced the v0.53–v0.64 drift.

| Pillar        | Question          | Source                                                                             |
| ------------- | ----------------- | ---------------------------------------------------------------------------------- |
| **Science**   | What is _true_?   | Peer-reviewed literature. Constrains what may be claimed.                          |
| **The forum** | What is _hard_?   | <https://forum.intervals.icu/c/ai-tools/> — ~30 competing tools failing in public. |
| **Demand**    | What is _wanted_? | <https://joincycling.featurebase.app/en/roadmap> — ranked votes from paying users. |

Science says what you may claim. The forum says where the bar is. Demand says
what to build next. **None substitutes for another** — a high vote count never
licenses a number science cannot back.

### Why this is written down

The roadmap tracked its evidence exactly through v0.52, then diverged:

| Planned (`2026-08-05-ai-coaching-landscape.md` §9) | Shipped                        |
| -------------------------------------------------- | ------------------------------ |
| v0.49–v0.52                                        | as planned ✓                   |
| **v0.53 Multi-A-race seasons**                     | planning-surface-parity-lock ✗ |
| **v0.54 Race pacing**                              | plan-style-quick-switch ✗      |

From v0.53 the work became UI quick-switches, and quality collapsed with it:
v0.56–v0.60 built and advertised a control that never reached the week it
edited, v0.61 removed a safety clamp it claimed to respect, v0.63/v0.64 were
published from a red build. Both skipped items are what demand ranks highest.

The failure was not speed. It was working without a source.

## Where Recover stands

**Feature-complete against ranked external demand.** Every high-vote row on
Recover's category board is shipped or led: multi-goal seasons (multi-A-race,
v0.114.0, plus A/B race priorities with distinct taper handling), advance
planning (races weeks ahead, availability beyond one week, plans that reshape
around future races), six wellness/activity sources (intervals.icu, Strava,
Whoop, Oura, Apple Health, Withings), training history, multiple time blocks
per day, running, and strength (v0.119.0).

**Mechanically sound.** 3015 tests (587 skip without a database), 45 migrations, zero confirmed axe
violations across the app, an 83-token design system
(`docs/design-system.md`), a 59-tool MCP surface, and a release path that is
fully automated end to end (`docs/RELEASING.md`).

**The remaining debt is epistemic, not functional.** 102 of 120 exported
engine constants carry `Confidence: Low` (16 Medium, 2 High). And
`races.resultActivityId` — how each race actually went — is stored, exposed
over MCP, and round-tripped on import, but nothing reads it. Phase 7 exists
because of that gap, not because of the numbers above.

Board re-read 2026-08-24 with a structured scrape. **An earlier refresh the
same day was wrong** — it read each card's vote count from the row above,
understating some figures and overstating others, and tracked only the
board's "In Review" column. The figures below are per-card (`title ·
category · comments · votes`) across every column.

| Votes | Request                                       | Recover                         |
| ----: | --------------------------------------------- | ------------------------------- |
|   304 | Multiple goals (sub-goals in one plan)        | **Leads** — multi-A-race + A/B  |
|   284 | Integration with intervals.icu                | **Leads** — two-way             |
|   283 | Health data integration (WHOOP/Apple/Garmin)  | **Leads** — six sources         |
|   280 | Training History                              | Has                             |
|   280 | Multiple availabilities per day               | **Leads**                       |
|   199 | Plan activity further in the future           | **Leads**                       |
|   164 | Add running workout                           | Has                             |
|   161 | Choosing new goal before the last is finished | Shipped (v0.114.0)              |
|   155 | Availability beyond one week ahead            | **Leads**                       |
|   155 | Add length filter when browsing workouts      | n/a — no workout library        |
|   125 | Strength training                             | Shipped (v0.119.0)              |
|   123 | Calendar                                      | **Partial — ICS export absent** |
|   107 | Show target cadence in workout                | n/a — no workout player         |
|    65 | Different FTPs indoor/outdoor                 | Shipped (v0.118.0)              |
|    52 | A more specific skills/power profile overview | Partial — power/pace curves     |
|    45 | Landscape mode                                | n/a — no workout player         |
|    33 | Indoor–outdoor switch                         | Partial — see v0.118.0          |
|    33 | Import completed activity FIT files           | Partial — CSV only              |

**The one genuine gap is narrow.** "Calendar" splits cleanly in two:
vacation-planning, which Recover already leads via availability overrides,
and **ICS export**, which is absent. The gap is ICS export, not a calendar
subsystem.

## Phase 5 — Stability

The precondition, deliberately small and finishable. Every item is a known,
named defect, not an aspiration:

- [x] The three parked v0.119.0 doc-accuracy findings — chiefly that
      `SUBSTITUTE_TO.strength` became unreachable, so a comment naming it as
      the red-readiness mechanism is false even though the behaviour is
      right.
- [x] **Soak capture flakiness**, found 2026-08-24 while releasing v0.119.0:
      the same settings surface rendered 5217 px in dark and 3649 px in
      light within one run. A truncated PNG is indistinguishable from a
      passing one.
- [x] Record the previous digest in `docs/ENVIRONMENTS.md` —
      `promote.yml` asks for it on every run; it was not done for v0.119.0.
- [x] **Rollback exercised against prod, 2026-08-26** — v0.119.0 → v0.118.0
      and back, 3m42s down and 4m13s up, prod on the older image for about
      four and a half minutes. It proved the thing the additive rule rests on
      and nobody had ever watched: old code running against a schema ahead of
      it, `"db":"up"`, zero failed jobs. Also exposed a real constraint —
      `Promote` needs the target release's original Soak run id, so a rollback
      target is only reachable while that run still exists. Numbers and the
      constraint are in `docs/RELEASING.md`.
- [x] `scripts/repair-plan-sport.ts` refusing two-race plans is **correct
      behaviour, not a defect** — reframed 2026-08-26 after three handoffs
      carried it as an open to-do. It is a v0.42 one-off repair for a single
      live plan (its header names it), and the defect class it repaired is now
      structurally closed: a plan's sport flows through
      `requirePlanSport(race.sport)`, which throws on an unsupported sport
      rather than falling through to running — the exact v0.42 bug. Refusing a
      two-race plan, loudly and with its reason, is the honest outcome; the
      alternative is collapsing a two-arc season into one. The script is
      tested and wired into no workflow.
      **The real open question is whether to retire it**, and that is a
      judgement about operational tooling rather than a bug: keeping a tested
      repair tool that refuses safely costs almost nothing, and deleting it
      because "the bug cannot happen any more" is the kind of confidence this
      project usually declines. Not scheduled either way.
- [x] Triathlon and multi-day pacing refusals have now been seen rendered
      (2026-08-26). Both reach the page through the `!card.pacing.available`
      branch in `src/app/train/page.tsx` and read correctly in place. A
      triathlon surfaces two distinct refusals — the demand card's "no demand
      figure yet" and the pacing line's own — each naming a different missing
      thing. **Permanent capture coverage is NOT closed by this** and is a
      larger piece than it looks: `nextUpcomingRace` picks strictly by
      earliest date, so seeding a refusal race alongside the existing
      confirmed one hijacks the race card on every `train*` surface. It needs
      a second seeded athlete or a tie-break, and deserves its own scoping.

## Phase 6 — Experience

The maximum focus. Four strands, each its own brainstorm → spec → plan
cycle — the discipline Phase 2b (design language and IA) used, because a UX
phase written as a checklist becomes a tweak list:

- [x] **First run and onboarding**, closed in v0.120.0. Recover computes
      from the athlete's own baselines, so day one is inherently empty and
      "calibrating" _is_ the new athlete's first experience — an edge case
      serving as the front door. Today already had a proper welcome card;
      Train, Body and Coach did not, so a new athlete who clicked around
      before connecting anything met four different flavours of nothing
      with no way back. One shared predicate — `isFirstRun()`, strictly
      gated on no active connection _and_ no wellness ever — now drives all
      four tabs through the `missing_input`/`fix` vocabulary the rest of the
      app already standardised on; Body's four repeated "not enough
      readings" statements collapse to one; a returning athlete whose
      wellness is older than 90 days is no longer mistaken for brand new;
      and all four first-run screens get real capture coverage for the
      first time — no capture had ever photographed a dataless account.
      Two rendering defects (a JSX-whitespace bug, a missing sidebar
      identity row) were found only by opening those new screenshots. This
      strand is one of four in Phase 6 — information architecture, flow and
      friction, and visual polish remain open.
- [ ] **Information architecture.** Today/Train/Coach/Body/Menu was set in
      v0.23.0 and has had features bolted on since; Settings alone has grown
      long enough that a reviewer got lost finding a card in it.
      **Inventory done** (`docs/2026-08-26-ia-inventory.md`), and it did
      _not_ overturn its premise the way the first-run strand did: five tabs
      sit above twenty-one destinations, the top level is sound, and every
      measured symptom is one level down. Settings expanded is 7.8 phone
      screens and Train ▸ Week is 4.7, while Body ▸ Trends, Body ▸ Labs,
      Train ▸ Season and Train ▸ Fitness do not scroll at all — four tabs
      the nav presents as peers of a surface ten times their size. Body has
      exactly one inbound link in the whole app.
      The inventory's own recommendation shipped with it: **tab-level
      telemetry**, because the counter recorded nine route keys and none of
      the eleven second-level destinations the inventory calls unequal.
      Seventeen keys now, no migration.
      **Two of the four questions are decided** (v0.121,
      `docs/2026-08-26-ia-decisions.md`), and they are the two counting could
      never have settled. "Menu" is now **Settings** — the label promised a
      hub of destinations while the page behind it was a settings page, and
      the page had renamed its own `<h1>` to agree with the tab rather than
      the other way round. And `BodyPrefsCard` — wake time, max HR, both
      FTPs, threshold pace, four 1RMs — left "App", where it sat between the
      push toggles and LLM usage, for its own section, **Your baselines**,
      placed second directly under Integrations. Those are not settings about
      the app; they are the figures every engine number is computed against,
      which is the goal sentence's own word. Body links to it, closing the
      one surface that had a single inbound link and no outbound one.
      **The other two stay parked on purpose** — whether Season, Fitness,
      Sleep and Labs deserve to be tabs is exactly what the new counter
      exists to answer, and deciding it now would discard the evidence just
      commissioned. Note that no usage evidence exists yet and none was
      claimed: `surface_views` shows `settings` as the most-viewed surface,
      and that figure is the capture script visiting four settings surfaces
      plus dev-server link-prefetch. Flow and friction, and visual polish,
      are unblocked by this: the top level is settled and Today's morning
      grid is not moving.
- [ ] **Flow and friction.** The multi-step journeys: confirm a week, plan a
      season, debrief a ride, connect a provider.
      **Inventory done** (`docs/2026-08-26-flow-inventory.md`): a structural
      map of the four journeys, and then choice load — how many things an
      athlete can actually press — measured in a real browser at 390x844.
      Train ▸ Season has **zero** actions: one screen of content, four tab
      controls to reach it, nothing on it to press, which is evidence for the
      IA strand's parked question rather than taste. Train ▸ Week is worst on
      both axes at once (4.7 screens, 21 visible controls, 49 more hidden or
      disabled). Body ▸ Journal is a flow rendered as a page (27 controls on
      2.4 screens). Those figures are fixture-dependent and the document says
      so, including the seed that made the first run of them wrong.
      **First fix: connect a provider**, the finding that needed no
      measurement to state. Six connectors sat under one "Integrations"
      heading doing three structurally different things — three redirect to a
      third party and come back through a callback, two want a token pasted
      here, one wants a push set up from a device that is not this one — and
      nothing on the card said which one the athlete was about to enter. One
      sentence per mechanism now does, owned by the connector shell rather
      than written five times, so the six stay comparable; each connect
      control points at it with `aria-describedby`, so an athlete tabbing
      straight to "Connect" hears the warning that it leaves the app rather
      than just the word "Connect". Strava's disconnected subtitle said "Not
      connected" — which the button beside it already said — and now names
      its data like the other four.
      Still open in this strand: the week adjustment that has no path
      (`src/app/train/page.tsx:812` already states the choice — either the
      action re-materializes the open week, or the copy describes the
      skeleton it actually edits), Season's zero actions, and the Week tab
      owning the season editing the Season tab only reports.
- [ ] **Visual polish and motion.** Transitions, loading states, density,
      typographic rhythm.

**Constraint carried from Phase 2b:** zero confirmed axe violations is a
ratchet, not a milestone. No experience work may regress it.

## Phase 7 — Learn from results

Read `races.resultActivityId`, compare prediction against outcome, and let
the comparison move constants off `Confidence: Low` where — and only where —
the evidence supports it. This overlaps Phase 6 rather than queueing behind
it: the engine work is small, and the surface ("we predicted 208 W, you held
214 W") is experience work.

- [ ] Compare predicted race pacing against the actual result activity.
- [ ] Compare the demand/feasibility estimate against what the athlete
      actually did.
- [ ] Surface the comparison to the athlete — the one capability that
      requires this athlete's own history, which no competitor can do
      without their data.

**The discipline that makes this honest:** calibration may only raise a
confidence label when the evidence genuinely supports the raise. A
calibration pass that concludes "still Low" is a successful pass. The taper
and transition evidence slices in Phase 3 are the model — six constants
moved to Medium, one stayed Low because nothing measures it, and the release
changed no behaviour.

## Not scheduled

Named so they are not rediscovered; unscheduled so they are not promises.

- **ICS export** — the one genuine demand gap (123 votes). Cheap to do
  badly: timezones, recurrence, and a feed URL that is a bearer credential
  in a query string.
- **MCP contract freeze** — after the numbers underneath are stable, not
  before.
- **On-ramps for the three dormant-but-kept features** — Deep Biology,
  outbound webhooks, coach long-term memory.
- **Fitbit / Google Health direct, and Cycle-Aware.**
