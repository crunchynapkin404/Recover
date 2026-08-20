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

import type { Verdict, Feasibility } from "@/lib/race/feasibility";
import type { VolumeResult } from "@/lib/week-plan/volume";
import type { PlanSport } from "@/lib/plan-sport";
import type { StartStateSource } from "@/lib/week-plan/start-state";

export type PlanPhase = "base" | "build" | "peak" | "taper" | "recovery";

export interface PhaseRow {
  /**
   * 1 = the plan's only arc, or (on a two-A-race plan) arc one plus the
   * recovery that bridges to the rebuild. 2 = the rebuild arc after that
   * recovery. Grouping by `(segment, phase)` rather than `phase` alone is
   * what keeps a two-arc plan from rendering as one merged phase list —
   * see this file's header comment and `buildPhases` below.
   */
  segment: 1 | 2;
  phase: PlanPhase;
  /** Equals weekNumbers.length. Carried explicitly because it is what renders. */
  weeks: number;
  weekNumbers: number[];
}

/**
 * Display order WITHIN a segment. Recovery sits last there: on a single-arc
 * plan it is a modifier tacked onto the end, not a stage of its own. On a
 * two-A-race plan the bridging recovery IS segment 1's own last stage
 * (`periodize`: arc one -> recovery -> arc two) — this order still puts it
 * last within segment 1, which is where it chronologically belongs.
 *
 * **Segment 2 usually has a recovery row too, and that is not the bridge.**
 * The rebuild arc runs `arc()`'s ordinary step-loading cadence, so a
 * long enough rebuild emits its own recovery weeks (a 26-week plan with the
 * first race in week 12 puts them at weeks 18 and 21). An earlier version of
 * this comment claimed segment 2's ABSENCE of a recovery row was meaningful;
 * it is not, because the row is normally present. Do not read a segment-2
 * recovery row as a second bridge — `plan-preview.test.ts` pins this.
 */
const PHASE_ORDER: PlanPhase[] = ["base", "build", "peak", "taper", "recovery"];

/**
 * Groups by `(segment, phase)`, not `phase` alone, and emits segment 1's
 * rows (in `PHASE_ORDER`) before segment 2's. Grouping by phase across the
 * whole plan is exactly the failure this module's header comment warns
 * about: a two-A-race plan would render one merged "base 10, build 6, peak
 * 3, taper 3, recovery 2" list with no way for the athlete to see there
 * were two arcs. A single-race plan has every week at `segment: 1`, so this
 * produces exactly the rows the old phase-only grouping did, plus that one
 * added field.
 */
export function buildPhases(
  weeks: { weekNumber: number; phase: PlanPhase; segment: 1 | 2 }[]
): PhaseRow[] {
  const byKey = new Map<string, number[]>();
  for (const w of weeks) {
    const key = `${w.segment}:${w.phase}`;
    const list = byKey.get(key) ?? [];
    list.push(w.weekNumber);
    byKey.set(key, list);
  }

  const rows: PhaseRow[] = [];
  for (const segment of [1, 2] as const) {
    for (const phase of PHASE_ORDER) {
      const key = `${segment}:${phase}`;
      if (!byKey.has(key)) continue;
      const weekNumbers = [...(byKey.get(key) ?? [])].sort((a, b) => a - b);
      rows.push({ segment, phase, weeks: weekNumbers.length, weekNumbers });
    }
  }
  return rows;
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
  | "short_horizon"
  | "no_bridge_room";

export interface WarningInput {
  startingCtlSource: StartStateSource;
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
  /**
   * True when the two A-races are close enough that the gap between them
   * clears neither the first race's recovery days nor the second's own
   * taper window — see `hasBridgeRoom` in training-plan.ts. Always false on
   * a single-race plan.
   */
  noBridgeRoom: boolean;
}

export function collectWarnings(input: WarningInput): PreviewWarning[] {
  const out: PreviewWarning[] = [];
  if (input.startingCtlSource === "global_fallback") {
    out.push("no_ctl_history");
  }
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
  if (input.noBridgeRoom) out.push("no_bridge_room");
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
  no_bridge_room:
    "Your two A-races are close enough together that every week between them is either recovery or taper — there is no room to rebuild. The plan still covers both.",
};

// ── v0.43: the preview itself ──────────────────────────────────────────────

export interface PreviewWeek {
  weekNumber: number;
  phase: PlanPhase;
  targetLoad: number;
  targetHours: number;
  raceName: string | null;
}

export interface PlanPreview {
  /** The draft row. Confirming this id is what activates the plan. */
  planId: string;
  sport: PlanSport;
  race: {
    /** null = confirming will create it. */
    id: string | null;
    name: string;
    date: string;
    priority: "A" | "B" | "C";
  };
  startDate: string;
  weeksTotal: number;
  /** The constraints this specific draft was built from — Rebuild's inputs
   *  must start from what actually produced the shown plan, not a hardcoded
   *  guess (Finding 3, v0.43 final review). */
  daysPerWeek: number;
  hoursPerWeek: number;
  phases: PhaseRow[];
  weeks: PreviewWeek[];
  /**
   * Provenance for the start-state fitness anchor used to build the plan.
   * Global fallback means no measured or computed pair was available.
   */
  startingCtl: { value: number; source: StartStateSource };
  feasibility: Feasibility | null;
  volume: {
    source: VolumeResult["source"];
    shortfall: VolumeResult["shortfall"];
  };
  warnings: PreviewWarning[];
}

export type PreviewResult =
  | { ok: true; preview: PlanPreview }
  | {
      ok: false;
      reason:
        | "unknown_sport"
        | "race_not_found"
        | "horizon_too_long"
        | "too_many_races"
        | "second_race_not_a";
    };

/** One sentence per refusal, naming the input at fault and its fix. */
export const REFUSAL_TEXT: Record<
  Extract<PreviewResult, { ok: false }>["reason"],
  string
> = {
  unknown_sport:
    "That race type does not name a sport, so there is nothing to build. Pick a race from your calendar, or use a race type this app plans for.",
  race_not_found: "That race is not on your calendar any more.",
  horizon_too_long:
    "Race day is more than 52 weeks away — check the date, or plan a nearer event first.",
  too_many_races:
    "This plan targets at most two A-races. Pick the two that matter and make the others B or C.",
  second_race_not_a:
    "Both target races must be A-priority and still upcoming. Change the second race's priority, or pick a different one.",
};
