import { BottomSheet } from "@/components/ui/bottom-sheet";

/**
 * The shell every Week destination sheet renders through. `BottomSheet`
 * (src/components/ui/bottom-sheet.tsx) already owns Escape, body-scroll
 * lock, swipe-to-dismiss and `prefers-reduced-motion` — this adds nothing
 * to that beyond a name of its own, so a `?sheet=` destination in
 * train/page.tsx has one thing to import and wrap its content in, matching
 * `CheckinSheet`/`DebriefSheet`'s use of the same shell on Today.
 */
export function WeekSheet({
  title,
  /** Where dismissal lands — the Week tab's own URL without `?sheet=`. */
  closeHref,
  children,
}: {
  title: string;
  closeHref: string;
  children: React.ReactNode;
}) {
  return (
    <BottomSheet title={title} closeHref={closeHref}>
      {children}
    </BottomSheet>
  );
}
