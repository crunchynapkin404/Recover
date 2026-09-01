"use client";

import { useActionState } from "react";
import {
  exportWorkoutAction,
  type ExportActionResult,
} from "@/app/train/workout-actions";

/**
 * Send this session's structured workout to intervals.icu.
 *
 * A form, not a link: this one WRITES — it creates a calendar event that syncs
 * to the athlete's head unit, and it pins what it sent. The `.zwo` download
 * beside it is a plain link precisely because it does neither.
 *
 * `stale` means the session has changed since it was exported: a different
 * length, or a different purpose after a readiness step-down. Recover keeps
 * showing the workout it sent rather than silently swapping it, and says so —
 * the alternative is the athlete finding out mid-ride that Recover and the
 * device disagree.
 */
export function ExportWorkout({
  date,
  index,
  stale,
  exportedAt,
}: {
  date: string;
  index: number;
  stale: boolean;
  exportedAt?: string;
}) {
  const [state, action, pending] = useActionState<
    ExportActionResult | null,
    FormData
  >(exportWorkoutAction, null);

  return (
    <form action={action} className="mt-1">
      <input type="hidden" name="date" value={date} />
      <input type="hidden" name="i" value={index} />
      {stale && (
        <p data-workout-stale className="text-label font-bold text-chart-3">
          This no longer fits today&rsquo;s session — re-send to update it.
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="text-label font-bold text-ink-secondary underline decoration-hairline underline-offset-2 disabled:opacity-60"
      >
        {pending
          ? "Sending…"
          : exportedAt && !stale
            ? "Re-send to intervals.icu"
            : stale
              ? "Re-send to intervals.icu"
              : "Send to intervals.icu"}
      </button>
      {state && (
        <p
          role="status"
          className={`mt-0.5 text-label ${state.ok ? "text-chart-2" : "text-chart-3"}`}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
