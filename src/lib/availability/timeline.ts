// The availability drag-timeline's geometry and mutation math (slice 3).
//
// Pure: no React, no DOM, no clock reads. Everything the timeline decides —
// where a pill sits, how far a drag may travel, what a screen reader is told —
// is decided here so it can be tested without a browser, and so the component
// over it owns nothing but input handling.
//
// `validateBlocks` (types.ts) remains the authority on commit. The clamping
// below prevents overlap DURING the drag, per the spec ("Overlap is prevented
// by the drag rather than rejected afterwards"); it does not replace the check.
import { blockMins, type AvailabilityBlock, type Energy } from "./types";
import { formatAvailability } from "./format";

/** Latest time TIME_RE admits. A block cannot run past the end of its day. */
export const LAST_MINUTE_OF_DAY = 23 * 60 + 59;

/** The spec's snap: every drag lands on a quarter hour. */
export const SNAP_MIN = 15;

/**
 * The spec's first named cost, as a number. Eighteen hours across a phone's
 * track is ~14px per hour here (see the plan's decision 5), so a one-hour
 * block would render 14px wide and be ungrabbable. Below this width the
 * scale is DELIBERATELY NOT PROPORTIONAL: a 44px pill that overstates a short
 * block beats an honest one nobody can touch. `PlacedBlock.widened` reports
 * every place the distortion applied, so it is visible rather than implied.
 */
export const MIN_BLOCK_PX = 44;

/**
 * The track's width in px at the reference viewport — MEASURED in a browser,
 * not derived. 390px phone, minus the sheet panel's border and px-6, minus
 * IntakeForm's border and p-4, plus the timeline's own -mx-4: 338px. An
 * earlier comment here claimed 342 by forgetting the two 1px borders, and
 * claimed the timeline was full-bleed while it paired `-mx-4` with a `px-4`
 * that cancelled it exactly — the real track was 306px. Both found by the
 * whole-branch review; this number is now what a browser reports.
 *
 * WHY A NOMINAL WIDTH AND NOT A LIVE ONE. The pills are positioned in PERCENT
 * so the layout survives any container width with no resize observer and no
 * SSR/hydration mismatch. But MIN_BLOCK_PX is a real pixel floor, and a floor
 * cannot be applied in percent without knowing what 100% is worth. So the
 * layout is computed once against this width and the whole result read as a
 * fraction of it — floor included, with no CSS `min-width` to disagree with
 * it. Everything therefore scales together: the floor is a true 44px here,
 * proportionally smaller on a narrower phone, larger on a desktop, and
 * non-overlapping at every width.
 *
 * At 338px over an 18-hour window this is 18.8px/hour, so the 44px floor
 * flattens every block shorter than about 2h20m. The spec costed the
 * distortion at ~18px/hour, so this is the trade it accepted — but the
 * flattening is bigger in practice than that sentence sounds, and the
 * durations are read from the day summary line, not from the geometry.
 */
export const NOMINAL_TRACK_PX = 338;

/** The shortest block a drag may produce. One snap step. */
export const MIN_BLOCK_MIN = SNAP_MIN;

export interface TrackWindow {
  startMin: number;
  endMin: number;
}

/** The spec's track: 05:00-23:00. Widened by `trackWindow` when a block needs it. */
export const DEFAULT_WINDOW: TrackWindow = {
  startMin: 5 * 60,
  endMin: 23 * 60,
};

/** Energy in the athlete's own words — the accessible name's last clause. */
export const ENERGY_WORD: Record<Energy, string> = {
  easy: "easy",
  normal: "normal",
  full: "full gas",
};

export function toMins(clock: string): number {
  const [h, m] = clock.split(":").map(Number);
  return h * 60 + m;
}

/** Minutes back to "HH:MM", clamped into the day TIME_RE accepts. */
export function toClock(mins: number): string {
  const clamped = Math.max(0, Math.min(LAST_MINUTE_OF_DAY, mins));
  const h = Math.floor(clamped / 60);
  return `${String(h).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
}

function isTimed(b: AvailabilityBlock): boolean {
  return b.start != null && b.end != null;
}

/**
 * ONE window for all seven days (plan decision 1). The spec says each day
 * spans 05:00-23:00; taken literally, a 04:30 block — which `validateBlocks`
 * admits and `BlockSheet` can already create — would be unreachable. This
 * widens outward to whole hours instead, for every day at once, so the seven
 * rows keep a single scale and no block is ever off the track.
 */
export function trackWindow(week: AvailabilityBlock[][]): TrackWindow {
  let { startMin, endMin } = DEFAULT_WINDOW;
  for (const day of week) {
    for (const b of day) {
      if (!isTimed(b)) continue;
      startMin = Math.min(startMin, Math.floor(toMins(b.start!) / 60) * 60);
      // Capped at the last minute a clock can express, NOT rounded freely up
      // to 24:00. `toClock` clamps to 23:59, so a window ceiling of 1440 put
      // the two clamps a minute apart: a block pushed against the right wall
      // was written back one minute shorter every commit, slid off the
      // 15-minute grid, and eventually reached start === end — a value
      // `validateBlocks` rejects, already sitting in the hidden input
      // `IntakeForm` submits. Found by the whole-branch review.
      endMin = Math.min(
        LAST_MINUTE_OF_DAY,
        Math.max(endMin, Math.ceil(toMins(b.end!) / 60) * 60)
      );
    }
  }
  return { startMin, endMin };
}

function spanMin(win: TrackWindow): number {
  return win.endMin - win.startMin;
}

export interface PlacedBlock {
  /** Index into the day's own `blocks` array — NOT the chronological rank. */
  index: number;
  leftPx: number;
  widthPx: number;
  /** True when `widthPx` was floored to MIN_BLOCK_PX. The distortion, reported. */
  widened: boolean;
}

/**
 * Timed blocks as pixel boxes, chronological, guaranteed non-overlapping and
 * guaranteed inside `[0, trackPx]`.
 *
 * Two passes, because the 44px floor can make blocks collide that do not
 * collide in time: a forward sweep pushes each block right of its
 * predecessor, and a backward sweep pulls the tail back inside the track when
 * the forward sweep ran it off the end. Untimed blocks have no position and
 * are omitted — the component lists them under the track instead (decision 2).
 */
export function layoutDay(
  blocks: AvailabilityBlock[],
  trackPx: number,
  win: TrackWindow
): PlacedBlock[] {
  const span = spanMin(win);
  const placed = blocks
    .map((b, index) => ({ b, index }))
    .filter(({ b }) => isTimed(b))
    .sort(({ b: a }, { b }) => toMins(a.start!) - toMins(b.start!))
    .map(({ b, index }) => {
      const trueLeft = ((toMins(b.start!) - win.startMin) / span) * trackPx;
      const trueWidth = (blockMins(b) / span) * trackPx;
      const widthPx = Math.max(trueWidth, MIN_BLOCK_PX);
      return {
        index,
        leftPx: trueLeft,
        widthPx,
        widened: widthPx > trueWidth,
      };
    });

  // A day can be over-subscribed: several short blocks, each floored to
  // MIN_BLOCK_PX, can need more room than the track has. The sweeps below
  // cannot invent space, and the backward pass used to resolve that by
  // clamping to 0 — which stacked pills on top of each other and hid one
  // block's resize handle beneath its neighbour, breaking this function's own
  // "guaranteed non-overlapping" promise. Scaling every width by the same
  // factor keeps the order and the guarantee, and gives up the 44px floor,
  // which is the only thing that CAN be given up here.
  const wanted = placed.reduce((sum, p) => sum + p.widthPx, 0);
  if (wanted > trackPx && wanted > 0) {
    const shrink = trackPx / wanted;
    for (const p of placed) p.widthPx *= shrink;
  }

  let cursor = 0;
  for (const p of placed) {
    p.leftPx = Math.max(p.leftPx, cursor);
    cursor = p.leftPx + p.widthPx;
  }
  let limit = trackPx;
  for (let i = placed.length - 1; i >= 0; i--) {
    const p = placed[i];
    p.leftPx = Math.max(0, Math.min(p.leftPx, limit - p.widthPx));
    limit = p.leftPx;
  }
  return placed;
}

/** A pixel distance along the track, as minutes on the same scale. */
export function pxToMins(
  px: number,
  trackPx: number,
  win: TrackWindow
): number {
  return (px / trackPx) * spanMin(win);
}

function snap(mins: number): number {
  return Math.round(mins / SNAP_MIN) * SNAP_MIN;
}

/**
 * The timed neighbours immediately before and after `index` in clock order —
 * the walls a drag may not cross.
 */
function walls(
  blocks: AvailabilityBlock[],
  index: number,
  win: TrackWindow
): { floor: number; ceil: number } {
  const self = toMins(blocks[index].start!);
  let floor = win.startMin;
  let ceil = win.endMin;
  blocks.forEach((b, i) => {
    if (i === index || !isTimed(b)) return;
    const start = toMins(b.start!);
    const end = toMins(b.end!);
    if (end <= self) floor = Math.max(floor, end);
    else if (start >= self) ceil = Math.min(ceil, start);
  });
  return { floor, ceil };
}

function withTimes(
  b: AvailabilityBlock,
  startMin: number,
  endMin: number
): AvailabilityBlock {
  // `mins` is derived from the CLAMPED clocks, never from the raw arguments.
  // Those two disagreed at the end-of-day wall and `validateBlocks` admits the
  // disagreement, so it would have persisted: `blockMins` prefers the clocks,
  // but `mins` is what a legacy reader sees.
  const start = toClock(startMin);
  const end = toClock(endMin);
  return { ...b, start, end, mins: toMins(end) - toMins(start) };
}

/** Slide a block, keeping its duration, stopping at the window and its neighbours. */
export function moveBlock(
  blocks: AvailabilityBlock[],
  index: number,
  deltaMins: number,
  win: TrackWindow
): AvailabilityBlock[] {
  const b = blocks[index];
  if (!isTimed(b)) return blocks;
  const duration = blockMins(b);
  const { floor, ceil } = walls(blocks, index, win);
  const wanted = snap(toMins(b.start!) + deltaMins);
  // The right wall is floored ONTO the snap grid before it clamps. The window
  // ceiling is 23:59, which is not a multiple of SNAP_MIN, so clamping to it
  // directly parked the block at an off-grid start (22:59 for an hour) and
  // broke the spec's "both in 15-minute steps" contract at exactly the edge
  // where an athlete holds the arrow key down. Costs up to 14 minutes of
  // reach at the very end of the day; BlockSheet still sets those exactly.
  // The LEFT wall is not floored: it is a neighbour's end, and stopping flush
  // against it is more useful than stopping on the grid short of it.
  const lastStart = Math.floor((ceil - duration) / SNAP_MIN) * SNAP_MIN;
  const start = Math.max(floor, Math.min(wanted, lastStart));
  return blocks.map((x, i) => (i === index ? withTimes(x, start, start + duration) : x));
}

/** Drag one edge, keeping the other fixed, never below MIN_BLOCK_MIN. */
export function resizeBlock(
  blocks: AvailabilityBlock[],
  index: number,
  edge: "start" | "end",
  deltaMins: number,
  win: TrackWindow
): AvailabilityBlock[] {
  const b = blocks[index];
  if (!isTimed(b)) return blocks;
  const { floor, ceil } = walls(blocks, index, win);
  let start = toMins(b.start!);
  let end = toMins(b.end!);
  if (edge === "start") {
    start = Math.max(floor, Math.min(snap(start + deltaMins), end - MIN_BLOCK_MIN));
  } else {
    end = Math.min(ceil, Math.max(snap(end + deltaMins), start + MIN_BLOCK_MIN));
  }
  return blocks.map((x, i) => (i === index ? withTimes(x, start, end) : x));
}

/** The default a `+` creates: an evening hour, normal energy, any sport. */
const NEW_BLOCK_START = 18 * 60;
const NEW_BLOCK_MIN = 60;

/**
 * Append an hour in the first gap that can hold one — 18:00 when it is free,
 * otherwise the earliest free hour after an existing block. Null when the day
 * is full, so the caller can disable its `+` rather than commit an overlap.
 */
export function addBlock(
  blocks: AvailabilityBlock[],
  win: TrackWindow
): AvailabilityBlock[] | null {
  const timed = blocks
    .filter(isTimed)
    .sort((a, b) => toMins(a.start!) - toMins(b.start!));
  // Order matters, and 18:00-first is not the only reason. A day that already
  // has a block wants its second one ADJACENT to the first — that is what
  // "another session today" means. The window's own start is the last resort,
  // not the second: dropping a new pill at 05:00 on a day whose only block is
  // at 18:00 hands the athlete a drag across the whole track to undo.
  const candidates = [
    NEW_BLOCK_START,
    ...timed.map((b) => toMins(b.end!)),
    win.startMin,
  ];
  for (const raw of candidates) {
    // Snapped FORWARD, not to the nearest step. `snap()` rounds, so a
    // candidate taken from a neighbour ending at 10:07 became 10:00 — back
    // inside that neighbour — then failed the clash test and was discarded,
    // reporting the day full (and disabling `+`) with a two-hour gap open.
    const start = Math.max(win.startMin, Math.ceil(raw / SNAP_MIN) * SNAP_MIN);
    const end = start + NEW_BLOCK_MIN;
    if (end > win.endMin) continue;
    const clashes = timed.some(
      (b) => toMins(b.start!) < end && start < toMins(b.end!)
    );
    if (clashes) continue;
    return [
      ...blocks,
      { start: toClock(start), end: toClock(end), mins: NEW_BLOCK_MIN, energy: "normal", sports: null },
    ];
  }
  return null;
}

/**
 * The spec's accessible name, verbatim: "Thursday 17:30 to 19:45, full gas".
 * A drag-only control is unusable by a screen reader; this is half of what
 * makes it usable, and the arrow-key handling in the component is the other.
 */
export function describeBlock(dayName: string, b: AvailabilityBlock): string {
  const when = isTimed(b)
    ? `${b.start} to ${b.end}`
    : formatAvailability(blockMins(b));
  return `${dayName} ${when}, ${ENERGY_WORD[b.energy]}`;
}
