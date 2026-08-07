# Evidence base for the race-demand constants

Companion to `docs/specs/2026-07-28-training-volume-evidence.md`, which covers
the cycling demand model, and `docs/specs/2026-08-06-periodize-evidence.md`,
which covers the skeleton generator. This one covers what v0.46 added when
`eventDemand()` learned to dispatch on sport: the running model in
`src/lib/race/running-time.ts`, the swim leg in `src/lib/race/swim-time.ts`,
the triathlon leg table in `src/lib/race/triathlon-legs.ts`, and the
history-derived anchors in `src/lib/week-plan/anchors.ts`.

**Short answer: one constant is a published, if contested, exponent; one is a
fixed convention; the leg distances are definitional facts, not estimates; and
the rest are judgement calls stated as such.** The most consequential finding
of this pass is not a brand-new constant at all — it is that
`LONGEST_RIDE_FRACTION`, sourced entirely from cycling coaching literature, is
now applied to running and triathlon feasibility with no supporting evidence
in either sport. Confidence is stated per constant so future tuning knows what
it is overriding.

## Summary

| Constant                       | Value                 | Evidence                                                                                                        | Confidence                           |
| ------------------------------ | --------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `RIEGEL_EXPONENT`              | 1.06                  | Riegel 1981, _Athletic Records and Human Endurance_                                                             | **Medium**                           |
| `VERTICAL_METRES_PER_FLAT_KM`  | 100                   | ITRA km-effort convention                                                                                       | **Low**                              |
| Swim leg race-pace adjustment  | _none — no constant_  | No published magnitude found for the net open-water/race-day effect                                             | **N/A — deliberate absence**         |
| `ANCHOR_CONSTANTS.WINDOW_DAYS` | 180                   | Judgement: wider than the 12-week volume-peak window because threshold moves slowly                             | **Low**                              |
| `ANCHOR_CONSTANTS.MIN_RUN_KM`  | 5                     | Judgement: Riegel needs a reference within a few multiples of the target                                        | **Low**                              |
| `ANCHOR_CONSTANTS.MIN_SWIM_M`  | 400                   | Judgement: below this, warm-up dominates pace                                                                   | **Low**                              |
| `TRIATHLON_LEGS` distances     | 3.8/180/42.2 km, etc. | Governing-body course definitions (Ironman / World Triathlon)                                                   | **High** — definitional              |
| `LONGEST_RIDE_FRACTION`        | 0.8                   | Cycling coaching guidance, itself contested — now applied to running/triathlon with no evidence in either sport | **Low, unvalidated outside cycling** |
| `EVENT_TO_WEEKLY_1DAY`         | 0.6                   | Calibrated against a long cycling sportive — now converts a marathon and an Ironman to weekly hours too         | **Low, unvalidated outside cycling** |
| `MULTI_DAY_EXPONENT`           | 0.686                 | Fitted to two cycling anchors (0.60 at one day, 2.50 at eight)                                                  | **Low, unvalidated outside cycling** |

## 1. `RIEGEL_EXPONENT = 1.06` is published, and its own error is characterised rather than hidden

Riegel 1981, _Athletic Records and Human Endurance_, American Scientist
69(3):285-290, gives the endurance decay `T₂ = T₁ × (D₂/D₁)^k` with `k ≈ 1.06`
across a wide range of race distances. This is the running counterpart of the
FTP-fraction ladder used for cycling — the same job, sustainable effort
decaying with duration, from a published source rather than a fitted curve.

**Confidence: Medium**, not High, and the reason is named rather than
smoothed over: Vickers & Vertosick 2016 (BMC Sports Sci Med Rehabil, _An
empirical study of race times in recreational endurance runners_) found the
exponent varies with training volume and runs **above** 1.06 for recreational
runners specifically. Since `(D₂/D₁) > 1` for any race longer than the
one-hour reference, a higher true exponent means a longer true time — so 1.06
**understates** a recreational athlete's marathon time relative to their real
decay rate. The direction of the error is known and it is the safe one: the
model asks for less than a true worst case would, not more.

The demand sweep (`scripts/demand-sweep.ts`) confirms the arithmetic is
sound, not merely plausible in the abstract. At a 5:00/km (300 s/km) threshold
pace — roughly a 1:45 half-marathoner — the flat marathon prediction is 3:48.
Using race-time equivalency (McMillan-style) tables as a cross-check, a
1:45 half typically predicts a marathon in the 3:40–3:50 range; 3:48 sits
inside that band. At a faster 4:00/km threshold the model predicts a 3:00
flat marathon, matching the same tables' prediction for a runner of that
class within a few minutes. Both checks are consistent with a real endurance
decay curve, not an artifact of the code.

## 2. `VERTICAL_METRES_PER_FLAT_KM = 100` is a stated convention, and the rigorous alternative was rejected on purpose

The ITRA "km-effort" formula (`effectiveFlatKm = distanceKm + elevationM /
100`) prices 100 m of ascent as one extra kilometre of flat running, then runs
the whole effective distance through the Riegel decay above. This is the same
status v0.45 gave the 3:1 mesocycle cadence: convention, not physiology, and
labelled as such.

**Confidence: Low.** The rigorous alternative — a Minetti-derived metabolic
cost model (Minetti et al. 2002, _J Appl Physiol_, "Energy cost of walking and
running at extreme uphill and downhill slopes") — was considered and
deliberately **not** used, for two reasons: it needs a grade distribution
(the shape of the climbing, not just its total) that the race form does not
collect, and the honest error bar on the pace anchor itself — a threshold
pace typed once, or derived as a floor from history — is already wider than
the gap between what the two elevation models would predict. Building the
more rigorous machinery would spend engineering effort buying precision the
inputs cannot support.

The sweep's elevation sanity checks land where a hilly-marathon reader would
expect: at a 5:00/km threshold, going from flat to +2000 m of gain moves the
prediction from 3:48 to 5:43 — roughly a 50% increase for an event whose
climbing (2000 m over 42.2 km, ~47 m/km average gradient) is genuinely closer
to a mountain race than a road marathon. That is a large but defensible
order of magnitude for that profile, not a sign of a broken formula.

## 3. The swim leg has no race-pace adjustment — a stated assumption, not a missing feature

`estimateSwimHours` (`src/lib/race/swim-time.ts`) multiplies distance by the
athlete's own pace with nothing else applied — no duration decay (the leg is
short enough, 0.75–3.8 km, that within-swim decay sits inside the anchor's own
error) and, more importantly, **no race-day adjustment of any kind**.

This is deliberately different from the running and cycling legs, both of
which price a race-day effort against a training-derived anchor. An earlier
draft of the implementation plan for this release added a
`SWIM_RACE_PACE_FACTOR` constant set to `1.0` as a "tuning point" — a
multiply-by-one dressed up as a decision, and exactly the kind of unsourced
number this evidence document exists to catch. It was caught in planning and
never shipped. **The swim leg is priced at the athlete's own median training
pace, full stop.**

The reason is stated rather than assumed: open-water conditions (wetsuit
buoyancy, drafting, current, sighting overhead) and race-day effort pull in
opposite directions, and no published magnitude for the _net_ effect —
after those two forces are combined — was found during this pass. Rather
than invent a number to fill the gap, the model prices the swim leg at what
is actually known: the athlete's own measured pace. This is recorded as
**N/A**, not **Low**, in the summary table, because there is no constant to
rate — the absence is the decision.

## 4. `ANCHOR_CONSTANTS` are judgement calls, and the running anchor is a floor, not a measurement

`src/lib/week-plan/anchors.ts` derives a threshold pace and a swim pace from
the athlete's own activity history when neither has been set in Settings.
Three constants govern the derivation, all rated **Low**:

- **`WINDOW_DAYS = 180`** — deliberately wider than
  `LEVEL_CONSTANTS.PEAK_WINDOW_WEEKS` (12 weeks / 84 days), the window used
  for the rolling volume peak. The two serve different purposes: a volume
  peak should be recent, but a physiological threshold moves slowly enough
  that a 12-week window risks missing an entire off-season and anchoring on
  nothing. 180 days is a judgement call about how slowly threshold pace
  drifts, not a measured decay rate.
- **`MIN_RUN_KM = 5`** — Riegel's decay is most trustworthy when the
  reference performance is within a few multiples of the target distance; a
  3 km parkrun extrapolated out to a marathon (14×) is a much longer
  extrapolation than a 5 km time run out to the same target (8.4×). 5 km is a
  round-number floor on that reasoning, not a derived cutoff.
- **`MIN_SWIM_M = 400`** — below this, warm-up and pool-turn overhead
  dominate a swim's average pace enough that the number would not represent
  sustainable effort. 400 m is judgement, not a measured threshold.

The **running** anchor carries an additional, more important caveat, worth
stating plainly rather than leaving implicit: `thresholdPaceFromHistory`
takes the **fastest** qualifying run in the window. Nothing in `activities`
distinguishes a genuine hard effort from an easy long run recorded at a
similar pace by coincidence, so the fastest qualifying run is a **floor** on
the athlete's ability, not a measurement of it. A well-trained athlete who
has not raced or done a hard effort recently will be under-anchored, and the
direction of that error is known and safe: demand comes out understated,
never overstated. `body_prefs.threshold_pace_sec_per_km` exists precisely so
the athlete can correct this by typing a real number.

The **swim** anchor uses the **median** pace instead, deliberately not the
same rule as running: a pool session is already a fair reading of sustainable
pace (there is no "hard effort vs. easy long run" ambiguity in a swim set the
way there is in a run), so a median resists one outlier sprint set in a way a
maximum would not.

## 5. `TRIATHLON_LEGS` is a fact table, not a model

The three legs of a standard-distance triathlon (Ironman 3.8/180/42.2 km,
70.3 1.9/90/21.1 km, Olympic 1.5/40/10 km, Sprint 0.75/20/5 km) are rated
**High** confidence because they are not estimates of anything — they are the
courses' own governing definitions. "Ironman" and "70.3" are brand names that
fix a distance by definition, the same way "marathon" fixes 42.2 km; there is
nothing to source beyond the rulebook. This is the reasoning already recorded
in the file header of `triathlon-legs.ts`, restated here because the evidence
document's summary table needs a confidence rating and "High" would otherwise
look unjustified next to five Low/Medium neighbours — it is high for a
different reason than the others: definitional certainty, not measurement or
convention.

The bare key `triathlon` is deliberately **absent** from the table: it names
a sport, not a distance, and a triathlon race entered as a bare "triathlon"
gives no information about which of the four standard distances (or a
non-standard one) it is. Guessing would put an unsourced number into a
training target — the table refuses rather than guesses, returning `null` and
routing the athlete to the same escape hatch every other refusal in this
model uses: their own stated finish time.

## 6. `LONGEST_RIDE_FRACTION` re-rated: unvalidated outside cycling

`FEASIBILITY_CONSTANTS.LONGEST_RIDE_FRACTION = 0.8`
(`src/lib/race/feasibility.ts`) already carried a **Low** rating in
`docs/specs/2026-07-28-training-volume-evidence.md` because the cycling
evidence behind it is itself contested: gran fondo coaching calls the long
ride the single biggest predictor of finishing, needing 70-80% of race
distance comfortably completed beforehand; CTS directly disputes this,
arguing there is nothing magical about the percentage and that 3-hour rides
can prepare a rider for a century. That disagreement was the reason the rule
was already demoted to softening a verdict by one step rather than driving it
outright — see `feasibility.ts`'s own file header.

**What changes in v0.46 is scope, not the number.** Before this release the
fraction was applied only to cycling events, where at least one side of a
disputed literature backs it. `assessFeasibility` has no sport parameter and
no sport check — it takes `queenStageHours` and a `longestSessionHours` and
applies the same 0.8 regardless of what produced them. Since v0.46 routes
running and triathlon events through the same feasibility function, **the
identical fraction is now silently asked to hold for a runner's longest long
run and a triathlete's longest brick session, disciplines the cited sources
say nothing about.** No search for running- or triathlon-specific evidence on
long-session-as-fraction-of-race-distance was conducted for this pass, so
this is not "no evidence was found" — it is "no evidence was sought," which
is a different and weaker position, stated exactly as such.

**Confidence: Low, explicitly re-rated as unvalidated outside cycling.** The
rule's own softening mechanism — it can move a verdict by at most one rung and
can never by itself produce "not_realistic" — is now doing double duty it was
not designed for: it was meant to hedge against contested-but-relevant
cycling evidence, and it is now also hedging against **absent** evidence in
two other sports. The mechanism happens to be the right shape for both
failure modes, but that is fortunate design, not evidence that the fraction
itself is right for a runner.

## 7. `EVENT_TO_WEEKLY_1DAY` and `MULTI_DAY_EXPONENT`: the second cycling constant now applied to three sports

Found by reading the demand sweep's output rather than by reviewing a diff,
and recorded here because it is the exact twin of §6 and is otherwise
undocumented for this release.

`eventDemand` converts an event's total duration into a weekly training
target by dividing by a ratio:

```text
ratio(days) = EVENT_TO_WEEKLY_1DAY × days ^ MULTI_DAY_EXPONENT
weeklyHours = totalEventHours / ratio(days)
```

**Both constants are cycling-calibrated.** `demand-constants.ts` justifies
`EVENT_TO_WEEKLY_1DAY = 0.6` explicitly against a bike race — _"A long
sportive is 200-350 TSS against ~630 sustainable weekly TSS at CTL 90 — about
half a training week"_ — and `MULTI_DAY_EXPONENT = 0.686` is fitted to two
cycling anchors (0.60 at one day, 2.50 at eight days, the latter from CTS on
multi-day cycling tours). Before v0.46 that was unremarkable, because every
event reaching this line was priced as a bike ride. **This release routes
marathons and Ironmans through the same divisor.**

What that produces, from `scripts/demand-sweep.ts`:

| Event                                 | Modelled duration | Weekly target |
| ------------------------------------- | ----------------- | ------------- |
| Marathon, 5:00/km threshold           | 3.79 h            | 6.3 h/week    |
| Ironman, 3 W/kg + 5:00/km + 2:00/100m | 11.06 h           | 18.5 h/week   |

Both land inside defensible ranges — 18.5 h/week is high but real for a
serious Ironman age-grouper, and 6.3 h/week is plausible for a recreational
marathoner — which is why this is recorded as a **confidence** problem rather
than a defect. But an 11-hour Ironman is not "about half a training week" in
the sense the constant's own comment describes, and no evidence was sought or
found that a single ratio should govern all three sports.

**Confidence: Low, unvalidated outside cycling.** The same wording as §6, for
the same reason. Two mitigations limit the damage: the figure is an upper
bound that `weeklyTargetHours` then clamps against the athlete's own measured
ceiling (`athleteLevel`'s 12-week rolling peak) and their stated availability,
so an overstated demand cannot by itself prescribe a week the athlete has
never come close to training; and `races.demand_hours_override` lets an
athlete or coach set the weekly figure directly.

**Not changed in this release, deliberately.** Re-deriving the ratio per sport
would mean inventing two more numbers with no better evidence than the one
being replaced — trading a documented weak assumption for an undocumented one.
The honest move is to name it here.

## 8. Rejected alternative: a default swim pace

Considered and rejected: shipping a documented default swim pace (for
example, a plausible club-swimmer figure like 2:00/100m) so a triathlete with
no swim history would still get a modelled figure rather than a refusal.

Rejected because the athlete-stated finish time already answers the cold-start
case honestly: a first-time Ironman entrant with no swim history typically
does know their target finish time (e.g. "sub-13"), and typing that produces
a **high**-confidence figure immediately, with no anchor of any kind required.
A manufactured default swim pace would instead put a number with no source
into a training target for every athlete who has genuinely never swum a
tracked 400 m — the precise failure mode `docs/specs/2026-08-06-periodize-evidence.md`
and this document's whole project exist to remove, reintroduced through a
different door. `eventDemand` refuses with `no_swim_anchor` instead, naming
the fix in the same sentence: add an expected finish time.

## Sources

- Riegel, P.S. (1981). "Athletic Records and Human Endurance." _American
  Scientist_ 69(3):285-290.
- Vickers, A.J. & Vertosick, E.A. (2016). "An empirical study of race times in
  recreational endurance runners." _BMC Sports Science, Medicine and
  Rehabilitation_ 8:26.
- Minetti, A.E. et al. (2002). "Energy cost of walking and running at extreme
  uphill and downhill slopes." _Journal of Applied Physiology_ 93(3):1039-1046.
- [ITRA — Kilometer-effort explained](https://itra.run/) — the
  distance-plus-elevation/100 convention used by international trail races
  for course grading.
- [How Long Should Your Longest Training Ride Be? — CTS](https://trainright.com/how-long-should-longest-training-ride-be/)
  — disputes the fixed-percentage claim `LONGEST_RIDE_FRACTION` is built on.
- `docs/specs/2026-07-28-training-volume-evidence.md` — `LONGEST_RIDE_FRACTION`'s
  original (cycling-only) evidence and its Low rating.
- `docs/specs/2026-08-06-periodize-evidence.md` — the confidence-rating format
  and candour this document mirrors.
