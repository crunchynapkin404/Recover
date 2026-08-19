"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS, isNavActive } from "@/lib/nav-items";
import { avatarInitial } from "@/components/app-shell";

/**
 * Desktop sidebar nav (v0.12) — the same routes as BottomNav, shown only at
 * lg+. On small screens the floating bottom tab bar stays; the two never
 * appear together (BottomNav is lg:hidden).
 */
export function SidebarNav({
  user,
}: {
  /** Pinned bottom row (3a); omitted when the shell has no session to show. */
  user?: { name: string | null; email: string; role: string } | null;
}) {
  const pathname = usePathname();
  const initial = avatarInitial(user ?? null);

  return (
    <nav className="fixed left-0 top-0 z-40 hidden h-svh w-[216px] flex-col border-r border-hairline bg-surface-base px-4 py-8 backdrop-blur-xl lg:flex">
      <span className="mb-8 px-3 text-title font-extrabold tracking-[-0.04em] text-ink-primary">
        Recover
      </span>
      <div className="flex flex-col gap-1">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = isNavActive(href, pathname);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-3 rounded-[14px] px-3 py-2.5 text-caption font-medium transition-colors ${
                active
                  ? "bg-surface-overlay text-ink-primary"
                  : "bg-surface-raised text-ink-muted hover:text-ink-secondary"
              }`}
            >
              <Icon className="size-5" strokeWidth={1.5} />
              {label}
            </Link>
          );
        })}
      </div>

      {user && (
        <Link
          href="/settings"
          className="mt-auto flex items-center gap-3 border-t border-hairline px-3 pt-4 transition-colors hover:text-ink-primary"
        >
          <span className="glass flex size-8 shrink-0 items-center justify-center rounded-full text-label font-bold text-ink-primary">
            {initial || "?"}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-caption font-bold text-ink-secondary">
              {user.name ?? "Athlete"}
            </span>
            <span className="block truncate text-label text-ink-muted">
              {user.role}
            </span>
          </span>
        </Link>
      )}
    </nav>
  );
}
