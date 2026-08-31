import type { Purpose } from "@/lib/availability/types";

/**
 * The five purposes a cycling library workout can answer. Keyed off the
 * engine's own vocabulary via Extract, never a parallel union — dropping a
 * member from Purpose is a compile error here rather than a silent hole.
 * "brick" is multi-sport; "strength" has strength/prescription.ts.
 */
export type LibraryPurpose = Extract<
  Purpose,
  "recovery" | "aerobic_base" | "long" | "threshold" | "vo2max"
>;

/** Targets are ALWAYS % of FTP, never watts. 88 means 88% FTP. */
export interface Step {
  secs: number;
  lo: number;
  hi: number;
  /** Ramp linearly lo→hi across the step. Absent = hold the range. */
  ramp?: true;
  rpm?: number;
}

/**
 * `repeat: 1` is a plain section; `repeat: n` is intervals.icu's
 * "Main set 5x" and Zwift's <IntervalsT Repeat="5">. Deliberately ONE level
 * deep — an over-under is authored as an unrolled body inside one repeat,
 * which every renderer already handles.
 */
export interface Block {
  name: string;
  repeat: number;
  steps: Step[];
}

export interface LibraryWorkout {
  /** Stable, hand-assigned, never renumbered — it is the sort key. */
  id: string;
  name: string;
  purpose: LibraryPurpose;
  /**
   * "sweet-spot" | "over-under" | "30-30" | … Rotation avoids repeating a
   * FAMILY, not merely an id: `purpose` was built for scheduling, not for
   * describing a stimulus, so (purpose, duration) alone collapses 100
   * workouts onto two axes and the same shape would recur under two names.
   */
  family: string;
  /** One sentence of coaching intent. Becomes the .zwo/ICU description. */
  why: string;
  /**
   * Provenance. REQUIRED — this is what carries the reversal recorded in the
   * spec. Names where the shape comes from, its confidence, and what would
   * raise it. A workout without one does not ship.
   */
  source: string;
  blocks: Block[];
}
