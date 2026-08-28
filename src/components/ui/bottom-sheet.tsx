"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * The redesign's bottom sheet (1h / 1i shell).
 *
 * Open state is the URL (`?sheet=checkin`), not React state, so a push
 * notification can deep-link straight into an open sheet and the back
 * button closes it. Dismissing navigates back to the same page without the
 * sheet params.
 *
 * Motion is inline rather than in globals.css because the swipe needs to
 * drive the same transform; `prefers-reduced-motion` is honoured explicitly
 * here for the same reason.
 */
export function BottomSheet({
  title,
  subtitle,
  /** Where dismissal lands — the page's own URL without the sheet params. */
  closeHref,
  children,
}: {
  title: string;
  subtitle?: string;
  closeHref: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [dragY, setDragY] = useState(0);
  const [closing, setClosing] = useState(false);
  const startY = useRef<number | null>(null);
  const reduceMotion = useRef(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    reduceMotion.current =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  const close = useCallback(() => {
    if (closing) return;
    setClosing(true);
    // Let the exit transition play before the navigation swaps the tree.
    const delay = reduceMotion.current ? 0 : 220;
    window.setTimeout(() => router.push(closeHref), delay);
  }, [closeHref, closing, router]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      // Review finding 1 (slice 2 task 2): a dialog nested inside this
      // sheet's own content — BlockSheet, opened from StandardWeek in the
      // plan-setup sheet, and IntakeForm's copy of the same pattern once
      // task 4 lands — has no Escape handler of its own and stages its
      // edits locally, writing them only from its own onClose. This
      // listener is document-level and stays live the whole time a nested
      // dialog is open, so without this guard Escape would close THIS
      // sheet, unmounting the nested dialog's host before it ever calls
      // its own close-and-save path — a silent discard, invisible to a
      // pointer/click test since a real tap can never reach this sheet's
      // own backdrop while a full-viewport nested dialog covers it (only a
      // keyboard event bypasses that hit-testing). Fixed at this shell,
      // not inside StandardWeek: every consumer that nests a `role="dialog"`
      // in here — present or future — inherits the guard for free, rather
      // than each one needing its own Escape handling.
      if (panelRef.current?.querySelector('[role="dialog"]')) return;
      close();
    }
    document.addEventListener("keydown", onKey);
    // The page behind must not scroll while a sheet is over it.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [close]);

  const translate = closing ? "100%" : `${dragY}px`;

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center">
      <button
        type="button"
        aria-label="Close"
        onClick={close}
        // The scrim darkens whatever is behind the sheet, so it is dark in
        // BOTH themes — a light-mode scrim that went white would dim nothing.
        // Tokenised as --scrim in v0.111.0 (value unchanged) so it stops being
        // a raw alpha nothing governs; it is waived by name in
        // tests/contrast-guard.test.ts, since no text is measured against it.
        className="absolute inset-0 bg-scrim backdrop-blur-sm transition-opacity duration-300 motion-reduce:transition-none"
        style={{ opacity: closing ? 0 : 1 }}
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="sheet-panel relative w-full max-w-lg rounded-t-[28px] border border-hairline bg-surface-overlay px-6 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] pt-3"
        style={{
          boxShadow: "0 -20px 60px rgba(0,0,0,0.6)",
          // Omitted entirely while idle — not merely set to `translateY(0px)`.
          // Per the CSS transforms spec, ANY transform value on this panel,
          // including a zero one, makes it the containing block for a
          // `position: fixed` descendant. Slice 2 task 2 nests exactly that:
          // the plan-setup sheet hosts StandardWeek, which opens BlockSheet
          // (its own `fixed inset-0` dialog) on a day tap — with a transform
          // sitting here, that dialog collapses to this panel's own box
          // instead of covering the viewport, instead of opening as a full
          // sheet over it. Idle is the only state a tap can land in: a drag
          // fires from touchmove, not a click, and by the time anyone can
          // aim at a row the mount entrance animation (`.sheet-panel`'s own
          // `sheet-up` keyframes, ~300ms) is long over.
          transform:
            dragY > 0 || closing ? `translateY(${translate})` : undefined,
          transition: dragY > 0 ? "none" : undefined,
          maxHeight: "92svh",
          overflowY: "auto",
        }}
        onTouchStart={(e) => {
          startY.current = e.touches[0].clientY;
        }}
        onTouchMove={(e) => {
          if (startY.current == null) return;
          const dy = e.touches[0].clientY - startY.current;
          if (dy > 0) setDragY(dy);
        }}
        onTouchEnd={() => {
          // A short tug springs back; a real pull dismisses.
          if (dragY > 110) close();
          else setDragY(0);
          startY.current = null;
        }}
      >
        <div
          aria-hidden
          className="mx-auto mb-4 h-1 w-10 rounded-full bg-hairline"
        />

        <div className="mb-4 flex items-baseline justify-between gap-3">
          <h2 className="text-body font-bold tracking-[-0.02em]">{title}</h2>
          {subtitle && (
            <span className="shrink-0 text-label text-ink-muted">
              {subtitle}
            </span>
          )}
        </div>

        {children}
      </div>
    </div>
  );
}
