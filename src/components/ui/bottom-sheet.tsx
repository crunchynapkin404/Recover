"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Elements a focus trap should stop at, in DOM order. Deliberately plain —
 * anchors with a real `href`, non-disabled form controls, and anything
 * carrying an explicit non-negative `tabindex` — the same set every
 * standard "roving focus trap" reference implementation targets. Excludes
 * `[tabindex="-1"]` on purpose: that's how the panel itself (below) is
 * reachable programmatically without joining the trap's own cycle.
 */
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

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
  // I3, final whole-branch review: whatever had focus right before this
  // sheet mounted — restored to it on close/unmount, rather than left
  // wherever focus happened to end up (often nowhere, once the trigger
  // itself has scrolled off or gone `inert`).
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    reduceMotion.current =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  // I3: moves focus into the panel the instant it mounts, and hands it
  // back on unmount. The panel itself — not a specific child — is the one
  // target every sheet's content shares regardless of what it renders
  // (`tabIndex={-1}` on the panel below is what makes a plain `<div>` a
  // valid programmatic focus target without joining the natural tab
  // order). A `[role="dialog"]` claiming `aria-modal="true"` while never
  // moving focus into itself is the same kind of inert claim `app-shell.tsx`'s
  // own I3 fix addresses for the background: the attribute promised
  // something the DOM never delivered.
  useEffect(() => {
    triggerRef.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    // The background leaves the tab order and the accessibility tree for as
    // long as this sheet is mounted. Done HERE, by the modal itself, rather
    // than by AppShell from its `overlay` prop: truthiness cannot know
    // whether a modal is visible, and inferring it shipped two page-killing
    // bugs — an always-truthy `<SheetHost/>` on Today, and Coach's
    // `lg:hidden` history panel, which is present in the DOM on desktop and
    // renders nothing. A mounted BottomSheet is the one unambiguous signal
    // that a modal is actually on screen.
    const background = document.querySelector("[data-app-background]");
    background?.setAttribute("inert", "");

    return () => {
      background?.removeAttribute("inert");
      triggerRef.current?.focus?.();
    };
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
      if (e.key === "Escape") {
        // Review finding 1 (slice 2 task 2): a dialog nested inside this
        // sheet's own content — BlockSheet, opened from StandardWeek in
        // the plan-setup sheet, and IntakeForm's copy of the same pattern
        // once task 4 lands — has no Escape handler of its own and
        // stages its edits locally, writing them only from its own
        // onClose. This listener is document-level and stays live the
        // whole time a nested dialog is open, so without this guard
        // Escape would close THIS sheet, unmounting the nested dialog's
        // host before it ever calls its own close-and-save path — a
        // silent discard, invisible to a pointer/click test since a real
        // tap can never reach this sheet's own backdrop while a
        // full-viewport nested dialog covers it (only a keyboard event
        // bypasses that hit-testing). Fixed at this shell, not inside
        // StandardWeek: every consumer that nests a `role="dialog"` in
        // here — present or future — inherits the guard for free, rather
        // than each one needing its own Escape handling.
        if (panelRef.current?.querySelector('[role="dialog"]')) return;
        close();
        return;
      }

      if (e.key !== "Tab") return;
      // I3, final whole-branch review: a manual focus trap. `inert` on
      // the background (app-shell.tsx's own I3 fix) already removes the
      // rest of the document from the tab order in a real browser, but
      // Tab off the panel's own last (or first) focusable element still
      // needs somewhere to go — and jsdom (this file's own test
      // environment) implements neither `inert`'s focus-blocking nor
      // native Tab traversal at all, so this is the part that has to be
      // explicit regardless of `inert`.
      const panel = panelRef.current;
      if (!panel) return;
      // Same guard as the Escape branch above, and the same reason: a
      // nested `[role="dialog"]` (BlockSheet) covers this panel's own
      // content, and this trap's plain DOM-order query can't tell "the
      // nested dialog's own controls" apart from "this panel's" — both
      // match FOCUSABLE_SELECTOR. Redirecting Tab within a mix of the
      // two would fight whatever the nested dialog wants focus to do
      // instead of deferring to it, so this trap stands down while one
      // is mounted, exactly as Escape does.
      if (panel.querySelector('[role="dialog"]')) return;
      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      );
      if (focusables.length === 0) {
        // Nothing to cycle to — hold focus on the panel itself rather
        // than letting Tab walk out into a background that (in a real
        // browser) is `inert` and cannot receive it anyway.
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || active === panel) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || active === panel) {
        e.preventDefault();
        first.focus();
      }
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
        // A plain <div> cannot receive focus at all without this, so the
        // open-effect's panelRef.current.focus() would be a no-op and the
        // trap below would have nothing to trap. -1 keeps it out of the
        // sequential tab order while still allowing programmatic focus.
        tabIndex={-1}
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
          // Root-cause fix for review finding 3 on the "plan-review" sheet
          // (a card ~1.5 phone screens tall, task 5): a drag begins ONLY
          // once the panel is already scrolled to its own top. Without
          // this, any downward `touchmove` on the panel set `dragY`
          // regardless of `scrollTop`, so scrolling back UP through a
          // tall sheet body — the everyday gesture needed to re-read
          // something further up the page, not a dismiss attempt — fought
          // native scroll for the same gesture and, past 110px, dismissed
          // the sheet outright. Fixed here rather than in any one sheet's
          // content: every consumer of this shell — present or future —
          // inherits it for free, the same reasoning that put the Escape
          // guard above at this shell instead of in StandardWeek.
          if ((panelRef.current?.scrollTop ?? 0) > 0) {
            // Re-baselined on every still-scrolling move, not left at the
            // gesture's original touch point, so the drag itself starts
            // from `dragY = 0` the instant the panel reaches its top —
            // not a jump to whatever `dy` had already accumulated against
            // a touch point the athlete has since scrolled well past.
            startY.current = e.touches[0].clientY;
            if (dragY !== 0) setDragY(0);
            return;
          }
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
