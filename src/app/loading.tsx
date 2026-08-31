import { Skeleton } from "@/components/ui/skeleton";
import { LoadingScreen } from "@/components/ui/loading-screen";
import { AppShell } from "@/components/app-shell";

export default function Loading() {
  return (
    <AppShell noChrome>
      {/* No label: this is the ROOT segment boundary, so it stands in for
          every route whose own boundary has not resolved yet. Naming a
          surface here announces the wrong one on /train, /admin and the
          rest. */}
      <LoadingScreen>
        <div className="mx-auto max-w-lg px-6 pt-8 lg:max-w-5xl lg:pb-16">
          <Skeleton className="mb-8 h-10 w-48" />
          <div className="mb-8 flex flex-col items-center gap-6">
            <Skeleton className="size-48 rounded-full" />
            <div className="grid w-full grid-cols-3 gap-3">
              <Skeleton className="h-20 rounded-2xl" />
              <Skeleton className="h-20 rounded-2xl" />
              <Skeleton className="h-20 rounded-2xl" />
            </div>
          </div>
          <Skeleton className="mb-10 h-24 rounded-[2rem]" />
          <Skeleton className="mb-10 h-32 rounded-[2rem]" />
          <Skeleton className="mb-10 h-16 rounded-2xl" />
          <Skeleton className="mb-10 h-16 rounded-2xl" />
        </div>
      </LoadingScreen>
    </AppShell>
  );
}
