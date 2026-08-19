# Multi-A-race seasons — design

**Date:** 2026-08-19 · **Phase:** 3, first item (`docs/ROADMAP.md`) ·
**Status:** design, not implemented

**Pillar: Demand,** constrained by **Science**. "Choosing a new goal before the
last one's done" is the #1 ranked external request at **244 votes** and the
only demand-map row marked **Gap**. It is also the skipped `v0.53` — the point
where the roadmap stopped tracking its evidence and the work became UI
quick-switches. `ROADMAP.md:55` states the lesson: _"The failure was not speed.
It was working without a source."_ This document exists so the second attempt
does not repeat the first.

---

## What the code does today — verified, not assumed

**The plan is single-race by construction, at the API boundary.** Not a bug, not
an oversight in handling: there is no parameter for a second race.

- `previewTrainingPlan` / `previewFromDraft` / `confirmTrainingPlan`
  (`src/lib/training-plan.ts`) each take **one** `raceId`, and derive sport,
  date and priority from that single row.
- `periodize(weeksTotal, …)` returns one **Base → Build → Peak → Taper** arc
  sized by `PHASE_SHARE_*` (`src/lib/plan-constants.ts`). `weeksTotal` is the
  span to one date. There is no phase vocabulary for "after a race, before the
  next one".
- The chosen race is _"highest priority, nearest date among their upcoming
  races"_ (`training-plan.ts:1161`).

**What already works, and should not be rebuilt.** The taper is _not_ part of
the single-race arc — it is applied per week, at materialization:

- `racesForWeek(userId, weekStart)` is week-scoped;
  `materializeWeek` takes `races[0]` as `primary` and asks
  `taperFractionForWeek(weekStart, primary)`
  (`src/lib/week-plan/materialize.ts:215-228`).
- So **a second A-race already gets a correctly-shaped taper week** when its
  week arrives. The schema already permits it: `races.priority` is an
  `A | B | C` enum with no uniqueness constraint on `A`.

**Therefore the gap is precisely this:** an athlete with two A-races gets a full
periodised arc to the first, a correct taper for the second, and **nothing
structured in between** — no recovery/transition, no re-build, no second peak.
The plan simply ends at race one.

That is a much smaller and better-shaped hole than "multi-race is unsupported",
and it should be sized accordingly.

---

## The evidence problem this feature inherits

A second A-race **runs the taper machinery twice**. That machinery's constants
are labelled **Invented, Confidence: Low** by this repo's own Phase 2a
provenance pass (`docs/plans/2026-08-09-provenance-race-taper.md`), because
`docs/specs/2026-07-19-v0.14-race-ready-design.md` decided the numbers as a
design choice and no literature was ever connected to them. `taper.ts`'s own
doc comment says so.

**Checked against the literature for this document, and the news is good.**

[Bosquet et al. 2007, _Effects of tapering on performance: a meta-analysis_](https://www.semanticscholar.org/paper/Effects-of-tapering-on-performance:-a-Bosquet-Montpetit/a41517ab5fa06b92568b861e2b1aa32b3003d214)
(27 of 182 studies met inclusion) finds the most effective strategy is a
**2-week exponential taper reducing training volume 41–60%, with intensity and
frequency unchanged.**

| repo constant                     | value         | against Bosquet                                                                             |
| --------------------------------- | ------------- | ------------------------------------------------------------------------------------------- |
| `TAPER_WINDOW_MID` = 14d          | 2 weeks       | **matches the stated optimum**                                                              |
| `TAPER_FRACTION_RACE_WEEK` = 0.45 | 55% reduction | **inside the 41–60% band**                                                                  |
| `TAPER_FRACTION_WEEK_1` = 0.65    | 35% reduction | approaches the band across the 2-week window                                                |
| intensity handling                | preserved     | **matches** — `raceWeekWorkouts`: _"volume is gone, intensity touches stay"_, openers at Z3 |
| `TAPER_WINDOW_LONG` = 21d         | 3 weeks       | **longer than the optimum** — divergence, needs a rationale                                 |

**The existing taper is defensible and merely uncited.** Connecting it is a
small evidence slice, not a rewrite — and it is worth doing _before_ v0.53
rather than after, because a second A-race doubles the athlete's exposure to
every one of these numbers. A newer
[systematic review and meta-analysis in endurance athletes (PLOS One, 2023)](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0282838)
should be read alongside it, and would speak to the 21-day divergence.

**The bridge phase has no source at all yet.** Its duration, its load, and
whether a second peak can match the first are the claims this feature would be
making, and none of them are currently backed. That is the gate.

---

## Proposed sequencing

1. **An evidence slice on the existing taper** — connect the windows and
   fractions to Bosquet 2007 and the 2023 endurance review; raise Confidence
   where the numbers land inside the evidence; state a rationale or change the
   value for `TAPER_WINDOW_LONG`'s 21 days. No behaviour change expected.
   Small, and it de-risks everything after it.
2. **Then multi-A-race**, on numbers that carry a citation.

Doing (2) first would double an athlete's exposure to Low-confidence constants
and add a third invented structure on top. That is the v0.53 failure mode with
better tests.

---

## Design sketch — for review, not for implementation yet

**Phase vocabulary.** `periodize()` grows a notion of segments rather than one
arc: `Base → Build → Peak → Taper → [Race 1] → Transition → Rebuild → Peak →
Taper → [Race 2]`. The transition is the new phase and the one needing a
source.

**Selection.** Replace _"highest priority, nearest date"_ with an ordered list
of A-races within the plan horizon. `previewTrainingPlan` takes `raceIds`, not
`raceId` — the compatibility shim being that one id behaves exactly as today.

**Open questions, none of which should be answered by taste:**

- How long is the transition, and is it a function of the first race's distance
  class? (`TAPER_WINDOW_*` already classifies distance; the same classifier may
  apply.)
- Can the second peak equal the first, or must the plan say it will be lower?
  This is a claim about the athlete's outcome and needs science before the UI
  states it either way.
- What is the minimum inter-race gap below which a second A-race should be
  **refused** rather than planned badly? A refusal that names its reason is
  this repo's established pattern (`{ ok: false, reason }` in
  `previewTrainingPlan`).
- ~~Does the existing per-week taper need any change at all?~~ **Answered while
  writing this, by reading it.** `racesForWeek` (`src/lib/race/service.ts:198`)
  selects every `upcoming` race in a **28-day window** from `weekStart`, sorted
  priority-A-first then date — there is no filter to a "plan target" race. So
  when race two's taper weeks arrive, race two _is_ `races[0]`, and
  `materializeWeek` tapers it with no change required. The second taper is
  already free.

  One coupling to record while it is visible: that 28-day lookahead is what
  bounds the taper window, and `TAPER_WINDOW_LONG` is 21 days. The margin is
  7 days. Any future window longer than 28 days would be silently ignored
  rather than refused — worth a test pinning the two constants together.

---

## Non-goals

- More than two A-races. The demand row is "a new goal before the last one's
  done", not arbitrary multi-peak seasons.
- Changing what a B or C race does. `materializeWeek` already handles those and
  is out of scope.
