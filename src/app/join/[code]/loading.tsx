import { Skeleton } from "@/components/ui/skeleton";
import { LoadingScreen } from "@/components/ui/loading-screen";

/**
 * Pre-auth, so this does NOT use AppShell — `page.tsx` renders a centred glass
 * card on the mesh gradient and this must match that shell, not the app one.
 *
 * It names its surface, unlike `src/app/loading.tsx`: that one is the root
 * segment's boundary and stands in for every route, so naming one there
 * announces the wrong surface. This boundary covers exactly this route.
 */
export default function Loading() {
  return (
    <main className="mesh-gradient flex min-h-svh items-center justify-center p-6">
      <div className="glass w-full max-w-sm rounded-[2rem] p-8">
        <LoadingScreen label="your invite">
          <Skeleton className="mb-1 h-7 w-40" />
          <Skeleton className="mb-6 h-10 w-full" />
          <Skeleton className="mb-3 h-10 rounded-xl" />
          <Skeleton className="mb-3 h-10 rounded-xl" />
          <Skeleton className="h-11 rounded-xl" />
        </LoadingScreen>
      </div>
    </main>
  );
}
