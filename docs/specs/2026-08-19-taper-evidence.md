# Evidence base for the taper constants

**Date:** 2026-08-19 · **Pillar:** Science · **Supersedes the Confidence
ratings in** `docs/plans/2026-08-09-provenance-race-taper.md` for
`src/lib/race/taper.ts` only.

Written because Phase 3's first item — multi-A-race seasons — would run this
machinery **twice** per season, doubling an athlete's exposure to every number
in it. The Phase 2a provenance pass had labelled all seven **Invented,
Confidence: Low**, correctly: the v0.14 design doc decided them and no
literature had ever been connected. This pass connects it.

## Summary

| Constant                   | Value | Before | After      | Why                                                              |
| -------------------------- | ----: | ------ | ---------- | ---------------------------------------------------------------- |
| `TAPER_WINDOW_SHORT`       |   10d | Low    | **Medium** | Inside the 8–14d largest-effect band                             |
| `TAPER_WINDOW_MID`         |   14d | Low    | **Medium** | Top of the largest-effect band; equals Bosquet's stated optimum  |
| `TAPER_WINDOW_LONG`        |   21d | Low    | **Medium** | Ceiling of the supported range; ≥22d is where benefit falls away |
| `TAPER_FRACTION_RACE_WEEK` |  0.45 | Low    | **Medium** | A 55% volume cut — inside the evidenced 41–60%                   |
| `TAPER_FRACTION_WEEK_1`    |  0.65 | Low    | **Medium** | With race week, a 2-week mean of 45% — inside the band           |
| `TAPER_FRACTION_WEEK_2`    |  0.80 | Low    | **Medium** | Gentle entry; the exponential decay shape both papers ask for    |
| `OPENER_MAX_MINS`          |    30 | Low    | **Low**    | **Unchanged** — no study measures the day-before session         |

**The headline: the numbers were already right, and merely uncited.** Nothing
in this pass changes behaviour. That is the expected outcome of an evidence
slice and not a disappointing one — the alternative finding, that a shipped
taper contradicted the literature, would have been considerably worse.

## 1. The two sources, and why the newer one governs

**Bosquet et al. 2007**, _Effects of tapering on performance: a meta-analysis_
— 27 of 182 screened studies, mixed sports. Concludes that a **2-week taper
with training volume reduced 41–60% exponentially, intensity and frequency
unchanged**, is the most efficient strategy.

**Ferreira et al. 2023** (PLOS One), _Effects of tapering on performance in
endurance athletes: a systematic review and meta-analysis_ — 14 studies,
**endurance athletes specifically**, which is this app's population. Findings
used here:

- **Duration.** 8–14 days produces the largest effect. Improvements remain
  significant at ≤7d, 8–14d **and 15–21d**. Tapers of **≥22 days show
  diminished effects**.
- **Volume.** A **41–60%** reduction significantly improves time-trial
  performance, and outperforms ≤20%, 21–40% and ≥60%.
- **Intensity and frequency.** Maintaining each significantly improved
  performance; **decreasing either was ineffective**.
- **Effect size.** Time trial SMD = **−0.45**; time to exhaustion SMD =
  **1.28**. Both P < 0.05.
- **Distance.** **No significant difference by event distance** — middle-,
  long- and ultra-distance were pooled.

Where they agree, we cite both. Where the endurance review is more specific, it
governs, because it is the closer population.

## 2. `TAPER_WINDOW_LONG = 21` — the divergence that wasn't

`docs/specs/2026-08-19-multi-a-race-seasons-design.md` flagged 21 days as
"longer than the optimum" against Bosquet's 2 weeks, and expected this pass to
either justify it or change it.

**It is justified, and the design doc's framing was too narrow.** Bosquet's
optimum is the _largest_ effect, not the _edge_ of benefit. The endurance
review measures three duration bands and finds all three significant, with the
15–21d band still improving performance and the fall-off beginning at **22
days**. `TAPER_WINDOW_LONG` therefore sits exactly at the last supported day.

That is a meaningfully different thing to know than "it is fine". It means the
constant has **no headroom**: raising it to 24 or 28 would cross the evidence,
and nothing in the code says so. See §4.

## 3. The distance mapping is a convention the evidence tolerates

`taperWindowDays()` maps marathon and Ironman to 21 days, half/70.3/fondo to
14, everything else to 10. The endurance review found **no significant
difference by event distance**.

So the mapping is not wrong, but it is **not evidenced either** — it is
coaching consensus that the evidence permits. Recorded in-code so that no
surface ever describes the athlete's taper length as derived from their race
distance. It is a default, and a defensible one.

## 4. What this pass leaves open

- **`OPENER_MAX_MINS` stays Low.** No study in either review isolates the
  day-before session. Finding sources for a constant's neighbours is not a
  source for the constant.
- **Race week reduces frequency, and the evidence says not to.** Both papers
  find maintained frequency matters. `raceWeekWorkouts` returns at most two
  sessions. The divergence is bounded — race week only, weeks −1 and −2 scale
  load and leave session count alone — and no studied protocol ends in a
  maximal race, which is arguably the missing frequency. Recorded in-code,
  not resolved: resolving it would mean claiming something about race-week
  structure that neither paper supports.
- **`TAPER_WINDOW_LONG` has no headroom and nothing guards it.** A future
  window > 28 days would also be silently truncated by `racesForWeek`'s 28-day
  lookahead rather than refused. Both bounds are now pinned by a test
  (`taper.test.ts`), so the next person to raise the constant is told.

## Sources

- Bosquet L, Montpetit J, Arvisais D, Mujika I. _Effects of tapering on
  performance: a meta-analysis._ Med Sci Sports Exerc, 2007.
  <https://www.semanticscholar.org/paper/Effects-of-tapering-on-performance:-a-Bosquet-Montpetit/a41517ab5fa06b92568b861e2b1aa32b3003d214>
- _Effects of tapering on performance in endurance athletes: a systematic
  review and meta-analysis._ PLOS One, 2023.
  <https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0282838>
- `docs/specs/2026-07-19-v0.14-race-ready-design.md` — where the values were
  decided (decision record, not research).
- `docs/plans/2026-08-09-provenance-race-taper.md` — the Phase 2a pass that
  labelled them Invented / Low.
