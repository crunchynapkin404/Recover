"use client";

import { useState } from "react";
import type { AvailabilityBlock } from "@/lib/availability/types";
import type { Verdict } from "@/lib/week-plan/ctl-projection";
import { IntakeForm, type IntakeState } from "@/components/week/intake-form";

export type AvailabilityWeekMode = "this" | "next";

/**
 * Everything `IntakeForm` needs to edit one week, as plain serializable
 * data — safe to build on the server and pass across the Server -> Client
 * boundary. `weekStart` matches `submitAvailability`'s presence-based
 * branch exactly: `""` for the current open week (replans exactly as
 * before), a real Monday for a future week (writes overrides only, never
 * replans — see `src/app/plan/actions.ts`).
 */
export interface WeekIntake {
  /** Resolved blocks per day, Monday first. */
  resolved: AvailabilityBlock[][];
  /** The dates of this week, Monday first. */
  dates: string[];
  /** Which of those dates are pinned by an override. */
  overrideDates: string[];
  verdict: Verdict;
  weekStart: string;
}

interface Props {
  /** This week's data. Its `weekStart` must be `""`. */
  thisWeek: WeekIntake;
  /**
   * Next week's data — a real projection (Task 3's `projectWeek`), not a
   * copy of this week's. Its `weekStart` must be next Monday's date. The
   * caller (`src/app/train/page.tsx`) only renders this component at all
   * when `projectWeek` succeeded; when it returns `null` (no active plan to
   * project from), the page falls back to a bare `IntakeForm` with no
   * switcher, per the spec's edge-case table.
   */
  nextWeek: WeekIntake;
  /**
   * Starting state. Defaults to "this week". `?availability=next` on a
   * fresh page load is threaded in as `"next"` so the next-week preview can
   * link straight into this state without duplicating the control.
   */
  initialMode?: AvailabilityWeekMode;
  sports: string[];
  /**
   * `submitAvailability`, a `"use server"` Server Action. This is the ONLY
   * function-valued prop this component (or its caller) may pass — Server
   * Actions are specially serialized by Next.js across the RSC boundary;
   * a plain closure is not. See `availability-week-switcher.test.tsx`'s
   * compile-time check for what enforces that nothing else here becomes
   * function-valued by accident.
   */
  action: (prev: IntakeState, formData: FormData) => Promise<IntakeState>;
}

export type { Props as AvailabilityWeekSwitcherProps };

const OPTIONS: { mode: AvailabilityWeekMode; label: string }[] = [
  { mode: "this", label: "This week" },
  { mode: "next", label: "Next week" },
];

/**
 * `This week | Next week` control for the availability form (next-week
 * preview). Renders `IntakeForm` itself — twice, once per week, both
 * always mounted — rather than taking a render-prop `children`. A render
 * prop is a plain closure; the only place this component is used
 * (`src/app/train/page.tsx`) is a Server Component with no `"use client"`,
 * and a closure authored there cannot cross into this `"use client"`
 * module. Everything this component takes instead is plain data, except
 * `action`, which Next.js already knows how to serialize specially.
 *
 * **Why two mounted `IntakeForm`s, toggled with the `hidden` attribute,
 * rather than one instance whose props change:** `IntakeForm` resyncs its
 * own in-progress `week` state whenever its `resolved` prop changes BY
 * VALUE (see its `serverWeek`/`syncedWeek` effect) — that resync exists so
 * a server-confirmed change (e.g. unpinning a day) replaces stale local
 * state. But `thisWeek.resolved` and `nextWeek.resolved` are genuinely
 * different weeks' data, so swapping one `IntakeForm` between them would
 * fire that same resync on every mode toggle and silently discard whatever
 * the athlete had half-entered for the week just switched away from — the
 * exact bug this component exists to not have. Mounting one `IntakeForm`
 * per week sidesteps it entirely: each instance's `resolved` prop is
 * constant across mode toggles (it only ever changes on a genuine server
 * re-render with new data, which is what that resync is actually for), so
 * each instance's local edits simply survive being hidden and shown again.
 * `hidden` (not conditional rendering) is what keeps both instances
 * mounted; the day list beneath a `hidden` element also isn't in the tab
 * order or accessibility tree, so the inactive week doesn't intrude.
 */
export function AvailabilityWeekSwitcher({
  thisWeek,
  nextWeek,
  initialMode = "this",
  sports,
  action,
}: Props) {
  const [mode, setMode] = useState<AvailabilityWeekMode>(initialMode);

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
            className={`rounded-full px-4 py-1.5 text-label font-bold transition-colors ${
              mode === opt.mode
                ? "bg-surface-overlay text-ink-primary"
                : "bg-surface-raised text-ink-muted hover:text-ink-secondary"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div hidden={mode !== "this"}>
        <IntakeForm
          heading="This week's availability"
          resolved={thisWeek.resolved}
          dates={thisWeek.dates}
          overrideDates={thisWeek.overrideDates}
          verdict={thisWeek.verdict}
          sports={sports}
          action={action}
          weekStart={thisWeek.weekStart}
        />
      </div>
      <div hidden={mode !== "next"}>
        <IntakeForm
          heading="Next week's availability"
          resolved={nextWeek.resolved}
          dates={nextWeek.dates}
          overrideDates={nextWeek.overrideDates}
          verdict={nextWeek.verdict}
          sports={sports}
          action={action}
          weekStart={nextWeek.weekStart}
        />
      </div>
    </div>
  );
}
