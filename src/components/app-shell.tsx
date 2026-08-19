import { BottomNav } from "@/components/bottom-nav";
import { GradientDepth } from "@/components/gradient-depth";
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
  /**
   * Full-screen overlays — the bottom sheets. Rendered as a sibling of the
   * content wrapper rather than inside it: that wrapper is `relative z-10`,
   * which opens a stacking context, so anything mounted within it can never
   * rise above the sidebar's own z-40 no matter what z-index it asks for.
   */
  overlay?: React.ReactNode;
}

export function AppShell({ children, noChrome = false, user, overlay }: Props) {
  return (
    <div className="mesh-gradient relative min-h-svh pb-32 pt-[env(safe-area-inset-top)] lg:pb-0">
      <GradientDepth />

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

      {overlay}
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

/**
 * The avatar's letter: first character of the display name, or of the email
 * when the account has no usable name. "?" when it has neither.
 *
 * One derivation, because there were three identical ones — Today's header,
 * Settings' header and SidebarNav's pinned row — and at lg+ two of them
 * render the same letter in the same viewport.
 */
export function avatarInitial(
  u: {
    name?: string | null;
    email?: string | null;
  } | null
): string {
  return (u?.name ?? u?.email ?? "").trim().charAt(0).toUpperCase() || "?";
}
