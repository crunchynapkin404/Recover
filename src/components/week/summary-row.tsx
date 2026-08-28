import Link from "next/link";
import { ChevronRight } from "lucide-react";

/**
 * The row that replaces a `Collapsible` trigger once what it used to expand
 * in place becomes a destination instead — same label, same optional count,
 * but a chevron that points to another screen rather than one that rotates
 * open beneath it.
 *
 * A plain link, nothing else: the content `href` names lives in the sheet
 * it points to, never duplicated here. See summary-row.test.tsx's "renders
 * none of the destination's content" — the whole point of this slice is
 * that a drawer keeps its contents in the DOM, costed by assistive
 * technology and counted by the choice-load measurement, whether or not it
 * is visibly open. A row that secretly rendered its panel would fail that
 * exactly as a `Collapsible` already open by default would.
 */
export function SummaryRow({
  label,
  badge,
  href,
}: {
  label: string;
  /** A short count or summary, e.g. "4 changes". Omitted entirely — not
   *  rendered as an empty span — when there is nothing to count. */
  badge?: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="glass flex w-full items-center justify-between gap-3 rounded-2xl p-5 text-left"
    >
      <span className="text-label font-bold uppercase tracking-[0.15em] text-ink-secondary">
        {label}
      </span>
      <span className="flex items-center gap-2">
        {badge && <span className="text-label text-ink-muted">{badge}</span>}
        <ChevronRight aria-hidden className="size-4 text-ink-muted" />
      </span>
    </Link>
  );
}
