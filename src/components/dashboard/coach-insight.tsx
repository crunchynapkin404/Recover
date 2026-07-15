"use client";

import Link from "next/link";
import { useState } from "react";
import { Sparkles, X } from "lucide-react";

interface Props {
  text: string;
  warning: string | null;
  threadId: string;
}

/** Today's proactive coach insight (v0.4b). Dismiss is local-only — the
 * card returns tomorrow with fresh content. Amber accent on warnings. */
export function CoachInsight({ text, warning, threadId }: Props) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <section
      className={`glass relative rounded-[2rem] p-5 ${
        warning ? "border border-amber-500/40" : ""
      }`}
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles
            aria-hidden
            className={`size-4 ${warning ? "text-amber-400" : "text-emerald-400"}`}
          />
          <span className="text-[10px] font-bold uppercase tracking-widest text-white/50">
            {warning ? "Coach — heads up" : "Coach"}
          </span>
        </div>
        <button
          onClick={() => setDismissed(true)}
          aria-label="Dismiss insight"
          className="text-white/40 transition-colors hover:text-white/70"
        >
          <X className="size-4" />
        </button>
      </div>
      <p className="text-sm leading-relaxed text-white/85">{text}</p>
      <Link
        href={`/coach?thread=${threadId}`}
        className="mt-3 inline-block text-[10px] font-bold uppercase tracking-widest text-emerald-400"
      >
        Open in coach →
      </Link>
    </section>
  );
}
