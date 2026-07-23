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
      if (e.key === "Escape") close();
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
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <button
        type="button"
        aria-label="Close"
        onClick={close}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300 motion-reduce:transition-none"
        style={{ opacity: closing ? 0 : 1 }}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="sheet-panel relative w-full max-w-lg rounded-t-[28px] border border-white/[0.12] bg-[#111113] px-6 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] pt-3"
        style={{
          boxShadow: "0 -20px 60px rgba(0,0,0,0.6)",
          transform: `translateY(${translate})`,
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
          className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20"
        />

        <div className="mb-4 flex items-baseline justify-between gap-3">
          <h2 className="text-[16px] font-bold tracking-[-0.02em]">{title}</h2>
          {subtitle && (
            <span className="shrink-0 text-[11px] text-white/45">
              {subtitle}
            </span>
          )}
        </div>

        {children}
      </div>
    </div>
  );
}
