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
  // "Settings", not "Menu". The label used to be "Menu" and /settings' own
  // <h1> read "Menu" to agree with it — the page renamed itself to match the
  // tab rather than the tab being named for its destination. "Menu" promises
  // a hub of destinations; what is behind it is a settings page, and every
  // other item here names the job it opens. Same slot, same icon, same route:
  // only the promise changed.
  { href: "/settings", label: "Settings", icon: Settings2 },
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
