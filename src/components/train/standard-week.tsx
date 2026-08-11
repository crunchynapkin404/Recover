"use client";

import { useRef, useState, useTransition } from "react";
import { blockMins, type AvailabilityBlock } from "@/lib/availability/types";
import { formatAvailability, formatBlocks } from "@/lib/availability/format";
import { setStandardWeekDay } from "@/app/plan/actions";
import { BlockSheet } from "@/components/week/block-sheet";

const DAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

interface Props {
  /** Monday-first, seven entries. */
  defaults: AvailabilityBlock[][];
  sports: string[];
}

/**
 * The standard week (task 14): the time an athlete normally has, set once
 * per weekday and reused every week until changed here. A single day's
 * override — set from the week view or the day menu's "no time today" —
 * always wins over whatever this screen says for that date, and keeps
 * winning after this screen changes; this component never touches
 * overrides, only `availability_defaults` via `setStandardWeekDay`.
 */
export function StandardWeek({ defaults, sports }: Props) {
  const [week, setWeek] = useState(defaults);
  const [open, setOpen] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const total = week.reduce(
    (s, day) => s + day.reduce((d, b) => d + blockMins(b), 0),
    0
  );

  // BlockSheet commits on every interaction, so wiring onChange straight to
  // the server action made each keystroke in a time input its own DB write
  // plus revalidatePath. Edits are staged locally and written once, when the
  // sheet closes.
  const staged = useRef<AvailabilityBlock[] | null>(null);

  function stage(weekday: number, blocks: AvailabilityBlock[]) {
    staged.current = blocks;
    setWeek((prev) => prev.map((d, i) => (i === weekday ? blocks : d)));
  }

  function closeAndSave(weekday: number) {
    const blocks = staged.current;
    staged.current = null;
    setOpen(null);
    if (!blocks) return; // opened and closed without editing anything
    startTransition(async () => {
      const r = await setStandardWeekDay(weekday, blocks);
      setError(r.ok ? null : r.error);
    });
  }

  return (
    <div className="glass rounded-[2rem] p-6">
      <p className="label-micro mb-1">Your standard week</p>
      <p className="mb-5 text-[12px] text-white/50">
        The time you normally have. Any single day you change from the week view
        overrides this — and keeps overriding it.
      </p>

      <ul className="mb-4">
        {DAY_NAMES.map((name, i) => (
          <li key={name} className="border-b border-white/[0.06] last:border-0">
            <button
              type="button"
              onClick={() => setOpen(i)}
              disabled={pending}
              className="flex w-full items-center justify-between py-3 text-left disabled:opacity-50"
            >
              <span className="text-[12.5px] font-bold text-white/85">
                {name}
              </span>
              <span className="text-[11.5px] text-white/50">
                {formatBlocks(week[i])}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <p className="text-center text-[11px] text-white/40">
        {formatAvailability(total)} in a standard week
      </p>
      {error && (
        <p className="mt-2 text-center text-[11px] text-red-400">{error}</p>
      )}

      {open !== null && (
        <BlockSheet
          dayLabel={DAY_NAMES[open]}
          blocks={week[open]}
          sports={sports}
          onChange={(next) => stage(open, next)}
          onClose={() => closeAndSave(open)}
        />
      )}
    </div>
  );
}
