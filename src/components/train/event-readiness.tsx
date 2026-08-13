/**
 * Is this event reachable from here?
 *
 * The question anyone entering a hard event actually has, and the one
 * nothing in the app answers today. `feasibilityFor` already did the
 * arithmetic and named which input is missing when it can't; this just
 * renders whichever one comes back.
 */
import type { Feasibility } from "@/lib/race/feasibility";
import type { PlanSport } from "@/lib/plan-sport";
import type { Figure } from "@/lib/uncertainty";
import { unavailableMessage } from "@/components/ui/unavailable";
import {
  DEMAND_UNAVAILABLE_COPY,
  type EventDemandResult,
} from "@/lib/race/demand";

interface Props {
  raceName: string;
  sport: PlanSport;
  /** States its own reason (via feasibilityFor) when there is no verdict —
   *  no tracked demand, no race date, or no measured training history. */
  feasibility: Figure<Feasibility>;
  demand: EventDemandResult;
}

const VERDICT_COPY: Record<Feasibility["verdict"], string> = {
  ready: "You are ready for this.",
  on_track: "On track — the plan gets you there.",
  tight: "Tight. One missed week and it slips.",
  not_realistic: "Not realistic from here.",
};

const VERDICT_TONE: Record<Feasibility["verdict"], string> = {
  ready: "text-chart-2",
  on_track: "text-chart-2",
  tight: "text-chart-3",
  not_realistic: "text-chart-5",
};

/** What the athlete calls their longest session, for this sport. */
const LONGEST_NOUN: Record<PlanSport, string> = {
  Bike: "longest ride",
  Run: "longest run",
  Triathlon: "longest bike leg",
};

/** The verb for taking on this sport's event — used in "You can still ___ it." */
const EVENT_VERB: Record<PlanSport, string> = {
  Bike: "ride",
  Run: "run",
  Triathlon: "race",
};

function fmt(hours: number): string {
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
}

function weeks(n: number): string {
  return n === 1 ? "1 week" : `${n} weeks`;
}

export function EventReadiness({
  raceName,
  sport,
  feasibility,
  demand,
}: Props) {
  if (!demand.available) {
    return (
      <div className="glass mt-4 rounded-[1.5rem] p-5">
        <p className="label-micro mb-1">{raceName}</p>
        <p className="mb-2 text-caption font-bold text-chart-3">
          No demand figure yet.
        </p>
        <p className="text-label leading-relaxed text-ink-secondary">
          {DEMAND_UNAVAILABLE_COPY[demand.reason]}
        </p>
      </div>
    );
  }
  if (!feasibility.available) {
    return (
      <div className="glass mt-4 rounded-[1.5rem] p-5">
        <p className="label-micro mb-1">{raceName}</p>
        <p className="mb-2 text-caption font-bold text-chart-3">
          No verdict yet.
        </p>
        <p className="text-label leading-relaxed text-ink-secondary">
          {unavailableMessage(feasibility)}
        </p>
      </div>
    );
  }

  const { verdict, weeksUntilEvent, requiredLongestSessionHours } =
    feasibility.value;
  const weeksNeeded = Math.max(
    feasibility.value.volumeWeeksNeeded,
    feasibility.value.longestSessionWeeksNeeded
  );

  return (
    <div className="glass mt-4 rounded-[1.5rem] p-5">
      <p className="label-micro mb-1">{raceName}</p>
      <p className={`mb-2 text-caption font-bold ${VERDICT_TONE[verdict]}`}>
        {VERDICT_COPY[verdict]}
      </p>
      <p className="text-label leading-relaxed text-ink-secondary">
        {`Asks about ${fmt(demand.weeklyHours)} a week, and a ${LONGEST_NOUN[sport]} of about ${fmt(requiredLongestSessionHours)}. ${weeks(weeksUntilEvent)} to go.`}
      </p>
      {verdict === "not_realistic" && (
        <p className="mt-2 text-label leading-relaxed text-ink-secondary">
          {Number.isFinite(weeksNeeded)
            ? `Closing the gap needs ${weeks(weeksNeeded)} of steady building, and there are ${weeks(weeksUntilEvent)}. You can still ${EVENT_VERB[sport]} it — go in knowing what it asks.`
            : `There is no recent training here to build from, so there is no honest estimate of how long closing the gap would take. You can still ${EVENT_VERB[sport]} it — go in knowing what it asks.`}
        </p>
      )}
      {feasibility.value.fromAverageDay && (
        <p className="mt-2 text-label text-ink-muted">
          Reasoning from an average day — add per-day distance and climbing to
          this event for a sharper longest-ride target.
        </p>
      )}
      <p className="mt-2 text-label text-ink-muted">
        {demand.confidenceReason}
      </p>
    </div>
  );
}
