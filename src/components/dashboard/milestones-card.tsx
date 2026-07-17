import { Medal } from "lucide-react";
import type { Milestones } from "@/lib/insights/milestones";

/** Sober milestones: real numbers or a muted em-dash — never a prompt. */
export function MilestonesCard({
  currentStreak,
  bestStreak,
  planWeeksCompleted,
  plansCompleted,
}: Milestones) {
  const rows: { label: string; value: string | null; detail: string | null }[] =
    [
      {
        label: "Logging streak",
        value:
          currentStreak > 0
            ? `${currentStreak} ${currentStreak === 1 ? "day" : "days"}`
            : null,
        detail: bestStreak > 0 ? `best ${bestStreak}` : null,
      },
      {
        label: "Plan weeks completed (≥70%)",
        value: planWeeksCompleted > 0 ? String(planWeeksCompleted) : null,
        detail: null,
      },
      {
        label: "Plans completed",
        value: plansCompleted > 0 ? String(plansCompleted) : null,
        detail: null,
      },
    ];

  return (
    <div className="glass rounded-[2rem] p-6">
      <div className="mb-4 flex items-center gap-2">
        <Medal className="size-4 text-emerald-400" />
        <h3 className="label-micro">Milestones</h3>
      </div>
      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline justify-between">
            <span className="text-xs text-white/70">{r.label}</span>
            <span className="text-xs font-bold">
              {r.value ?? <span className="font-normal text-white/30">—</span>}
              {r.detail != null && (
                <span className="ml-1.5 font-normal text-white/40">
                  · {r.detail}
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
