"use client";

import { useState, useTransition } from "react";
import { markSessionDone } from "@/app/plan/actions";
import { friendlyPlanError } from "@/components/week/day-actions";

/**
 * "Mark done" on Today's session (2a). Records the athlete's own word that
 * the session happened — status only. It writes no load and no activity, so
 * the week's adherence keeps measuring what actually synced; if the ride
 * lands later, the real numbers attach to the day that's already complete.
 */
export function MarkDoneButton({ date }: { date: string }) {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (done) {
    return (
      <span className="rounded-full border border-hairline bg-surface-overlay px-3.5 py-1.5 text-label font-bold text-chart-2">
        ✓ Done
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await markSessionDone(date);
            if (result.ok) setDone(true);
            else setError(friendlyPlanError(result.error));
          });
        }}
        className="rounded-full bg-accent px-3.5 py-1.5 text-label font-bold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        Mark done
      </button>
      {error && <span className="text-label text-chart-5">{error}</span>}
    </>
  );
}
