/**
 * Reconciling the day's stated intensity band with the workout chosen for it.
 *
 * FOUND BY OPENING A CAPTURE, which is the only way it could have been. The
 * open day rendered "Long · 95 min Z1-Z2" with "3 × 10 min at 76-85% FTP"
 * directly underneath — a card contradicting itself in both themes and both
 * viewports. 132 PNGs and a clean `0 confirmed` axe report said nothing about
 * it, because a card disagreeing with itself is not an accessibility fault.
 *
 * The cause is that the two halves never knew about each other. `intensity`
 * is a literal the planner stamps on a session (`materialize.ts`); the
 * library is indexed on `purpose` and `durationMins` and has never carried a
 * zone. Nothing reconciled them, and nothing had to until v0.129.0 added
 * families that put a third of a long ride at tempo.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO is recompute the band from the workout.
 * That was the first design and measuring it killed it: every session spans
 * from its recovery valleys to its peak, so the range collapses to "Z1-Zpeak"
 * — threshold days read "Z1-Z4" and VO2max days "Z1-Z5", both true and both
 * strictly less useful than the "Z4-Z5" the planner already said. The band is
 * only ever WIDENED, and only when the workout genuinely goes above it.
 *
 * Pure — no I/O, no clock.
 */
import type { Block } from "./types";

/**
 * Upper bound of each power zone, as % of FTP, INCLUSIVE. Index 0 is Z1's
 * ceiling; anything above the last entry is Z7.
 *
 * Source: Allen & Coggan, *Training and Racing with a Power Meter* (3rd ed.,
 * VeloPress 2019) — the seven-zone model, which is the vocabulary the
 * planner's own "Z1-Z2"/"Z4-Z5" literals already speak.
 * Confidence: Medium — the model is published, cited and near-universal, but
 * the boundaries are round teaching numbers rather than measured
 * physiological transitions, and Coggan says as much.
 * What would raise it: nothing available. They are definitions, not
 * measurements, and this athlete's own transitions are not what the label
 * claims to describe.
 */
export const ZONE_UPPER_PCT_FTP = [55, 75, 90, 105, 120, 150] as const;

/** The zone a % of FTP falls in, 1-7. Boundaries close the zone below them. */
export function zoneOf(pctFtp: number): number {
  for (const [i, upper] of ZONE_UPPER_PCT_FTP.entries()) {
    if (pctFtp <= upper) return i + 1;
  }
  return ZONE_UPPER_PCT_FTP.length + 1;
}

/**
 * The hardest zone anywhere in the workout, reading each step's TOP (`hi`)
 * and looking inside repeated blocks — the main set is authored once and
 * repeated, so a scan restricted to `repeat === 1` would miss every interval.
 */
export function peakZone(blocks: readonly Block[]): number {
  let peak = 0;
  for (const b of blocks) {
    for (const s of b.steps) peak = Math.max(peak, zoneOf(s.hi));
  }
  return peak;
}

/** "Z1-Z2" → 2, "Z3" → 3. null when the label is not a zone band at all. */
function plannedTop(label: string): number | null {
  const m = /^Z([1-7])(?:-Z([1-7]))?$/.exec(label.trim());
  if (!m) return null;
  return Number(m[2] ?? m[1]);
}

/**
 * The band to show for a day that has a structured workout: the planner's
 * own label, widened at the top when the workout goes above it.
 *
 * A label this cannot parse is returned untouched. The planner also emits
 * "Recovery", "4x8" and "" — those are its own words for the session, and
 * rewording them is not this function's mandate.
 */
export function reconcileBand(
  planned: string,
  blocks: readonly Block[]
): string {
  const top = plannedTop(planned);
  if (top == null) return planned;
  const peak = peakZone(blocks);
  if (peak <= top) return planned;
  const bottom = /^Z([1-7])-/.exec(planned.trim())?.[1] ?? String(top);
  return `Z${bottom}-Z${peak}`;
}
