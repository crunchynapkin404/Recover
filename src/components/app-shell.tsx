import { BottomNav } from "@/components/bottom-nav";
import { SidebarNav } from "@/components/sidebar-nav";

export interface ShellUser {
  name: string | null;
  email: string;
  role: string;
}

interface Props {
  children: React.ReactNode;
  /** When true, page manages its own header — shell adds nothing. */
  noChrome?: boolean;
  /**
   * Fills the sidebar's pinned user row (3a). Passed by the pages that have
   * already resolved a session, rather than read from headers() here —
   * reading request headers in the shell opts every route into dynamic
   * rendering, including /login, which has no business being dynamic.
   */
  user?: ShellUser | null;
}

export function AppShell({ children, noChrome = false, user }: Props) {
  return (
    <div className="mesh-gradient relative min-h-svh pb-32 pt-[env(safe-area-inset-top)] lg:pb-0">
      {/* Depth layers */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute left-[-10%] top-[-10%] h-1/2 w-[60%] rounded-full bg-emerald-500/5 blur-[120px]" />
        <div className="absolute bottom-[10%] right-[-10%] h-[40%] w-[50%] rounded-full bg-blue-500/5 blur-[120px]" />
      </div>

      {/* Desktop sidebar (lg+); small screens use the bottom tab bar below. */}
      <SidebarNav user={user ?? null} />

      <div className="relative z-10 lg:pl-[216px]">
        {noChrome ? (
          children
        ) : (
          <main className="mx-auto w-full max-w-lg px-6 lg:max-w-3xl">
            {children}
          </main>
        )}
      </div>

      <BottomNav />
    </div>
  );
}

/**
 * Narrows a Better Auth user to what the sidebar row needs. Call sites
 * already hold the session, so this costs no extra query.
 */
export function shellUser(u: {
  name?: string | null;
  email: string;
  role?: string | null;
}): ShellUser {
  return { name: u.name ?? null, email: u.email, role: u.role ?? "member" };
}
