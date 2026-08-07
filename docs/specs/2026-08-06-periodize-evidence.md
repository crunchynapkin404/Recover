# Evidence base for the periodization constants

Companion to `docs/specs/2026-07-28-training-volume-evidence.md`, which covers
the race-driven volume model. This one covers `periodize()` — the skeleton
generator, which until v0.45 had no evidence document at all.

**Short answer: most of these are convention.** Two have a defensible
quantitative basis. The rest are coaching practice with no comparative
evidence, and this document says so rather than dressing them up. Confidence is
stated per constant so future tuning knows what it is overriding.

## Summary

| Constant                    | Value | Evidence                                               | Confidence |
| --------------------------- | ----- | ------------------------------------------------------ | ---------- |
| `PHASE_SHARE_BASE`          | 0.4   | Traditional linear periodization convention            | **Low**    |
| `PHASE_SHARE_BUILD`         | 0.3   | As above                                               | **Low**    |
| `PHASE_SHARE_TAPER`         | 0.15  | As above; the real taper is race-driven, not this      | **Low**    |
| `MIN_BASE_WEEKS`            | 2     | Arbitrary floor for short plans                        | **Low**    |
| `MIN_BUILD_WEEKS`           | 1     | Arbitrary floor for short plans                        | **Low**    |
| `MIN_TAPER_WEEKS`           | 2     | Arbitrary floor for short plans                        | **Low**    |
| `MIN_PEAK_WEEKS`            | 1     | Arbitrary floor for short plans                        | **Low**    |
| `CTL_TO_WEEKLY_LOAD`        | 7     | Inverse of CTL as an EWMA of daily TSS                 | **Medium** |
| `MIN_WEEKLY_LOAD`           | 100   | Arbitrary floor so a zero-CTL athlete gets a plan      | **Low**    |
| `PROGRESSION_BASE`          | 1.08  | Inside the conventional "5-10 %/week" band             | **Low**    |
| `PROGRESSION_BUILD`         | 1.07  | As above                                               | **Low**    |
| `PROGRESSION_PEAK`          | 1.02  | As above                                               | **Low**    |
| `PROGRESSION_STEP_CAP`      | 0.1   | Arbitrary cap on one week's absolute rise              | **Low**    |
| `RECOVERY_FRACTION`         | 0.6   | Inside the 50-75 % volume band that maintains VO₂max   | **Medium** |
| `RECOVERY_INTERVAL_BASE`    | 4     | 3:1 step loading — convention, no comparative evidence | **Low**    |
| `RECOVERY_INTERVAL_DEFAULT` | 3     | 2:1 step loading — convention, no comparative evidence | **Low**    |
| `HOURS_BASE_INTERCEPT`      | 0.85  | Convention                                             | **Low**    |
| `HOURS_BASE_SLOPE`          | 0.05  | Convention                                             | **Low**    |
| `HOURS_BUILD_INTERCEPT`     | 1.0   | Convention                                             | **Low**    |
| `HOURS_BUILD_SLOPE`         | 0.03  | Convention                                             | **Low**    |
| `HOURS_PEAK`                | 1.1   | Convention                                             | **Low**    |
| `CTL_RAMP_PER_WEEK`         | 5     | Coggan/Friel ramp-rate guidance, ~5 TSS/week           | **Medium** |

## 1. The phase split is convention, and the arithmetic misleads

`PHASE_SHARE_BASE` / `BUILD` / `TAPER` divide the plan 40/30/15, peak taking
the remainder. This is traditional linear periodization as taught, and no
head-to-head evidence establishes it over any other division.

There is a second, subtler problem the split creates: **recovery weeks are
counted inside the phase totals.** A "4-week base" containing a recovery week
is three loading weeks. The intervals.icu ATP thread ran to six posts of
confusion over exactly this. Stated here so the arithmetic is not read as
saying more than it does.

## 2. `CTL_TO_WEEKLY_LOAD = 7` is arithmetic, not a claim

CTL is an exponentially weighted moving average of daily TSS with a 42-day
time constant. A steady weekly load `L` settles at `CTL ≈ L / 7`. Using 7 to
go the other way is the inverse of that identity.

What it is **not**: a claim that any given athlete's CTL will reach `L/7`
within the plan, which depends on where they start and how long the plan runs.
It is a starting-point conversion. **Confidence: Medium** — sound arithmetic on
the Banister model, applied slightly beyond what it strictly licenses.

## 3. `RECOVERY_FRACTION = 0.6` has real support

The detraining literature is unusually clear here, and the volume evidence doc
already leans on it for the short-event floor:

- A 70 % reduction in volume with intensity maintained preserves VO₂max.
- Maintaining 50-75 % of normal volume showed no drop in aerobic fitness.

0.6 sits inside that band, so a recovery week is a maintenance week rather than
a detraining one. **Confidence: Medium.**

## 4. The step-loading cadence is convention with no comparative evidence

`RECOVERY_INTERVAL_BASE = 4` and `RECOVERY_INTERVAL_DEFAULT = 3` implement 3:1
and 2:1 step loading — each value names "every Nth week is recovery", so 4
means 3 loading weeks then 1 recovery week, and 3 means 2 loading weeks then
1 recovery week. A targeted search for a head-to-head comparison of 3:1
versus 2:1 in endurance athletes returns nothing.

**Do not cite Issurin 2010 for this.** Issurin is _block_ periodization —
2-4 week concentrated blocks in accumulation → transmutation → realization.
That is a different model and does not support 3:1 step loading.
intervals.icu's own documentation makes this mis-citation; we should not
inherit it. **Confidence: Low, and it should stay Low.**

## 5. The progression rates are feel

`PROGRESSION_BASE = 1.08`, `BUILD = 1.07`, `PEAK = 1.02` sit inside the
conventional "increase 5-10 % per week" advice, which is itself convention
rather than a finding. `PROGRESSION_STEP_CAP = 0.1` is an arbitrary absolute
brake on top.

What matters more than their exact values is what now bounds them — see §6.
**Confidence: Low.**

## 6. `CTL_RAMP_PER_WEEK = 5` — the bound that was missing

Until v0.45 nothing bounded the skeleton's compounding. `effectiveWeekLoad`
clamps week-over-week change to ±`RAMP_CLAMP_PCT` (0.2) of last week's
**actual** load — but the skeleton progresses at 8 %/week, and **8 < 20, so
that clamp never fires against it**. Every step was individually legal while
the total ran away: `1.08^20` is 4.7x.

The bound is now applied where the compounding happens:

```text
maxLoad(w)  = (startingCtl + CTL_RAMP_PER_WEEK × w) × CTL_TO_WEEKLY_LOAD
currentLoad = min(compounded, maxLoad(w))
```

5 TSS/week is the Coggan/Friel ramp-rate guidance, widely used in coaching
practice and surfaced by TrainingPeaks as a ramp-rate warning. It is **not** a
validated injury threshold, and no trial supports the specific number.
**Confidence: Medium** — defensible practice, not evidence.

## 7. The taper is not in this document

`PHASE_SHARE_TAPER` decides how many weeks are _labelled_ taper. The taper's
actual shape comes from `src/lib/race/taper.ts` — 21/14/10-day windows by race
class and the fractions 0.45/0.65/0.80 — driven by the race calendar.

Before v0.45 `periodize()` also decayed load 25 %/week and hours
0.7 → 0.6 → 0.5 in taper weeks: two independent rates for one taper, which
diverged every week. Both are gone. The taper ladder now has one authority.

## Sources

- Impellizzeri et al. 2020, IJSPP — _Acute:Chronic Workload Ratio: Conceptual
  Issues and Fundamental Pitfalls_
- Issurin 2010 — block periodization (cited here only to record that it does
  **not** support 3:1 step loading)
- `docs/specs/2026-07-28-training-volume-evidence.md` — detraining and volume
  bands, and the ACWR correction this release also makes
