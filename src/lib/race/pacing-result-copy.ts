/**
 * The one sentence that describes a race result against its pacing target.
 *
 * Separate from pacing-result.ts on purpose: that module is the comparison,
 * this is how it READS. Two surfaces need the identical sentence — the Races
 * sheet row and the post-race debrief's stat line — and a second phrasing
 * assembled at either call site is how the athlete's screen and their coach
 * come to disagree about the same race.
 *
 * Pure — no I/O, no clock, no JSX.
 */
import type { PacingComparison, PacingVerdict } from "./pacing-result";

/** Seconds per km as m:ss/km. 285 → "4:45/km". */
export function fmtPace(secPerKm: number): string {
  const m = Math.floor(secPerKm / 60);
  const sec = Math.round(secPerKm % 60);
  return `${m}:${String(sec).padStart(2, "0")}/km`;
}

/** U+2212 MINUS SIGN, not a hyphen — this sits next to figures. */
function signedPct(pct: number): string {
  const rounded = Math.abs(pct).toFixed(1);
  return pct < 0 ? `−${rounded}%` : `+${rounded}%`;
}

const VERDICT_WORD: Record<PacingVerdict, string> = {
  harder: "harder than the band",
  inside: "inside the band",
  easier: "easier than the band",
};

/**
 * THE VERDICT IS STATED IN WORDS AND THE RAW PACE DELTA IS NOT PRINTED.
 *
 * For a run the delta's sign runs OPPOSITE to the effort — −7 s/km is faster,
 * which is harder. "+25 s/km" next to a verdict reads as "harder" to anyone
 * who has not been told the convention, and the convention is not something a
 * surface gets to assume. The percentage carries the same information without
 * inviting the wrong reading, and `VERDICT_WORD` says the direction outright.
 */
export function describePacingResult(v: PacingComparison): string {
  if (v.sport === "Bike") {
    return (
      `Predicted ${v.targetWatts} W (hold ${v.lowWatts}–${v.highWatts}) · ` +
      `you held ${v.actualWatts} W — ${VERDICT_WORD[v.verdict]}, ${signedPct(v.deltaPct)}`
    );
  }
  return (
    `Predicted ${fmtPace(v.targetSecPerKm)} (hold ${fmtPace(v.lowSecPerKm)}–${fmtPace(v.highSecPerKm)}) · ` +
    `you held ${fmtPace(v.actualSecPerKm)} — ${VERDICT_WORD[v.verdict]}, ${signedPct(v.deltaPct)}`
  );
}
