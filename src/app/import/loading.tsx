import { Skeleton } from "@/components/ui/skeleton";
import { AppShell } from "@/components/app-shell";

export default function Loading() {
  return (
    <AppShell>
      <div className="space-y-6 pt-8">
        <div className="mb-6">
          <Skeleton className="mb-1 h-8 w-36" /> {/* "Import Data" title */}
          <Skeleton className="h-3 w-64" /> {/* subtitle */}
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-8 w-20 rounded-full" /> {/* Wellness tab */}
          <Skeleton className="h-8 w-20 rounded-full" /> {/* Activities tab */}
        </div>
        <Skeleton className="h-64 rounded-[2rem]" />{" "}
        {/* drop zone + hint + button */}
        <Skeleton className="h-16 rounded-[2rem]" /> {/* empty/result state */}
      </div>
    </AppShell>
  );
}
