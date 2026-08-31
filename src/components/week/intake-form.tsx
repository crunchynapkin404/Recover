"use client";

import { useActionState, useState, useTransition } from "react";
import { blockMins, type AvailabilityBlock } from "@/lib/availability/types";
import { formatAvailability } from "@/lib/availability/format";
import type { Verdict } from "@/lib/week-plan/ctl-projection";
import { clearDayOverride } from "@/app/plan/actions";
import { BlockSheet } from "./block-sheet";
import { AvailabilityTimeline } from "./availability-timeline";
import { PinnedAction } from "./pinned-action";
import { WEEKDAY_NAMES } from "@/lib/weekdays";

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
 *
 * LIGHT-MODE SURFACE COLLISION, a fifth time. This now renders only inside
 * the "availability" sheet (slice 2 task 4), whose own panel is
 * bg-surface-overlay. The root used to carry `.glass` (`--glass-bg` resolves
 * to `--surface-raised`, which equals `--surface-overlay` in light — both
 * #ffffff) — the same bug task 1 fixed for WeekRationale/EventReadiness,
 * task 2 for StandardWeek, task 3 for RacesSection. Fixed with the same
 * `border-hairline bg-surface-selected` precedent.
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
  // The flag was discarded here until slice 6, which is why unpinning showed
  // no feedback at all: the old `Pinned ×` badge only ever went disabled.
  const [unpinning, startTransition] = useTransition();

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
    <form
      action={formAction}
      className="rounded-[2rem] border border-hairline bg-surface-selected p-4"
    >
      <input type="hidden" name="weekStart" value={weekStart} />
      <p className="label-micro mb-1">{heading}</p>
      <p className="mb-5 text-label text-ink-muted">
        When you can train — the week plans itself around these blocks.
      </p>

      {/* Total + warning render BEFORE the day list, not after it, so
          PinnedAction (below) is always the day list's immediate DOM
          neighbour. When it moves before, PinnedAction sat right after
          this text in document order — but once stuck, it visually floats
          ABOVE its own natural position, which put a lower-document-order
          fragment of this exact text on screen BELOW an already-rendered
          button: a DOM-order inversion, not the "content legibly scrolls
          under the band" the brief anticipates (Task 6 report, browser
          verification screenshot). Nothing between the list and the button
          removes the inversion outright rather than relying on the band's
          blur to paper over it. */}
      <p className="mb-2 text-center text-label text-ink-muted">
        {`${formatAvailability(totalMins)} ${weekLabel}`}
      </p>
      {warning && (
        <p className="mb-5 text-center text-label leading-relaxed text-chart-3">
          {warning}
        </p>
      )}
      {/* I5, final whole-branch review: `state.message` — the server's
          response to a real submission, e.g. "That week has already
          passed. Nothing was changed." — used to render AFTER
          PinnedAction, exactly the position the comment above says causes
          a DOM-order inversion. It joins total/warning here rather than
          sitting between the list and the button, so `</ul>` stays
          PinnedAction's immediate DOM predecessor and there is still
          nothing between them to invert. */}
      {state.message !== "" && (
        <p className="mb-5 text-center text-label text-ink-secondary">
          {state.message}
        </p>
      )}

      <AvailabilityTimeline
        week={week}
        pinned={dates.map((d) => overrideDates.includes(d))}
        onChangeDay={(i, next) =>
          setWeek((prev) => prev.map((d, j) => (j === i ? next : d)))
        }
        onUnpin={unpin}
        onOpenDay={setOpenDay}
      />
      {/* The submitted value, unchanged from the list this replaced. The
          timeline is a VIEW over `week`; these are what actually reach
          submitAvailability, and tests/intake-form-resync.test.tsx asserts
          against them for exactly that reason. */}
      {week.map((blocks, i) => (
        <input
          key={i}
          type="hidden"
          name={`blocks-${i}`}
          value={JSON.stringify(blocks)}
        />
      ))}

      <PinnedAction
        label="Confirm week"
        formAction={formAction}
        pending={pending}
        // This form now renders only inside the "availability" sheet
        // (slice 2 task 4) — see PinnedAction's own doc comment for why
        // its sticky offset differs there (review finding 4, fix pass).
        variant="sheet"
      />

      {openDay !== null && (
        <BlockSheet
          dayLabel={WEEKDAY_NAMES[openDay]}
          blocks={week[openDay]}
          sports={sports}
          onChange={(next) =>
            setWeek((prev) => prev.map((d, j) => (j === openDay ? next : d)))
          }
          onClose={() => setOpenDay(null)}
          pinned={overrideDates.includes(dates[openDay])}
          onUnpin={() => unpin(openDay)}
          unpinPending={unpinning}
        />
      )}
    </form>
  );
}
