"use client";

import { useState } from "react";

/**
 * The Today debrief chip (2a). A compact emerald chip that reveals the existing
 * DebriefForm inline. The final design opens bottom-sheet 1i (step 6); this
 * disclosure is the honest interim that reuses the real form and its
 * submitDebrief / skipDebrief actions unchanged.
 */
export function DebriefDisclosure({
  name,
  children,
}: {
  name: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className="mb-6">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between rounded-[14px] border border-emerald-500/30 bg-emerald-500/[0.06] px-3.5 py-2.5 text-left transition-colors hover:bg-emerald-500/[0.1]"
      >
        <span className="text-[11.5px] text-white/85">
          How was <strong className="font-bold text-white">{name}</strong>?
        </span>
        <span className="text-[10.5px] font-bold text-emerald-400">
          {open ? "Close" : "Debrief · 30s →"}
        </span>
      </button>
      {open && <div className="mt-3">{children}</div>}
    </section>
  );
}
