# Availability drag-timeline (slice 3) — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the availability sheet's seven-rows-and-a-modal form with a
week of drag-editable time tracks, so the single most-used write path in the
app is direct manipulation instead of a modal per day.

**Architecture:** All geometry and all mutation math live in one pure module
(`src/lib/availability/timeline.ts`) with no React and no DOM — that is where
the snapping, the 44 px floor, the neighbour clamping and the accessible names
are decided and tested. A single client component renders seven tracks over
that module and owns only input handling (pointer, keyboard, selection).
`IntakeForm` keeps its form, its hidden `blocks-${i}` inputs, its resync guard,
its verdict line, its `Pinned ×` badges and its `PinnedAction`; only its `<ul>`
day list is replaced. `BlockSheet` stays, reachable from the selected block, as
the precise and assistive path.

**Tech Stack:** Next.js App Router, React 19, Tailwind v4 token classes,
Vitest (node for the pure module, jsdom + `createRoot` + `act` for components,
no testing-library).

**Spec:** `docs/specs/2026-08-27-week-surface-redesign-design.md`, section
"The availability sheet (T)".

**Prior context:** `docs/2026-08-28-v0123-handoff.md` — read its "Traps this
codebase will spring on you" before task 3.

**What is NOT in this slice.** The spec's "The Sunday reminder" subsection is
**already built and shipped in v0.123.0** — `shouldPromptNextWeekAvailability`
and `promptNextWeekAvailability` in `src/lib/week-plan/availability-prompt.ts`,
behind migration 0045's `week_plans.next_week_prompted_at`, deep-linking to
`/train?availability=next`. Do not re-implement it. The `This week · Next week`
tenses the spec asks for are likewise already live in
`AvailabilityWeekSwitcher`. This slice is the timeline and nothing else.

## Global Constraints

- **The model does not change.** `AvailabilityBlock` stays
  `{ start, end, mins, energy, sports }`. Days keep holding more than one
  block. Every edit still commits through `validateBlocks`
  (`src/lib/availability/types.ts`) — it remains the authority on commit even
  though the drag prevents overlap up front.
- **`MAX_SESSIONS_PER_DAY` is 2**, but nothing in this UI may assume it. The
  layout must be total for any number of blocks.
- **No new colour tokens.** Existing token classes only. `--surface-raised`
  and `--surface-overlay` are BOTH `#ffffff` in light, and
  `--surface-selected` EQUALS `--surface-base` in both themes. `IntakeForm`'s
  own card is already `bg-surface-selected`, so nothing inside it may claim
  that token as a fill.
- **Colour means status in the day strip, always** (`STATUS_DOT`,
  `src/lib/status-color.ts`). This timeline paints no status and must not
  import `STATUS_DOT`; see decision 3 for what it paints instead.
- **`BlockSheet` is `position: fixed` and nests inside this sheet.**
  `BottomSheet` omits its idle transform for exactly that reason. Nothing in
  this slice may add a `transform` — not even a zero one — to any ancestor of
  the timeline, or `BlockSheet` collapses to a 132 px sliver.
- **If the keyboard path is not done, the feature is not done.** Every block
  is focusable, has an accessible name, and is adjustable by arrow keys.
- **Tests are Vitest.** Pure module: node env, no pragma. Components: first
  line `// @vitest-environment jsdom`, rendered with `renderToString` for
  static assertions or `createRoot` + `act` for interaction, matching
  `src/components/week/block-sheet.test.tsx`. No testing-library.
- **Every test watched failing first**, and mutation-checked where its failure
  would otherwise be silent. A guard test on a silent-data-loss path passed
  1-in-5 last session because it asserted synchronously against code that
  fired inside `setTimeout(fn, 0)` — run any such test five times, not once.
- **Commit as soon as you are green.** Seven implementers died mid-task on
  account limits last session; one left a `{false ? (` mutation applied in the
  working tree. If you apply a mutation, restore it before doing anything else.
- **This branch's signature defect is "correct in isolation, wrong in
  composition."** Thirteen such defects were found across slices 1 and 2, each
  having passed its own task review. Before finishing any task, ask what
  *other* surface consumes what you touched.

## Five decisions taken as plan author

Recorded because they resolve silences in the spec, or deviate from it.

1. **One track window for the whole week, not a fixed 05:00–23:00 per day.**
   The spec says each day is a track spanning 05:00–23:00. Taken literally, a
   block starting at 04:30 — which `validateBlocks` admits, and which the
   existing `BlockSheet` can already create — either vanishes or is clipped.
   Instead `trackWindow()` computes ONE window for all seven days: 05:00–23:00
   by default, widened outward to whole hours to contain every timed block in
   the week. The scale stays identical across the seven rows, which is the
   whole point of stacking them, and nothing is ever unreachable. Dragging
   clamps to that same window.
2. **Legacy untimed blocks are listed below the track, not placed on it.** A
   block with `start === null` (the pre-block model, still admitted by
   `validateBlocks`) has no position. Inventing one would fabricate data the
   athlete never entered. It renders as a chip under its day's track carrying
   `formatBlock`'s duration-only string, and tapping it opens `BlockSheet`,
   which already knows how to convert it to a clock range.
3. **Energy is fill DENSITY plus the day strip's notch, not three hues.** The
   spec asks for "Fill = energy … the same two-channel grammar as the day
   strip". The day strip's two channels are colour (status) and shape (a notch
   for a hard day), and its comment is explicit that colour is not available
   for intensity. This timeline paints no status, so it uses one hue — the
   app's `--accent` — at three densities, plus the strip's own notch glyph on
   `full` alone. Two channels, one vocabulary, no new token, and energy is
   never carried by colour alone.
4. **The pill's label is `text-ink-primary` at every density, and the
   densities are capped so that holds.** Measured in task 2, not asserted:
   `/20`, `/40`, `/60` clear 4.5:1 against `--ink-primary` over
   `--surface-selected` in both themes; an opaque `bg-accent` does not, in
   either. Note this is a hole the repo's guards do not cover —
   `contrast-guard.test.ts` gives `--accent` the "text" role and checks it as
   ink on surfaces, never as a fill under ink — so task 2 adds the check
   rather than relying on a green suite.
5. **The track is full-bleed and the weekday label sits ABOVE it, because the
   spec's own cost arithmetic only holds at the full content width.** The spec
   costs the distortion at ~18 px/hour, which assumes the track spans a 390 px
   phone. Nested normally it would not: the sheet's `px-6` and `IntakeForm`'s
   `p-7` leave 286 px of row, and a weekday label beside the track takes ~40 px
   more — 246 px for eighteen hours, or 13.7 px/hour, at which the 44 px floor
   swallows every block shorter than **3h 13m**. Almost every training block is
   1–2 h, so the timeline would render them all at one width and show nothing.
   Two changes buy the spec's own number back: `IntakeForm`'s padding drops
   `p-7` → `p-4`, and the timeline cancels that padding with `-mx-4` and puts
   the weekday label on its own line above the track. The track is then 342 px
   — **19 px/hour**, the spec's figure — and the floor swallows blocks under
   **2h 19m**, which is the distortion the spec actually accepted. That number
   is still large and is stated, not hidden: below ~2h 20m the pills are
   equal-width and the duration is read from the label, not the geometry.

## File structure

| File | Responsibility |
| --- | --- |
| `src/lib/availability/timeline.ts` (new) | All geometry and mutation math. Pure: no React, no DOM, no clock reads. |
| `src/lib/availability/timeline.test.ts` (new) | Node-env tests for the above. |
| `src/lib/availability/energy-fill.ts` (new) | `ENERGY_FILL` — the measured density scale, as Tailwind class strings. |
| `tests/energy-fill-contrast.test.ts` (new) | Proves each density clears AA under `--ink-primary`, both themes. |
| `src/components/week/availability-timeline.tsx` (new) | Seven tracks. Owns selection, pointer drag, keyboard. |
| `src/components/week/availability-timeline.test.tsx` (new) | Static render + keyboard + drag. |
| `src/components/week/block-sheet.tsx` (modify) | Imports `toMins`/`toClock` from `timeline.ts` instead of defining them. |
| `src/components/week/intake-form.tsx` (modify) | `<ul>` day list → `<AvailabilityTimeline>`. Everything else unchanged. |

---

### Task 1: The pure timeline module

**Files:**
- Create: `src/lib/availability/timeline.ts`
- Create: `src/lib/availability/timeline.test.ts`
- Modify: `src/components/week/block-sheet.tsx:36-52` (delete the local
  `toMins`/`toClock`/`LAST_MINUTE_OF_DAY`, import them instead)

**Interfaces:**
- Consumes: `AvailabilityBlock`, `Energy` from `@/lib/availability/types`.
- Produces, all from `@/lib/availability/timeline`:
  - `LAST_MINUTE_OF_DAY: number`, `SNAP_MIN: number`, `MIN_BLOCK_PX: number`,
    `MIN_BLOCK_MIN: number`, `NOMINAL_TRACK_PX: number`,
    `DEFAULT_WINDOW: TrackWindow`
  - `ENERGY_WORD: Record<Energy, string>`
  - `toMins(clock: string): number`, `toClock(mins: number): string`
  - `interface TrackWindow { startMin: number; endMin: number }`
  - `trackWindow(week: AvailabilityBlock[][]): TrackWindow`
  - `interface PlacedBlock { index: number; leftPx: number; widthPx: number; widened: boolean }`
  - `layoutDay(blocks: AvailabilityBlock[], trackPx: number, win: TrackWindow): PlacedBlock[]`
  - `pxToMins(px: number, trackPx: number, win: TrackWindow): number`
  - `moveBlock(blocks, index, deltaMins, win): AvailabilityBlock[]`
  - `resizeBlock(blocks, index, edge: "start" | "end", deltaMins, win): AvailabilityBlock[]`
  - `addBlock(blocks, win): AvailabilityBlock[] | null`
  - `describeBlock(dayName: string, b: AvailabilityBlock): string`

- [ ] **Step 1: Write the failing test**

Create `src/lib/availability/timeline.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_WINDOW,
  MIN_BLOCK_PX,
  NOMINAL_TRACK_PX,
  addBlock,
  describeBlock,
  layoutDay,
  moveBlock,
  pxToMins,
  resizeBlock,
  toClock,
  toMins,
  trackWindow,
} from "./timeline";
import type { AvailabilityBlock } from "./types";

const block = (
  start: string,
  end: string,
  energy: AvailabilityBlock["energy"] = "normal"
): AvailabilityBlock => ({
  start,
  end,
  mins: toMins(end) - toMins(start),
  energy,
  sports: null,
});

describe("toMins / toClock", () => {
  it("round-trips a clock time", () => {
    expect(toClock(toMins("18:45"))).toBe("18:45");
  });

  it("clamps to the end of the day, never past it", () => {
    expect(toClock(25 * 60)).toBe("23:59");
    expect(toClock(-30)).toBe("00:00");
  });
});

describe("trackWindow", () => {
  it("is 05:00-23:00 for an ordinary week", () => {
    const week = [[block("18:00", "19:30")], [], [], [], [], [], []];
    expect(trackWindow(week)).toEqual(DEFAULT_WINDOW);
  });

  it("is 05:00-23:00 for an empty week", () => {
    expect(trackWindow([[], [], [], [], [], [], []])).toEqual(DEFAULT_WINDOW);
  });

  // Decision 1: a block outside the default window widens it for EVERY day,
  // so the seven rows keep one scale and nothing is clipped away.
  it("widens down to a whole hour to contain an early block", () => {
    const week = [[block("04:30", "05:30")], [], [], [], [], [], []];
    expect(trackWindow(week).startMin).toBe(4 * 60);
    expect(trackWindow(week).endMin).toBe(23 * 60);
  });

  it("widens up to a whole hour to contain a late block", () => {
    const week = [[], [], [], [], [], [], [block("22:00", "23:30")]];
    expect(trackWindow(week).endMin).toBe(24 * 60);
  });

  it("ignores untimed legacy blocks", () => {
    const legacy: AvailabilityBlock = {
      start: null,
      end: null,
      mins: 60,
      energy: "normal",
      sports: null,
    };
    expect(trackWindow([[legacy], [], [], [], [], [], []])).toEqual(
      DEFAULT_WINDOW
    );
  });
});

describe("layoutDay", () => {
  const trackPx = NOMINAL_TRACK_PX;

  it("places a block proportionally when it is wide enough", () => {
    // 18:00-21:00 in a 05:00-23:00 window: 13/18 of the way along, 3/18 wide.
    // 3h is 57px here, clear of the 44px floor.
    const [p] = layoutDay([block("18:00", "21:00")], trackPx, DEFAULT_WINDOW);
    expect(p.leftPx).toBeCloseTo((13 / 18) * trackPx, 5);
    expect(p.widthPx).toBeCloseTo((3 / 18) * trackPx, 5);
    expect(p.widened).toBe(false);
  });

  // The spec's first named cost, made explicit: a one-hour block is 19px on
  // a phone and nobody can grab it. Everything under 2h19m is floored — see
  // the plan's decision 5 for why that number is what it is.
  it("floors a short block to the minimum touch width and says so", () => {
    const [p] = layoutDay([block("18:00", "19:00")], trackPx, DEFAULT_WINDOW);
    expect(p.widthPx).toBe(MIN_BLOCK_PX);
    expect(p.widened).toBe(true);
  });

  it("pushes a widened block's neighbour right rather than overlapping it", () => {
    const day = [block("18:00", "19:00"), block("19:15", "20:15")];
    const [a, b] = layoutDay(day, trackPx, DEFAULT_WINDOW);
    expect(b.leftPx).toBeGreaterThanOrEqual(a.leftPx + a.widthPx);
  });

  it("keeps every block inside the track, even when they cannot all fit proportionally", () => {
    const day = [block("22:00", "22:30"), block("22:30", "23:00")];
    const placed = layoutDay(day, trackPx, DEFAULT_WINDOW);
    for (const p of placed) {
      expect(p.leftPx).toBeGreaterThanOrEqual(0);
      expect(p.leftPx + p.widthPx).toBeLessThanOrEqual(trackPx + 0.001);
    }
  });

  it("reports the index of the block it placed, in chronological order", () => {
    const day = [block("20:00", "21:00"), block("07:00", "08:00")];
    expect(layoutDay(day, trackPx, DEFAULT_WINDOW).map((p) => p.index)).toEqual([
      1, 0,
    ]);
  });

  it("skips untimed blocks entirely", () => {
    const day: AvailabilityBlock[] = [
      { start: null, end: null, mins: 60, energy: "normal", sports: null },
    ];
    expect(layoutDay(day, trackPx, DEFAULT_WINDOW)).toEqual([]);
  });
});

describe("pxToMins", () => {
  it("converts a pixel delta to minutes on the same scale", () => {
    expect(pxToMins(246, 246, DEFAULT_WINDOW)).toBe(18 * 60);
    expect(pxToMins(123, 246, DEFAULT_WINDOW)).toBe(9 * 60);
  });
});

describe("moveBlock", () => {
  it("snaps the new start to a quarter hour", () => {
    const day = [block("18:00", "19:00")];
    const next = moveBlock(day, 0, 20, DEFAULT_WINDOW);
    expect(next[0].start).toBe("18:15");
    expect(next[0].end).toBe("19:15");
  });

  it("preserves the block's duration", () => {
    const day = [block("18:00", "19:30")];
    const next = moveBlock(day, 0, 60, DEFAULT_WINDOW);
    expect(next[0].mins).toBe(90);
  });

  it("stops at the start of the window instead of leaving it", () => {
    const day = [block("05:30", "06:30")];
    const next = moveBlock(day, 0, -120, DEFAULT_WINDOW);
    expect(next[0].start).toBe("05:00");
    expect(next[0].end).toBe("06:00");
  });

  it("stops at the end of the window instead of leaving it", () => {
    const day = [block("21:30", "22:30")];
    const next = moveBlock(day, 0, 240, DEFAULT_WINDOW);
    expect(next[0].end).toBe("23:00");
  });

  // The spec: "Overlap is prevented by the drag rather than rejected
  // afterwards." validateBlocks still gets the last word on commit.
  it("stops against the next block rather than overlapping it", () => {
    const day = [block("18:00", "19:00"), block("20:00", "21:00")];
    const next = moveBlock(day, 0, 180, DEFAULT_WINDOW);
    expect(next[0].end).toBe("20:00");
    expect(next[0].start).toBe("19:00");
  });

  it("stops against the previous block rather than overlapping it", () => {
    const day = [block("18:00", "19:00"), block("20:00", "21:00")];
    const next = moveBlock(day, 1, -180, DEFAULT_WINDOW);
    expect(next[1].start).toBe("19:00");
  });

  it("leaves an untimed block alone", () => {
    const day: AvailabilityBlock[] = [
      { start: null, end: null, mins: 60, energy: "normal", sports: null },
    ];
    expect(moveBlock(day, 0, 60, DEFAULT_WINDOW)).toEqual(day);
  });
});

describe("resizeBlock", () => {
  it("moves the end edge and recomputes mins", () => {
    const day = [block("18:00", "19:00")];
    const next = resizeBlock(day, 0, "end", 30, DEFAULT_WINDOW);
    expect(next[0].end).toBe("19:30");
    expect(next[0].mins).toBe(90);
  });

  it("moves the start edge and recomputes mins", () => {
    const day = [block("18:00", "19:00")];
    const next = resizeBlock(day, 0, "start", -30, DEFAULT_WINDOW);
    expect(next[0].start).toBe("17:30");
    expect(next[0].mins).toBe(90);
  });

  it("never shrinks below one snap step", () => {
    const day = [block("18:00", "19:00")];
    const next = resizeBlock(day, 0, "end", -120, DEFAULT_WINDOW);
    expect(next[0].start).toBe("18:00");
    expect(next[0].end).toBe("18:15");
  });

  it("stops the end edge against the next block", () => {
    const day = [block("18:00", "19:00"), block("20:00", "21:00")];
    const next = resizeBlock(day, 0, "end", 180, DEFAULT_WINDOW);
    expect(next[0].end).toBe("20:00");
  });

  it("stops the start edge at the window", () => {
    const day = [block("05:15", "06:15")];
    const next = resizeBlock(day, 0, "start", -120, DEFAULT_WINDOW);
    expect(next[0].start).toBe("05:00");
  });
});

describe("addBlock", () => {
  it("puts the first block of a day at 18:00 for an hour", () => {
    const next = addBlock([], DEFAULT_WINDOW);
    expect(next).not.toBeNull();
    expect(next![0].start).toBe("18:00");
    expect(next![0].end).toBe("19:00");
    expect(next![0].energy).toBe("normal");
    expect(next![0].sports).toBeNull();
  });

  it("finds a free hour after an existing block rather than overlapping it", () => {
    const next = addBlock([block("18:00", "19:00")], DEFAULT_WINDOW);
    expect(next).not.toBeNull();
    expect(next![1].start).toBe("19:00");
    expect(next![1].end).toBe("20:00");
  });

  it("returns null when the day has no free hour left", () => {
    expect(addBlock([block("05:00", "23:00")], DEFAULT_WINDOW)).toBeNull();
  });
});

describe("describeBlock", () => {
  // The exact string the spec names as the accessible name.
  it("reads as the spec's example", () => {
    expect(describeBlock("Thursday", block("17:30", "19:45", "full"))).toBe(
      "Thursday 17:30 to 19:45, full gas"
    );
  });

  it("names easy and normal in the athlete's own words", () => {
    expect(describeBlock("Monday", block("06:00", "07:00", "easy"))).toBe(
      "Monday 06:00 to 07:00, easy"
    );
    expect(describeBlock("Monday", block("06:00", "07:00", "normal"))).toBe(
      "Monday 06:00 to 07:00, normal"
    );
  });

  it("falls back to a duration for an untimed block", () => {
    expect(
      describeBlock("Monday", {
        start: null,
        end: null,
        mins: 90,
        energy: "normal",
        sports: null,
      })
    ).toBe("Monday 1h 30m, normal");
  });
});
```

- [ ] **Step 2: Run the test to watch it fail**

```bash
npx vitest run src/lib/availability/timeline.test.ts
```

Expected: FAIL — `Failed to resolve import "./timeline"`.

- [ ] **Step 3: Write the module**

Create `src/lib/availability/timeline.ts`:

```ts
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
 * The track's assumed width, in px, at the reference viewport (390px phone,
 * inside the availability sheet, full-bleed — see the plan's decision 5).
 *
 * WHY A NOMINAL WIDTH AND NOT A MEASURED ONE. The pills are positioned in
 * PERCENT so the layout survives any container width with no resize observer
 * and no SSR/hydration mismatch. But MIN_BLOCK_PX is a real pixel floor, and
 * a floor cannot be applied in percent without knowing what 100% is worth.
 * So the layout is computed once against this nominal width and the result
 * read as a fraction of it; CSS `min-width: 44px` on the pill is the hard
 * backstop that keeps the floor true at every OTHER width. The consequence,
 * stated: on a container much wider than this the overlap sweep is slightly
 * conservative, never wrong — it can leave a gap, never an overlap.
 *
 * At 342px over an 18-hour window this is 19px/hour, which is the figure the
 * spec costed the distortion at.
 */
export const NOMINAL_TRACK_PX = 342;

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
      endMin = Math.max(endMin, Math.ceil(toMins(b.end!) / 60) * 60);
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
  return {
    ...b,
    start: toClock(startMin),
    end: toClock(endMin),
    mins: endMin - startMin,
  };
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
  const start = Math.max(floor, Math.min(wanted, ceil - duration));
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
  const candidates = [
    NEW_BLOCK_START,
    win.startMin,
    ...timed.map((b) => toMins(b.end!)),
  ];
  for (const raw of candidates) {
    const start = Math.max(win.startMin, snap(raw));
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
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/lib/availability/timeline.test.ts
```

Expected: PASS, 30 tests.

- [ ] **Step 5: Point `BlockSheet` at the shared clock helpers**

In `src/components/week/block-sheet.tsx`, delete the local
`LAST_MINUTE_OF_DAY`, `toMins` and `toClock` definitions and import them:

```ts
import { toClock, toMins } from "@/lib/availability/timeline";
```

Leave `minutesBetween` where it is — it has one caller and no other home yet.
Semantics are identical: `toClock` still clamps to the end of the DAY, not to
the track, which is what `patch()` needs.

- [ ] **Step 6: Run the block-sheet suite to prove nothing moved**

```bash
npx vitest run src/components/week/block-sheet.test.tsx
```

Expected: PASS, unchanged count.

- [ ] **Step 7: Commit**

```bash
git add src/lib/availability/timeline.ts src/lib/availability/timeline.test.ts src/components/week/block-sheet.tsx
git commit -m "feat(availability): pure geometry and mutation core for the drag-timeline"
```

---

### Task 2: The measured energy fill scale

**Files:**
- Create: `src/lib/availability/energy-fill.ts`
- Create: `tests/energy-fill-contrast.test.ts`

**Interfaces:**
- Consumes: `Energy` from `@/lib/availability/types`.
- Produces: `ENERGY_FILL: Record<Energy, string>` — the Tailwind fill class for
  a pill at that energy — and `ENERGY_ALPHA: Record<Energy, number>`, the same
  scale as numbers so the contrast test can compute against it.

**Why this is its own task.** `tests/contrast-guard.test.ts` gives `--accent`
the role "text" (`roleOfToken`, `src/lib/design/tokens.ts`) and checks it as
ink ON surfaces. Nothing in the repo checks it as a FILL UNDER ink, which is
exactly what a pill is. An opaque `bg-accent` under `text-ink-primary`
measures ~3.3:1 in light and ~2.0:1 in dark — a real defect a green suite
would not have reported.

- [ ] **Step 1: Write the failing test**

Create `tests/energy-fill-contrast.test.ts`:

```ts
// The hole tests/contrast-guard.test.ts structurally cannot cover, for the
// one place this branch opens it: --accent as a FILL with text on top.
//
// roleOfToken() classifies `accent` as "text", so the sibling guard measures
// it as ink against every surface and never as a ground under ink. The
// availability timeline paints pills in three densities of accent and writes
// the block's duration inside them, so the composited fill is a real text
// background — and an opaque bg-accent fails AA under --ink-primary in BOTH
// themes (~3.3:1 light, ~2.0:1 dark). That is why the scale is capped.
import { describe, expect, it } from "vitest";
import { ENERGY_ALPHA } from "../src/lib/availability/energy-fill";
import { compositeOver } from "../src/lib/design/color-literals";
import { contrastRatio, hexToRgb } from "../src/lib/design/contrast";
import { resolvedThemeTokens, type ThemeName } from "../src/lib/design/tokens";
import { ENERGY_CEILING } from "../src/lib/availability/types";

const THEMES: ThemeName[] = ["light", "dark"];
const AA_TEXT = 4.5;

/**
 * The ground the pills actually sit on: IntakeForm's own card is
 * `bg-surface-selected`, inside the availability sheet's overlay panel.
 */
const GROUND = "surface-selected";

describe("energy fill scale", () => {
  const tokens = resolvedThemeTokens();

  it("covers exactly the energies the model admits", () => {
    expect(Object.keys(ENERGY_ALPHA).sort()).toEqual(
      Object.keys(ENERGY_CEILING).sort()
    );
  });

  it("is a strictly increasing density, so energy is legible as weight", () => {
    expect(ENERGY_ALPHA.easy).toBeLessThan(ENERGY_ALPHA.normal);
    expect(ENERGY_ALPHA.normal).toBeLessThan(ENERGY_ALPHA.full);
  });

  for (const theme of THEMES) {
    for (const [energy, alpha] of Object.entries(ENERGY_ALPHA)) {
      it(`clears AA for --ink-primary on ${energy} in ${theme}`, () => {
        const [r, g, b] = hexToRgb(tokens[theme].accent);
        const fill = compositeOver([r, g, b, alpha], tokens[theme][GROUND]);
        expect(contrastRatio(tokens[theme]["ink-primary"], fill)).toBeGreaterThanOrEqual(
          AA_TEXT
        );
      });
    }
  }

  // The reason the scale is capped rather than running to a solid accent —
  // pinned so a later "make full gas bolder" edit fails here instead of on a
  // phone. If this test ever passes, --accent has changed and the cap can be
  // revisited.
  it("records that an opaque accent fill would fail, in both themes", () => {
    for (const theme of THEMES) {
      const [r, g, b] = hexToRgb(tokens[theme].accent);
      const fill = compositeOver([r, g, b, 1], tokens[theme][GROUND]);
      expect(contrastRatio(tokens[theme]["ink-primary"], fill)).toBeLessThan(
        AA_TEXT
      );
    }
  });
});
```

- [ ] **Step 2: Run the test to watch it fail**

```bash
npx vitest run tests/energy-fill-contrast.test.ts
```

Expected: FAIL — `Failed to resolve import "../src/lib/availability/energy-fill"`.

- [ ] **Step 3: Write the module**

Create `src/lib/availability/energy-fill.ts`:

```ts
// Energy as fill DENSITY, one hue (plan decision 3).
//
// The spec asks for "Fill = energy … the same two-channel grammar as the day
// strip". The day strip's channels are colour (status, via STATUS_DOT) and
// shape (a notch on a hard day), and its own comment is explicit that colour
// is not available for intensity. This timeline paints no status, so it takes
// the same two channels with one hue: three densities of --accent, plus the
// strip's notch glyph on `full` alone. Energy is therefore never carried by
// colour alone, which is what makes it survive a colour-blind reading.
//
// THE DENSITIES ARE CAPPED, NOT CHOSEN BY EYE. Text sits inside these pills,
// so each composited fill must clear AA under --ink-primary in both themes.
// A solid bg-accent does not (~3.3:1 light, ~2.0:1 dark) — see
// tests/energy-fill-contrast.test.ts, which measures every value here and
// pins that failure so this cap cannot be quietly lifted.
import type { Energy } from "./types";

/** The scale as numbers, for the contrast test to compute against. */
export const ENERGY_ALPHA: Record<Energy, number> = {
  easy: 0.2,
  normal: 0.4,
  full: 0.6,
};

/**
 * The same scale as Tailwind classes. Written out as literals, never
 * assembled from ENERGY_ALPHA at runtime: Tailwind v4 only compiles classes
 * that appear as literal strings in source (see tests/type-scale-guard.test.ts
 * for the same argument), so a computed `bg-accent/${n}` would produce no CSS.
 */
export const ENERGY_FILL: Record<Energy, string> = {
  easy: "bg-accent/20",
  normal: "bg-accent/40",
  full: "bg-accent/60",
};
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/energy-fill-contrast.test.ts
```

Expected: PASS, 11 tests.

- [ ] **Step 5: Mutation-check the cap**

Temporarily set `full: 1` in `ENERGY_ALPHA`, re-run, and confirm the dark and
light `full` cases FAIL. **Restore the file immediately** — a mutation left in
the working tree cost the last session a whole debugging pass.

```bash
npx vitest run tests/energy-fill-contrast.test.ts   # expect 2 failures
git diff --stat src/lib/availability/energy-fill.ts # expect: no diff after restoring
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/availability/energy-fill.ts tests/energy-fill-contrast.test.ts
git commit -m "feat(availability): measured energy fill scale, capped at AA"
```

---

### Task 3: The timeline component, static render

**Files:**
- Create: `src/components/week/availability-timeline.tsx`
- Create: `src/components/week/availability-timeline.test.tsx`

**Interfaces:**
- Consumes: everything Task 1 and Task 2 produce; `WEEKDAY_NAMES`,
  `WEEKDAY_SHORT` from `@/lib/weekdays`; `formatBlocks`, `formatAvailability`
  from `@/lib/availability/format`.
- Produces:

```ts
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
export function AvailabilityTimeline(props: AvailabilityTimelineProps): JSX.Element;
```

This task renders and is reachable by keyboard focus; arrow keys and drag land
in tasks 4 and 5.

- [ ] **Step 1: Write the failing test**

Create `src/components/week/availability-timeline.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { AvailabilityTimeline } from "./availability-timeline";
import type { AvailabilityBlock } from "@/lib/availability/types";
import { toMins } from "@/lib/availability/timeline";

const block = (
  start: string,
  end: string,
  energy: AvailabilityBlock["energy"] = "normal"
): AvailabilityBlock => ({
  start,
  end,
  mins: toMins(end) - toMins(start),
  energy,
  sports: null,
});

const emptyWeek = (): AvailabilityBlock[][] =>
  Array.from({ length: 7 }, () => []);

function render(week: AvailabilityBlock[][], pinned = Array(7).fill(false)) {
  return renderToString(
    <AvailabilityTimeline
      week={week}
      pinned={pinned}
      onChangeDay={vi.fn()}
      onUnpin={vi.fn()}
      onOpenDay={vi.fn()}
    />
  );
}

describe("AvailabilityTimeline", () => {
  it("renders one track per weekday, Monday first", () => {
    const html = render(emptyWeek());
    for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) {
      expect(html).toContain(`>${day}<`);
    }
    expect(html.match(/data-track=/g)).toHaveLength(7);
  });

  // The spec's second named cost. A drag-only control is unusable by a screen
  // reader, so every block is a real button carrying the spec's own name.
  it("gives every block a focusable button with the spec's accessible name", () => {
    const week = emptyWeek();
    week[3] = [block("17:30", "19:45", "full")];
    const html = render(week);
    expect(html).toContain('aria-label="Thursday 17:30 to 19:45, full gas"');
    expect(html).toMatch(/<button[^>]*data-block="3:0"/);
  });

  it("paints energy as the measured density, not an invented hue", () => {
    const week = emptyWeek();
    week[0] = [block("06:00", "07:00", "easy")];
    week[1] = [block("06:00", "07:00", "normal")];
    week[2] = [block("06:00", "07:00", "full")];
    const html = render(week);
    expect(html).toContain("bg-accent/20");
    expect(html).toContain("bg-accent/40");
    expect(html).toContain("bg-accent/60");
  });

  // Decision 3's second channel: full gas is not told apart by density alone.
  it("marks full gas with the day strip's notch, and nothing below it", () => {
    const full = emptyWeek();
    full[0] = [block("06:00", "07:00", "full")];
    expect(render(full)).toContain('data-notch=""');
    const normal = emptyWeek();
    normal[0] = [block("06:00", "07:00", "normal")];
    expect(render(normal)).not.toContain("data-notch");
  });

  it("positions a pill by percentage of the track, not by pixels", () => {
    const week = emptyWeek();
    week[0] = [block("18:00", "21:00")];
    const html = render(week);
    // 05:00-23:00, so 18:00 is 13/18 along and the block is 3/18 wide.
    expect(html).toMatch(/left:\s*72\.2/);
    expect(html).toMatch(/width:\s*16\.6/);
  });

  it("says a day is rest when it has no blocks", () => {
    expect(render(emptyWeek())).toContain("Rest");
  });

  it("keeps the Pinned badge and its unpin affordance", () => {
    const pinned = Array(7).fill(false);
    pinned[2] = true;
    const html = render(emptyWeek(), pinned);
    expect(html).toContain("Pinned");
    expect(html).toContain('aria-label="Wednesday: back to your standard week"');
  });

  it("offers a plus per day that reaches the precise editor", () => {
    const html = render(emptyWeek());
    expect(html).toContain('aria-label="Add a block on Monday"');
    expect(html).toContain('aria-label="Edit Monday precisely"');
  });

  // Decision 2: an untimed legacy block has no position and must not be
  // given an invented one, but it must not vanish either.
  it("lists an untimed legacy block under its track rather than placing it", () => {
    const week = emptyWeek();
    week[0] = [
      { start: null, end: null, mins: 90, energy: "normal", sports: null },
    ];
    const html = render(week);
    expect(html).toContain("1h 30m");
    expect(html).toContain('data-untimed="0:0"');
    expect(html).not.toMatch(/data-block="0:0"/);
  });

  // The plan's global constraint: BlockSheet is position:fixed and nests
  // inside this sheet, so ANY transform on an ancestor collapses it.
  it("puts no transform on any ancestor of a nested dialog", () => {
    const week = emptyWeek();
    week[0] = [block("18:00", "19:00")];
    const html = render(week);
    // Both spellings: an inline `transform:` declaration and any Tailwind
    // utility that compiles to one. A lucide icon's own path data can contain
    // the word, so this checks the two shapes that actually create a
    // containing block, not the substring.
    expect(html).not.toMatch(/transform\s*:/);
    expect(html).not.toMatch(/class="[^"]*\b(translate|scale|rotate|skew)-/);
  });
});
```

- [ ] **Step 2: Run the test to watch it fail**

```bash
npx vitest run src/components/week/availability-timeline.test.tsx
```

Expected: FAIL — `Failed to resolve import "./availability-timeline"`.

- [ ] **Step 3: Write the component**

Create `src/components/week/availability-timeline.tsx`:

```tsx
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
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/components/week/availability-timeline.test.tsx
```

Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/week/availability-timeline.tsx src/components/week/availability-timeline.test.tsx
git commit -m "feat(availability): timeline tracks, pills and the energy notch"
```

---

### Task 4: The keyboard path

**Files:**
- Modify: `src/components/week/availability-timeline.tsx` (add `onKeyDown` to
  the pill button)
- Modify: `src/components/week/availability-timeline.test.tsx` (append a
  `describe` block)

**Interfaces:**
- Consumes: `moveBlock`, `resizeBlock` from Task 1.
- Produces: no new exports. Behaviour only.

**If the keyboard path is not done, the feature is not done.** This task is
that clause. The spec: arrows move the start, shift+arrows resize, both in
15-minute steps.

- [ ] **Step 1: Write the failing test**

Append to `src/components/week/availability-timeline.test.tsx`:

```tsx
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach } from "vitest";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

/** Mounts the timeline and returns the last `onChangeDay` call's arguments. */
function mount(week: AvailabilityBlock[][]) {
  const calls: [number, AvailabilityBlock[]][] = [];
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(
      <AvailabilityTimeline
        week={week}
        pinned={Array(7).fill(false)}
        onChangeDay={(d, next) => calls.push([d, next])}
        onUnpin={vi.fn()}
        onOpenDay={vi.fn()}
      />
    );
  });
  return {
    calls,
    press(id: string, key: string, shiftKey = false) {
      const el = host!.querySelector<HTMLElement>(`[data-block="${id}"]`);
      if (!el) throw new Error(`no block ${id}`);
      act(() => {
        el.dispatchEvent(
          new KeyboardEvent("keydown", { key, shiftKey, bubbles: true })
        );
      });
    },
  };
}

describe("AvailabilityTimeline keyboard path", () => {
  it("moves the start a quarter hour on ArrowRight", () => {
    const week = emptyWeek();
    week[0] = [block("18:00", "19:00")];
    const t = mount(week);
    t.press("0:0", "ArrowRight");
    expect(t.calls.at(-1)).toEqual([
      0,
      [expect.objectContaining({ start: "18:15", end: "19:15" })],
    ]);
  });

  it("moves the start back a quarter hour on ArrowLeft", () => {
    const week = emptyWeek();
    week[0] = [block("18:00", "19:00")];
    const t = mount(week);
    t.press("0:0", "ArrowLeft");
    expect(t.calls.at(-1)).toEqual([
      0,
      [expect.objectContaining({ start: "17:45", end: "18:45" })],
    ]);
  });

  it("resizes the end on shift+ArrowRight, keeping the start", () => {
    const week = emptyWeek();
    week[0] = [block("18:00", "19:00")];
    const t = mount(week);
    t.press("0:0", "ArrowRight", true);
    expect(t.calls.at(-1)).toEqual([
      0,
      [expect.objectContaining({ start: "18:00", end: "19:15", mins: 75 })],
    ]);
  });

  it("shrinks on shift+ArrowLeft but never below a quarter hour", () => {
    const week = emptyWeek();
    week[0] = [block("18:00", "18:15")];
    const t = mount(week);
    t.press("0:0", "ArrowLeft", true);
    expect(t.calls.at(-1)).toEqual([
      0,
      [expect.objectContaining({ start: "18:00", end: "18:15" })],
    ]);
  });

  it("opens the precise editor on Enter", () => {
    const week = emptyWeek();
    week[0] = [block("18:00", "19:00")];
    const opened: number[] = [];
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root!.render(
        <AvailabilityTimeline
          week={week}
          pinned={Array(7).fill(false)}
          onChangeDay={vi.fn()}
          onUnpin={vi.fn()}
          onOpenDay={(d) => opened.push(d)}
        />
      );
    });
    const el = host.querySelector<HTMLElement>('[data-block="0:0"]')!;
    act(() => {
      el.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
      );
    });
    expect(opened).toEqual([0]);
  });

  it("leaves other keys to the browser", () => {
    const week = emptyWeek();
    week[0] = [block("18:00", "19:00")];
    const t = mount(week);
    t.press("0:0", "Tab");
    t.press("0:0", "a");
    expect(t.calls).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to watch it fail**

```bash
npx vitest run src/components/week/availability-timeline.test.tsx
```

Expected: FAIL — the six new tests, `t.calls` empty.

- [ ] **Step 3: Add the handler**

In `availability-timeline.tsx`, import the two mutators:

```ts
import { moveBlock, resizeBlock } from "@/lib/availability/timeline";
```

and add `onKeyDown` to the pill `<button>`, immediately after its `onClick`:

```tsx
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
```

Add `SNAP_MIN` to the existing import from `@/lib/availability/timeline`.

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/components/week/availability-timeline.test.tsx
```

Expected: PASS, 16 tests.

- [ ] **Step 5: Mutation-check, five times**

Change `dir * SNAP_MIN` to `dir * 1` and confirm the suite fails. Restore.
Then run the file five times to prove the assertions are not racing a
`setTimeout` the way last session's guard did:

```bash
for i in 1 2 3 4 5; do npx vitest run src/components/week/availability-timeline.test.tsx || echo "FLAKE on run $i"; done
git diff --stat src/components/week/availability-timeline.tsx  # expect: no diff
```

- [ ] **Step 6: Commit**

```bash
git add src/components/week/availability-timeline.tsx src/components/week/availability-timeline.test.tsx
git commit -m "feat(availability): arrow-key move and resize on the timeline"
```

---

### Task 5: The pointer drag

**Files:**
- Modify: `src/components/week/availability-timeline.tsx`
- Modify: `src/components/week/availability-timeline.test.tsx`

**Interfaces:**
- Consumes: `pxToMins`, `moveBlock`, `resizeBlock` from Task 1.
- Produces: no new exports. Behaviour only.

Pointer Events, not touch or mouse: one code path covers finger, stylus and
mouse, and `setPointerCapture` keeps the gesture alive when the finger leaves
the pill — which it will, since a 44px pill is smaller than a fingertip.

- [ ] **Step 1: Write the failing test**

Append to `src/components/week/availability-timeline.test.tsx`:

```tsx
describe("AvailabilityTimeline pointer drag", () => {
  /** jsdom gives every element a zero rect; the drag math needs a real width. */
  const realRect = HTMLElement.prototype.getBoundingClientRect;
  function stubTrackWidth(px: number) {
    Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
      configurable: true,
      value() {
        return { width: px, height: 36, top: 0, left: 0, right: px, bottom: 36, x: 0, y: 0, toJSON: () => ({}) };
      },
    });
  }
  // Restored, because this patches a PROTOTYPE: left in place it would hand a
  // fake 180px rect to every test that runs after this describe block, in
  // this file and — if the ordering ever changes — before the ones that
  // assert against real zero-width jsdom layout.
  afterEach(() => {
    Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
      configurable: true,
      value: realRect,
    });
  });

  function drag(el: HTMLElement, fromX: number, toX: number) {
    (el as HTMLElement & { setPointerCapture?: (id: number) => void }).setPointerCapture =
      () => {};
    (el as HTMLElement & { releasePointerCapture?: (id: number) => void }).releasePointerCapture =
      () => {};
    act(() => {
      el.dispatchEvent(
        new PointerEvent("pointerdown", { clientX: fromX, pointerId: 1, bubbles: true })
      );
    });
    act(() => {
      el.dispatchEvent(
        new PointerEvent("pointermove", { clientX: toX, pointerId: 1, bubbles: true })
      );
    });
    act(() => {
      el.dispatchEvent(
        new PointerEvent("pointerup", { clientX: toX, pointerId: 1, bubbles: true })
      );
    });
  }

  it("moves a block by the dragged distance, snapped", () => {
    stubTrackWidth(180); // 18h over 180px — 10px an hour, so 30px is 3h.
    const week = emptyWeek();
    week[0] = [block("10:00", "11:00")];
    const t = mount(week);
    drag(host!.querySelector<HTMLElement>('[data-block="0:0"]')!, 0, 30);
    expect(t.calls.at(-1)).toEqual([
      0,
      [expect.objectContaining({ start: "13:00", end: "14:00" })],
    ]);
  });

  it("resizes from the end handle instead of moving", () => {
    stubTrackWidth(180);
    const week = emptyWeek();
    week[0] = [block("10:00", "11:00")];
    const t = mount(week);
    act(() => {
      host!
        .querySelector<HTMLElement>('[data-block="0:0"]')!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    drag(host!.querySelector<HTMLElement>('[data-handle="0:0:end"]')!, 0, 10);
    expect(t.calls.at(-1)).toEqual([
      0,
      [expect.objectContaining({ start: "10:00", end: "12:00", mins: 120 })],
    ]);
  });

  // The spec: handles appear only on the selected block, and OUTSIDE the
  // pill's visual bounds so the touch target is not the pill's own width.
  it("shows resize handles only on the selected block", () => {
    stubTrackWidth(180);
    const week = emptyWeek();
    week[0] = [block("10:00", "11:00")];
    mount(week);
    expect(host!.querySelector('[data-handle="0:0:end"]')).toBeNull();
    act(() => {
      host!
        .querySelector<HTMLElement>('[data-block="0:0"]')!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host!.querySelector('[data-handle="0:0:end"]')).not.toBeNull();
    expect(host!.querySelector('[data-handle="0:0:start"]')).not.toBeNull();
  });

  it("commits nothing when the pointer never moved", () => {
    stubTrackWidth(180);
    const week = emptyWeek();
    week[0] = [block("10:00", "11:00")];
    const t = mount(week);
    drag(host!.querySelector<HTMLElement>('[data-block="0:0"]')!, 40, 40);
    expect(t.calls).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to watch it fail**

```bash
npx vitest run src/components/week/availability-timeline.test.tsx
```

Expected: FAIL — no `data-handle` elements, no `onChangeDay` calls.

- [ ] **Step 3: Add the drag**

At module scope, beside `idOf`:

```tsx
/**
 * The track's real width right now, for turning a pixel drag into minutes.
 * Read from the element at gesture start rather than measured on every
 * render: this is the ONE place a real width is needed, and reading it here
 * costs one layout per drag instead of a resize observer for the page's life.
 */
function trackPxOf(el: HTMLElement | null): number {
  return el?.getBoundingClientRect().width || 0;
}
```

In `DayTrack`, above the returned JSX:

```tsx
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
   * A resize handle's pointer props. `stopPropagation` is load-bearing, not
   * hygiene: the handles render INSIDE the pill button — they must, to be
   * positioned against it — so without it a pointerdown on a handle bubbles
   * to the button, whose own onPointerDown overwrites the gesture with
   * `edge: null` and turns a resize into a move.
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
    };
  }
```

Add `pxToMins` to the timeline import and `useRef` to the React import
(`import { useRef, useState } from "react"`). Wire the three handlers onto the
pill `<button>`:

```tsx
              onPointerDown={(e) => onPointerDown(e, p.index, null)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
```

and render the two handles inside the pill, after the label span, gated on
selection:

```tsx
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
```

The pill needs `touch-none` added to its class list so a horizontal drag is
not stolen by the sheet's own scroll.

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/components/week/availability-timeline.test.tsx
```

Expected: PASS, 20 tests.

- [ ] **Step 5: Mutation-check the no-op guard, five times**

Delete the `JSON.stringify(next) === JSON.stringify(d.committed)` early return
and confirm "commits nothing when the pointer never moved" fails. Restore, then:

```bash
for i in 1 2 3 4 5; do npx vitest run src/components/week/availability-timeline.test.tsx || echo "FLAKE on run $i"; done
git diff --stat src/components/week/availability-timeline.tsx  # expect: no diff
```

- [ ] **Step 6: Commit**

```bash
git add src/components/week/availability-timeline.tsx src/components/week/availability-timeline.test.tsx
git commit -m "feat(availability): pointer drag to move and resize blocks"
```

---

### Task 6: Wire the timeline into `IntakeForm`

**Files:**
- Modify: `src/components/week/intake-form.tsx` — replace the `<ul>` day list
  (and only that) with `<AvailabilityTimeline>`
- Modify: `src/components/week/intake-form.test.tsx` — update the day-list
  assertions
- Test: `tests/intake-form-resync.test.tsx` must pass UNCHANGED

**Interfaces:**
- Consumes: `AvailabilityTimeline` from Task 3–5.
- Produces: no new exports.

**What must NOT change.** The `<form>`, the hidden `blocks-${i}` inputs, the
`serverWeek`/`syncedWeek` resync, `verdictLine`, `PinnedAction`, the
`clearDayOverride` path, and `BlockSheet`'s mounting. `tests/intake-form-resync.test.tsx`
pins a real silent-data-loss bug (I7) and must pass without edits — if you
find yourself changing it, you have changed the submitted value, which is the
defect it exists to catch.

- [ ] **Step 1: Write the failing test**

Append to `src/components/week/intake-form.test.tsx`, inside the existing
`describe("IntakeForm")`:

```tsx
  it("renders the week as tracks, not as a list of rows", () => {
    const html = renderToString(
      <IntakeForm
        resolved={resolved}
        dates={dates}
        overrideDates={[]}
        verdict={{ kind: "building" } as never}
        sports={["Ride"]}
        action={noop}
      />
    );
    expect(html.match(/data-track=/g)).toHaveLength(7);
    expect(html).toContain('aria-label="Wednesday 18:00 to 19:30, normal"');
  });

  it("still submits every day through its hidden input", () => {
    const html = renderToString(
      <IntakeForm
        resolved={resolved}
        dates={dates}
        overrideDates={[]}
        verdict={{ kind: "building" } as never}
        sports={["Ride"]}
        action={noop}
      />
    );
    for (let i = 0; i < 7; i++) {
      expect(html).toContain(`name="blocks-${i}"`);
    }
  });
```

Add a `dates` fixture alongside the existing `resolved` one if the file does
not already have one:

```tsx
const dates = [
  "2026-08-24",
  "2026-08-25",
  "2026-08-26",
  "2026-08-27",
  "2026-08-28",
  "2026-08-29",
  "2026-08-30",
];
```

- [ ] **Step 2: Run the test to watch it fail**

```bash
npx vitest run src/components/week/intake-form.test.tsx
```

Expected: FAIL — no `data-track` in the output.

- [ ] **Step 3: Swap the list for the timeline**

In `intake-form.tsx`, import the component:

```ts
import { AvailabilityTimeline } from "./availability-timeline";
```

Replace the whole `<ul className="mb-3"> … </ul>` block with:

```tsx
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
```

Change the form's own padding from `p-7` to `p-4`. The timeline cancels that
`p-4` with its own `-mx-4 px-4`, so the track spans the sheet's full content
width — 342px, the 19px/hour the spec costed. Decision 5 has the arithmetic
and why anything narrower makes the surface useless rather than merely tight.

- [ ] **Step 4: Run both suites to verify**

```bash
npx vitest run src/components/week/intake-form.test.tsx tests/intake-form-resync.test.tsx
```

Expected: PASS both, and `intake-form-resync.test.tsx` with NO edits to it.

- [ ] **Step 5: Run the whole component and availability surface**

```bash
npx vitest run src/components/week src/components/train src/lib/availability tests/submit-availability-week.test.ts tests/sync-overrides-week.test.ts
```

Expected: PASS. `submit-availability-week.test.ts` and
`sync-overrides-week.test.ts` are the server side of this write path and must
be untouched by a view change — if either moves, the hidden inputs changed
shape and the swap is wrong.

- [ ] **Step 6: Commit**

```bash
git add src/components/week/intake-form.tsx src/components/week/intake-form.test.tsx
git commit -m "feat(availability): the sheet's day list becomes the drag-timeline"
```

---

### Task 7: The whole-branch pass

**Files:**
- Modify: `docs/2026-08-26-flow-inventory.md` — a fourth dated section
- Modify: `docs/ROADMAP.md` — flow-and-friction 3 of 3

**No per-task review can see what this task looks for.** Thirteen defects
across slices 1 and 2 lived at seams between tasks, each having passed its own
review. Point this pass at the seams: what else renders `IntakeForm`, what
else imports what you touched, and what the surface looks like at a breakpoint
jsdom cannot have.

- [ ] **Step 1: The full suite, with a database**

```bash
set -a; . ./.env; set +a
DATABASE_URL="$DATABASE_URL" DATABASE_DRIVER=pg npx vitest run
```

Expected: 3204+ passed, 1 expected fail, 1 skipped. 587 tests skip without the
database, so a run that skips them proves less than it looks like.

- [ ] **Step 2: Read every other consumer of what you touched**

```bash
grep -rn "IntakeForm\|BlockSheet\|toClock\|toMins" src/ --include=*.tsx --include=*.ts | grep -v test
```

For each hit that is not a file this plan lists: open it and ask whether this
change alters what it renders. `AvailabilityWeekSwitcher` mounts TWO
`IntakeForm`s at once, both always mounted with `hidden` — the timeline now
renders fourteen tracks in the DOM, and the hidden one must stay out of the
tab order and the accessibility tree.

- [ ] **Step 3: The app, at a real breakpoint**

```bash
BETTER_AUTH_URL=http://localhost:3210 npm run dev -- --port 3210
npx tsx scripts/seed-confirmed-race.ts   # seed FIRST — see the flow inventory
SCREENSHOT_BASE_URL=http://localhost:3210 npx tsx scripts/verify-surfaces.ts slice3 --only=train
```

Open the artifact. Check, by looking: the seven tracks share one scale; a
one-hour block is grabbable; the selected block's handles sit outside it; the
pill label is legible at every energy in BOTH themes; `BlockSheet` still opens
full-height over the sheet rather than as a sliver.

- [ ] **Step 4: The axe ratchet stays at 0**

The gate is on by default. **Do not raise the ceiling.** Its failure message
tells you to open the artifact first; doing that named the rule, element and
surface in one read last session. A drag surface's likely findings are
`aria-required-children` on the track and `nested-interactive` on the handles
inside the pill button — the handles are `aria-hidden` with `tabIndex={-1}`
for exactly that reason, so a hit there means the markup drifted.

- [ ] **Step 5: Re-measure and record**

Re-run the measurement documented in `docs/2026-08-26-flow-inventory.md` under
"Choice load, measured" — visible/enabled controls split appChrome / tabs /
surface, with `appChrome` always 5 as its own self-check. Add a fourth dated
section for slice 3 beside the original, slice 1 and slice 2. Record the real
number even if it is worse; the surface's honesty about the 1.84-vs-1.2 gap is
the reason that document is worth reading.

- [ ] **Step 6: Commit and open the PR**

```bash
git add docs/2026-08-26-flow-inventory.md docs/ROADMAP.md
git commit -m "docs: slice 3 measured, flow-and-friction complete"
```

---

## Self-review against the spec

Run before handing this to an executor; recorded here so the executor can see
what was checked.

**Spec coverage.** Track 05:00–23:00 → task 1 `DEFAULT_WINDOW` (widened per
decision 1). Position/width/fill → tasks 1 and 3. Drag body to move, ends to
resize → task 5. Snap to 15 → task 1 `SNAP_MIN`. Tap selects and reveals
handles outside the pill → task 5. `+` adds a second block → tasks 1
`addBlock` and 3. Overlap prevented by the drag → task 1 `walls`. Sport chips
where the plan gives a choice → unchanged, still `BlockSheet`'s rule, reached
via "Edit precisely". This/Next tenses, `Pinned` badge, `clearDayOverride`
per day → already live in `AvailabilityWeekSwitcher`/`IntakeForm`, preserved
by task 6. Standard week not a tense here → unchanged. 44 px minimum with the
distortion commented → task 1 `MIN_BLOCK_PX`. Focusable blocks with the
spec's accessible name and arrow-key adjustment → tasks 1 `describeBlock` and
4. `BlockSheet` kept as the precise path → task 3's "Edit precisely" and task
4's Enter. The Sunday reminder → **already shipped in v0.123.0**, see the
header.

**Gap, stated rather than hidden.** The spec's "Fill = energy" is delivered as
density, not hue (decision 3), and the pill's in-fill label is a duration
rather than the full clock range — at the 44 px floor there is no room for
"18:00–19:30", and the full range is in the accessible name and in
`BlockSheet`. Both are deviations an executor should not silently "fix".
