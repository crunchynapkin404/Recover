import type { ScheduledWorkout } from "@/lib/week-plan/types";
import { fuellingFromSession } from "@/lib/fuelling/from-session";

function range(r: { min: number; max: number }, unit: string): string {
  return `${r.min}-${r.max} ${unit}`;
}

function confidenceTone(confidence: "high" | "medium" | "low"): string {
  if (confidence === "high") return "text-emerald-300 border-emerald-400/30";
  if (confidence === "medium")
    return "text-amber-300 border-amber-400/30";
  return "text-white/65 border-white/20";
}

export function FuellingCard({
  date,
  workouts,
  bodyMassKg,
}: {
  date: string;
  workouts: ScheduledWorkout[];
  bodyMassKg: number | null;
}) {
  if (workouts.length === 0) return null;

  return (
    <section className="mb-5 overflow-hidden rounded-[18px] border border-white/[0.08] bg-white/[0.03] p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-[12px] font-bold uppercase tracking-[0.12em] text-white/70">
          Session fuelling
        </h2>
        <span className="text-[10px] text-white/40">{date}</span>
      </div>

      <div className="space-y-3">
        {workouts.map((w, idx) => {
          const guidance = fuellingFromSession(w, bodyMassKg);
          return (
            <article
              key={`${w.type}-${idx}`}
              className="rounded-[14px] border border-white/[0.08] bg-white/[0.02] p-3"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="truncate text-[12.5px] font-semibold text-white">
                  {w.type} · {w.durationMins} min
                </p>
                <span
                  className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${confidenceTone(
                    guidance.confidence
                  )}`}
                >
                  {guidance.confidence}
                </span>
              </div>

              <div className="space-y-1.5 text-[11px] text-white/75">
                <p>
                  <span className="font-semibold text-white/85">Before:</span>{" "}
                  {range(guidance.before.carbsG, "g carbs")} · {guidance.before.note}
                </p>
                <p>
                  <span className="font-semibold text-white/85">During:</span>{" "}
                  {range(guidance.during.carbsPerHourG, "g carbs/h")} and{" "}
                  {range(guidance.during.fluidMlPerHour, "ml fluid/h")}
                </p>
                <p>
                  <span className="font-semibold text-white/85">After:</span>{" "}
                  {range(guidance.after.carbsG, "g carbs")} and{" "}
                  {range(guidance.after.proteinG, "g protein")} · {guidance.after.note}
                </p>
              </div>

              {guidance.assumptions.length > 0 && (
                <p className="mt-2 text-[10px] text-white/45">
                  Assumptions: {guidance.assumptions.join("; ")}
                </p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
