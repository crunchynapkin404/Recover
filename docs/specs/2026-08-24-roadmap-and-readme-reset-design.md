# Roadmap and README reset — design

Written 2026-08-24, the day v0.119.0 (strength training) reached production.
Three of the four phases in `docs/ROADMAP.md` are complete, the demand map that
drives "what's next" contains numbers that are wrong, and `README.md`'s status
section describes v0.50.0 — sixty-nine releases ago. Every claim below about
the current state was checked against the code or the live board, not against
another document.

## Why now

The roadmap in force was written at v0.65.0 as a **remediation programme**:
prove the numbers correct (Phase 2), then close the highest-ranked demand gaps
(Phase 3). That programme has finished — Phase 2 is 24 of 24, Phase 3 is 7 of
8, and the eighth item is "remainder of the demand map, by votes", which the
stock-take below shows is nearly empty. A roadmap organised the same way would
have almost nothing in it, which is not the same as the project being done.

## What Recover has today

Verified by reading the code, not the docs.

**Feature-complete against ranked external demand.** Every high-vote row on
<https://joincycling.featurebase.app/en/roadmap> is shipped or led:
multi-goal seasons (multi-A-race, v0.114.0, plus A/B race priorities with
distinct taper handling), advance planning (races weeks ahead, availability
beyond one week, plans that reshape around future races), six wellness/activity
sources (intervals.icu, Strava, Whoop, Oura, Apple Health, Withings), training
history, multiple time blocks per day, running, and strength (v0.119.0).

**Mechanically sound.** 2961 tests, 45 migrations, **zero confirmed axe
violations** across the app, an 83-token design system with a descriptive
`docs/design-system.md`, a 59-tool MCP surface frozen by snapshot, and a
release path that is fully automated end to end (`docs/RELEASING.md`).

**The remaining debt is epistemic, not functional.** 102 exported engine
constants carry `Confidence: Low` against 16 Medium and 2 High. And
`races.resultActivityId` — how each race actually went — is stored, exposed
over MCP, and round-tripped on import, but **nothing reads it**. The app has
never once checked a prediction against reality. `docs/ROADMAP.md` named this
itself when race pacing shipped: confidence "never reads high, because nothing
here is measured against this athlete's own race results… calibrating against
it is the release that could earn it."

That sentence is the whole thesis of the new roadmap.

## The demand map was wrong, and says so

On 2026-08-24 the board was re-scraped and the demand map "refreshed". That
refresh was **misaligned by one row** — it read the vote count _preceding_
each title rather than the one following it, because the scrape flattened the
page to text and the cards render as `TITLE · category · comments · votes`.
Every figure in that table was therefore wrong, and one derived claim —
"Strength training overtook Calendar, 121→155 vs 152→125" — is wrong in its
reasoning, is committed to `main`, and is quoted in v0.119.0's release notes.

What actually happened: Strength moved 121→**125** (+4) while Calendar fell
152→**123** (−29). Strength did end up ahead, by two votes because Calendar
collapsed, not by thirty because Strength surged. The build decision survives;
the stated reason does not.

The corrected table also has to be **wider than before**. The previous map
tracked only the board's "In Review" column, so the largest rows on the board —
several of which Recover leads — were absent entirely, and one row Recover
leads was recorded at 7 votes when the board says 280.

The new table carries a one-line note recording that it was wrong once and how
it is now derived. A table that silently corrects itself teaches nothing.

### Corrected standing (board re-read 2026-08-24, structured scrape)

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

**The one genuine gap is narrow.** "Calendar" reads as a large feature but its
own post and comments split cleanly in two: _"indicate when you're on vacation
so it can schedule a rest week"_ — which Recover already leads via availability
overrides — and _"push my workout schedule to my Apple or Google calendar"_,
which is absent. The gap is **ICS export**, not a calendar subsystem.

## Decisions

| #   | Decision                                                                                                   | Why                                                                                                                                                                                                                                     |
| --- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Archive the completed roadmap to `docs/archive/ROADMAP-through-v0.119.md`; write a fresh `docs/ROADMAP.md` | Direct precedent: this repo archived its 1,469-line predecessor at v0.65 with the framing "a record, not a plan; nothing there is scheduled." Same move, same reasoning. 1,390 lines is not a document anyone re-reads before deciding. |
| D2  | Keep the goal statement and the three pillars verbatim                                                     | They are good, they are load-bearing, and the drift they were written to prevent (v0.53–v0.64) is exactly the risk a fresh roadmap reintroduces. Not the place to innovate.                                                             |
| D3  | Demote the demand map to a "Where Recover stands" table                                                    | Demand was the spine of Phase 3 because there were ranked gaps to close. There are no longer any of consequence. It stays as an input and a scoreboard, not a work queue.                                                               |
| D4  | Three new phases: **5 Stability**, **6 Experience**, **7 Learn from results**                              | Matches the stated constraint — features are in, so stabilise, then make experience the maximum focus — while keeping one capability bet so the roadmap is not purely inward-facing.                                                    |
| D5  | Phase 6 items are each a brainstorm → spec → plan cycle, not checklist entries                             | Exactly how Phase 2b (design language and IA) was scoped, and 2b is the closest precedent for experience work in this repo. A UX phase written as a task list becomes a tweak list.                                                     |
| D6  | Phase 7 overlaps Phase 6 rather than queueing behind it                                                    | Its engine work is small; its surface ("we predicted 208 W, you held 214 W") is experience work. Sequencing them strictly would either delay the evidence or ship it without a surface.                                                 |
| D7  | A "Not scheduled" section, named but uncommitted                                                           | ICS export, MCP contract freeze, dormant-feature on-ramps, Fitbit/Google Health, Cycle-Aware. Naming them stops rediscovery; scheduling them would be a promise the phases above do not support.                                        |
| D8  | Full README rewrite, same skeleton                                                                         | Its status section is 69 releases stale. The hero, screenshots and MCP-first pitch are good and stay; everything factual is rewritten against verified state.                                                                           |

## Phase 5 — Stability

The precondition, deliberately small and finishable. Every item is a known,
named defect or gap, not an aspiration:

- The three parked doc-accuracy findings from v0.119.0 — chiefly that
  `SUBSTITUTE_TO.strength` became unreachable, so a comment naming it as the
  red-readiness mechanism is false even though the behaviour is right.
- **Soak capture flakiness**, found 2026-08-24 while releasing v0.119.0: the
  settings surfaces truncated non-deterministically (the same surface rendered
  5217 px in dark and 3649 px in light within one run). Step 8 of the release
  path depends on those images, and **a truncated PNG looks identical to a
  passing one** — the same class of blind spot as the pacing line that was
  never photographed until v0.117.0.
- Record the previous digest in `docs/ENVIRONMENTS.md`; `promote.yml` asks for
  it on every run and it was not done for v0.119.0.
- **Rollback has never been exercised against prod.** Documented, designed,
  untested — `docs/RELEASING.md` says so itself.
- `scripts/repair-plan-sport.ts` still refuses two-race plans.
- Triathlon and multi-day pacing refusals have still never been seen rendered.

## Phase 6 — Experience (the maximum focus)

Four strands. Each gets its own brainstorm → spec → plan cycle.

- **First run and onboarding.** Recover computes from the athlete's own
  baselines, so day one is inherently empty and "calibrating" _is_ the new
  athlete's first experience — a state designed as an edge case and serving as
  the front door.
- **Information architecture.** Today/Train/Coach/Body/Menu was set in v0.23.0
  and has had features bolted on since. Settings in particular has grown long
  enough that a reviewer got lost finding a card in it.
- **Flow and friction.** The multi-step journeys: confirm a week, plan a
  season, debrief a ride, connect a provider.
- **Visual polish and motion.** Transitions, loading states, density,
  typographic rhythm.

**Constraint carried from Phase 2b:** zero confirmed axe violations is a
ratchet, not a milestone. No experience work may regress it.

## Phase 7 — Learn from results

Read `races.resultActivityId`, compare prediction against outcome, and let the
comparison move constants off `Confidence: Low` where — and only where — the
evidence supports it.

- Compare predicted race pacing against the actual result activity.
- Compare the demand/feasibility estimate against what the athlete actually
  did.
- Surface the comparison. This is the most defensible thing the app could
  show, and it is the one capability that requires the athlete's own history —
  no competitor can do it without their data.

**The discipline that makes this honest:** calibration may only raise a
confidence label when the evidence genuinely supports the raise. A
calibration pass that concludes "still Low" is a successful pass. The taper
and transition evidence slices in Phase 3 are the model — six constants moved
to Medium, one stayed Low because nothing measures it, and the release changed
no behaviour.

## Not scheduled

Named so they are not rediscovered; unscheduled so they are not promises.

- **ICS export** — the one genuine demand gap (123 votes). Cheap to do badly:
  timezones, recurrence, and a feed URL that is a bearer credential in a query
  string.
- MCP contract freeze — after the numbers underneath are stable, not before.
- On-ramps for the three dormant-but-kept features.
- Fitbit / Google Health direct; Cycle-Aware.

## README

Same skeleton — the hero, the four screenshots and the MCP-first pitch are the
strongest things in it and stay. Everything factual is rewritten:

- **Status section**: currently claims v0.50.0 with a highlights trail from
  v0.21–v0.50. Replaced with the current release and a pointer to the roadmap
  rather than a restatement of it — a release trail in a README is a thing that
  goes stale by construction, and this one did.
- **Features**: add strength training; correct the MCP tool count to 59;
  verify every existing bullet against the code before keeping it.
- **The competitive claim**, which the README does not currently make and
  which is now the strongest true thing about the project: Recover leads or
  ships nearly every top-ranked row on the largest public demand board in this
  category, while remaining self-hosted and free.

## Testing

Documentation only — no code, no tests. The verification bar is instead:

1. Every factual claim in both documents traceable to code, a workflow file,
   or the live board — the same bar `docs/ROADMAP.md` sets for itself.
2. `npm run format:check` green (markdown tables need a second prettier pass).
3. No link in either document pointing at a section moved into the archive.
4. The corrected vote figures reproducible from the structured scrape, not the
   flattened-text one that caused the error.
