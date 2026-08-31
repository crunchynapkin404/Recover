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
    why: "Easy watts at high cadence — neuromuscular work without load.",
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
];
