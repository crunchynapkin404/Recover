"use client";

import { useRef, useState } from "react";
import { Plus, SlidersHorizontal } from "lucide-react";
import type { AvailabilityBlock } from "@/lib/availability/types";
import { formatAvailability, formatBlocks } from "@/lib/availability/format";
import { blockMins } from "@/lib/availability/types";
import { ENERGY_FILL, ENERGY_NOTCHES } from "@/lib/availability/energy-fill";
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

/**
 * How far a pointer must travel before the gesture counts as a drag. One
 * pixel on the nominal track is ~3.2 minutes, and `snap()` rounds to the
 * quarter hour, so without a threshold a 3px tap wobble committed a
 * 15-minute move with nothing on screen to say so.
 */
const DRAG_THRESHOLD_PX = 8;

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
    // -mx-4 with NO padding put back. The first version paired it with px-4,
    // which restores exactly what the negative margin pulls out — a net-zero
    // change that left the track at 306px while every position is computed
    // against NOMINAL_TRACK_PX (342). A container NARROWER than nominal is
    // the one case the min-width backstop cannot absorb, so adjacent pills
    // overlapped and one block's resize handle sat under its neighbour.
    // Only the day header rows are padded back in, below; the track itself
    // is meant to bleed. This is a margin, NOT a transform — see the file doc.
    <div className="-mx-4 mb-3">
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
  // and no hydration mismatch.
  //
  // THERE IS NO CSS `min-width` BACKSTOP, deliberately. The first version had
  // one, which meant the rendered floor and the computed floor disagreed
  // whenever the real track was not the nominal width — and on a container
  // NARROWER than nominal that disagreement is an OVERLAP, the one thing
  // `layoutDay` promises cannot happen. Letting the percentages carry the
  // floor means everything scales together: the floor is 44px at the
  // reference viewport, proportionally smaller on a narrower phone, and
  // non-overlapping at every width.
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
    pointerId: number;
    blockIndex: number;
    edge: "start" | "end" | null;
    originX: number;
    trackPx: number;
    committed: AvailabilityBlock[];
    /** Set once the pointer travels past DRAG_THRESHOLD_PX. */
    moved: boolean;
  } | null>(null);

  /**
   * True while the click the browser synthesises after a drag is still to
   * come. The pill's onClick toggles selection, and that click bubbles up
   * from the handles too — so without this every resize ended by deselecting
   * the block and unmounting the handles it was being performed with.
   */
  const swallowClick = useRef(false);

  function onPointerDown(
    e: React.PointerEvent<HTMLElement>,
    blockIndex: number,
    edge: "start" | "end" | null
  ) {
    const track = e.currentTarget.closest<HTMLElement>("[data-track]");
    const trackPx = trackPxOf(track);
    if (trackPx === 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    // Cleared at the START of every gesture, not left to the click that ends
    // one. Setting it on the drag and clearing it on the click assumed a
    // click always arrives — it does not after a pointercancel, or when the
    // gesture ends off the element — and a stuck flag silently swallowed the
    // NEXT legitimate tap instead.
    swallowClick.current = false;
    drag.current = {
      pointerId: e.pointerId,
      blockIndex,
      edge,
      originX: e.clientX,
      trackPx,
      committed: blocks,
      moved: false,
    };
  }

  function onPointerMove(e: React.PointerEvent<HTMLElement>) {
    const d = drag.current;
    if (!d) return;
    // A SECOND FINGER MUST NOT STEER THE FIRST ONE'S GESTURE. There is one
    // drag ref per day, so without this a touch landing on the other pill
    // mid-drag replaced the block index and the origin, and the first
    // finger's next move jumped a block nobody was dragging.
    if (e.pointerId !== d.pointerId) return;
    const dx = e.clientX - d.originX;
    // A TAP IS NOT A DRAG. On the nominal track one pixel is ~3.2 minutes, so
    // snap() turned a 3px wobble into a committed quarter-hour move — and
    // Android's touch slop alone is 8px, so this fired on ordinary taps. The
    // gesture has to clear a real distance before it edits anything.
    if (!d.moved) {
      if (Math.abs(dx) < DRAG_THRESHOLD_PX) return;
      d.moved = true;
    }
    const deltaMins = pxToMins(dx, d.trackPx, win);
    // Snapping happens inside moveBlock/resizeBlock, so a sub-step drag
    // resolves to the same block it started as and commits nothing new.
    const next = d.edge
      ? resizeBlock(d.committed, d.blockIndex, d.edge, deltaMins, win)
      : moveBlock(d.committed, d.blockIndex, deltaMins, win);
    if (JSON.stringify(next) === JSON.stringify(d.committed)) return;
    onChangeDay(day, next);
  }

  function onPointerUp(e: React.PointerEvent<HTMLElement>) {
    if (drag.current && e.pointerId !== drag.current.pointerId) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    // Only a gesture that actually moved should eat the click that follows.
    swallowClick.current = drag.current?.moved === true;
    drag.current = null;
  }

  /**
   * A gesture the browser took over — it decided the touch was a scroll after
   * all. Clearing the ref is what stops the next unrelated pointermove from
   * resuming a drag nobody is making.
   */
  function onPointerCancel() {
    // No click follows a cancelled gesture, so nothing must be armed to
    // swallow one.
    swallowClick.current = false;
    drag.current = null;
  }

  /**
   * NO `touch-action` AND NO TOUCH GUARDS, arrived at by removing both.
   *
   * The first version put `touch-action: pinch-zoom` on the pill and stopped
   * touch events reaching `BottomSheet`. That settled the horizontal drag and
   * broke everything else: `pinch-zoom` forbids ALL single-finger panning, not
   * just horizontal, and the stopPropagation killed the sheet's own
   * drag-to-dismiss — so on a sheet that is 1.09 screens tall, a thumb swipe
   * starting anywhere on a pill scrolled nothing, dismissed nothing, and slid
   * the block a quarter hour instead. Seven tracks of pills, mostly covered.
   *
   * DRAG_THRESHOLD_PX is what makes doing nothing correct. A vertical swipe
   * never travels far enough horizontally to commit, the browser claims the
   * gesture and scrolls, and `onPointerCancel` retires the drag cleanly. A
   * horizontal drag in a vertically-scrolling container is not claimed, so it
   * reaches these handlers as before. Pinch-zoom is untouched, which is the
   * whole of WCAG 1.4.4 here and what `tests/viewport-zoom-guard.test.ts`
   * exists to protect.
   */

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
      onClick: (e: React.MouseEvent<HTMLElement>) => {
        e.stopPropagation();
        swallowClick.current = false;
      },
    };
  }

  return (
    <li className="border-b border-hairline py-2 last:border-0">
      {/* The label is ABOVE the track, not beside it: a 40px label column
          costs 12% of the track, and decision 5's arithmetic does not survive
          that. */}
      <div className="mb-1 flex items-center gap-2 px-4">
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
            // The visible text is "Pinned ×", so the accessible name has to
            // start with it (WCAG 2.5.3). The first version replaced it
            // wholesale, which broke "tap Pinned" for every voice-control
            // user — a regression against main, where the button had only a
            // `title` and its visible text WAS its name.
            aria-label={`Pinned — ${dayName}, back to your standard week`}
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
        {/* THE PILL CARRIES NO TEXT, and that is a finding from the capture,
            not an oversight. At the 44px floor — which is where every block
            under ~2h20m lands — a duration renders as "1h 00…" and an
            ellipsis is worse than nothing. The numbers live one line up, in
            the day summary, at full width; the pill is a mark, the way the
            day strip's bars are. `describeBlock` carries everything for a
            screen reader, which never depended on the painted label. */}
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
              onClick={() => {
                // The click that closes a drag is not a selection gesture.
                // It arrives from the handles too, which sit inside this
                // button, so a resize used to end by deselecting the block
                // and unmounting the very handles it was using.
                if (swallowClick.current) {
                  swallowClick.current = false;
                  return;
                }
                onSelect(isSelected ? null : id);
              }}
              onKeyDown={(e) => {
                // The spec's keyboard contract: arrows move the start,
                // shift+arrows resize, both in SNAP_MIN steps — the same
                // steps a drag lands on, so the two paths cannot disagree.
                //
                // ENTER AND SPACE ARE DELIBERATELY NOT HANDLED HERE. They
                // used to call onOpenDay, which made activation mean two
                // different things: a tap toggled selection, Enter opened
                // BlockSheet — and a touch screen reader's double-tap
                // dispatches a CLICK, so those users got the toggle and could
                // never reach the sheet from a pill, while `aria-pressed`
                // announced a state the keyboard path never set. Left alone,
                // the browser turns Enter/Space on a <button> into the same
                // click a tap produces, and the two modalities agree. The
                // precise editor is the day's own "Edit precisely" control,
                // which does not depend on selection.
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
              style={{ left: pct(p.leftPx), width: pct(p.widthPx) }}
              className={`absolute inset-y-0 flex scroll-mb-52 items-center justify-center gap-1 rounded-lg border border-accent ${
                ENERGY_FILL[b.energy]
              } ${isSelected ? "ring-2 ring-accent" : ""}`}
            >
              {/* The day strip's notch glyph, reused — but COUNTED, not
                  reserved for the top tier. Painting it only on `full` left
                  `easy` and `normal` separated by two alpha steps of one hue,
                  measured at 1.37:1, under the 3:1 WCAG asks of a meaningful
                  graphical distinction — and the pill carries no text, so
                  there was nothing else to read. One dot for normal, two for
                  full gas, none for easy: a shape channel that scales. */}
              {ENERGY_NOTCHES[b.energy] > 0 && (
                <span
                  aria-hidden
                  data-notch=""
                  className="flex shrink-0 gap-0.5"
                >
                  {Array.from({ length: ENERGY_NOTCHES[b.energy] }, (_, n) => (
                    <span
                      key={n}
                      className="h-1 w-1 rounded-full bg-ink-primary"
                    />
                  ))}
                </span>
              )}
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
        <ul className="mt-1 flex flex-wrap gap-1.5 px-4">
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
