# Evidence base for the multi-A-race transition

**Date:** 2026-08-19 · **Pillar:** Science, constraining Demand · **Prerequisite
for** the Multi-A-race seasons item in `docs/ROADMAP.md` Phase 3 · **Companion
to** `docs/specs/2026-08-19-taper-evidence.md`

`docs/specs/2026-08-19-multi-a-race-seasons-design.md` closed with three open
questions and one instruction about them: _"none of which should be answered by
taste."_ This pass answers them from the literature where the literature
answers, and says so plainly where it does not. It ships no code.

## Summary

| The design doc's question                                          | Answer                                                                                                                                                                                     | Confidence                                               |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| How long is the transition, and does it scale with distance class? | **Two parts, and only one of them is a duration.** Post-race _recovery_ is evidenced and **does** scale with race duration. The _rebuild_ needs no constant — it is the weeks that remain. | Recovery: **Medium** at the long class, **Low** below it |
| Can the second peak equal the first?                               | **No source, in either direction.** Nothing measures a repeated taper within one season. The plan must not state it either way.                                                            | —                                                        |
| What is the minimum gap below which a second A-race is refused?    | **Refusal is the wrong shape**, and the code already settled why. Warn with a named reason instead.                                                                                        | —                                                        |

**The headline: one of the three questions dissolves, one is unanswerable, and
only the first yields a number.** That is a smaller result than the design doc
expected, and it is the honest one. The proposed constants are in §4.

**A finding that is not one of the three, and matters more than two of them:**
in a close A-race pairing the shipped code already puts race two's _taper_ on
the week immediately after race one, where the evidence puts recovery. §7.

---

## 1. The sources, and how they are weighted

Recovery from a race and maintenance of fitness are two different literatures,
and this document needs both.

**Post-race recovery — how long the first race costs.** Four studies, weighted
by sample and by how close the population is to this app's:

| Study                                                                  | Event                 | n                             | What it measured                                               |
| ---------------------------------------------------------------------- | --------------------- | ----------------------------- | -------------------------------------------------------------- |
| Neubauer, König & Wagner 2008, _Eur J Appl Physiol_                    | Ironman               | **42** well-trained males     | CK, myoglobin, IL-6, IL-10, hs-CRP, MPO, elastase, cortisol    |
| Millet et al. 2011, _PLoS One_                                         | 166 km mountain ultra | experienced ultra runners     | Maximal voluntary contraction, excitation-contraction coupling |
| Takayama, Aoyagi, Shimazu & Nabekura 2017, _J Sports Med_              | Marathon              | **11** recreational (6M / 5F) | VO₂max, running economy, AT, peak velocity, soreness           |
| Nosaka, Abbiss, Watson, Wall, Suzuki & Laursen 2010, _Eur J Sport Sci_ | Ironman               | **1** (case study)            | VO₂max, economy, strength, jump, soreness, blood markers       |

**Maintenance and detraining — what the weeks after recovery must not do.**

- **Mujika & Padilla 2000**, _Sports Medicine_, Parts I and II. The reference
  review, split at four weeks of insufficient stimulus.
- **Hickson et al.**, three reduced-training trials (_MSSE_ 1981, frequency;
  _J Appl Physiol_ 1982, duration; _J Appl Physiol_ 1985, intensity).

**Multi-race season structure — what elite practice actually looks like.**

- **Tønnessen, Sylta, Haugen, Hem, Svendsen & Seiler 2014**, _PLoS One_, "The
  Road to Gold" — 11 Olympic and World Champion XC skiers and biathletes, one
  year of day-to-day training each.

**One citation is second-hand and is marked as such.** Nosaka et al. 2010 is
paywalled at Wiley (HTTP 402) and Taylor & Francis (403), and is not in Europe
PMC. Its figures below are read from secondary reporting of its abstract, not
from the paper. It is an n = 1 case study and carries the least weight here
anyway; nothing in §4 turns on it alone. Recorded rather than quietly cited,
because this repo has already been bitten once by a fact checked against a
memory instead of against the source (`ROADMAP.md`'s CI-database correction).

---

## 2. The recovery half is evidenced, and it does scale with distance

This is the one place the three questions yield a number.

**Marathon.** Takayama et al. tested 11 recreational runners (finish
3 h 36 ± 42 min) on a treadmill before and 7 days after a race. Every aerobic
measure came back trivial or unclear: VO₂max −1.2 ml/kg/min ("possibly
trivial"), running economy and %VO₂max at AT unclear, velocity at AT −0.2 km/h
and peak velocity −0.3 km/h ("likely trivial"). Soreness rose through day 3 and
showed no clear difference from pre-race at days 4–7. Their conclusion:
_"physiological capacity associated with marathon running performance is
recovered within 7 days after a marathon run."_

**Ironman.** Neubauer et al. sampled blood from 42 well-trained male triathletes
at −2, 0, +1, +5 and +19 days. At **five days** CK, myoglobin, IL-6 and hs-CRP
had fallen but were **still significantly elevated** (P < 0.001). At 19 days most
markers had returned, with myoglobin and hs-CRP still slightly but significantly
above pre-race. Their conclusion: _"a low-grade systemic inflammation persisted
until at least 5 days post-race, possibly reflecting incomplete muscle
recovery."_ The n = 1 case study puts functional recovery in the same region and
slower on the aerobic measure: strength 2 days, jump and economy 8 days, VO₂max
**15 days**.

**166 km mountain ultra.** Millet et al. found maximal voluntary contraction
down 35–39% with a failure of excitation-contraction coupling _"never described
after prolonged running"_; maximal force capacities were back to baseline by
**two weeks**, with most of the recovery inside **nine days**.

**So distance scales, and this is the interesting part.** The taper evidence
pass found the opposite for taper _length_ — Ferreira et al. 2023 pooled middle-,
long- and ultra-distance and found **no significant difference by event
distance**, which is why `taperWindowDays()`'s mapping is recorded in-code as _"a
convention the evidence tolerates rather than one it requires"_.

**Recovery is where distance does show up.** Marathon aerobic capacity is back
inside a week; Ironman inflammation is still measurable at five days and its
aerobic measure took two weeks in the single case; ultra neuromuscular function
takes nine to sixteen days. Recover already owns a distance classifier
(`taperWindowDays`, `src/lib/race/taper.ts:77`). Reusing it for recovery is
**better evidenced than the use it already has.**

That asymmetry is worth stating in one line, because it will read as
inconsistent otherwise: **the same classifier is a tolerated convention for the
taper and a supported one for the recovery.**

---

## 3. The rebuild half is not a new lever — it is the one the taper already uses

The design doc's phase sketch names `Transition → Rebuild` as new vocabulary.
The literature says the transition needs no new prescription, because the thing
it must avoid has one answer everywhere it has been measured.

**Mujika & Padilla 2000 Part II**, verbatim: _"All these negative effects can be
avoided or limited by reduced training strategies, as long as **training
intensity is maintained** and frequency reduced only moderately. On the other
hand, **training volume can be markedly reduced.**"_

**Hickson's three trials separate the variables**, and the split is clean.
Cutting duration, or cutting frequency to 2 or 4 days a week, held VO₂max for at
least 15 weeks. Cutting **intensity** by a third failed to maintain VO₂max, and
cutting it by two thirds was worse still.

Three prescriptions from three literatures now agree:

| Lever         | Taper (Ferreira 2023, Bosquet 2007)   | Recovery week (`RECOVERY_FRACTION`) | Bridge (Mujika & Padilla, Hickson) |
| ------------- | ------------------------------------- | ----------------------------------- | ---------------------------------- |
| **Volume**    | cut 41–60%                            | cut 40%                             | "may be markedly reduced"          |
| **Intensity** | **maintain** — cutting is ineffective | (unchanged)                         | **maintain** — the binding one     |
| **Frequency** | maintain                              | (unchanged)                         | reduce "only moderately"           |

`PLAN_CONSTANTS.RECOVERY_FRACTION = 0.6` is already rated **Medium** on this
exact band (`docs/specs/2026-08-06-periodize-evidence.md` §3: _"a 70% reduction
in volume with intensity maintained preserves VO₂max"_, _"maintaining 50–75% of
normal volume showed no drop in aerobic fitness"_).

**Therefore: the bridge phase needs no load constant of its own.** A recovery
week already is a maintenance week at an evidenced fraction, and the weeks after
it are ordinary Base/Build weeks that `periodize()` already sizes. Proposing a
`BRIDGE_FRACTION` would be inventing a third number for a lever that already has
two, one of which is already cited.

**What has no source is the rebuild's _duration_,** and it does not need one.
`periodize()` already collapses its phases into whatever week count it is given
— the `short_horizon` comment at `src/lib/training-plan.ts:1045-1051` says so
explicitly: _"it collapses into whatever phases fit inside the week count"_.
Hand it the weeks left after recovery and it produces the rebuild. No constant,
so nothing to rate.

---

## 4. Proposed constants — one family, and what each is worth

For the implementing release to adopt or to change. A parallel to
`taperWindowDays()` in the same file, reusing its classifier:

| Proposed                   | Value | Classes                    | Evidence                                                                                                                                 | Confidence        |
| -------------------------- | ----: | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `RACE_RECOVERY_DAYS_LONG`  |   14d | marathon, full Ironman     | Bounded below by marathon aerobic recovery at 7d (n=11) and above by Ironman VO₂max at 15d (n=1) and markers still elevated at 5d (n=42) | **Medium**        |
| `RACE_RECOVERY_DAYS_MID`   |    7d | half, 70.3, fondo, century | **No study located at this distance.** Interpolated between the long class and nothing                                                   | **Low**           |
| `RACE_RECOVERY_DAYS_SHORT` |    4d | everything else            | **None.** A floor so a short A-race still costs something                                                                                | **Invented, Low** |

**Read the confidence column, not the table shape.** Only the long class has
studies under it. The other two rows exist so the classifier is total, and they
should say **Invented** in-code the way `OPENER_MAX_MINS` does — labelling the
unsourceable is an acceptable answer and better than silence (`ROADMAP.md` 2a).

**14 rather than 7 for the long class, and the reason is a disagreement between
the two measures.** Takayama's marathon runners were aerobically recovered at 7
days; the Ironman case study's VO₂max needed 15, and Neubauer's 42 triathletes
still had significant inflammation at 5. Aerobic capacity returns before tissue
does, and a plan that resumes on the aerobic reading alone resumes onto a leg
that is still repairing. 14 sits above the marathon finding and below the
Ironman one. It is a judgement between two evidenced endpoints, which is a
different thing from a number with no endpoints at all — hence Medium, not High.

---

## 5. Can the second peak equal the first? There is no source either way

A targeted search for a repeated or second taper within one season, and for
diminished response to it, returns **nothing**. Neither taper meta-analysis
addresses it: Bosquet 2007 and Ferreira 2023 both measure a single taper against
a control condition. No study in either found a protocol where the same athletes
were tapered twice with a race in between.

**So Recover may not say the second peak will be lower, and may not say it will
be equal.** Both are claims about the athlete's outcome, and neither has a
source. This is exactly the case 2b.3's vocabulary was built for — _"no figure
plus the reason"_, the pattern v0.46 set for event demand. The second race gets
a plan; it does not get a comparative promise about how it will go.

**The one adjacent finding argues against the feature's own mental model, and is
recorded rather than buried.** Tønnessen et al. followed 11 athletes who each
won an Olympic or World Championship gold, across the full year before it. Their
competition phase is not two arcs with a bridge — it is continuous. Training
volume, frequency **and intensity remained unchanged from the pre-peaking to the
peaking period**; the 32 ± 15% volume reduction is measured from the general
_preparation_ period, not from a taper. Only three of the eleven took a rest day
in the final five days before the best race of their career. The authors'
conclusion is blunt: _"they did not follow suggested tapering practice derived
from short-term experimental studies."_

That does not sink the feature. The 244-vote demand row is age-group athletes
with two goal races, not World Cup skiers racing twice a week for fourteen
weeks, and Recover's own athlete is the former. But it does mean **no one may
claim the elite literature supports a rebuild-and-re-peak structure.** The
structure is coaching convention. The levers inside it (§3) are evidenced; the
shape around them is not.

---

## 6. The refusal threshold — the question has the wrong shape, and the code says why

The design doc asked for _"the minimum inter-race gap below which a second
A-race should be **refused** rather than planned badly"_, citing
`previewTrainingPlan`'s `{ ok: false, reason }`.

**`previewTrainingPlan` already decided this class of question, the other way.**
`src/lib/training-plan.ts:1045`:

> _"A close race is SCALED, not refused — refusing to plan is worse than
> planning honestly. A date beyond a year is a typo, and the athlete can act on
> being told so."_

Refusal there is reserved for input that can only be a mistake:
`horizon_too_long` fires at `weeksTotal > 52`, and `race_not_found` /
`unknown_sport` on unresolvable rows. A genuinely close race produces
`shortHorizon = weeksTotal < 4`, which becomes the **`short_horizon` warning**,
not a refusal.

Two A-races three weeks apart is not a typo. It is the thing the 244 votes are
asking for. **So the answer is a warning with a named reason, in the existing
`PreviewWarning` shape** (`collectWarnings`,
`src/lib/plan-preview.ts:77-113`): a new union member, one sentence in
`WARNING_TEXT` (`:116`) naming the input at fault, and the exhaustive switch
that makes omitting it a compile error.

**The threshold is still worth computing, as the warning's trigger.** Below

```text
gap < raceRecoveryDays(race1.raceType) + taperWindowDays(race2.raceType)
```

there is no week that is neither recovery nor taper — there is nothing to
rebuild with, so the plan between the two races is a schedule, not a plan. With
§4's proposals:

| Pairing             | Recovery + taper | Floor           |
| ------------------- | ---------------- | --------------- |
| marathon → marathon | 14 + 21          | **35 d** (5 wk) |
| half → half         | 7 + 14           | **21 d** (3 wk) |
| short → short       | 4 + 10           | **14 d** (2 wk) |
| marathon → half     | 14 + 14          | **28 d** (4 wk) |
| half → marathon     | 7 + 21           | **28 d** (4 wk) |

**These floors are more permissive than coaching consensus, deliberately.** The
widely-repeated marathon guidance is that under four weeks you are still
recovering and only past eight weeks do you resume full training — which would
put the marathon → marathon floor at 8 weeks, not 5. That guidance is convention
with no trial behind it, and the warning's job is to tell the athlete what the
plan cannot contain, not to tell them what to race. Recover says "there is no
room to rebuild between these two races"; it does not say "do not do this."

---

## 7. What this pass found in the shipped code

The design doc recorded that _"the second taper is already free"_ —
`racesForWeek` has no filter to a plan target, so when race two's taper weeks
arrive it is `races[0]` and `materializeWeek` tapers it unchanged. That is
correct. **It is also, in a close pairing, too early.**

Trace it. `racesForWeek` (`src/lib/race/service.ts:198`) selects `upcoming`
races with `date >= weekStart` and `date <= weekStart + 27`, sorted priority
A→C then date. Race one is excluded the moment its week has passed. So for two
A-marathons 21 days apart:

- **Week of race one** — both races are in window; race one sorts first (same
  priority, earlier date); `taperFractionForWeek` returns
  `TAPER_FRACTION_RACE_WEEK` (0.45). Correct.
- **The week immediately after** — race one is gone; race two is `races[0]` at
  20 days out; `d <= 20 && window >= TAPER_WINDOW_LONG` returns
  **`TAPER_FRACTION_WEEK_2` (0.80)**.

So the first week after a marathon is shaped as a taper week for the next one:
80% of the previous week's actual load, intensity preserved, Z3 openers two days
out — on the week where §2 puts soreness still resolving and inflammation still
measurable. At a 14-day gap it is `TAPER_FRACTION_WEEK_1` (0.65) instead, one
rung lower and the same shape.

**Nothing in the code distinguishes the week after an A-race from any other
week.** `RECOVERY_FRACTION` has exactly three uses
(`src/lib/training-plan.ts:453`, `:457`, `:574`), all inside `periodize()`'s
step-loading cadence — every Nth week, counted from plan start. There is no
post-race concept in `src/lib/week-plan/` or `src/lib/race/` at all.

This is not a defect anyone has hit, because nothing today produces two A-races
inside one taper window in a plan. It becomes one the day this feature ships,
and it is the first thing the implementing release should pin with a test.

---

## 8. What this pass leaves open

- **The MID and SHORT recovery values have no study under them.** Marked
  Invented/Low above. A search for half-marathon and 10 km recovery time courses
  returns CK kinetics reported second-hand and no primary time-to-recovery
  study in trained runners. If one exists, it was not found on 2026-08-19.
- **Recovery scaling is inferred across studies, not measured within one.** No
  study located compares recovery duration across distances in the same cohort;
  §2's ladder is assembled from four separate populations with different
  measures. The direction is consistent; the spacing is not evidenced.
- **Nosaka et al. 2010 is cited second-hand** (§1) and is n = 1.
- **Nothing measures whether the transition should be shorter for a fitter
  athlete.** Every number in §4 is race-side only. Recover has a CTL for each
  athlete and does not use it here, which is a defensible omission and not a
  principled one.
- **Recovery status is not modelled at all.** These constants describe a
  calendar, not the athlete. If a race went badly or the athlete is ill, 14 days
  is still 14 days. Reading `daily_metrics` to shorten or extend it would be a
  new athlete-facing claim and needs its own evidence.

## Sources

- Neubauer O, König D, Wagner KH. _Recovery after an Ironman triathlon:
  sustained inflammatory responses and muscular stress._ Eur J Appl Physiol, 2008. <https://europepmc.org/article/MED/18548269>
- Millet GY, Tomazin K, Verges S, et al. _Neuromuscular consequences of an
  extreme mountain ultra-marathon._ PLoS One, 2011.
  <https://www.ncbi.nlm.nih.gov/pmc/articles/PMC3043077/>
- Takayama F, Aoyagi A, Shimazu W, Nabekura Y. _Effects of marathon running on
  aerobic fitness and performance in recreational runners one week after a
  race._ J Sports Med, 2017.
  <https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5613699/>
- Nosaka K, Abbiss CR, Watson G, Wall B, Suzuki K, Laursen P. _Recovery
  following an Ironman triathlon: a case study._ Eur J Sport Sci, 2010.
  **Read second-hand — paywalled, not in Europe PMC.**
  <https://www.tandfonline.com/doi/abs/10.1080/17461390903426642>
- Mujika I, Padilla S. _Detraining: loss of training-induced physiological and
  performance adaptations. Part I: short term insufficient training stimulus._
  Sports Med, 2000. <https://europepmc.org/article/MED/10966148>
- Mujika I, Padilla S. _Detraining … Part II: long term insufficient training
  stimulus._ Sports Med, 2000. <https://europepmc.org/article/MED/10999420>
- Hickson RC, Rosenkoetter MA. _Reduced training frequencies and maintenance of
  increased aerobic power._ Med Sci Sports Exerc, 1981.
  <https://pubmed.ncbi.nlm.nih.gov/7219129/>
- Hickson RC, Kanakis C, Davis JR, et al. _Reduced training duration effects on
  aerobic power, endurance, and cardiac growth._ J Appl Physiol, 1982.
  <https://journals.physiology.org/doi/abs/10.1152/jappl.1982.53.1.225>
- Hickson RC, Foster C, Pollock ML, et al. _Reduced training intensities and
  loss of aerobic power, endurance, and cardiac growth._ J Appl Physiol, 1985.
  <https://journals.physiology.org/doi/abs/10.1152/jappl.1985.58.2.492>
- Tønnessen E, Sylta Ø, Haugen TA, Hem E, Svendsen IS, Seiler S. _The road to
  gold: training and peaking characteristics in the year prior to a gold medal
  endurance performance._ PLoS One, 2014.
  <https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0101796>
- `docs/specs/2026-08-19-taper-evidence.md` — the taper constants, and where the
  distance-mapping asymmetry in §2 comes from.
- `docs/specs/2026-08-06-periodize-evidence.md` — `RECOVERY_FRACTION` and the
  50–75% maintenance band §3 leans on.
- `docs/specs/2026-08-19-multi-a-race-seasons-design.md` — the design this
  answers, including the two questions it answered by reading the code.
