"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Clock,
  CalendarRange,
  Sparkles,
  Activity,
  Settings2,
} from "lucide-react";

// Option B IA (v0.21): one home per job — Today / Train / Coach / Body / Menu.
const NAV_ITEMS = [
  { href: "/", label: "Today", icon: Clock },
  { href: "/train", label: "Train", icon: CalendarRange },
  { href: "/coach", label: "Coach", icon: Sparkles },
  { href: "/body", label: "Body", icon: Activity },
  { href: "/settings", label: "Menu", icon: Settings2 },
] as const;

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="glass-no-hover fixed bottom-8 left-1/2 z-50 flex w-[calc(100%-48px)] max-w-sm -translate-x-1/2 items-center justify-between rounded-[2.5rem] border border-hairline bg-surface-base px-4 py-3 shadow-2xl backdrop-blur-2xl lg:hidden">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active =
          href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`relative flex flex-col items-center gap-1 px-2 transition-all active:scale-90 ${
              active
                ? "text-ink-primary"
                : "text-ink-muted hover:text-ink-primary"
            }`}
          >
            <Icon className="size-6" strokeWidth={1.5} />
            {/* No uppercase/tracking here: the 12px floor (text-label) made
                that combination overflow the nav at 320-375pt (review C3).
                The design reference (v0.99-train.html:1020-1023) specifies
                this size with neither transform applied. */}
            <span className="text-label font-bold">{label}</span>
            {active && <span className="nav-active-dot" />}
          </Link>
        );
      })}
    </nav>
  );
}
