import {
  Clock,
  CalendarRange,
  Sparkles,
  Activity,
  Settings2,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

/**
 * Option B IA (v0.21): one home per job — Today / Train / Coach / Body / Menu.
 *
 * One list for both renderers. BottomNav (mobile) and SidebarNav (lg+) show
 * the same five routes and never appear together, and each used to carry its
 * own copy — sidebar-nav's even said "mirrors BottomNav" in a comment, which
 * is a duplication with a note attached rather than a shared list.
 *
 * The two renderers still differ in layout and styling, which is why this
 * module owns the DATA and not a component.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", label: "Today", icon: Clock },
  { href: "/train", label: "Train", icon: CalendarRange },
  { href: "/coach", label: "Coach", icon: Sparkles },
  { href: "/body", label: "Body", icon: Activity },
  { href: "/settings", label: "Menu", icon: Settings2 },
] as const;

/**
 * Whether `href` is the active route for `pathname`.
 *
 * "/" matches only itself — every path starts with it, so the prefix rule
 * would light Today up on every screen.
 */
export function isNavActive(href: string, pathname: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}
