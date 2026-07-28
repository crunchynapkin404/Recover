/**
 * Is this event reachable from here?
 *
 * The question anyone entering a hard event actually has, and the one
 * nothing in the app answers today. `assessFeasibility` (Task 7) already
 * did the arithmetic; this just says it plainly.
 */
import type { Feasibility } from "@/lib/race/feasibility";
import type { EventDemand } from "@/lib/race/demand";

interface Props {
  raceName: string;
  feasibility: Feasibility;
  demand: EventDemand;
}

const VERDICT_COPY: Record<Feasibility["verdict"], string> = {
  ready: "You are ready for this.",
  on_track: "On track — the plan gets you there.",
  tight: "Tight. One missed week and it slips.",
  not_realistic: "Not realistic from here.",
};

const VERDICT_TONE: Record<Feasibility["verdict"], string> = {
  ready: "text-emerald-400",
  on_track: "text-emerald-400/80",
  tight: "text-amber-300",
  not_realistic: "text-red-400",
};

function fmt(hours: number): string {
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
}

function weeks(n: number): string {
  return n === 1 ? "1 week" : `${n} weeks`;
}

export function EventReadiness({ raceName, feasibility, demand }: Props) {
  const { verdict, weeksUntilEvent, requiredLongestRideHours } = feasibility;
  const weeksNeeded = Math.max(
    feasibility.volumeWeeksNeeded,
    feasibility.longestRideWeeksNeeded
  );

  return (
    <div className="glass mt-4 rounded-[1.5rem] p-5">
      <p className="label-micro mb-1">{raceName}</p>
      <p className={`mb-2 text-[13px] font-bold ${VERDICT_TONE[verdict]}`}>
        {VERDICT_COPY[verdict]}
      </p>
      <p className="text-[11.5px] leading-relaxed text-white/60">
        {`Asks about ${fmt(demand.weeklyHours)} a week, and a longest ride of about ${fmt(requiredLongestRideHours)}. ${weeks(weeksUntilEvent)} to go.`}
      </p>
      {verdict === "not_realistic" && (
        <p className="mt-2 text-[11.5px] leading-relaxed text-white/60">
          {Number.isFinite(weeksNeeded)
            ? `Closing the gap needs ${weeks(weeksNeeded)} of steady building, and there are ${weeks(weeksUntilEvent)}. You can still ride it — go in knowing what it asks.`
            : `There is no recent training here to build from, so there is no honest estimate of how long closing the gap would take. You can still ride it — go in knowing what it asks.`}
        </p>
      )}
      {feasibility.fromAverageDay && (
        <p className="mt-2 text-[11px] text-white/40">
          Reasoning from an average day — add per-day distance and climbing to
          this event for a sharper longest-ride target.
        </p>
      )}
    </div>
  );
}
