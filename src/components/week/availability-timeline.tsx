"use client";

import { useRef, useState } from "react";
import { Plus, SlidersHorizontal } from "lucide-react";
import type { AvailabilityBlock } from "@/lib/availability/types";
import { formatAvailability, formatBlocks } from "@/lib/availability/format";
import { blockMins } from "@/lib/availability/types";
import { ENERGY_FILL } from "@/lib/availability/energy-fill";
import {
  NOMINAL_TRACK_PX,
  SNAP_MIN,
  addBlock,
  describeBlock,
  layoutDay,
  moveBlock,
  pxToMins,
  resizeBlock,
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
 * The track's real width right now, for turning a pixel drag into minutes.
 * Read from the element at gesture start rather than measured on every
 * render: this is the ONE place a real width is needed, and reading it here
 * costs one layout per drag instead of a resize observer for the page's life.
 */
function trackPxOf(el: HTMLElement | null): number {
  return el?.getBoundingClientRect().width || 0;
}

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
 * EVERY FOCUSABLE CONTROL CARRIES `scroll-mb-52` (208px). `PinnedAction`'s
 * stuck band occupies the bottom ~189px of the viewport once engaged, and
 * without this, tabbing to a late day lands focus on a control the browser
 * already considers in view by raw bounding box — leaving it focused and
 * invisible behind the band. `IntakeForm`'s own day list carried this before
 * the timeline replaced it, and its guard test is what caught the omission.
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

  // The gesture in flight. A ref, not state: pointermove fires far faster
  // than React can re-render, and the drag's own arithmetic must read the
  // value the LAST move wrote, not the one the last commit re-rendered with.
  const drag = useRef<{
    blockIndex: number;
    edge: "start" | "end" | null;
    originX: number;
    trackPx: number;
    committed: AvailabilityBlock[];
  } | null>(null);

  function onPointerDown(
    e: React.PointerEvent<HTMLElement>,
    blockIndex: number,
    edge: "start" | "end" | null
  ) {
    const track = e.currentTarget.closest<HTMLElement>("[data-track]");
    const trackPx = trackPxOf(track);
    if (trackPx === 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = {
      blockIndex,
      edge,
      originX: e.clientX,
      trackPx,
      committed: blocks,
    };
  }

  function onPointerMove(e: React.PointerEvent<HTMLElement>) {
    const d = drag.current;
    if (!d) return;
    const deltaMins = pxToMins(e.clientX - d.originX, d.trackPx, win);
    // Snapping happens inside moveBlock/resizeBlock, so a sub-step drag
    // resolves to the same block it started as and commits nothing new.
    const next = d.edge
      ? resizeBlock(d.committed, d.blockIndex, d.edge, deltaMins, win)
      : moveBlock(d.committed, d.blockIndex, deltaMins, win);
    if (JSON.stringify(next) === JSON.stringify(d.committed)) return;
    onChangeDay(day, next);
  }

  function onPointerUp(e: React.PointerEvent<HTMLElement>) {
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    drag.current = null;
  }

  /**
   * A gesture the browser took over — it decided the touch was a scroll after
   * all. Clearing the ref is what stops the next unrelated pointermove from
   * resuming a drag nobody is making.
   */
  function onPointerCancel() {
    drag.current = null;
  }

  /**
   * THE SECOND HALF OF THE GESTURE CONFLICT. A horizontal pill drag competes
   * with two separate things, and they need two separate answers.
   *
   * The browser's own pan is handled by `touch-pinch-zoom` on the pill
   * (`touch-action: pinch-zoom`): it stops the browser claiming the gesture
   * as a scroll, and it KEEPS pinch-zoom, which the blanket "block every
   * gesture" value would not. That distinction is the whole of WCAG 1.4.4
   * here, and it is why `tests/viewport-zoom-guard.test.ts` bans that value
   * and the directional pan ones while allowing this — an app whose own
   * premise was that most of its type is 11px or smaller cannot be the one
   * that takes magnification away.
   *
   * (Written without spelling those two class names: that guard matches a
   * bare word, so naming them in prose counts as using them — the same trap
   * `block-sheet.tsx`'s scrim comment documents for the offender ratchet.)
   *
   * `BottomSheet`'s drag-to-dismiss is a React listener on its panel, not a
   * browser gesture, so `touch-action` cannot reach it: it fires from
   * `onTouchMove` whenever the panel is scrolled to the top, which is exactly
   * when a pill drag is most likely. Stopping the touch events here is what
   * keeps a drag on a pill from dismissing the sheet out from under it.
   * `onPointerCancel` above covers whatever still gets away.
   */
  const touchGuards = {
    onTouchStart: (e: React.TouchEvent<HTMLElement>) => e.stopPropagation(),
    onTouchMove: (e: React.TouchEvent<HTMLElement>) => e.stopPropagation(),
  };

  /**
   * A resize handle's pointer props. `stopPropagation` is load-bearing, not
   * hygiene: the handles render INSIDE the pill button — they must, to be
   * positioned against it — so without it a pointerdown on a handle bubbles
   * to the button, whose own onPointerDown overwrites the gesture with
   * `edge: null` and turns a resize into a move. The test
   * "resizes from the end handle instead of moving" is what caught it.
   */
  function handleProps(blockIndex: number, edge: "start" | "end") {
    return {
      onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
        e.stopPropagation();
        onPointerDown(e, blockIndex, edge);
      },
      onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
        e.stopPropagation();
        onPointerMove(e);
      },
      onPointerUp: (e: React.PointerEvent<HTMLElement>) => {
        e.stopPropagation();
        onPointerUp(e);
      },
      onPointerCancel,
      ...touchGuards,
    };
  }

  return (
    <li className="border-b border-hairline py-2 last:border-0">
      {/* The label is ABOVE the track, not beside it: a 40px label column
          costs 12% of the track, and decision 5's arithmetic does not survive
          that. */}
      <div className="mb-1 flex items-center gap-2">
        <span className="shrink-0 text-label font-bold uppercase tracking-wider text-ink-muted">
          {WEEKDAY_SHORT[day]}
        </span>
        {/* `formatBlocks`, exactly as the day list this replaced showed it —
            "07:00-08:00 · 1h 00m", or "Rest". The timeline conveys WHEN by
            position, but position is only approximate once the 44px floor
            distorts it, so the numeric clock range stays on the page rather
            than being reachable only through BlockSheet. Dropping it was a
            real information loss, and availability-week-switcher.test.tsx
            is what caught it. */}
        <span className="flex-1 truncate text-label text-ink-secondary">
          {formatBlocks(blocks)}
        </span>
        {pinned && (
          <button
            type="button"
            aria-label={`${dayName}: back to your standard week`}
            onClick={() => onUnpin(day)}
            className="shrink-0 scroll-mb-52 rounded-full border border-hairline bg-surface-overlay px-2 py-0.5 text-label font-bold text-chart-3"
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
          className="shrink-0 scroll-mb-52 rounded-full p-1 text-ink-muted disabled:opacity-40"
        >
          <Plus aria-hidden className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label={`Edit ${dayName} precisely`}
          onClick={() => onOpenDay(day)}
          className="shrink-0 scroll-mb-52 rounded-full p-1 text-ink-muted"
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
              onKeyDown={(e) => {
                // The spec's keyboard contract: arrows move the start,
                // shift+arrows resize, both in SNAP_MIN steps — the same
                // steps a drag lands on, so the two paths cannot disagree.
                // Enter hands off to BlockSheet, which stays the precise and
                // assistive editor for energy, sports and exact clock times.
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onOpenDay(day);
                  return;
                }
                const dir =
                  e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
                if (dir === 0) return;
                e.preventDefault();
                onSelect(id);
                onChangeDay(
                  day,
                  e.shiftKey
                    ? resizeBlock(blocks, p.index, "end", dir * SNAP_MIN, win)
                    : moveBlock(blocks, p.index, dir * SNAP_MIN, win)
                );
              }}
              onPointerDown={(e) => onPointerDown(e, p.index, null)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerCancel}
              {...touchGuards}
              style={{ left: pct(p.leftPx), width: pct(p.widthPx) }}
              className={`absolute inset-y-0 flex min-w-11 touch-pinch-zoom scroll-mb-52 items-center justify-center gap-1 rounded-lg border border-accent/60 text-label text-ink-primary ${
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
              {isSelected && (
                <>
                  {/* OUTSIDE the pill's own bounds (-left-3 / -right-3, 24px
                      wide): the spec is explicit that "the touch target is not
                      the pill's rendered width", and at the 44px floor the
                      pill has no room to host a grabbable edge inside itself.
                      aria-hidden with tabIndex -1 — the keyboard path is
                      shift+arrows on the pill itself, so these would be two
                      extra tab stops that do nothing a keyboard user needs. */}
                  <span
                    aria-hidden
                    tabIndex={-1}
                    data-handle={`${id}:start`}
                    {...handleProps(p.index, "start")}
                    className="absolute -left-3 inset-y-0 w-6 cursor-ew-resize"
                  />
                  <span
                    aria-hidden
                    tabIndex={-1}
                    data-handle={`${id}:end`}
                    {...handleProps(p.index, "end")}
                    className="absolute -right-3 inset-y-0 w-6 cursor-ew-resize"
                  />
                </>
              )}
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
                className="scroll-mb-52 rounded-full border border-hairline bg-surface-overlay px-2 py-0.5 text-label text-ink-secondary"
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
