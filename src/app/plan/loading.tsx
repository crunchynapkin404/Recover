import { Skeleton } from "@/components/ui/skeleton";
import { AppShell } from "@/components/app-shell";

export default function Loading() {
  return (
    <AppShell>
      <div className="pt-8">
        <Skeleton className="mb-1 h-8 w-48" /> {/* plan title */}
        <Skeleton className="mb-8 h-3 w-64" /> {/* race/week subtitle */}

        <Skeleton className="mb-4 h-3 w-16" /> {/* "Races" label */}
        <Skeleton className="mb-4 h-16 rounded-2xl" /> {/* races list */}
        <Skeleton className="mb-10 h-11 rounded-2xl" /> {/* "+ Add race" bar */}

        <Skeleton className="mb-6 h-20 rounded-[2rem]" /> {/* week strip */}

        <div className="mb-10 space-y-3">
          <Skeleton className="h-20 rounded-2xl" />
          <Skeleton className="h-20 rounded-2xl" />
          <Skeleton className="h-20 rounded-2xl" />
          <Skeleton className="h-20 rounded-2xl" />
          <Skeleton className="h-20 rounded-2xl" />
          <Skeleton className="h-20 rounded-2xl" />
          <Skeleton className="h-20 rounded-2xl" />
        </div>

        <Skeleton className="mb-3 h-3 w-32" /> {/* "Remaining skeleton" label */}
        <Skeleton className="h-40 rounded-[2rem]" /> {/* skeleton table */}
      </div>
    </AppShell>
  );
}
