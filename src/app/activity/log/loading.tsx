import { Skeleton } from "@/components/ui/skeleton";
import { AppShell } from "@/components/app-shell";

export default function Loading() {
  return (
    <AppShell>
      <div className="space-y-6 pt-8">
        <div className="mb-6">
          <Skeleton className="mb-1 h-8 w-40" /> {/* "Log Activity" title */}
          <Skeleton className="h-3 w-56" /> {/* subtitle */}
        </div>

        <div className="space-y-3">
          <Skeleton className="h-24 rounded-[2rem]" /> {/* sport selector */}
          <Skeleton className="h-72 rounded-[2rem]" /> {/* details form */}
          <Skeleton className="h-12 rounded-2xl" /> {/* submit button */}
        </div>
      </div>
    </AppShell>
  );
}
