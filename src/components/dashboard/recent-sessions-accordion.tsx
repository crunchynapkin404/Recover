import Link from "next/link";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsiblePanel,
} from "@/components/ui/collapsible";
import { EmptyState } from "@/components/ui/empty-state";
import { History } from "lucide-react";
import { WeeklySummary } from "@/components/dashboard/weekly-summary";
import { MilestonesCard } from "@/components/dashboard/milestones-card";
import { formatDay, formatDuration, formatKm } from "@/lib/format";
import type { Milestones } from "@/lib/insights/milestones";

interface RecentActivity {
  id: string;
  name: string | null;
  sport: string | null;
  startDate: Date;
  durationS: number | null;
  distanceM: number | null;
  load: number | null;
}

interface Props {
  weeklySummary: {
    workouts: number;
    totalVolume: string;
    avgLoad: string;
    streak: number;
    ringOuter: number | null;
    ringInner: number | null;
  };
  milestones: Milestones;
  recentActivities: RecentActivity[];
}

export function RecentSessionsAccordion({
  weeklySummary,
  milestones,
  recentActivities,
}: Props) {
  return (
    <Collapsible>
      <CollapsibleTrigger
        badge={
          <span className="rounded-full bg-white/5 px-2 py-0.5 text-[9px] font-bold text-white/40">
            {recentActivities.length} sessions
          </span>
        }
      >
        <History aria-hidden className="size-[18px] text-white/40" />
        <span className="text-xs font-bold uppercase tracking-widest text-white/80">
          Recent Sessions
        </span>
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="space-y-6 p-5 pt-4">
          <WeeklySummary {...weeklySummary} />
          <MilestonesCard {...milestones} />
          {recentActivities.length === 0 ? (
            <EmptyState icon={History} message="No activities synced yet." />
          ) : (
            <div className="divide-y divide-white/5">
              {recentActivities.slice(0, 5).map((a) => (
                <Link
                  href={`/activity/${a.id}`}
                  key={a.id}
                  className="flex items-baseline justify-between gap-4 py-3 transition-colors hover:bg-white/5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold">
                      {a.name ?? a.sport}
                    </p>
                    <p className="text-[10px] text-white/40">
                      {a.sport} · {formatDay(a.startDate)}
                    </p>
                  </div>
                  <p className="shrink-0 text-xs tabular-nums text-white/40">
                    {formatDuration(a.durationS)}
                    {a.distanceM != null && <> · {formatKm(a.distanceM)}</>}
                    {a.load != null && <> · {Math.round(a.load)}</>}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
}
