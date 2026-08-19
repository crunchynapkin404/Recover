"use client";

import { useActionState, useState, useTransition } from "react";
import { blockMins, type AvailabilityBlock } from "@/lib/availability/types";
import { formatAvailability, formatBlocks } from "@/lib/availability/format";
import type { Verdict } from "@/lib/week-plan/ctl-projection";
import { clearDayOverride } from "@/app/plan/actions";
import { BlockSheet } from "./block-sheet";
import { WEEKDAY_NAMES, WEEKDAY_SHORT } from "@/lib/weekdays";

export interface IntakeState {
  message: string;
}

interface Props {
  /** Resolved blocks per day, Monday first. */
  resolved: AvailabilityBlock[][];
  /** The dates of this week, Monday first. */
  dates: string[];
  /** Which of those dates are pinned by an override. */
  overrideDates: string[];
  verdict: Verdict;
  sports: string[];
  action: (prev: IntakeState, formData: FormData) => Promise<IntakeState>;
  /**
   * Which week this submission targets — the week switcher's hidden field.
   * Empty (the default) means the current open week, matching
   * `submitAvailability`'s presence-based branch: absent/empty replans the
   * open week exactly as before, a real Monday targets a future week and
   * only writes overrides.
   */
  weekStart?: string;
  /**
   * The label above the day list. Defaults to the current-week copy so
   * every pre-existing caller (and `intake-form.test.tsx`, which never
   * passes this prop) keeps behaving exactly as before. The availability
   * week switcher passes "Next week's availability" for its next-week
   * instance — the heading must follow which week is actually being
   * edited, not always claim "this week" regardless of `weekStart`.
   */
  heading?: string;
}

function verdictLine(v: Verdict, weekLabel: string): string | null {
  if (v.kind === "losing") {
    return `That's under the ${formatAvailability(Math.round(v.maintenanceHrs * 60))} it takes to hold your fitness — CTL is projected to fall to about ${Math.round(v.projectedCtl)} ${weekLabel}.`;
  }
  if (v.kind === "holding") {
    return `Enough to hold your fitness, not to build it — ${weekLabel}'s plan asks for about ${formatAvailability(Math.round(v.targetHrs * 60))}.`;
  }
  return null;
}

/**
 * This week's availability (task 15): resolved blocks per day (standard week
 * + any date override, already merged by resolveWeek), a "Pinned" badge on
 * any day whose date carries an override, and an honest verdict line when
 * the time offered cannot hold — let alone build — fitness.
 *
 * Unpinning a day only ever deletes its override row (clearDayOverride) —
 * that is the one and only way back to the standard week for that date.
 * Editing this form and resubmitting never clears a pin: submitAvailability
 * writes per-day blocks, which is exactly what an override already is, so a
 * day left untouched here keeps whatever was last saved for it.
 */
export function IntakeForm({
  resolved,
  dates,
  overrideDates,
  verdict,
  sports,
  action,
  weekStart = "",
  heading = "This week's availability",
}: Props) {
  const [state, formAction, pending] = useActionState(action, { message: "" });
  const [week, setWeek] = useState(resolved);
  const [openDay, setOpenDay] = useState<number | null>(null);
  const [, startTransition] = useTransition();

  // The server owns what is actually stored. Unpinning a day deletes its
  // override and revalidates, so `resolved` comes back as the standard week —
  // without this resync the client keeps the deleted override's blocks, the
  // hidden inputs below resubmit them, and syncDateOverrides re-creates the
  // override that was just removed. Compared by value: every server render
  // hands down fresh array identities, so identity would resync constantly
  // and discard the athlete's in-progress edits.
  const serverWeek = JSON.stringify(resolved);
  const [syncedWeek, setSyncedWeek] = useState(serverWeek);
  if (syncedWeek !== serverWeek) {
    setSyncedWeek(serverWeek);
    setWeek(resolved);
  }

  const totalMins = week.reduce(
    (s, day) => s + day.reduce((d, b) => d + blockMins(b), 0),
    0
  );
  // `weekStart` is the same presence-based signal `submitAvailability` and
  // the week switcher already key off of: empty means this instance is
  // editing the current open week, a real Monday means it's editing a
  // future one. `heading` follows it (see the prop doc above) — these
  // derived strings must follow the exact same mode, not just the heading's
  // own text, so they never contradict it the way "this week" did while
  // `heading` already said "Next week's availability".
  const weekLabel = weekStart ? "next week" : "this week";
  const warning = verdictLine(verdict, weekLabel);

  function unpin(i: number) {
    startTransition(async () => {
      await clearDayOverride(dates[i]);
    });
  }

  return (
    <form action={formAction} className="glass rounded-[2rem] p-7">
      <input type="hidden" name="weekStart" value={weekStart} />
      <p className="label-micro mb-1">{heading}</p>
      <p className="mb-5 text-label text-ink-muted">
        When you can train — the week plans itself around these blocks.
      </p>

      <ul className="mb-3">
        {week.map((blocks, i) => {
          const pinned = overrideDates.includes(dates[i] ?? "");
          return (
            <li
              key={WEEKDAY_SHORT[i]}
              className="border-b border-hairline last:border-0"
            >
              <div className="flex items-center gap-3 py-2.5">
                <button
                  type="button"
                  onClick={() => setOpenDay(i)}
                  className="flex flex-1 items-center justify-between text-left"
                >
                  <span className="text-label font-bold uppercase tracking-wider text-ink-muted">
                    {WEEKDAY_SHORT[i]}
                  </span>
                  <span className="text-label text-ink-secondary">
                    {formatBlocks(blocks)}
                  </span>
                </button>
                {pinned && (
                  <button
                    type="button"
                    onClick={() => unpin(i)}
                    title="Back to your standard week"
                    className="rounded-full border border-hairline bg-surface-overlay px-2 py-0.5 text-label font-bold text-chart-3"
                  >
                    Pinned ×
                  </button>
                )}
              </div>
              <input
                type="hidden"
                name={`blocks-${i}`}
                value={JSON.stringify(blocks)}
              />
            </li>
          );
        })}
      </ul>

      <p className="mb-2 text-center text-label text-ink-muted">
        {`${formatAvailability(totalMins)} ${weekLabel}`}
      </p>
      {warning && (
        <p className="mb-5 text-center text-label leading-relaxed text-chart-3">
          {warning}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-2xl bg-accent py-3 text-caption font-bold text-primary-foreground transition-opacity disabled:opacity-50"
      >
        Confirm week
      </button>
      {state.message !== "" && (
        <p className="mt-3 text-center text-label text-ink-secondary">
          {state.message}
        </p>
      )}

      {openDay !== null && (
        <BlockSheet
          dayLabel={WEEKDAY_NAMES[openDay]}
          blocks={week[openDay]}
          sports={sports}
          onChange={(next) =>
            setWeek((prev) => prev.map((d, j) => (j === openDay ? next : d)))
          }
          onClose={() => setOpenDay(null)}
        />
      )}
    </form>
  );
}
