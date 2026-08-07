# v0.46 — Demand knows its sport

Design spec, 2026-08-07. Sequenced as v0.46 in
`docs/specs/2026-08-05-ai-coaching-landscape.md` §9, carrying F3 and F7 from
`docs/specs/2026-08-05-training-plan-audit.md`.

## Premise

`estimateRidingHours` is the drag equation: `CdA`, air density, an FTP fraction
ladder, and a mass documented as _"Rider plus bike plus kit"_. `eventDemand`
calls it for every event of every sport, and `volume-inputs.ts:198` calls
`eventDemand` for whatever race is the target — **with no sport check anywhere
on the path**, even though `races.sport` has been a stored, validated
`["Bike","Run","Triathlon"]` enum since v0.42.

The defect is not that a running model is missing. It is that **one cycling
model is applied to three sports with no dispatch key**, and everything
downstream inherits the assumption: `race/feasibility.ts` names its output
`requiredLongestRideHours`, `EventReadiness` hardcodes the word "ride", and
`longestRideHoursOf` returns the longest activity of any kind at all.

Both failure directions are silent. A runner **with** an FTP has a marathon
priced as roughly 1.2 h of cycling against a real 3–4 h run — understated by a
factor of three. A runner **without** one gets `null`, `volume.ts:79` takes its
`ceilingHours == null || raceDemandHours == null` branch, and the entire
race-driven volume feature reverts to `constraints.hoursPerWeek` without a word
on any screen.

This release gives demand a sport, and gives every figure it produces a
confidence and a reason. Where a figure cannot be produced, the release makes
that **loud** — which is the half that has been missing for four releases.

## Scope decision

This defect is invisible to the instance's own athlete, who is a cyclist with an
FTP of 310. It is taken next anyway, on the roadmap's own rule that breadth
never lands before the arithmetic under it is right, and because it is the last
remaining silent-wrongness defect in the v0.42 audit.

Deliberately **not** in scope:

- **Swim as a plan sport.** `PLAN_SPORTS` still refuses `Swim` and there is
  still no swim workout branch in `generateWorkouts`. Swim is _priced_ only as
  a leg inside a triathlon, never as a standalone race. Pricing is not planning.
- **`weeklyTargetHours`'s arithmetic.** The `min(demand, ceiling)` logic, the
  null-ceiling suppression and the floor all stay exactly as they are. This
  release changes what `raceDemandHours` **is**, not what is done with it.
- **B/C taper behaviour.** `effectiveWeekLoad`'s ±20 % ramp guard clamping the
  skeleton taper back up stays deferred to v0.47, as ruled during v0.45.
- **`README.md`,** stale at v0.40.1 and now six releases behind. Its own pass.

## Findings this spec rests on

All verified against `main` at `cca6707`, by reading the code, not assumed.

### F3 — The race-demand model is cycling-only, and is applied to every sport

`eventDemand` (`race/demand.ts:53`) returns `null` unless `input.ftpWatts > 0`,
then prices the event with `estimateRidingHours` (`race/riding-time.ts:67`) for
every sport. `volume-inputs.ts:198` supplies `ftpWatts` from
`prefs?.ftpWatts ?? latestEftp` and `massKg` from the athlete's weight plus a
documented `+ 8` for "bike and kit". Nothing on the path reads `target.sport`.

Carried verbatim from the audit; re-verified line by line on `cca6707`.

### F7 — Two vocabularies for race type

`races.race_type` is free text (live value: `GranFondo`) while
`generate_training_plan`'s `raceType` is a closed 13-value enum (live value:
`gran_fondo`).

**The audit's framing is now stale, and this spec corrects it.** v0.42's
`normaliseRaceType` + `RACE_TYPE_SPORT` exact lookup (`plan-sport.ts:67-137`)
already collapses `gran_fondo`, `GranFondo` and `gran fondo` onto one key, so
sport inference no longer runs against two spellings. What remains today is
purely cosmetic — raw `raceType` reaches plan titles and the coach's summary
(`training-plan.ts:1447`, `:1526`), so an athlete can see "gran_fondo training
plan".

F7 acquires real weight only because of this release. §4's triathlon leg
lookup is keyed by the same normalised string, so a spelling that fails to
collapse no longer produces an odd title — it produces **no demand figure at
all**.

### F3b — `longestRideHoursOf` has no sport filter (new; not in the audit)

`volume-inputs.ts:88-105` dedupes the history and returns the longest
`durationS` of **any activity of any kind**. It is named for a ride and computes
the longest session. It feeds `feasibility.longestRideHours`, which drives the
longest-session verdict rendered by `EventReadiness`.

For the reporting cyclist it happens to be a ride. For a triathlete, marathon
readiness is answered by their longest **bike ride**; for a cyclist who also
hikes, a long walk can outrank every ride they own. Same defect class as F3,
one module over, and reached the same way — a cycling assumption with no sport
check.

### F8 — `ctlDelta` and the week around it use two different windows

`weekly-review.ts:210-231`: `weekLoad`, `sessions` and `avgReadiness` are all
computed from `thisWeekDays` — a calendar week — while `ctlDelta` compares
`latestWellness.ctl` against the most recent wellness row on or before
`sevenAgoYmd`, a rolling 7-day lookback. The two are rendered in **one
sentence** at `:262`. Assigned to v0.46 during v0.45; carried here as a rider.

---

## The design

### 1. One dispatch point, three priced disciplines

```text
races.sport ─┬─ "Bike"      → estimateRidingHours       (exists, unchanged)
             ├─ "Run"       → estimateRunningHours      (new)
             └─ "Triathlon" → swim + bike + run legs    (new, composed)
                              ↑ leg distances from a raceType lookup
```

Above all three sits an athlete-stated finish time that wins outright. Below
them sits an honest refusal. Both carry a confidence and a reason.

`races.sport` is the dispatch key. It is already stored, already validated
against the enum, and already the authority `generateWorkouts` dispatches on
since v0.42 — so this release adds no new notion of "what sport is this", it
routes demand through the one that exists.

### 2. The running model

`estimateRunningHours` mirrors `estimateRidingHours`'s shape — an anchor, a
duration decay, an elevation cost — with every term sourced to running
literature.

**Anchor: threshold pace.** A new `body_prefs.threshold_pace_sec_per_km`, the
exact analogue of the existing `ftpWatts`.

Its fallback, when unset, is derived from history: the fastest pace sustained
over a run of **at least 5 km within the trailing 180 days**, read from
`activities.distanceM / activities.durationS` where `canonicalSport` is `Run`,
then Riegel-converted **to** a one-hour reference so it enters the model on the
same footing as a stated threshold pace. Riegel is used in both directions —
history to threshold, threshold to race distance.

The derived value is rated **Low** confidence for a reason that must be stated
rather than assumed: nothing in `activities` distinguishes a hard effort from an
easy long run, so the fastest qualifying run is a **floor** on the athlete's
ability, not a measurement of it. A well-trained athlete who has raced nothing
recently will be under-anchored, and the direction of that error is known —
demand is understated, never overstated. `threshold_pace_sec_per_km` exists so
the athlete can correct it, and the Low-confidence reason string says so.

The intervals.icu pace curve (`athlete_curves`, `kind: "pace"`) is deliberately
**not** the anchor. `athlete-curves.ts` requires an active `intervals_icu`
connection and returns `{ available: false, reason: "no_connection" }`
otherwise, so a Strava-only or manual athlete would get nothing — and the
volume path is a database read, not a network call. Putting a provider-gated
fetch under plan generation would trade one silent failure for another.

**Duration decay: Riegel's endurance formula.** `T₂ = T₁ × (D₂/D₁)^1.06`
(Riegel 1981, _American Scientist_, "Athletic Records and Human Endurance").
This is the running counterpart of the FTP-fraction ladder — the same job,
published. Threshold pace is by definition roughly one-hour race pace, so the
reference performance falls out of the anchor with no second input:
`D₁ = 3600 / thresholdPaceSecPerKm` km at `T₁ = 1 h`.

**Confidence: Medium, not High.** Vickers & Vertosick (2016), _An empirical
study of race times in recreational endurance runners_ (BMC Sports Sci Med
Rehabil), found the exponent varies with training volume and runs above 1.06 for
recreational runners. The value stands; the rating states the sensitivity rather
than smoothing it over.

**Elevation: ITRA km-effort.** `effectiveFlatKm = distanceKm + elevationM / 100`
— one metre of ascent priced as ten metres of flat, then run through the decay
above.

**Confidence: Low, and labelled convention rather than physiology**, the same
way v0.45 labelled the 3:1 mesocycle. A Minetti-derived metabolic model
(Minetti et al. 2002, _J Appl Physiol_) is the more rigorous alternative and is
rejected on purpose: the honest error bar on the anchor is wider than the
difference between the two models, so the extra machinery would buy precision
the inputs cannot support. This reasoning is recorded in the evidence document
so a later reader does not mistake it for an oversight.

### 3. The triathlon model

Three legs, summed. The bike leg reuses `estimateRidingHours` unchanged; the run
leg uses `estimateRunningHours`; the swim leg is priced from the athlete's own
swim history — the **median pace across swims of at least 400 m in the trailing
180 days**, where `canonicalSport` is `Swim`.

Median rather than fastest, and no duration decay: a triathlon swim leg is
0.75–3.8 km, short enough that within-swim decay is inside the anchor's own
error, and unlike the running anchor a median over many pool sessions is already
a fair reading of sustainable pace rather than a floor. Recorded in the evidence
document as **Low** confidence and as a modelling choice, not a measurement.

**Leg distances come from a `raceType` lookup**, keyed by `normaliseRaceType`:

| normalised key                   | swim km | bike km | run km |
| -------------------------------- | ------- | ------- | ------ |
| `ironman`                        | 3.8     | 180     | 42.2   |
| `70.3`, `halfironman`            | 1.9     | 90      | 21.1   |
| `olympictri`, `olympictriathlon` | 1.5     | 40      | 10     |
| `sprinttri`, `sprinttriathlon`   | 0.75    | 20      | 5      |

These distances are **definitional**, which is what makes a lookup legitimate
here where it would not be for a gran fondo: "Ironman" fixes the course length,
"gran fondo" tells you nothing about whether it climbs 800 m or 4000 m. The
generic key `triathlon` is deliberately absent — it names a sport, not a
distance.

`races.distanceKm` holds a single total for a triathlon and cannot be
decomposed: 226 km does not split back into 3.8 / 180 / 42.2. So for Triathlon
the lookup wins, and any stated `elevationM` is attributed **entirely to the
bike leg**, documented as an approximation on the grounds that a triathlon's
climbing is overwhelmingly on the bike.

**Transitions (T1/T2, roughly 5–15 minutes) are omitted and noted** — below the
model's own error bar. This is the same call `demand.ts:108-111` already made
for cumulative multi-day fatigue, and it is recorded the same way.

**No invented defaults, and no partial pricing.** If any leg cannot be priced —
an unrecognised triathlon format, no swim history — the whole figure is
unavailable, with a reason that names the fix.

A documented default swim pace was considered and rejected. The athlete-stated
finish time is the honest answer to the cold-start case: a first-time Ironman
athlete has no swim history but does know they are targeting sub-13, and typing
that produces a high-confidence figure immediately. Inventing a swim pace would
put a number with no source into a training target — the precise failure v0.45
existed to remove.

### 4. The athlete-stated override

A new `races.expected_finish_hours`. It is the athlete's own figure for how long
the event takes them, and it wins over every model.

When it is set, **no leg pricing is attempted and no anchor is required**. The
stated duration enters the model where a computed `totalHours` would, and flows
through the event-to-weekly ratio unchanged. This is what rescues every refusal
case in §3: an unrecognised triathlon format, a missing swim history and a
runner with no threshold pace are all answered by one number the athlete already
knows, rather than by a default nobody can source.

This mirrors the existing `races.demand_hours_override` and does not replace it.
The two are different quantities and both are kept:

- `expected_finish_hours` — how long **the event** takes. Feeds the model at the
  duration step, so it flows through the event-to-weekly ratio, the queen-stage
  figure and feasibility exactly as a modelled duration would.
- `demand_hours_override` — how many hours **a training week** should ask for.
  Applied last, after the ratio, as today.

### 5. Making the silent case impossible

Today `eventDemand` returns `null` and `volume.ts:79` takes its fallback branch
without telling anyone. **A nullable return is what let this hide for four
releases**, and replacing the model without replacing the return type would
leave the same hole under a better number.

```ts
export type EventDemandResult =
  | ({ available: true } & EventDemand)
  | { available: false; reason: DemandUnavailableReason };
```

A discriminated result cannot be consumed without handling the unavailable
branch. This is the mechanism v0.43 established for `previewTrainingPlan`, and
the house style the last three releases converged on: v0.39's
`Carried<Table, Exempt>` and v0.40's `Record<SecurityEvent, true>` witness both
put the guarantee in the compiler rather than in a test or a reviewer's
attention.

`DemandUnavailableReason` is a closed union, each member carrying the sentence
that names the fix — "no swim history yet — add your expected finish time",
"unrecognised triathlon format", "no threshold pace and not enough recent runs".

`EventDemand` gains a confidence level and a reason:

| Level      | When                                                                         | Reason shown                                                                   |
| ---------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **high**   | the athlete stated the finish time                                           | "Your expected finish time."                                                   |
| **medium** | modelled from an athlete-set anchor (`body_prefs.ftp_watts`, threshold pace) | "Modelled from your FTP and the course profile."                               |
| **low**    | modelled from a synced or history-derived anchor, or from an average day     | "Estimated from your recent runs — set a threshold pace for a sharper figure." |

The reason is one string, rendered to the athlete **and** handed to the coach,
so the two surfaces cannot diverge — the discipline `assembleWeeklyTarget`
already enforces for the hours number, applied to the number's provenance.

This is the Domestique pattern named in the landscape survey §6: cap the
confidence and say so, rather than reporting a derived metric flat.

### 6. The vocabulary follows the sport

Three renames, all currently wrong for two of three sports:

- `longestRideHoursOf(activities)` → `longestSessionHoursOf(activities,
disciplines)`, filtered through `disciplinesOf(race.sport)` against
  `canonicalSport(activity.sport)` — never the raw provider word, per the note
  already standing in `plan-sport.ts:166-173`. This closes F3b.
- `feasibility.requiredLongestRideHours` → `requiredLongestSessionHours`, and
  `longestRideWeeksNeeded` → `longestSessionWeeksNeeded`.
- `EventReadiness` selects its noun from the sport — "longest ride" / "longest
  run" / "longest bike leg" — instead of hardcoding "ride" at
  `event-readiness.tsx:53` and `:58`.

`LONGEST_RIDE_FRACTION` and the reasoning attached to it in
`feasibility.ts:12-18` are cycling evidence. Whether the same fraction holds for
a marathon is a separate question with a separate answer; the evidence document
records the fraction as **unvalidated outside cycling** rather than silently
inheriting a High rating across sports.

### 7. The `ctlDelta` window (rider)

`weekly-review.ts:221-231` gains a calendar-week lookback matching
`thisWeekDays`, so the sentence at `:262` carries one definition of "this week"
instead of two.

---

## Data model changes

| Table        | Column                      | Type      | Why                                                                                   |
| ------------ | --------------------------- | --------- | ------------------------------------------------------------------------------------- |
| `body_prefs` | `threshold_pace_sec_per_km` | `integer` | Running anchor; the analogue of `ftp_watts`. null = derive from history, then refuse. |
| `races`      | `expected_finish_hours`     | `real`    | Athlete-stated event duration. Wins over every model.                                 |

Both nullable, both defaulting to null — and that is precisely the hazard.
Drizzle marks a column optional in `$inferInsert` whenever it is nullable or
defaulted, so omitting either one from an insert site **compiles clean**. Both
must therefore be brought under `Carried<Table, Exempt>`
(`src/lib/export/carried.ts`) and `scripts/export-import-drill.ts` re-run. This
is the exact defect v0.39 shipped a type to prevent, and that type only binds
over columns that are in scope for it.

No swim anchor column. Swim is priced from history or not at all (§3).

---

## Testing

Every model change is verified by **reading actual output across a sweep**, not
by a green suite:

- A marathon priced across a range of threshold paces and elevation profiles,
  with the resulting weekly demand printed week by week.
- An Ironman and a 70.3 priced across a range of anchors, with each leg's
  contribution printed separately so a leg that silently returns zero is
  visible.
- The existing gran fondo case re-priced and diffed against `main` to prove the
  cycling path is **byte-identical** — this release must not move the reporting
  athlete's numbers at all.

v0.45's lesson is carried into the implementation plan explicitly: **plan-
authored test blocks are drafts to verify, never text to transcribe.** Ten
plan-authored defects landed across five of ten tasks last release, every one
of them in what the plan _asserted_ rather than what it _identified_. Each test
in this plan is to be run against the implementation before it is trusted, and
each guard mutation-tested — all four of v0.45's real defects were code that
worked and quietly did something else with a green suite at the moment it was
introduced.

DB-backed tests must follow `describe.skipIf(!hasDb)`, and the suite is to be
run once with `DATABASE_URL` **unset** before pushing, per the standing CI
guard.

---

## Evidence document

A new `docs/specs/2026-08-07-race-demand-evidence.md`, mirroring
`docs/specs/2026-07-28-training-volume-evidence.md` and
`docs/specs/2026-08-06-periodize-evidence.md`: every new constant with its
source and an honest confidence rating, including the three already marked down
here — Riegel's exponent at Medium, ITRA km-effort at Low/convention, and
`LONGEST_RIDE_FRACTION` recorded as unvalidated outside cycling.

## What "done" looks like

1. A marathon entered by a runner with no FTP produces a real weekly demand
   figure, or a refusal naming what to add — never a silent fallback.
2. A marathon entered by a runner **with** an FTP is no longer priced as a bike
   ride.
3. An Ironman prices three legs, and says which one it could not price when it
   cannot.
4. The reporting cyclist's gran fondo figures are unchanged, byte for byte.
5. Every demand figure on screen carries a confidence and a sentence saying
   where it came from.
6. `/train` says "longest run" to a runner.
