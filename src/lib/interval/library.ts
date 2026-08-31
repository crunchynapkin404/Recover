import type { LibraryWorkout, Block, Step } from "./types";

const S = (
  secs: number,
  lo: number,
  hi: number,
  x: Partial<Step> = {}
): Step => ({
  secs,
  lo,
  hi,
  ...x,
});
const B = (name: string, repeat: number, steps: Step[]): Block => ({
  name,
  repeat,
  steps,
});
/** Warmup ramps; it is the flex step for quality sessions. */
const WU = (m: number) => B("Warmup", 1, [S(m * 60, 50, 70, { ramp: true })]);
const CD = (m: number) => B("Cooldown", 1, [S(m * 60, 50, 50)]);
/** The endurance body — the flex step for recovery, aerobic_base and long. */
const BODY = (m: number, lo: number, hi: number) =>
  B("Endurance", 1, [S(m * 60, lo, hi)]);

/** `source` in the shape plan-constants.ts uses. */
const conv = (what: string, raise: string): string =>
  `Coaching convention. Confidence: Low — ${what}. What would raise it: ${raise}.`;

const NO_TRIAL =
  "a controlled comparison of these block lengths at this intensity on the same athlete";

/**
 * The curated cycling library. Hand-authored, and the reason this feature
 * reverses a recorded non-goal — see the spec's "The reversal, recorded".
 *
 * Every workout carries a `source` naming its provenance, a confidence label,
 * and what would raise it. They are coaching conventions and they say so; a
 * shape dressed up as a citation it does not have would break the admission
 * gate the whole reversal rests on.
 *
 * Ids are stable and never renumbered — selection sorts on them.
 */
export const LIBRARY: readonly LibraryWorkout[] = [
  // ── recovery ─────────────────────────────────────────────────────────
  {
    id: "rec-spin-30",
    name: "Recovery Spin",
    purpose: "recovery",
    family: "easy-spin",
    why: "Turn the legs over; nothing more.",
    source: conv(
      "no trial fixes a recovery ride's length",
      "any evidence that duration matters below the aerobic threshold"
    ),
    blocks: [WU(5), BODY(20, 45, 55), CD(5)],
  },
  {
    id: "rec-spin-70",
    name: "Long Easy Spin",
    purpose: "recovery",
    family: "easy-spin",
    why: "A longer easy ride when the plan wants volume without stress.",
    source: conv("as rec-spin-30", "the same"),
    blocks: [WU(5), BODY(60, 45, 55), CD(5)],
  },
  {
    id: "rec-cadence-30",
    name: "Recovery with Cadence",
    purpose: "recovery",
    family: "cadence-play",
    why: "Easy effort at high cadence — neuromuscular work without load.",
    source: conv(
      "high-cadence spinning on recovery days is convention, untested against plain easy riding",
      "a trial comparing recovery quality with and without the cadence work"
    ),
    blocks: [WU(5), B("Easy", 1, [S(1200, 45, 55, { rpm: 95 })]), CD(5)],
  },
  {
    id: "rec-cadence-70",
    name: "Long Recovery with Cadence",
    purpose: "recovery",
    family: "cadence-play",
    why: "As the short version, stretched.",
    source: conv("as rec-cadence-30", "the same"),
    blocks: [WU(5), B("Easy", 1, [S(3600, 45, 55, { rpm: 95 })]), CD(5)],
  },

  // ── aerobic_base ─────────────────────────────────────────────────────
  {
    id: "end-short",
    name: "Short Endurance",
    purpose: "aerobic_base",
    family: "endurance",
    why: "Steady aerobic riding — the plan's default session.",
    source: conv(
      "zone-2 riding is near-universal convention; its exact band is not settled",
      "a comparison of 56-75% against a narrower band on the same athlete"
    ),
    blocks: [WU(6), BODY(15, 56, 75), CD(6)],
  },
  {
    id: "end-mid",
    name: "Endurance",
    purpose: "aerobic_base",
    family: "endurance",
    why: "Steady aerobic riding.",
    source: conv("as end-short", "the same"),
    blocks: [WU(6), BODY(30, 56, 75), CD(6)],
  },
  {
    id: "end-long",
    name: "Endurance, Extended",
    purpose: "aerobic_base",
    family: "endurance",
    why: "Steady aerobic riding at length.",
    source: conv("as end-short", "the same"),
    blocks: [WU(10), BODY(75, 56, 75), CD(10)],
  },
  {
    id: "end-xl",
    name: "Endurance, Long",
    purpose: "aerobic_base",
    family: "endurance",
    why: "The upper end of an endurance day.",
    source: conv("as end-short", "the same"),
    blocks: [WU(10), BODY(210, 56, 72), CD(10)],
  },
  {
    id: "end-tempo-mid",
    name: "Endurance with Tempo",
    purpose: "aerobic_base",
    family: "tempo-touches",
    why: "Aerobic volume with two tempo blocks for shape.",
    source: conv(
      "tempo touches inside an endurance ride are convention for time-limited weeks",
      "a comparison against the same minutes ridden flat"
    ),
    blocks: [
      WU(10),
      BODY(30, 56, 72),
      B("Tempo", 2, [S(600, 76, 83), S(300, 55, 55)]),
      CD(10),
    ],
  },
  {
    id: "end-tempo-long",
    name: "Endurance with Tempo, Extended",
    purpose: "aerobic_base",
    family: "tempo-touches",
    why: "As above, longer.",
    source: conv("as end-tempo-mid", "the same"),
    blocks: [
      WU(10),
      BODY(75, 56, 72),
      B("Tempo", 3, [S(600, 76, 83), S(300, 55, 55)]),
      CD(10),
    ],
  },

  // ── long ─────────────────────────────────────────────────────────────
  {
    id: "long-short",
    name: "Short Long Ride",
    purpose: "long",
    family: "long-steady",
    why: "The shortest ride the plan still calls long.",
    source: conv(
      "the two-hour convention for endurance rides is uncited coaching guidance, already recorded at MIN_LONG_BOUND_MINS",
      "a dose-response study on ride duration in trained cyclists"
    ),
    blocks: [WU(10), BODY(40, 56, 72), CD(10)],
  },
  {
    id: "long-mid",
    name: "Long Ride",
    purpose: "long",
    family: "long-steady",
    why: "Steady aerobic hours.",
    source: conv("as long-short", "the same"),
    blocks: [WU(15), BODY(90, 56, 72), CD(15)],
  },
  {
    id: "long-xl",
    name: "Long Ride, Extended",
    purpose: "long",
    family: "long-steady",
    why: "The long end of a long ride.",
    source: conv("as long-short", "the same"),
    blocks: [WU(15), BODY(210, 56, 70), CD(15)],
  },
  {
    id: "long-surges-mid",
    name: "Long Ride with Surges",
    purpose: "long",
    family: "long-surges",
    why: "Steady hours with short efforts late, on already-tired legs.",
    source: conv(
      "late-ride efforts to rehearse fatigue resistance are convention; the placement is not derived",
      "a trial placing the same efforts early against late"
    ),
    blocks: [
      WU(15),
      BODY(90, 56, 72),
      B("Surges", 4, [S(60, 105, 115), S(240, 55, 65)]),
      CD(15),
    ],
  },
  {
    id: "long-surges-xl",
    name: "Long Ride with Surges, Extended",
    purpose: "long",
    family: "long-surges",
    why: "As above, longer.",
    source: conv("as long-surges-mid", "the same"),
    blocks: [
      WU(15),
      BODY(180, 56, 70),
      B("Surges", 5, [S(60, 105, 115), S(240, 55, 65)]),
      CD(15),
    ],
  },

  // ── threshold ────────────────────────────────────────────────────────
  {
    id: "thr-3x4",
    name: "Threshold 3×4",
    purpose: "threshold",
    family: "threshold-blocks",
    why: "Three short blocks at threshold — the shortest session that still delivers the stimulus.",
    // The 4-minute cooldown is deliberate: FLEX_FLOOR_SECS stops the warmup
    // shrinking below 5 minutes, so a 5-minute cooldown would start this
    // workout's span at 28 and leave the 27-minute day unanswered.
    source: conv(
      "block length at threshold is convention, not derived",
      NO_TRIAL
    ),
    blocks: [WU(8), B("Main set", 3, [S(240, 95, 100), S(120, 55, 55)]), CD(4)],
  },
  {
    id: "thr-3x5",
    name: "Threshold 3×5",
    purpose: "threshold",
    family: "threshold-blocks",
    why: "Three blocks at threshold.",
    source: conv("as thr-3x4", NO_TRIAL),
    blocks: [
      WU(10),
      B("Main set", 3, [S(300, 95, 100), S(180, 55, 55)]),
      CD(6),
    ],
  },
  {
    id: "ss-3x5",
    name: "Sweet Spot 3×5",
    purpose: "threshold",
    family: "sweet-spot",
    why: "Three short sweet-spot blocks — less sharp than threshold, easier to repeat.",
    source: conv(
      "the sweet-spot band (88-93%) is widely used and has no settled definition",
      "a comparison of 88-93% against 95-100% for the same total work"
    ),
    blocks: [WU(10), B("Main set", 3, [S(300, 88, 93), S(180, 55, 55)]), CD(6)],
  },
  {
    id: "thr-3x5-long-wu",
    name: "Threshold 3×5, Long Build",
    purpose: "threshold",
    family: "threshold-blocks",
    why: "The same main set behind a longer build.",
    source: conv("as thr-3x4", NO_TRIAL),
    blocks: [
      WU(20),
      B("Main set", 3, [S(300, 95, 100), S(180, 55, 55)]),
      CD(6),
    ],
  },
  {
    id: "ss-2x12",
    name: "Sweet Spot 2×12",
    purpose: "threshold",
    family: "sweet-spot",
    why: "Two longer sweet-spot blocks.",
    source: conv("as ss-3x5", "the same"),
    blocks: [WU(20), B("Main set", 2, [S(720, 88, 93), S(300, 55, 55)]), CD(8)],
  },
  {
    id: "thr-4x8",
    name: "Threshold 4×8",
    purpose: "threshold",
    family: "threshold-blocks",
    why: "Four blocks at threshold — the classic mid-length session.",
    source: conv("as thr-3x4", NO_TRIAL),
    blocks: [
      WU(25),
      B("Main set", 4, [S(480, 95, 100), S(240, 55, 55)]),
      CD(9),
    ],
  },
  {
    id: "ou-3x12",
    name: "Over-Under 3×12",
    purpose: "threshold",
    family: "over-under",
    why: "Alternating either side of threshold — clearing lactate while still working.",
    source: conv(
      "over-unders are convention for threshold tolerance; the 2-minute alternation is arbitrary",
      "a trial comparing alternation periods at matched total work"
    ),
    blocks: [
      WU(25),
      B("Main set", 3, [
        S(120, 105, 105),
        S(120, 90, 90),
        S(120, 105, 105),
        S(120, 90, 90),
        S(120, 105, 105),
        S(120, 90, 90),
        S(300, 55, 55),
      ]),
      CD(9),
    ],
  },
  {
    id: "ss-3x20",
    name: "Sweet Spot 3×20",
    purpose: "threshold",
    family: "sweet-spot",
    why: "Three long sweet-spot blocks — the upper end of a threshold day.",
    source: conv("as ss-3x5", "the same"),
    blocks: [
      WU(28),
      B("Main set", 3, [S(1200, 88, 93), S(300, 55, 55)]),
      CD(9),
    ],
  },

  // ── vo2max ───────────────────────────────────────────────────────────
  {
    id: "vo2-6x1",
    name: "VO₂max 6×1",
    purpose: "vo2max",
    family: "short-vo2",
    why: "Six short, sharp efforts — the shortest VO₂max session worth doing.",
    source: conv(
      "short-interval VO2max work is convention; one minute is one of several lengths in use",
      "a comparison of 1-, 3- and 5-minute intervals at matched total work"
    ),
    blocks: [
      WU(16),
      B("Main set", 6, [S(60, 110, 120), S(120, 50, 50)]),
      CD(6),
    ],
  },
  {
    id: "vo2-5x3",
    name: "VO₂max 5×3",
    purpose: "vo2max",
    family: "classic-vo2",
    why: "Five three-minute efforts with equal recovery.",
    source: conv("3-minute intervals at 106-118% are convention", NO_TRIAL),
    blocks: [
      WU(20),
      B("Main set", 5, [S(180, 106, 118), S(180, 50, 50)]),
      CD(8),
    ],
  },
  {
    id: "vo2-30-30",
    name: "VO₂max 30/30",
    purpose: "vo2max",
    family: "short-vo2",
    why: "Thirty on, thirty off — accumulates time near VO₂max at lower perceived cost.",
    source: conv(
      "30/30s are widely used; the claim that they accumulate more time at VO2max is not tested here",
      "a comparison of measured time-at-VO2max against 4-minute intervals"
    ),
    blocks: [
      WU(20),
      B("Main set", 3, [
        S(30, 115, 125),
        S(30, 50, 50),
        S(30, 115, 125),
        S(30, 50, 50),
        S(30, 115, 125),
        S(30, 50, 50),
        S(30, 115, 125),
        S(30, 50, 50),
        S(30, 115, 125),
        S(30, 50, 50),
        S(300, 50, 50),
      ]),
      CD(8),
    ],
  },
  {
    id: "vo2-5x4",
    name: "VO₂max 5×4",
    purpose: "vo2max",
    family: "classic-vo2",
    why: "Five four-minute efforts — the session most plans mean by VO₂max.",
    source: conv("as vo2-5x3", NO_TRIAL),
    blocks: [
      WU(25),
      B("Main set", 5, [S(240, 106, 115), S(240, 50, 50)]),
      CD(9),
    ],
  },
  {
    id: "vo2-4x5",
    name: "VO₂max 4×5",
    purpose: "vo2max",
    family: "classic-vo2",
    why: "Four five-minute efforts — longer and a little lower than 5×4.",
    source: conv("as vo2-5x3", NO_TRIAL),
    blocks: [
      WU(30),
      B("Main set", 4, [S(300, 106, 112), S(300, 50, 50)]),
      CD(9),
    ],
  },
  {
    id: "vo2-8x3",
    name: "VO₂max 8×3",
    purpose: "vo2max",
    family: "short-vo2",
    why: "Eight three-minute efforts.",
    source: conv("as vo2-6x1", "the same"),
    blocks: [
      WU(30),
      B("Main set", 8, [S(180, 108, 116), S(180, 50, 50)]),
      CD(9),
    ],
  },
  {
    id: "vo2-12x3",
    name: "VO₂max 12×3",
    purpose: "vo2max",
    family: "short-vo2",
    why: "Twelve three-minute efforts — the upper end of a VO₂max day.",
    source: conv("as vo2-6x1", "the same"),
    blocks: [
      WU(26),
      B("Main set", 12, [S(180, 108, 116), S(180, 50, 50)]),
      CD(9),
    ],
  },
];
