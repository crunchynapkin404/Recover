import { Skeleton } from "@/components/ui/skeleton";
import { LoadingScreen } from "@/components/ui/loading-screen";
import { AppShell } from "@/components/app-shell";

export default function Loading() {
  return (
    <AppShell>
      <LoadingScreen label="Train">
        <Skeleton className="mt-8 mb-4 h-8 w-28" />
        <Skeleton className="mb-5 h-10 rounded-full" />
        <Skeleton className="mb-4 h-28 rounded-[2rem]" />
        <Skeleton className="mb-4 h-20 rounded-[2rem]" />
        {/* The day strip: seven columns, the shape Week has carried since
            v0.123.0's composition slice. */}
        <div className="mb-4 grid grid-cols-7 gap-1.5">
          {Array.from({ length: 7 }, (_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-32 rounded-[2rem]" />
      </LoadingScreen>
    </AppShell>
  );
}
