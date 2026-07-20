import { Skeleton } from "@/components/ui/skeleton";
import { AppShell } from "@/components/app-shell";

export default function Loading() {
  return (
    <AppShell>
      <Skeleton className="mb-8 mt-8 h-20 rounded-3xl" />
      <Skeleton className="mb-8 h-10 w-full rounded-full" />
      <div className="space-y-3">
        <Skeleton className="h-32 rounded-3xl" />
        <Skeleton className="h-16 rounded-2xl" />
        <Skeleton className="h-16 rounded-2xl" />
      </div>
    </AppShell>
  );
}
