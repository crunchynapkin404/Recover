"use client";

import { useState } from "react";

export type AvailabilityWeekMode = "this" | "next";

interface Props {
  /**
   * Next Monday's date (YYYY-MM-DD), computed server-side with the repo's
   * `addDaysYmd` off `week.weekStart`. Never derive this from the client's
   * own clock — its timezone is not the server's, and this repo has already
   * shipped one bug from that exact mistake.
   */
  nextWeekStart: string;
  /**
   * Starting state. Defaults to "this week". `?availability=next` on a
   * fresh page load should be threaded in as `"next"` so the next-week
   * preview (a later piece of work) can link straight into this state
   * without duplicating the control.
   */
  initialMode?: AvailabilityWeekMode;
  /**
   * Render prop rather than a plain child: the wrapped form is the one that
   * owns the `<form>` element, so it is the one that must place the hidden
   * `weekStart` input as its own descendant for the browser to submit it.
   * This also keeps the switcher itself free of the form's own dependencies.
   */
  children: (weekStart: string) => React.ReactNode;
}

const OPTIONS: { mode: AvailabilityWeekMode; label: string }[] = [
  { mode: "this", label: "This week" },
  { mode: "next", label: "Next week" },
];

/**
 * `This week | Next week` control for the availability form (next-week
 * preview). Local component state, not a navigation: switching modes
 * re-renders the wrapped form with a new `weekStart` prop but never
 * re-mounts it, so any half-entered day edits inside it ride along
 * untouched — the same guarantee a save-on-switch or a "discard changes?"
 * warning would give, without needing either.
 *
 * The `weekStart` value handed to the wrapped form matches
 * `submitAvailability`'s presence-based branch exactly: empty string for
 * "this week" (the current open week — replans exactly as before), the
 * next Monday's date for "next week" (a future week — overrides are
 * written and nothing is replanned).
 */
export function AvailabilityWeekSwitcher({
  nextWeekStart,
  initialMode = "this",
  children,
}: Props) {
  const [mode, setMode] = useState<AvailabilityWeekMode>(initialMode);
  const weekStart = mode === "next" ? nextWeekStart : "";

  return (
    <div>
      <div
        role="group"
        aria-label="Availability week"
        className="mb-3 flex justify-center gap-1.5"
      >
        {OPTIONS.map((opt) => (
          <button
            key={opt.mode}
            type="button"
            onClick={() => setMode(opt.mode)}
            aria-pressed={mode === opt.mode}
            className={`rounded-full px-4 py-1.5 text-[11px] font-bold transition-colors ${
              mode === opt.mode
                ? "bg-white/[0.12] text-white"
                : "bg-white/[0.04] text-white/50 hover:text-white/80"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {children(weekStart)}
    </div>
  );
}
