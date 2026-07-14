import { BottomNav } from "@/components/bottom-nav";

interface Props {
  children: React.ReactNode;
  /** When true, page manages its own header — shell adds nothing. */
  noChrome?: boolean;
}

export function AppShell({ children, noChrome = false }: Props) {
  return (
    <div className="mesh-gradient relative min-h-svh pb-32 pt-[env(safe-area-inset-top)]">
      {/* Depth layers */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute left-[-10%] top-[-10%] h-1/2 w-[60%] rounded-full bg-emerald-500/5 blur-[120px]" />
        <div className="absolute bottom-[10%] right-[-10%] h-[40%] w-[50%] rounded-full bg-blue-500/5 blur-[120px]" />
      </div>

      <div className="relative z-10">
        {noChrome ? (
          children
        ) : (
          <main className="mx-auto w-full max-w-lg px-6">{children}</main>
        )}
      </div>

      <BottomNav />
    </div>
  );
}
