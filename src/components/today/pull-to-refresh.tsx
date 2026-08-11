"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";

const THRESHOLD_PX = 70;

/**
 * Custom pull-to-refresh, active only in the installed app (standalone
 * display mode) at scroll-top. globals.css sets overscroll-behavior-y:
 * contain in standalone mode so the browser's native pull-to-reload never
 * competes with this gesture.
 */
export function PullToRefresh({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const startY = useRef<number | null>(null);
  const enabled = useRef(false);

  useEffect(() => {
    enabled.current = window.matchMedia("(display-mode: standalone)").matches;
  }, []);

  async function refresh() {
    setBusy(true);
    try {
      await fetch("/api/sync/now", { method: "POST" });
      router.refresh();
    } catch {
      // Network failure — the indicator just retracts.
    } finally {
      setBusy(false);
      setPull(0);
    }
  }

  return (
    <div
      onTouchStart={(e) => {
        if (enabled.current && window.scrollY === 0)
          startY.current = e.touches[0].clientY;
      }}
      onTouchMove={(e) => {
        if (startY.current == null || busy) return;
        const delta = e.touches[0].clientY - startY.current;
        setPull(Math.max(0, Math.min(delta, THRESHOLD_PX * 1.5)));
      }}
      onTouchEnd={() => {
        if (pull >= THRESHOLD_PX && !busy) void refresh();
        else setPull(0);
        startY.current = null;
      }}
    >
      <div
        aria-hidden
        className="flex justify-center overflow-hidden transition-[height]"
        style={{ height: busy ? 40 : pull * 0.6 }}
      >
        <RefreshCw
          className={`mt-2 size-5 text-emerald-400 ${busy ? "animate-spin" : ""}`}
          style={{ opacity: busy ? 1 : Math.min(1, pull / THRESHOLD_PX) }}
        />
      </div>
      {children}
    </div>
  );
}
