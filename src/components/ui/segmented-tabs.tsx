import Link from "next/link";

export interface SegmentedItem {
  /** Compared against `active` to find the current segment. */
  key: string | number;
  /** Finished display string — see the note on text nodes below. */
  label: string;
  href: string;
}

/**
 * The app's segmented control: a row of links, one of them current.
 *
 * **Links, not state.** Every segment carries the rest of the filter state in
 * its href, so the browser's back button walks the athlete's actual path and
 * the row needs no client JS. This is why v0.98.0's deleted `ui/tabs.tsx` was
 * not re-vendored to close ROADMAP.md:581 — shadcn's Tabs is a state
 * component, and adopting it would have silently traded that away. Choosing
 * the pattern deliberately, which is what the item asked for, meant building
 * the link-based control the four call sites were already hand-rolling.
 *
 * It replaced four of them — `train/train-tabs`, `body/body-tabs` and both
 * `range-tabs` — which had drifted: `train/range-tabs` still painted its
 * active pill `bg-accent/20 text-accent`, a straight token translation of the
 * `bg-emerald-500/20` it shipped with in 00534a5, while the other three had
 * moved to the surface treatment. That divergence was inherited, never
 * designed. The treatment below is the settled one and now has one definition.
 *
 * `train/view-tabs` is deliberately NOT a caller: it is a month picker with
 * date logic, and only looks like a tab bar from a distance.
 *
 * Two roles, two correct answers for assistive tech:
 * - `navLabel` given — page navigation. A named `<nav>` landmark, and the
 *   current segment is `aria-current="page"`.
 * - `navLabel` omitted — a filter on the page you are already on, where
 *   "page" would be a lie. A plain row, and `aria-current="true"`. No second
 *   unnamed landmark for anyone listing them.
 */
export function SegmentedTabs({
  items,
  active,
  size = "tab",
  navLabel,
  className = "",
}: {
  items: readonly SegmentedItem[];
  active: string | number;
  /** `tab` is a named section; `pill` is the tighter numeric filter. */
  size?: "tab" | "pill";
  navLabel?: string;
  /** Layout — margins, wrapping, alignment. The part that legitimately differs. */
  className?: string;
}) {
  const Row = navLabel ? "nav" : "div";
  // Gap belongs to the size, not to the caller: a caller-supplied `gap-1`
  // would collide with a built-in `gap-1.5` and the winner would be decided by
  // Tailwind's output order rather than by either party's intent.
  const pad = size === "tab" ? "px-4 py-1.5" : "px-2.5 py-1";
  const gap = size === "tab" ? "gap-1.5" : "gap-1";

  return (
    <Row
      {...(navLabel ? { "aria-label": navLabel } : {})}
      className={`flex ${gap} ${className}`}
    >
      {items.map((item) => {
        const current = item.key === active;
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={current ? (navLabel ? "page" : "true") : undefined}
            className={`rounded-full ${pad} text-label font-bold transition-colors ${
              current
                ? "bg-surface-overlay text-ink-primary"
                : "bg-surface-raised text-ink-muted hover:text-ink-secondary"
            }`}
          >
            {/*
              One finished string, never `{n}{"d"}`: React inserts a hydration
              boundary comment between adjacent expression children, which
              renders "30<!-- -->d" and splits the label across two text nodes.
              Callers format the label; this renders it.
            */}
            {item.label}
          </Link>
        );
      })}
    </Row>
  );
}
