import Link from "next/link";
import { Info } from "lucide-react";

const EMPTY_LABELS = new Set(["info", "information", "more", "details", "?"]);

/**
 * The `ⓘ`. A LINK to where an explanation lives, never a tooltip or popover —
 * a drawer keeps its contents on the page, which removes no screens and
 * inverts the principle this whole strand serves (see the spec's "The
 * principle this serves").
 *
 * lucide `Info` rather than the `ⓘ` character: this repo's axe reporting files
 * single-character text as `incomplete` for contrast — the same treatment the
 * `▲`/`▼` trend arrows get — so a glyph would add indeterminate nodes for
 * nothing. The icon is `aria-hidden` and the name is carried in text.
 */
export function DisclosureLink({
  href,
  /** What this discloses — "How to fuel this session", never "Info". */
  label,
}: {
  href: string;
  label: string;
}) {
  if (EMPTY_LABELS.has(label.trim().toLowerCase())) {
    throw new Error(
      `DisclosureLink label ${JSON.stringify(label)} names what it is, not ` +
        "what it discloses. A good label says what it discloses " +
        '("How to fuel this session"), not what it is ("Info") — three ' +
        "identical 'Info' links in one card teach a screen-reader user " +
        "nothing. Name the destination instead."
    );
  }
  return (
    <Link
      href={href}
      data-slot="disclosure-link"
      className="inline-flex shrink-0 items-center rounded-full p-1 text-ink-muted transition-colors hover:text-ink-primary focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <Info aria-hidden className="size-4" />
      <span className="sr-only">{label}</span>
    </Link>
  );
}
