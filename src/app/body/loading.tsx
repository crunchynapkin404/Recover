import { Skeleton } from "@/components/ui/skeleton";
import { LoadingScreen } from "@/components/ui/loading-screen";
import { AppShell } from "@/components/app-shell";

export default function Loading() {
  return (
    <AppShell>
      <LoadingScreen label="Body">
        <Skeleton className="mt-8 mb-4 h-8 w-24" />
        <Skeleton className="mb-5 h-10 rounded-full" />
        <Skeleton className="mb-4 h-40 rounded-[2rem]" />
        <Skeleton className="mb-4 h-24 rounded-[2rem]" />
        <Skeleton className="mb-4 h-24 rounded-[2rem]" />
        <Skeleton className="h-24 rounded-[2rem]" />
      </LoadingScreen>
    </AppShell>
  );
}
