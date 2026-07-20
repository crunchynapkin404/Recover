import { Skeleton } from "@/components/ui/skeleton";
import { AppShell } from "@/components/app-shell";

export default function Loading() {
  return (
    <AppShell noChrome>
      <div className="px-6 pt-8">
        <Skeleton className="mx-auto mb-6 h-10 w-32 rounded-full" />
        <Skeleton className="mb-4 h-10 w-full rounded-full" />
        <div className="space-y-6">
          <Skeleton className="h-20 w-4/5 rounded-2xl" />
          <Skeleton className="ml-auto h-16 w-3/5 rounded-2xl" />
          <Skeleton className="h-24 w-4/5 rounded-2xl" />
        </div>
      </div>
    </AppShell>
  );
}
