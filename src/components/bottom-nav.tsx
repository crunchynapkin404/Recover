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
  { href: "/settings", label: "Menu", icon: Settings2 },
] as const;

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="glass-no-hover fixed bottom-8 left-1/2 z-50 flex w-[calc(100%-48px)] max-w-sm -translate-x-1/2 items-center justify-between rounded-[2.5rem] border border-white/10 bg-neutral-950 px-4 py-3 shadow-2xl backdrop-blur-2xl lg:hidden">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active =
          href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={`relative flex flex-col items-center gap-1 px-2 transition-all active:scale-90 ${
              active ? "text-white" : "text-white/50 hover:text-white"
            }`}
          >
            <Icon className="size-6" strokeWidth={1.5} />
            <span className="text-[8px] font-bold uppercase tracking-widest">
              {label}
            </span>
            {active && <span className="nav-active-dot" />}
          </Link>
        );
      })}
    </nav>
  );
}
