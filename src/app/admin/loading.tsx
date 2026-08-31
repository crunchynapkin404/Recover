import { Skeleton } from "@/components/ui/skeleton";
import { LoadingScreen } from "@/components/ui/loading-screen";
import { AppShell } from "@/components/app-shell";

export default function Loading() {
  return (
    <AppShell>
      <LoadingScreen label="Admin">
        <Skeleton className="mt-8 mb-6 h-8 w-32" />
        <Skeleton className="mb-4 h-32 rounded-[2rem]" />
        <Skeleton className="mb-4 h-48 rounded-[2rem]" />
        <Skeleton className="h-48 rounded-[2rem]" />
      </LoadingScreen>
    </AppShell>
  );
}
