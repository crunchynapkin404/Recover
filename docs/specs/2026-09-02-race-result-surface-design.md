# The race result, on a screen — design

ROADMAP Phase 7's third item: "Surface the comparison to the athlete — the one
capability that requires this athlete's own history, which no competitor can do
without their data." Written 2026-09-02, after v0.129.0 shipped the engine.
Every claim below about existing behaviour was read out of the file that
implements it.

## The engine already exists, and nothing renders it

v0.129.0 added `comparePacing` (`src/lib/race/pacing-result.ts`),
`racePacingResult` (`race/service.ts`) and `get_race_result_pacing`. The figure
is complete: target, band, what was held, the signed delta, and a verdict in
effort terms, with four first-class refusals.

**It reaches an athlete only if they think to ask the coach.** That is the whole
gap.

## What measuring the surface found

Three things, and the second one changes what this item is.

**1. The pacing figure is already one tap deep.** The forward-looking pacing
prose is not on Train — it lives inside the `why-week` sheet, behind a
`SummaryRow` (`train/page.tsx`, "the one row that replaces all four"). So the
existing precedent for a pacing figure is _a sheet_, not the page.

**2. A FINISHED RACE CURRENTLY VANISHES FROM EVERY SCREEN.** `RaceChip` is
built from `raceCard`, which is built from `nextUpcomingRace`, which filters
`status = "upcoming"`. The debrief sets `status: "completed"` in the same
transaction that links the result. From that moment the race is on no surface
at all. This item is therefore not "add a line to the race card" — the card
the line would go on no longer exists by the time there is anything to say.

**3. But the Races sheet already lists completed races.** `train/page.tsx:565`
calls `listRaces(userId)` with **no status filter**, so every race — upcoming,
completed and skipped — is already rendered by `races-section.tsx`, each row
carrying a status control. There is already a durable place where a finished
race appears. Nothing has ever put anything useful in it.

**4. The debrief is the one proactive post-race moment.** `runRaceDebriefs`
assembles `statLines` (race-morning readiness, duration and load, taper
execution) and posts one message to the athlete's morning thread. It is the
only thing in the app that speaks to the athlete _because_ a race happened.

## Decisions

| #   | Decision                                                                                | Why                                                                                                                                                                                                                                                                                                                      |
| --- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | **Two surfaces, one figure**: the Races sheet row (durable) and the debrief (proactive) | They answer different questions. The debrief answers "how did Sunday go" at the moment the athlete wants to know; the sheet answers "what did I hold at Alpine Tour" three months later. One is a message that scrolls away, the other is a row that does not. Both read `racePacingResult` — never a second derivation. |
| D2  | **No new block on Train or Today, and no change to `RaceChip`**                         | The chip is the _upcoming_ race and is shared with Today. Making it mean two things is how a component acquires a second job. A new post-race block is the expensive option and would need its own anchor, its own empty state and its own capture surface for a thing an athlete looks at a handful of times a year.    |
| D3  | **The Races sheet row is the primary deliverable**; the debrief line is secondary       | The sheet is deterministic, durable, and already renders completed races. The debrief passes through `phrase()`, an LLM with a 10s cap, so its exact wording is not guaranteed — acceptable for a stat line, wrong for the only place a number lives.                                                                    |
| D4  | **The debrief gets the comparison as a `statLines` entry**, not as new prose            | That array already feeds both the deterministic template and the LLM instruction, which ends "Never invent numbers not given here". Reusing it inherits the Strava firewall, the template fallback and the instruction, and adds one line. Inventing a second path would need all three again.                           |
| D5  | **Every refusal renders, via `<Unavailable>`**                                          | Four of them, and they are the point. `Figure`'s vocabulary and the house `<Unavailable>` component already handle `calibrating` / `missing_input` / `not_applicable` uniformly, and the forward pacing line already uses it. A refusal that renders as a blank row is the failure the vocabulary exists to prevent.     |
| D6  | **`N` most recent raced races, not all of them**                                        | `racePacingResult(userId, raceId)` is one race per call, and the sheet can hold a season. Rendering a comparison for a race from three seasons ago costs a query and says nothing. Bounded, and the bound is declared rather than assumed.                                                                               |

## What the row says

The figure is already shaped for this. For a bike race:

```
Alpine Tour · 12 Aug · completed
Predicted 208 W (hold 198–218) · you held 214 W — harder, +2.9%
The target was not recorded before the start …
```

**`verdict` is the word that carries**, and it is in effort terms for both
sports — for a run, `harder` is a _faster_ pace and a _lower_ seconds-per-km.
The raw `deltaSecPerKm` runs the other way and the tool's own `note` says so.
A surface that renders the delta without the verdict will read backwards to
every runner, which is exactly the mutation `pacing-result.test.ts` exists for.

## The `why` is not optional here

Every other figure on this surface carries its assumption, and this one has a
harder thing to admit than most: **the target was never recorded before the
start.** It is recomputed from the anchors that were on file on race day, and
`body_prefs` has no history so an athlete-set anchor is still today's value.

That sentence is already in `RECOMPUTED_WHY` and travels with the figure. It
must render, not sit behind a tooltip, for the same reason the forward pacing
line renders its own: the assumption is the point, and a tooltip is where an
assumption goes to be dropped.

## When it refuses

All four already exist and all four must be seen rendered:

- **No result linked yet** → `missing_input`, "this race's result activity".
  The common case for a race in the last 48 hours.
- **A Strava result** → `not_applicable`, naming the provider agreement. Linked
  as bookkeeping, never scored.
- **A bike result with no power** → `missing_input`, "average power for the race".
- **Distance too far from the race's own** → `not_applicable`, naming both
  figures. A DNF or a mis-linked activity.

## Capture coverage, which is the part that will be skipped

**The Soak cannot photograph this.** Its seeded owner is a marathon runner with
no linked race result, and `train-workout` is already excepted from soak.yml
for the same class of reason (#224). The evidence has to come from a
PR-level capture job.

Worse, the _interesting_ states are refusals, and a seeded athlete has at most
one of them. This is the same shape as the two gaps this project has already
recorded — "no capture photographs a disconnected connector", and the
triathlon/multi-day pacing refusals that shipped unrendered for a release.

**So this slice budgets for a seeded race result** in the cycling owner
(`scripts/seed-cycling-owner.ts` already builds a gran-fondo plan), plus a
decision — named here rather than discovered later — about whether one seeded
refusal is enough or whether the refusals get a dedicated fixture.

## Testing

- **The pure work is done.** `comparePacing` is unit-tested and
  mutation-verified; this slice adds no maths.
- **Assert wiring at the surface**, through the real `racePacingResult` — a
  component test proves the component renders what it is handed, not that the
  sheet hands it the right race.
- **A test per refusal**, asserting the athlete-facing sentence renders, not
  merely that something did.
- **The debrief line is asserted on the deterministic template**, not on the
  LLM path — `runRaceDebriefs` already takes an `llm` override for exactly this.
- **A Strava-result debrief must not carry the comparison**, asserted
  end-to-end. The firewall is already inside `comparePacing`, so this is a
  regression test on the wiring, not on the rule.

## What this deliberately does not do

- **No new Train or Today block, and no change to `RaceChip`.** See D2.
- **No history view of every past race's pacing.** D6 bounds it; a season-long
  pacing history is a different feature with a different question behind it.
- **No calibration.** Reading the comparison back into the constants is Phase
  7's own stated purpose and a separate release. This slice moves no confidence
  label, and the comparison still inherits the prediction's exactly.
- **No demand/feasibility comparison.** That is Phase 7 item 2, still open, and
  bundling them would put two engines behind one surface decision.

## The one question for the owner

**How long should a finished race stay visible, and where?** D1 puts the
durable answer in the Races sheet, which is honest but quiet — an athlete who
does not open that sheet sees the comparison once, in a chat message, and then
never again. The alternative is a post-race state on Today for some window
after the race, which is D2's expensive option and would need its own capture
coverage and its own empty state.

This spec takes the quiet answer deliberately, because it is reversible and
because a finished race currently vanishes entirely — the sheet is strictly
better than nothing and does not commit the surface to anything. If the answer
is "an athlete should be met with it", that is a larger slice and should be
scoped as one.
