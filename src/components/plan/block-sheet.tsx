"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  validateBlocks,
  type AvailabilityBlock,
  type Energy,
} from "@/lib/availability/types";
import { formatBlock } from "@/lib/availability/format";

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
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  return eh * 60 + em - (sh * 60 + sm);
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
      if (merged.start != null && merged.end != null) {
        merged.mins = minutesBetween(merged.start, merged.end);
      }
      return merged;
    });
    commit(next);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Availability for ${dayLabel}`}
        className="relative max-h-[85svh] w-full max-w-lg overflow-y-auto rounded-t-[28px] border border-white/[0.12] bg-[#111113] px-6 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] pt-3"
      >
        <div
          aria-hidden
          className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20"
        />
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <h2 className="text-[16px] font-bold tracking-[-0.02em]">
            {dayLabel}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 text-[12px] font-bold text-emerald-400"
          >
            Done
          </button>
        </div>

        {blocks.length === 0 ? (
          <p className="mb-4 text-[12px] text-white/50">
            Rest — no time set for this day.
          </p>
        ) : (
          <ul className="mb-4 space-y-3">
            {blocks.map((b, i) => (
              <li
                key={i}
                className="rounded-2xl border border-white/5 bg-white/5 p-3"
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="time"
                      value={b.start ?? ""}
                      aria-label={`Block ${i + 1} start time`}
                      onChange={(e) => patch(i, { start: e.target.value })}
                      className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[12px] text-white"
                    />
                    <span aria-hidden className="text-white/30">
                      –
                    </span>
                    <input
                      type="time"
                      value={b.end ?? ""}
                      aria-label={`Block ${i + 1} end time`}
                      onChange={(e) => patch(i, { end: e.target.value })}
                      className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[12px] text-white"
                    />
                  </div>
                  <button
                    type="button"
                    aria-label={`Remove block ${i + 1}`}
                    onClick={() => commit(blocks.filter((_, j) => j !== i))}
                    className="rounded-full p-1.5 text-white/40 transition-colors hover:bg-red-500/10 hover:text-red-400"
                  >
                    <Trash2 aria-hidden className="size-3.5" />
                  </button>
                </div>

                <p className="mb-2 text-[11px] text-white/40">
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
                      className={`rounded-full border px-3 py-1.5 text-[11px] font-bold transition-colors ${
                        b.energy === e.value
                          ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-400"
                          : "border-white/10 bg-white/5 text-white/70"
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
                          className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                            on
                              ? "border-white/20 bg-white/[0.14] text-white"
                              : "border-white/10 bg-white/[0.04] text-white/40"
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
          <p role="alert" className="mb-3 text-[11px] text-red-400">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={() => commit([...blocks, { ...NEW_BLOCK }])}
          className="flex w-full items-center justify-center gap-1.5 rounded-2xl border border-white/10 bg-white/5 py-2.5 text-[12px] font-bold text-white/70"
        >
          <Plus aria-hidden className="size-3.5" />
          Add a block
        </button>
      </div>
    </div>
  );
}
