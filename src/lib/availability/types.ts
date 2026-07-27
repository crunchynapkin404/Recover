// The availability value type. Pure: no DB, no clock reads.

export type Energy = "easy" | "normal" | "full";

export type Purpose =
  "recovery" | "aerobic_base" | "threshold" | "vo2max" | "brick" | "long";

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

/** At most this many sessions land on one calendar day. */
export const MAX_SESSIONS_PER_DAY = 2;

/** Which purposes an expected energy level admits. */
export const ENERGY_CEILING: Record<Energy, Purpose[]> = {
  easy: ["recovery", "aerobic_base", "long"],
  normal: ["recovery", "aerobic_base", "long", "threshold"],
  full: ["recovery", "aerobic_base", "long", "threshold", "vo2max", "brick"],
};

/** Below its floor a session no longer delivers its stimulus. */
export const PURPOSE_FLOORS: Record<Purpose, number> = {
  recovery: 20,
  aerobic_base: 40,
  threshold: 45,
  vo2max: 40,
  brick: 60,
  long: 90,
};

/** One step toward the nearest lesser stimulus. recovery is the floor. */
export const SUBSTITUTE_TO: Partial<Record<Purpose, Purpose>> = {
  vo2max: "threshold",
  brick: "threshold",
  threshold: "aerobic_base",
  long: "aerobic_base",
  aerobic_base: "recovery",
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
