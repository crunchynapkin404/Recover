// The availability value type. Pure: no DB, no clock reads.

export type Energy = "easy" | "normal" | "full";

export type Purpose =
  | "recovery"
  | "aerobic_base"
  | "threshold"
  | "vo2max"
  | "brick"
  | "long"
  | "strength";

export interface AvailabilityBlock {
  /** "HH:MM" local. null only on rows migrated from the pre-block model. */
  start: string | null;
  end: string | null;
  /** Derived from start/end on write when both are present. */
  mins: number;
  energy: Energy;
  /** null = any sport in the plan. */
  sports: string[] | null;
}

/**
 * At most this many sessions land on one calendar day. Source:
 * `docs/specs/2026-07-27-availability-scheduling-redesign-design.md`
 * ("at most two sessions per day"), a scheduling design decision.
 * Confidence: Low.
 */
export const MAX_SESSIONS_PER_DAY = 2;

/** Which purposes an expected energy level admits. */
export const ENERGY_CEILING: Record<Energy, Purpose[]> = {
  easy: ["recovery", "aerobic_base", "long"],
  normal: ["recovery", "aerobic_base", "long", "threshold", "strength"],
  full: [
    "recovery",
    "aerobic_base",
    "long",
    "threshold",
    "vo2max",
    "brick",
    "strength",
  ],
};

/**
 * Below its floor a session no longer delivers its stimulus. Source: same
 * availability-scheduling-redesign design doc's per-purpose floor table
 * (recovery 20, aerobic_base 40, threshold 45, vo2max 40, brick 60, long
 * 90) — a coaching judgment call, not literature-cited. Confidence: Low.
 */
export const PURPOSE_FLOORS: Record<Purpose, number> = {
  recovery: 20,
  aerobic_base: 40,
  threshold: 45,
  vo2max: 40,
  brick: 60,
  long: 90,
  /**
   * Below this a strength session is not worth changing clothes for. Matches
   * `recovery`'s floor — the shortest big-4 session that still delivers a
   * stimulus. Coaching judgment, not literature-cited. Confidence: Low.
   */
  strength: 20,
};

/** One step toward the nearest lesser stimulus. recovery is the floor. */
export const SUBSTITUTE_TO: Partial<Record<Purpose, Purpose>> = {
  vo2max: "threshold",
  brick: "threshold",
  threshold: "aerobic_base",
  long: "aerobic_base",
  aerobic_base: "recovery",
  strength: "recovery",
};

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** "HH:MM", hour 00-23, minute 00-59 — the shape toMinutes() itself never checks. */
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Both null (legacy/unset), or both present and a plausible "HH:MM". Guards
 * against non-object entries first: callers pass this the raw contents of a
 * parsed JSON array, which TypeScript's `AvailabilityBlock` type does not
 * enforce at runtime.
 */
function hasValidClockShape(b: AvailabilityBlock): boolean {
  if (typeof b !== "object" || b === null) return false;
  if (b.start === null && b.end === null) return true;
  return (
    typeof b.start === "string" &&
    typeof b.end === "string" &&
    TIME_RE.test(b.start) &&
    TIME_RE.test(b.end)
  );
}

/**
 * The only reader of a block's duration. Clock times win when present so
 * `mins` can never drift from them; legacy blocks carry `mins` alone.
 */
export function blockMins(b: AvailabilityBlock): number {
  if (b.start != null && b.end != null) {
    return toMinutes(b.end) - toMinutes(b.start);
  }
  return b.mins;
}

/** Null when the list is a legal day. An empty list is legal: "unavailable". */
export function validateBlocks(blocks: AvailabilityBlock[]): string | null {
  for (const b of blocks) {
    if (!hasValidClockShape(b)) {
      return "A block's start and end must both be times, or both be empty.";
    }
    // These three reach the engine as-is. `energy` indexes ENERGY_CEILING in
    // admits(), so an unrecognised tier throws there rather than here — and
    // once stored, it throws on every subsequent materialize/replan for this
    // athlete. Validate at the only gate every writer passes through.
    if (!Object.prototype.hasOwnProperty.call(ENERGY_CEILING, b.energy)) {
      return "A block's energy must be easy, normal or full.";
    }
    if (!Number.isInteger(b.mins) || b.mins < 0) {
      return "A block's minutes must be a whole number of minutes, not negative.";
    }
    if (
      b.sports !== null &&
      (!Array.isArray(b.sports) || b.sports.some((s) => typeof s !== "string"))
    ) {
      return "A block's sports must be names, or empty for any sport.";
    }
    // `[]` is not `null`: admits() reads it as "no sport qualifies", so the
    // block is availability the athlete can see but nothing can ever occupy.
    if (Array.isArray(b.sports) && b.sports.length === 0) {
      return "A block with no sport selected can never hold a session. Pick at least one, or leave it open to any sport.";
    }
    if (
      b.start != null &&
      b.end != null &&
      toMinutes(b.end) <= toMinutes(b.start)
    ) {
      return "A block must end after it starts.";
    }
  }
  const timed = blocks
    .filter((b) => b.start != null && b.end != null)
    .sort((a, b) => toMinutes(a.start!) - toMinutes(b.start!));
  for (let i = 1; i < timed.length; i++) {
    if (toMinutes(timed[i].start!) < toMinutes(timed[i - 1].end!)) {
      return "Blocks on the same day cannot overlap.";
    }
  }
  return null;
}
