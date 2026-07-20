import { Skeleton } from "@/components/ui/skeleton";
import { AppShell } from "@/components/app-shell";

export default function Loading() {
  return (
    <AppShell>
      <Skeleton className="mb-8 mt-8 h-10 w-40" />
      <div className="space-y-6">
        <Skeleton className="h-28 rounded-[2rem]" />
        <Skeleton className="h-16 rounded-[2rem]" />
        <Skeleton className="h-16 rounded-[2rem]" />
        <Skeleton className="h-16 rounded-[2rem]" />
        <Skeleton className="h-16 rounded-[2rem]" />
        <Skeleton className="h-16 rounded-[2rem]" />
      </div>
    </AppShell>
  );
}
