"use client";

import { useState } from "react";
import { Plus, SlidersHorizontal } from "lucide-react";
import type { AvailabilityBlock } from "@/lib/availability/types";
import { formatAvailability } from "@/lib/availability/format";
import { blockMins } from "@/lib/availability/types";
import { ENERGY_FILL } from "@/lib/availability/energy-fill";
import {
  NOMINAL_TRACK_PX,
  addBlock,
  describeBlock,
  layoutDay,
  trackWindow,
  type TrackWindow,
} from "@/lib/availability/timeline";
import { WEEKDAY_NAMES, WEEKDAY_SHORT } from "@/lib/weekdays";

export interface AvailabilityTimelineProps {
  /** Resolved blocks per day, Monday first. Exactly seven. */
  week: AvailabilityBlock[][];
  /** Which of the seven days are pinned by an override. */
  pinned: boolean[];
  /** Commit one day's new block list. The caller runs validateBlocks. */
  onChangeDay: (dayIndex: number, next: AvailabilityBlock[]) => void;
  /** Unpin day `i` — IntakeForm's existing clearDayOverride path. */
  onUnpin: (dayIndex: number) => void;
  /** Open BlockSheet on day `i` — the precise and assistive path. */
  onOpenDay: (dayIndex: number) => void;
}

/** "3:0" — day index and block index, the id both a pointer and a key press use. */
type BlockId = `${number}:${number}`;
const idOf = (day: number, block: number): BlockId => `${day}:${block}`;

/**
 * The availability drag-timeline (slice 3). Seven day tracks, one shared
 * scale, a pill per block.
 *
 * ALL GEOMETRY AND ALL MUTATION MATH LIVE IN
 * `src/lib/availability/timeline.ts`. This component owns input handling and
 * nothing else, which is what lets the snapping, the 44px floor, the
 * neighbour clamping and the accessible names be tested without a browser.
 *
 * THE 44px FLOOR IS A DELIBERATE DISTORTION. Eighteen hours across this
 * track is ~14px an hour on a phone, so a one-hour block would render 14px
 * wide and be ungrabbable. Below 44px the scale is not proportional. The
 * spec accepts this explicitly: "an honest 18px pill nobody can grab is worse
 * than a 44px one that overstates a short block."
 *
 * A DRAG-ONLY CONTROL IS UNUSABLE BY KEYBOARD AND SCREEN READER, so every
 * pill is a real `<button>` with the name `describeBlock` builds, arrow keys
 * adjust it, and `BlockSheet` stays reachable per day as the precise path.
 *
 * NO TRANSFORM, ANYWHERE IN THIS TREE. `BlockSheet` is `position: fixed` and
 * opens from inside this component's own sheet; per the CSS transforms spec
 * any transform on an ancestor — including a zero one — makes that ancestor
 * its containing block and collapses it to a sliver. `BottomSheet` omits its
 * idle transform for the same reason.
 */
export function AvailabilityTimeline({
  week,
  pinned,
  onChangeDay,
  onUnpin,
  onOpenDay,
}: AvailabilityTimelineProps) {
  const [selected, setSelected] = useState<BlockId | null>(null);
  const win = trackWindow(week);

  return (
    // -mx-4 cancels IntakeForm's own p-4 so the track spans the sheet's full
    // content width. Decision 5: at anything narrower the 44px floor swallows
    // every block a real athlete enters, and the timeline shows one width for
    // everything. This is a margin, NOT a transform — see the file doc.
    <div className="-mx-4 mb-3 px-4">
      <ul>
        {week.map((blocks, day) => (
          <DayTrack
            key={WEEKDAY_SHORT[day]}
            day={day}
            blocks={blocks}
            win={win}
            pinned={pinned[day] ?? false}
            selected={selected}
            onSelect={setSelected}
            onChangeDay={onChangeDay}
            onUnpin={onUnpin}
            onOpenDay={onOpenDay}
          />
        ))}
      </ul>
    </div>
  );
}

function DayTrack({
  day,
  blocks,
  win,
  pinned,
  selected,
  onSelect,
  onChangeDay,
  onUnpin,
  onOpenDay,
}: {
  day: number;
  blocks: AvailabilityBlock[];
  win: TrackWindow;
  pinned: boolean;
  selected: BlockId | null;
  onSelect: (id: BlockId | null) => void;
  onChangeDay: (dayIndex: number, next: AvailabilityBlock[]) => void;
  onUnpin: (dayIndex: number) => void;
  onOpenDay: (dayIndex: number) => void;
}) {
  const dayName = WEEKDAY_NAMES[day];
  // Computed once against the nominal track width and rendered as a FRACTION
  // of it, so the layout survives any container width with no resize observer
  // and no hydration mismatch. `min-w-11` on the pill is the hard 44px
  // backstop at every width that is not the nominal one. See
  // NOMINAL_TRACK_PX's own comment for why the floor forces this shape.
  const placed = layoutDay(blocks, NOMINAL_TRACK_PX, win);
  const pct = (px: number) => `${(px / NOMINAL_TRACK_PX) * 100}%`;
  const untimed = blocks
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => b.start == null || b.end == null);
  const full = addBlock(blocks, win) === null;

  return (
    <li className="border-b border-hairline py-2 last:border-0">
      {/* The label is ABOVE the track, not beside it: a 40px label column
          costs 12% of the track, and decision 5's arithmetic does not survive
          that. */}
      <div className="mb-1 flex items-center gap-2">
        <span className="shrink-0 text-label font-bold uppercase tracking-wider text-ink-muted">
          {WEEKDAY_SHORT[day]}
        </span>
        <span className="flex-1 truncate text-label text-ink-secondary">
          {blocks.length === 0
            ? "Rest"
            : formatAvailability(
                blocks.reduce((s, b) => s + blockMins(b), 0)
              )}
        </span>
        {pinned && (
          <button
            type="button"
            aria-label={`${dayName}: back to your standard week`}
            onClick={() => onUnpin(day)}
            className="shrink-0 rounded-full border border-hairline bg-surface-overlay px-2 py-0.5 text-label font-bold text-chart-3"
          >
            Pinned ×
          </button>
        )}
        <button
          type="button"
          aria-label={`Add a block on ${dayName}`}
          disabled={full}
          onClick={() => {
            const next = addBlock(blocks, win);
            if (next) onChangeDay(day, next);
          }}
          className="shrink-0 rounded-full p-1 text-ink-muted disabled:opacity-40"
        >
          <Plus aria-hidden className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label={`Edit ${dayName} precisely`}
          onClick={() => onOpenDay(day)}
          className="shrink-0 rounded-full p-1 text-ink-muted"
        >
          <SlidersHorizontal aria-hidden className="size-3.5" />
        </button>
      </div>

      <div
        data-track={day}
        className="relative h-9 rounded-lg bg-surface-overlay"
      >
        {placed.map((p) => {
          const b = blocks[p.index];
          const id = idOf(day, p.index);
          const isSelected = selected === id;
          return (
            <button
              key={id}
              type="button"
              data-block={id}
              data-widened={p.widened ? "" : undefined}
              aria-label={describeBlock(dayName, b)}
              aria-pressed={isSelected}
              onClick={() => onSelect(isSelected ? null : id)}
              style={{ left: pct(p.leftPx), width: pct(p.widthPx) }}
              className={`absolute inset-y-0 flex min-w-11 items-center justify-center gap-1 rounded-lg border border-accent/60 text-label text-ink-primary ${
                ENERGY_FILL[b.energy]
              } ${isSelected ? "ring-2 ring-accent" : ""}`}
            >
              {b.energy === "full" && (
                // The day strip's own notch glyph, reused verbatim: energy is
                // never told apart by fill density alone.
                <span
                  aria-hidden
                  data-notch=""
                  className="h-1 w-1 shrink-0 rounded-full bg-ink-primary"
                />
              )}
              <span className="truncate">{formatAvailability(blockMins(b))}</span>
            </button>
          );
        })}
      </div>

      {untimed.length > 0 && (
        <ul className="mt-1 flex flex-wrap gap-1.5">
          {untimed.map(({ b, i }) => (
            <li key={i}>
              <button
                type="button"
                data-untimed={idOf(day, i)}
                aria-label={`${describeBlock(dayName, b)} — set a time`}
                onClick={() => onOpenDay(day)}
                className="rounded-full border border-hairline bg-surface-overlay px-2 py-0.5 text-label text-ink-secondary"
              >
                {formatAvailability(blockMins(b))}
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
