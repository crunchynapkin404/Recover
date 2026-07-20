import { Skeleton } from "@/components/ui/skeleton";
import { AppShell } from "@/components/app-shell";

export default function Loading() {
  return (
    <AppShell>
      <div className="pt-8">
        <Skeleton className="mb-8 h-10 w-40" />
        <Skeleton className="mb-6 h-16 rounded-3xl" />
        <Skeleton className="mb-4 h-10 w-full rounded-full" />
        <Skeleton className="mb-4 h-40 rounded-3xl" />
        <Skeleton className="mb-8 h-40 rounded-3xl" />
        <Skeleton className="h-24 rounded-[2rem]" />
      </div>
    </AppShell>
  );
}
