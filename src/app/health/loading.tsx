import { Skeleton } from "@/components/ui/skeleton";
import { AppShell } from "@/components/app-shell";

export default function Loading() {
  return (
    <AppShell>
      <div className="mb-8 pt-8">
        <Skeleton className="mb-1 h-8 w-32" /> {/* "Health" title */}
        <Skeleton className="h-3 w-64" /> {/* subtitle */}
      </div>

      <div className="space-y-6 lg:grid lg:grid-cols-2 lg:items-start lg:gap-6 lg:space-y-0">
        <Skeleton className="h-44 rounded-[2rem]" /> {/* bio age card */}
        <Skeleton className="h-32 rounded-[2rem]" /> {/* blood pressure card */}
        <Skeleton className="h-36 rounded-[2rem]" /> {/* health upload */}
        <Skeleton className="h-40 rounded-[2rem]" /> {/* manual entry */}
        <Skeleton className="h-56 rounded-[2rem] lg:col-span-2" /> {/* biomarker list */}
      </div>
    </AppShell>
  );
}
