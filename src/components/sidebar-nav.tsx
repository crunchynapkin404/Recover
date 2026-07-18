"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutGrid,
  PenLine,
  Sparkles,
  BookOpen,
  CalendarRange,
  Settings2,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/", label: "Home", icon: LayoutGrid },
  { href: "/plan", label: "Plan", icon: CalendarRange },
  { href: "/log", label: "Log", icon: PenLine },
  { href: "/coach", label: "Coach", icon: Sparkles },
  { href: "/journal", label: "Journal", icon: BookOpen },
  { href: "/settings", label: "Settings", icon: Settings2 },
] as const;

/**
 * Desktop sidebar nav (v0.12) — the same routes as BottomNav, shown only at
 * lg+. On small screens the floating bottom tab bar stays; the two never
 * appear together (BottomNav is lg:hidden).
 */
export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed left-0 top-0 z-40 hidden h-svh w-56 flex-col border-r border-white/5 bg-neutral-950/40 px-4 py-8 backdrop-blur-xl lg:flex">
      <span className="mb-8 px-3 text-lg font-bold tracking-tighter text-white/90">
        Recover
      </span>
      <div className="flex flex-col gap-1">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active =
            href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium transition-colors ${
                active
                  ? "bg-white/10 text-white"
                  : "text-white/50 hover:bg-white/5 hover:text-white"
              }`}
            >
              <Icon className="size-5" strokeWidth={1.5} />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
