/**
 * The shape of a plan the athlete has been shown but has not accepted.
 *
 * Arithmetic first: `phases` exists so the week count reconciles on screen.
 * `periodize` substitutes recovery weeks INSIDE a phase's span, so "base 8
 * weeks" and "eight base weeks" are different numbers — the gap that produced
 * six separate confused forum posts on the competing implementation. Recovery
 * therefore gets its own row and the rows sum to weeksTotal by construction.
 *
 * Pure — no I/O, no clock.
 */

import type { Verdict } from "@/lib/race/feasibility";
import type { VolumeResult } from "@/lib/week-plan/volume";

export type PlanPhase = "base" | "build" | "peak" | "taper" | "recovery";

export interface PhaseRow {
  phase: PlanPhase;
  /** Equals weekNumbers.length. Carried explicitly because it is what renders. */
  weeks: number;
  weekNumbers: number[];
}

/** Display order. Recovery sits last: it is a modifier, not a stage. */
const PHASE_ORDER: PlanPhase[] = ["base", "build", "peak", "taper", "recovery"];

export function buildPhases(
  weeks: { weekNumber: number; phase: PlanPhase }[]
): PhaseRow[] {
  const byPhase = new Map<PlanPhase, number[]>();
  for (const w of weeks) {
    const list = byPhase.get(w.phase) ?? [];
    list.push(w.weekNumber);
    byPhase.set(w.phase, list);
  }

  return PHASE_ORDER.filter((p) => byPhase.has(p)).map((phase) => {
    const weekNumbers = [...(byPhase.get(phase) ?? [])].sort((a, b) => a - b);
    return { phase, weeks: weekNumbers.length, weekNumbers };
  });
}

/**
 * Closed set. A condition that does not appear here is a bug in the caller,
 * not a warning we forgot — the whole point is that the preview never goes
 * quiet about a number it could not derive honestly.
 */
export type PreviewWarning =
  | "no_ctl_history"
  | "volume_fallback"
  | "availability_binds"
  | "feasibility_tight"
  | "feasibility_not_realistic"
  | "race_created"
  | "availability_seeded"
  | "short_horizon";

export interface WarningInput {
  startingCtlSource: "wellness" | "default";
  volumeSource: VolumeResult["source"];
  hasShortfall: boolean;
  /**
   * null while feasibility could not be assessed at all. That is silence,
   * not a warning: we only speak once we have a verdict, and only if that
   * verdict is "tight" or "not_realistic". "ready" and "on_track" are also
   * silent — they are not warnings, they are confirmations.
   */
  feasibilityVerdict: Verdict | null;
  raceCreated: boolean;
  availabilitySeeded: boolean;
  shortHorizon: boolean;
}

export function collectWarnings(input: WarningInput): PreviewWarning[] {
  const out: PreviewWarning[] = [];
  if (input.startingCtlSource === "default") out.push("no_ctl_history");
  if (input.volumeSource === "fallback") out.push("volume_fallback");
  if (input.hasShortfall) out.push("availability_binds");

  // null ("not assessed") is handled before the switch because it is not a
  // `Verdict` member. The switch below is exhaustive over what remains so
  // that a fifth `Verdict` literal is a compile error here, not a silent
  // fall-through — the exact "goes quiet about a number" failure this
  // module exists to close. See `_exhaustive` in the `default` arm.
  if (input.feasibilityVerdict !== null) {
    switch (input.feasibilityVerdict) {
      case "ready":
      case "on_track":
        // Both are deliberately silent: confirmations, not warnings.
        break;
      case "tight":
        out.push("feasibility_tight");
        break;
      case "not_realistic":
        out.push("feasibility_not_realistic");
        break;
      default: {
        const _exhaustive: never = input.feasibilityVerdict;
        throw new Error(`Unhandled feasibility verdict: ${_exhaustive}`);
      }
    }
  }

  if (input.raceCreated) out.push("race_created");
  if (input.availabilitySeeded) out.push("availability_seeded");
  if (input.shortHorizon) out.push("short_horizon");
  return out;
}

/** One sentence per warning, naming the input at fault. */
export const WARNING_TEXT: Record<PreviewWarning, string> = {
  no_ctl_history:
    "No fitness history found, so this plan starts from an assumed CTL of 30 rather than a measured one.",
  volume_fallback:
    "Weekly hours come from the figure you typed, not from your race and training history — one of those was missing.",
  availability_binds:
    "Your standard week offers less time than this plan wants; the weekly target is capped by what you have available.",
  feasibility_tight:
    "There is little margin between now and race day for the volume this event asks for.",
  feasibility_not_realistic:
    "On your current volume there is not enough time before race day to prepare for this event.",
  race_created:
    "Confirming this plan will also create the race on your calendar.",
  availability_seeded:
    "You have no standard week yet; confirming will create one from the hours above.",
  short_horizon:
    "There are fewer than four weeks until race day, so this is a shortened plan rather than a full progression.",
};
