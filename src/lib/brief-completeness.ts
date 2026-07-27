/**
 * Data-completeness for the morning brief (2026-07-26). Two different
 * questions, deliberately answered from two different sources:
 *
 *  - "Did last night's measurement arrive?" — read from the RAW
 *    wellness_daily fields. This gates whether the brief may fire at all.
 *    It must NOT be answered from componentScores: those stay null until
 *    the athlete has MIN_BASELINE_DAYS (14) of history, so a new athlete
 *    with a perfectly good HRV reading would never pass the gate.
 *
 *  - "What actually counted toward the score?" — read from
 *    daily_metrics.componentScores. That is the honest thing to tell the
 *    athlete, and it correctly separates "no HRV measured" from "HRV
 *    measured but not yet baselined".
 *
 * Pure functions only: no db, no I/O.
 */

export interface OvernightArrival {
  hrv: boolean;
  sleep: boolean;
}

/** The brief may fire on its own only once both overnight signals exist. */
export function overnightComplete(a: OvernightArrival): boolean {
  return a.hrv && a.sleep;
}

/**
 * Map today's wellness_daily row to an arrival. Only `null` counts as "not
 * measured" — 0 is a real reading.
 *
 * Sleep arrival is "either source", mirroring readiness.ts's own scoring
 * (readiness.ts:135-138 scores from sleepScore when present, falling back to
 * sleepSecs): Oura, Whoop and intervals.icu can each populate sleep_score
 * independently of sleep_secs. Gating on sleepSecs alone would hold an
 * athlete whose provider only ever sends a score, forever, to the 09:00
 * backstop.
 */
export function arrivalFromWellness(
  row:
    | {
        hrvMs: number | null;
        sleepSecs: number | null;
        sleepScore: number | null;
      }
    | null
    | undefined
): OvernightArrival {
  return {
    hrv: row?.hrvMs != null,
    sleep: row?.sleepSecs != null || row?.sleepScore != null,
  };
}

export type ComponentKey = "hrv" | "rhr" | "sleep" | "form";

const ALL_COMPONENTS: ComponentKey[] = ["hrv", "rhr", "sleep", "form"];

/** Athlete-facing names, in the readiness engine's own weight order. */
const LABELS: Record<ComponentKey, string> = {
  hrv: "HRV",
  rhr: "resting HR",
  sleep: "sleep",
  form: "form",
};

/**
 * Which components contributed nothing to today's score. Defensive about
 * the jsonb: null, absent, or a non-object all mean "nothing scored".
 */
export function missingComponents(scores: unknown): ComponentKey[] {
  if (typeof scores !== "object" || scores === null) return [...ALL_COMPONENTS];
  const s = scores as Partial<Record<ComponentKey, number | null>>;
  return ALL_COMPONENTS.filter((k) => s[k] == null);
}

function list(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * One plain sentence naming the gaps, or null when the picture is whole.
 * Never fabricates confidence — the athlete sees exactly what the number
 * did and did not include.
 *
 * Takes the arrival as well as the scores because a null score has two very
 * different causes: the measurement never came, or it came but the athlete
 * has fewer than MIN_BASELINE_DAYS (14) of history to score it against.
 * Only HRV and sleep have arrival information; a null RHR or form score is
 * reported neutrally, since we cannot tell which case it is.
 */
export function gapSentence(
  scores: unknown,
  arrival: OvernightArrival
): string | null {
  const missing = missingComponents(scores);
  if (missing.length === 0) return null;

  const present = ALL_COMPONENTS.filter((k) => !missing.includes(k));

  // Split only the two we have arrival facts for.
  const unbaselined = missing.filter(
    (k) => (k === "hrv" && arrival.hrv) || (k === "sleep" && arrival.sleep)
  );
  const absent = missing.filter((k) => !unbaselined.includes(k));

  const clauses: string[] = [];
  if (absent.length > 0) {
    clauses.push(
      `${list(absent.map((k) => LABELS[k]))} ${absent.length === 1 ? "is" : "are"} missing for today`
    );
  }
  if (unbaselined.length > 0) {
    clauses.push(
      `${list(unbaselined.map((k) => LABELS[k]))} arrived but ${unbaselined.length === 1 ? "has" : "have"} not enough history to score yet`
    );
  }

  const suffix =
    present.length > 0
      ? ` — this leans on ${list(present.map((k) => LABELS[k]))}.`
      : ".";

  return `Incomplete picture: ${clauses.join("; ")}${suffix}`;
}
