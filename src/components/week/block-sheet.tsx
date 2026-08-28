"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  validateBlocks,
  type AvailabilityBlock,
  type Energy,
} from "@/lib/availability/types";
import { formatBlock } from "@/lib/availability/format";
// Shared with the availability drag-timeline (slice 3) rather than defined
// twice: both editors turn the same clock strings into the same minutes, and
// a second copy is how the two would silently disagree about the end of a day.
import { toClock, toMins } from "@/lib/availability/timeline";

export interface BlockSheetProps {
  dayLabel: string;
  blocks: AvailabilityBlock[];
  /** Sports in the athlete's plan. Chips appear only when there's a genuine choice. */
  sports: string[];
  onChange: (next: AvailabilityBlock[]) => void;
  onClose: () => void;
}

const ENERGY_LEVELS: { value: Energy; label: string }[] = [
  { value: "easy", label: "Easy" },
  { value: "normal", label: "Normal" },
  { value: "full", label: "Full gas" },
];

const NEW_BLOCK: AvailabilityBlock = {
  start: "18:00",
  end: "19:00",
  mins: 60,
  energy: "normal",
  sports: null,
};

function minutesBetween(start: string, end: string): number {
  return toMins(end) - toMins(start);
}

/**
 * The block editor sheet (task 13): one day's training availability as a
 * list of clock-time blocks, each with an expected energy level and,
 * plan-permitting, which sports may land in it.
 *
 * Reuses the sheet shell + backdrop from `availability-sheet.tsx` (same
 * fixed/backdrop-button/role=dialog shape) rather than the URL-driven
 * `BottomSheet`, since this component is a plain controlled
 * blocks/onChange/onClose callback like `AvailabilitySheet`, not a
 * `?sheet=` route. Clock times use native `type="time"` inputs — already
 * the app's idiom for editing a clock time directly (see
 * `body-prefs-card.tsx`'s wake-time field) — rather than `WheelColumn`,
 * which this codebase reserves for scrubbing a duration.
 *
 * Edits commit immediately through `validateBlocks`: a valid edit calls
 * `onChange`, an invalid one (bad shape, backwards window, overlap) is
 * rejected and surfaced as an alert instead, leaving the last-committed
 * `blocks` prop in place — same "commit on every interaction" model as
 * `AvailabilitySheet`.
 */
export function BlockSheet({
  dayLabel,
  blocks,
  sports,
  onChange,
  onClose,
}: BlockSheetProps) {
  const [error, setError] = useState<string | null>(null);

  function commit(next: AvailabilityBlock[]) {
    const invalid = validateBlocks(next);
    setError(invalid);
    if (!invalid) onChange(next);
  }

  function patch(i: number, patchBlock: Partial<AvailabilityBlock>) {
    const next = blocks.map((b, j) => {
      if (j !== i) return b;
      const merged = { ...b, ...patchBlock };
      // Fill in whichever end is still missing, deriving it from the
      // duration the block already carries.
      //
      // In practice this only ever fires for a legacy duration-only block
      // (start and end both null, duration in `mins` alone), which had no
      // path through this UI to a clock range at all: `validateBlocks`
      // admits only both-null or both-set, and every edit commits
      // immediately, so setting one field landed on the half-set shape, was
      // rejected, and the input reverted. Deriving the other end in the same
      // edit means the athlete's stored minutes survive the conversion
      // rather than being replaced by an arbitrary default.
      //
      // A `type="time"` input reports a partially entered or cleared value
      // as `""`, which parses to NaN and derives a nonsense "NaN:NaN" — but
      // `commit` runs `validateBlocks` before calling `onChange`, and a `""`
      // start fails the clock-shape check, so the whole edit is rejected and
      // neither value ever escapes this function.
      if (merged.start != null && merged.end == null) {
        merged.end = toClock(toMins(merged.start) + b.mins);
      } else if (merged.end != null && merged.start == null) {
        merged.start = toClock(toMins(merged.end) - b.mins);
      }
      if (merged.start != null && merged.end != null) {
        merged.mins = minutesBetween(merged.start, merged.end);
      }
      return merged;
    });
    commit(next);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center">
      {/* Deliberately NOT tokenized (Task 12, whole-branch review 2026-08-12
          I5's Part B). This is a modal scrim dimming whatever sits behind
          the sheet — not text (no `ink-*` role applies) and not a surface
          this component owns (no `surface-*` role applies either; it has
          to composite over arbitrary page content, not sit as an opaque
          ground the way `--surface-*` does). There is no scrim token in
          the vocabulary, and inventing one for a single call site would be
          worse than the one raw utility it replaces. The black-alpha scrim
          on the next line stays, on purpose — it is the ONE site excluded
          from this surface's zero-offender claim, and the only match the
          sweep's grep should return. Not a miss.

          (Written without quoting the utility itself: the offender ratchet
          scans source lines, so a comment naming the pattern would count
          as an occurrence and make the zero claim un-literal.) */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-scrim backdrop-blur-sm"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Availability for ${dayLabel}`}
        className="glass relative max-h-[85svh] w-full max-w-lg overflow-y-auto rounded-t-[28px] px-6 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] pt-3"
      >
        <div
          aria-hidden
          className="mx-auto mb-4 h-1 w-10 rounded-full bg-hairline opacity-40"
        />
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <h2 className="text-body font-bold tracking-[-0.02em]">{dayLabel}</h2>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 text-label font-bold text-accent"
          >
            Done
          </button>
        </div>

        {blocks.length === 0 ? (
          <p className="mb-4 text-label text-ink-muted">
            Rest — no time set for this day.
          </p>
        ) : (
          <ul className="mb-4 space-y-3">
            {blocks.map((b, i) => (
              <li key={i} className="rounded-2xl bg-surface-overlay p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="time"
                      value={b.start ?? ""}
                      aria-label={`Block ${i + 1} start time`}
                      onChange={(e) => patch(i, { start: e.target.value })}
                      className="rounded-lg border border-hairline px-2 py-1 text-label text-ink-primary"
                    />
                    <span aria-hidden className="text-ink-muted">
                      –
                    </span>
                    <input
                      type="time"
                      value={b.end ?? ""}
                      aria-label={`Block ${i + 1} end time`}
                      onChange={(e) => patch(i, { end: e.target.value })}
                      className="rounded-lg border border-hairline px-2 py-1 text-label text-ink-primary"
                    />
                  </div>
                  <button
                    type="button"
                    aria-label={`Remove block ${i + 1}`}
                    onClick={() => commit(blocks.filter((_, j) => j !== i))}
                    className="rounded-full p-1.5 text-ink-muted transition-colors hover:bg-chart-5/10 hover:text-chart-5"
                  >
                    <Trash2 aria-hidden className="size-3.5" />
                  </button>
                </div>

                <p className="mb-2 text-label text-ink-muted">
                  {formatBlock(b)}
                </p>

                <div
                  role="group"
                  aria-label={`Block ${i + 1} energy`}
                  className="mb-2 flex flex-wrap gap-1.5"
                >
                  {ENERGY_LEVELS.map((e) => (
                    <button
                      key={e.value}
                      type="button"
                      aria-pressed={b.energy === e.value}
                      onClick={() => patch(i, { energy: e.value })}
                      className={`rounded-full border px-3 py-1.5 text-label font-bold transition-colors ${
                        b.energy === e.value
                          ? "border-hairline bg-accent text-primary-foreground"
                          : "border-hairline bg-surface-raised text-ink-secondary"
                      }`}
                    >
                      {e.label}
                    </button>
                  ))}
                </div>

                {sports.length > 1 && (
                  <div
                    role="group"
                    aria-label={`Block ${i + 1} sports`}
                    className="flex flex-wrap gap-1.5"
                  >
                    {sports.map((s) => {
                      const on = b.sports == null || b.sports.includes(s);
                      return (
                        <button
                          key={s}
                          type="button"
                          aria-pressed={on}
                          onClick={() => {
                            const current = b.sports ?? sports;
                            const next = on
                              ? current.filter((x) => x !== s)
                              : [...current, s];
                            patch(i, {
                              sports:
                                next.length === sports.length ? null : next,
                            });
                          }}
                          className={`rounded-full border px-3 py-1.5 text-label font-semibold transition-colors ${
                            on
                              ? "border-hairline bg-accent text-primary-foreground"
                              : "border-hairline bg-surface-raised text-ink-secondary"
                          }`}
                        >
                          {s}
                        </button>
                      );
                    })}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {error && (
          <p role="alert" className="mb-3 text-label text-chart-5">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={() => commit([...blocks, { ...NEW_BLOCK }])}
          className="flex w-full items-center justify-center gap-1.5 rounded-2xl border border-hairline bg-surface-overlay py-2.5 text-label font-bold text-ink-secondary"
        >
          <Plus aria-hidden className="size-3.5" />
          Add a block
        </button>
      </div>
    </div>
  );
}
