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
 * showing the workout it sent rather than silently swapping it. The MESSAGE
 * saying so lives in the row above, not here, so this form can sit inline
 * beside the download link — `display: contents` puts the button straight into
 * that flex row while the status line still claims a full row of its own.
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
    <form action={action} className="contents">
      <input type="hidden" name="date" value={date} />
      <input type="hidden" name="i" value={index} />
      <button
        type="submit"
        disabled={pending}
        className="text-label font-bold text-accent underline underline-offset-2 disabled:opacity-60"
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
          className={`w-full text-label ${state.ok ? "text-chart-2" : "text-chart-3"}`}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
