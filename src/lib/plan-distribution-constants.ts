/**
 * How a week's total training minutes are divided into sessions.
 *
 * These decide what an athlete's week physically looks like — how long the
 * long run is, how a triathlete's hours split across three sports. They were
 * inline literals inside `training-plan.ts`, sitting beside *exported*
 * constants in the same file (`MIN_LONG_BOUND_MINS`,
 * `ABSOLUTE_LONG_BOUND_MINS`) that each carry a full `Source:` block from
 * Phase 2a's original sweep. That sweep covered exported constants only, so
 * it walked straight past these. They are the clearest illustration of the
 * gap v0.94.0 exists to close.
 *
 * **v0.94.0 changed no value.** Only provenance is new. Where the sourcing
 * shows a number sits outside published guidance, that is recorded here as a
 * finding rather than silently corrected — changing training prescriptions
 * is a separate decision from documenting them.
 *
 * ## References
 *
 * - Hansons Marathon Method and Jack Daniels both cap the long run at
 *   **25-30% of weekly volume**; the "20-30% rule" is the common statement of
 *   it. <https://www.runinrabbit.com/blogs/rabbit-chatter/the-marathon-training-series-building-mileage-for-long-runs>
 * - Triathlon discipline splits, which vary widely by source and distance:
 *   a "balanced athlete" 30/50/20, Olympic-distance 35/40/25, and an
 *   elite/short-course distribution near 20/50/30.
 *   <https://www.trainingpeaks.com/blog/balancing-swim-bike-run-in-triathlon-training/>
 */

/**
 * Fraction of the week's minutes given to the long run, and to each other
 * running session.
 *
 * Source: Hansons / Daniels, who cap the long run at 25-30% of weekly
 * volume. 0.32 is just above that band expressed as distance — but Recover
 * divides **minutes**, not miles, and the same guidance rendered in time
 * ("a three-hour long run means running 9-10 hours a week") is 30-33%. Read
 * as time, 0.32 sits inside the cited range.
 * Confidence: Medium. The unit distinction is what earns it: applied to
 * mileage this would be a slight overshoot.
 * Scope: the fraction is a target, then bounded by MIN_LONG_BOUND_MINS and
 * ABSOLUTE_LONG_BOUND_MINS in `training-plan.ts`.
 *
 * EASY_RUN_FRACTION (0.15) is Invented, Low — a filler share with no cited
 * basis, chosen so the remaining sessions divide sensibly.
 */
export const RUN_LONG_FRACTION = 0.32;
export const RUN_EASY_FRACTION = 0.15;

/**
 * Hard ceiling on a single long run, in minutes, and the tighter ceiling
 * during a taper week.
 *
 * Source: Invented. Three hours is a widely repeated practical ceiling for a
 * marathon long run — the argument being that beyond it the injury and
 * recovery cost outruns the aerobic return — but it is coaching convention,
 * not a citable finding, and it is applied here to every runner regardless
 * of their own longest recent run.
 * Confidence: Low.
 *
 * **This is the BINDING bound for most athletes, not RUN_LONG_FRACTION.**
 * `0.32 × weekHours × 60 > 180` whenever the week exceeds **9.375 hours**,
 * so above that the fraction has no effect whatever and every long run is
 * exactly 180 minutes. Recorded because it is easy to read the fraction as
 * the governing rule when for a high-volume runner it never applies — and
 * because it is why a mutation raising the fraction from 0.32 to 0.50
 * survived the whole suite: at a 10-hour fixture, both values clamp to 180.
 * See `plan-distribution.test.ts`, which tests below the crossover for that
 * reason.
 */
export const RUN_LONG_CAP_MINS = 180;
export const RUN_LONG_CAP_TAPER_MINS = 60;

/**
 * The same two fractions for a cycling plan.
 *
 * Source: Invented. The long-ride share is the cycling analogue of the
 * running long-run rule, set slightly higher because cycling is
 * non-weight-bearing and tolerates a longer single session at the same
 * weekly volume — a defensible rationale, but not a cited one. No
 * equivalent of the Hansons/Daniels 25-30% rule was found for cycling.
 * Confidence: Low.
 */
export const BIKE_LONG_FRACTION = 0.38;
export const BIKE_EASY_FRACTION = 0.18;

/**
 * How a triathlon week's minutes divide across the three disciplines.
 *
 * Source: **Invented, and it does not match the distributions found.**
 * Recorded plainly because this is the sharpest claim in the file — it
 * decides how a triathlete's whole week is allocated.
 *
 * Published splits cluster around: "balanced athlete" 30/50/20,
 * Olympic-distance 35/40/25, and elite/short-course near 20/50/30. Every one
 * of them puts **bike at 40-50%** (most say 50) and **run at 20-30%**.
 * Recover's run share of 0.40 is roughly double the cited figure, and its
 * bike share sits at the bottom of the cited range.
 *
 * The sources do agree on two things Recover cannot use: the split should
 * track the athlete's own strengths and weaknesses, and it should reflect
 * the time actually spent in each discipline *during the race*, which varies
 * by distance. Recover applies one fixed split to every triathlete at every
 * distance, which is why this cannot be rated above Low whatever numbers it
 * held.
 * Confidence: Low.
 *
 * **Flagged as a candidate defect, deliberately not fixed here.** v0.94.0 is
 * a provenance release; changing a training prescription is a separate
 * decision needing its own release, its own reasoning about who is already
 * mid-plan, and a view on whether to vary by race distance.
 */
export const TRI_SPLIT = { swim: 0.2, bike: 0.4, run: 0.4 } as const;

/**
 * Within-discipline shares of a triathlon week's per-sport minutes: the long
 * session of the sport, the key swim session, and the remaining sessions.
 *
 * Source: Invented, all three. Design choices with no cited basis.
 * Confidence: Low.
 */
export const TRI_LONG_RUN_FRACTION = 0.45;
export const TRI_KEY_SWIM_FRACTION = 0.55;
export const TRI_SECONDARY_FRACTION = 0.3;
