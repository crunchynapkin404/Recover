# Evidence base for the training-volume constants

Research pass, 2026-07-28, prompted by the user asking whether published
studies could replace the guessed constants in the race-driven volume model.

**Short answer: partly.** Some constants now have solid anchors. One is
actively contested in the literature. Two have no source at all and remain
empirical. Confidence is stated per constant so future tuning knows what it is
overriding.

## Summary

| Constant | Value | Evidence | Confidence |
| --- | --- | --- | --- |
| `CDA` | 0.32 | Measured hoods position **0.316 m²** | **High** |
| `HEADROOM` (ceiling) | 1.3 | ACWR safe zone **0.8–1.3** | **High** |
| `RAMP_CLAMP_PCT` (existing) | 0.2 | ACWR 1.2, inside the safe band | **High** |
| Maintenance floor (new) | 0.5–0.7 | **50–75% of volume maintains VO₂max** | **High** |
| `EVENT_TO_WEEKLY` ratio(days) | 0.6 → 2.5 | 1-day: **300 TSS vs ~630 weekly**, cross-checked vs **8–12 h/wk** plans. 8-day: CTS **2–3×** | Medium |
| Level CTL bands | 35/55/80 | CTS: fondo riders **40–100**, competitors **70–120** | Medium |
| Level hours bands | 3/5/9 | Elite **14.7–19.7 h/wk**; competitive amateurs **~9.8**; elite junior/masters competitive at **6–12** | Medium |
| `FTP_FRACTION` | 0.85/0.75/0.68 | Durability: critical power decays **~10%** after fatiguing work — our 20% span is steeper | Medium |
| `LONGEST_RIDE_FRACTION` | 0.8 | **CONTESTED — sources disagree** | **Low** |
| `REAL_WORLD_FACTOR` | 0.85 | No source found | **Low** |
| `CLIMB_GRADIENT` | 0.07 | No source found | **Low** |

## What changes

### 1. `HEADROOM = 1.3` stops being a guess

The volume ceiling sits at `rollingPeak × 1.3`. That number was picked by feel.
It turns out to be exactly the upper bound of the acute:chronic workload ratio
safe zone: **ACWR should stay between 0.8 and 1.3**, the danger zone begins
above 1.5, and **≥2.0 carries the greatest injury risk**. A 2025 meta-analysis
of 22 studies found the ratio predicts injury better than weekly volume alone.

So the ceiling is now defensible as "the most this athlete's chronic load
supports", not a round number. Same for the existing `RAMP_CLAMP_PCT = 0.2`
(a 1.2 ratio), which sits comfortably inside the safe band.

### 2. The short-event floor has real evidence

A criterium currently prescribes **1.9 h/week** — the model is volume-only, so a
short intense event reads as almost no demand and the plan would detrain the
athlete. The detraining literature answers this directly:

- **A 70% reduction in volume, with intensity maintained, preserves VO₂max.**
- Maintaining **50–75%** of normal volume showed no drop in aerobic fitness.
- **30–50% of normal volume across 3–4 days/week with one intensity day**
  maintains injury tolerance, lactate threshold and VO₂max.

**Recommendation: floor the weekly target at `0.6 × rollingPeakHours`.** For
this athlete (peak 8.9h) a crit would prescribe ~5.3 h/week instead of 1.9 —
enough to hold fitness, and never a detraining prescription.

### 3. Multi-day demand has one good quantitative source

CTS: *"A multi-day event is likely 2-3 times your normal weekly training load,
measured by hours, miles, or Training Stress Score."*

Inverted, that gives `weeklyHours = totalEventHours / 2.5`. It is a single
source and a coaching heuristic rather than a controlled study, but it is
quantitative, directly on point, and from a reputable coaching organisation.
Better than the averaging approach it replaces, which discarded total event
load entirely.

**This has an uncomfortable consequence, and it is the most important finding
of this pass.** For the athlete's 8-day alpine tour:

```text
event total       42.1 h
÷ 2.5             16.8 h/week required
athlete trains     9.0 h/week   →  event is 4.7× their weekly load
athlete offers    12.5 h/week
```

The literature calls 2–3× normal. At 4.7× **this athlete is under-prepared by
the published guideline** — and their own estimate of "9–12 h/week or so"
describes the time they have, not the training the event asks for. Surfacing
exactly that gap is what the feasibility verdict exists to do. Do not tune the
constant until the model agrees with the athlete's estimate; that would delete
the finding.

### 3b. The single-day anchor — and the two paths unify

The 2–3× rule is for multi-day events; applied to one 6.8h fondo it gives
2.7 h/week, which is nonsense. A second research pass found the single-day
numbers directly:

- **Beginner century/gran fondo plans: 6–8 h/week.**
- **Intermediate: 8–12 h/week.**
- **Advanced: peak 15 h/week, longest ride 5h.**
- Summarised as *"about 6 hours per week on the low end, to about 12 hours per
  week on the high end."*
- A long sportive or race generates **200–350+ TSS**; sustainable weekly TSS is
  about **CTL × 7–8**. At CTL 90 (mid competitive-fondo band) that is ~630
  weekly TSS, so a 300-TSS event is roughly **half a training week**.

That last line is the unifying insight. Both endpoints express the same
quantity — **event total load as a multiple of a weekly training load**:

| Event shape | Event ÷ weekly load | Source |
| --- | --- | --- |
| 1 day | **≈ 0.6** | 300 TSS event vs ~630 weekly TSS; cross-checked against 8–12 h/week plans |
| 8 days | **≈ 2.5** | CTS "2-3 times your normal weekly training load" |

So one formula, with the multiplier growing as the event lengthens:

```text
ratio(days)  = 0.60 × days^0.686        // 0.686 fits the two anchors exactly
weeklyHours  = totalEventHours / ratio(days)
then clamp:    max(floor 0.6 × peak, …) then min(ceiling 1.3 × peak)
```

Checked against the published bands, with nothing fitted to them beyond the two
endpoint ratios:

| Event | Total | Raw | Final | Literature |
| --- | --- | --- | --- | --- |
| 8-day alpine tour | 42.1h | 16.8h | **11.6h** (ceiling) | — |
| 1-day alpine fondo | 6.8h | 11.4h | **11.4h** | 8–12 (intermediate) |
| Flat century ~5h | 5.6h | 9.4h | **9.4h** | 8–12 |
| 3-day stage race | 13.6h | 10.7h | **10.7h** | — |
| Local crit | 1.3h | 2.1h | **5.3h** (floor) | n/a |

Both single-day cases land inside the published range. The tour's raw 16.8h is
cut to 11.6h by the ACWR ceiling — which is the shortfall the feasibility
verdict should report, not a number to tune away.

### 4. `LONGEST_RIDE_FRACTION` is contested and must be softened

The feasibility verdict treats "longest ride ≥ 0.8 × queen stage" as a hard
requirement. The sources disagree about whether that matters at all:

- Gran fondo coaching: *"the long ride is the single biggest predictor of
  performance, with riders needing to complete 70–80% of the sportive distance
  comfortably four weeks before the event"* — and most plans peak at 70–80% of
  race distance.
- CTS, directly contradicting it: *"there is nothing magical about achieving a
  specific percentage of the race or event distance in a single training ride,
  as approximately 75% of the total event distance makes neither a significant
  difference in finish rates. You can absolutely develop the fitness necessary
  to complete a challenging century or gran fondo with training rides that
  never exceed 3 hours."*

**Recommendation: keep the longest-ride dimension but demote it.** It should
inform the verdict's wording, not by itself produce "not realistic". A rider
with ample weekly volume and no single long ride should read as a caution, not
a refusal. The 0.8 value stays, flagged Low confidence.

### 5. A caveat on volume itself

The largest relevant meta-analysis — 41 studies, 81 training groups, 797
trained cyclists — concluded that **high training volumes may not guarantee
better VO₂max or performance**, and that training distribution matters more
than any specific model.

That does not invalidate this design, because it answers a different question:
it measures *performance improvement* (VO₂max, time-trial) in already-trained
cyclists, whereas event completion is a question of **durability** — resisting
decline after many hours, over consecutive days. Those have separate evidence
bases. But it is a real caution against treating "more hours" as the goal, and
it supports keeping availability a ceiling rather than a target.

### 6. Physics constants

`CDA = 0.32` is well anchored: a baseline road position on the hoods measures
**0.316 m²**; drops are 0.04–0.06 lower.

`REAL_WORLD_FACTOR = 0.85` and `CLIMB_GRADIENT = 0.07` have **no source**. They
are empirical corrections that make the model reproduce plausible finish times.
They stay, explicitly marked Low confidence.

The `FTP_FRACTION` ladder (0.85 → 0.75 → 0.68) is directionally supported by
durability research — critical power decays **~10%** after fatiguing exercise,
and efficiency deteriorates with prolonged work — but our 20% span across the
ladder is steeper than that single figure. It describes average sustainable
intensity across a whole event rather than a post-fatigue CP measurement, which
are different constructs, so the comparison is indicative only.

## Sources

- [Acute:chronic workload ratio and injury risk (OAJSM)](https://www.dovepress.com/the-relationship-between-acute-chronic-workload-ratios-and-injury-risk-peer-reviewed-fulltext-article-OAJSM)
- [Gabbett — guide to acute-chronic load](http://archive.trainingground.guru/articles/loaded-questions-with-tim-gabbett)
- [ACWR and injury risk in elite Gaelic football (PubMed)](https://pubmed.ncbi.nlm.nih.gov/27400233/)
- [Training, Performance and Recovery for Multi-Day Cycling Tours — CTS](https://trainright.com/crushing-multi-day-cycling-tours-amateur-stage-race/)
- [How Long Should Your Longest Training Ride Be? — CTS](https://trainright.com/how-long-should-longest-training-ride-be/)
- [What is CTL and how to use it — CTS](https://trainright.com/what-is-chronic-training-load-ctl-and-how-to-use-it-to-improve-performance/)
- [Training distribution, duration and volume in trained cyclists: systematic review and meta-analysis (JSAMS 2024)](https://www.jsams.org/article/S1440-2440(24)00596-6/fulltext)
- [Training periodization, intensity distribution and volume in trained cyclists: systematic review (PubMed)](https://pubmed.ncbi.nlm.nih.gov/36640771/)
- [A reduction in training volume and intensity for 21 days does not impair performance in cyclists (PubMed)](https://pubmed.ncbi.nlm.nih.gov/11726481/)
- [Cardiorespiratory and metabolic consequences of detraining (Frontiers)](https://www.frontiersin.org/journals/physiology/articles/10.3389/fphys.2023.1334766/full)
- [Prolonged cycling reduces power output at the moderate-to-heavy transition (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC9488873/)
- [Durability as an index of endurance performance (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC12576026/)
- [How world-class Giro d'Italia finishers train (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC9796663/)
- [Cumulative fatigue in professional stage races (medRxiv)](https://www.medrxiv.org/content/10.1101/2024.11.06.24316801v1.full)
- [Aerodynamic efficiency in road positioning (CdA by position)](https://www.adaptivehp.com/blog/2018/1/7/aerodynamic-efficiency-in-road-positioning)
- [Pacing strategies in Gran Fondo cycling: Quebrantahuesos, 6,589 finishers (Springer)](https://link.springer.com/article/10.1007/s11332-026-01828-0)
