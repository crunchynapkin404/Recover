import { Skeleton } from "@/components/ui/skeleton";
import { AppShell } from "@/components/app-shell";

export default function Loading() {
  return (
    <AppShell>
      <div className="mb-6 pt-8">
        <Skeleton className="mb-4 h-3 w-24" /> {/* back link */}
        <Skeleton className="mb-1 h-8 w-56" /> {/* activity name */}
        <Skeleton className="h-3 w-40" /> {/* sport · date */}
      </div>

      <div className="space-y-4 pb-12">
        <Skeleton className="h-24 rounded-[2rem]" /> {/* stats grid */}
        <Skeleton className="h-28 rounded-[2rem]" /> {/* debrief */}
        <Skeleton className="h-32 rounded-[2rem]" /> {/* stream chart */}
        <Skeleton className="h-32 rounded-[2rem]" /> {/* stream chart */}
        <Skeleton className="h-40 rounded-[2rem]" /> {/* laps table */}
      </div>
    </AppShell>
  );
}
