import Link from "next/link";
import type { DaySlot } from "@/lib/week-plan/types";
import { STATUS_DOT, STATUS_LABEL } from "@/lib/status-color";
import { WEEKDAY_NAMES, WEEKDAY_NARROW, weekdayIndex } from "@/lib/weekdays";
import {
  dayShape,
  weekMaxMins,
  type DayShape,
} from "@/lib/week-plan/day-shape";

interface Props {
  days: DaySlot[] | null;
  /**
   * The day currently open elsewhere on the page (Train's `?day=`, via
   * openDayFrom). Optional, and independent of `hrefForDay`: Today's week
   * row passes neither, so no day ever gets the open-day pill there.
   *
   * Independent of "today", too (I2 fix, final whole-branch review): this
   * used to collapse onto one `highlightDate` (`selectedDate ?? today`),
   * so on Train — which always passes this — the focus ring meant "open"
   * and never "today", contrary to the spec. `today` is computed from the
   * real calendar date below regardless of what this prop carries; a day
   * can be rung as today, marked open, both, or neither, independently.
   */
  selectedDate?: string | null;
  /**
   * Present only on Train, where each day is a real destination. Absent
   * here means Today's week row: every day renders as a plain, unlinked
   * column rather than an anchor to nowhere — see the ruling in this
   * slice's progress ledger (pre-Task 3).
   */
  hrefForDay?: (date: string) => string;
  /**
   * Which visual language draws each day's mark. Defaults to "dots" — the
   * pre-Task-3 status dot — so a caller that doesn't opt in is unaffected
   * by the bar/notch redesign. Train passes "bars" explicitly; Today does
   * not pass this at all and keeps its dots.
   *
   * Deliberately a SEPARATE prop from `hrefForDay`, not derived from it:
   * a first pass shared one mark renderer between both callers, and
   * Today's week row silently went from 10px dots to 32px bars as a side
   * effect of Train gaining links — an unreviewed visual change to
   * exactly the surface v0.121.0 had to fix a real 152px overflow on.
   * Interactivity and visual mode are different questions; keying one off
   * the other is how a future change to either breaks the other by
   * accident.
   */
  marks?: "dots" | "bars";
}

function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * The same two channels a sighted athlete reads from a bar's height and its
 * notch, folded into one sentence — a bar chart is not itself an accessible
 * name. Race and rest days fall outside that height/notch language
 * entirely, so they get their own short forms instead of "0 minutes".
 *
 * Computed regardless of `marks`: dots mode still needs a real accessible
 * name (see WeekStrip's `role="group"` comment below) — the visual mark is
 * the only thing that varies by mode, not what a screen reader announces.
 */
function accessibleLabel(weekday: string, d: DaySlot, shape: DayShape): string {
  if (d.status === "race") {
    return d.raceName
      ? `${weekday}, race day: ${d.raceName}`
      : `${weekday}, race day`;
  }
  if (shape.rest) {
    return `${weekday}, ${STATUS_LABEL[d.status].toLowerCase()}`;
  }
  const hard = shape.hard ? ", hard session" : "";
  return `${weekday}, ${shape.mins} minutes${hard}, ${STATUS_LABEL[d.status].toLowerCase()}`;
}

/**
 * The pre-Task-3 mark: a small status dot, or the race flag. Byte-for-byte
 * the markup Today's week row has always rendered (`aria-hidden` added only
 * because the wrapping element now carries the real accessible name — see
 * WeekStrip). Kept as its own renderer rather than folded into BarMark: see
 * `marks`'s doc comment on Props for why sharing one broke Today silently.
 */
function DotMark({ day: d, ringed }: { day: DaySlot; ringed: boolean }) {
  if (d.status === "race") {
    return (
      <span
        data-status="race"
        aria-hidden="true"
        className={`flex h-3 w-3 items-center justify-center text-label leading-none ${
          ringed ? "rounded-full ring-2 ring-ink-muted" : ""
        }`}
      >
        🏁
      </span>
    );
  }
  return (
    <span
      data-status={d.status}
      aria-hidden="true"
      className={`h-2.5 w-2.5 rounded-full ${STATUS_DOT[d.status]} ${
        ringed ? "ring-2 ring-ink-muted" : ""
      }`}
    />
  );
}

/** h-8 */
const TRACK_PX = 32;
/** h-1 — the notch */
const NOTCH_PX = 4;
/** gap-0.5, between the notch and the bar */
const GAP_PX = 2;
/**
 * The bar's own pixel budget once the notch and the gap above it are
 * reserved. Sizing the bar as a PERCENTAGE OF THE FULL TRACK (as a first
 * pass did) let the notch + gap silently eat into that percentage instead:
 * flexbox's default shrink then clamped the bar at ~26px for any
 * heightPct above ~81, so the week's longest day (100 by construction)
 * rendered identically to anything within ~19 points of it — exactly
 * where an athlete needs the difference to be readable, and invisible to
 * the suite because jsdom computes no layout. Scaling against the bar's
 * real budget instead keeps [MIN_HEIGHT_PCT, 100] linear across its whole
 * range, and the notch (marked `shrink-0` below) can never compete with
 * it for space again.
 */
const BAR_MAX_PX = TRACK_PX - NOTCH_PX - GAP_PX;

/**
 * The day's mark: a duration bar for a real session, an explicit glyph for
 * a day with none. Colour still comes from STATUS_DOT — this never invents
 * a second colour channel for intensity, it only adds a notch above hard
 * bars and a flat glyph in place of a hairline-thin one. `aria-hidden`
 * throughout: the wrapping link/div already carries the accessible name.
 */
function BarMark({
  day: d,
  shape,
  ringed,
}: {
  day: DaySlot;
  shape: DayShape;
  ringed: boolean;
}) {
  if (d.status === "race") {
    return (
      <span
        data-status="race"
        aria-hidden="true"
        className={`flex h-8 w-3 items-end justify-center text-label leading-none ${
          ringed ? "rounded-full ring-2 ring-ink-muted" : ""
        }`}
      >
        🏁
      </span>
    );
  }
  return (
    <div
      className="flex w-2.5 flex-col items-center justify-end gap-0.5"
      style={{ height: `${TRACK_PX}px` }}
    >
      {/* The notch: a small mark above the bar on a hard day only. Shape
          and position carry the meaning, not a colour — COLOUR IS NOT
          AVAILABLE FOR INTENSITY, STATUS_DOT already owns it. shrink-0
          so it can never be squeezed to make room for a tall bar — see
          BAR_MAX_PX above for why that squeeze was the actual bug. */}
      <span
        aria-hidden="true"
        data-hard={shape.hard ? "" : undefined}
        className={`h-1 w-1 shrink-0 rounded-full ${
          shape.hard ? "bg-ink-primary" : "bg-transparent"
        }`}
      />
      {shape.rest ? (
        // A rest day is not a short bar: a 20-minute recovery spin floors
        // to MIN_HEIGHT_PCT and stays a bar; a day with nothing planned
        // gets this flat glyph instead so the two can never look alike.
        <span
          data-status={d.status}
          aria-hidden="true"
          className={`h-[3px] w-3 shrink-0 rounded-full ${STATUS_DOT[d.status]} ${
            ringed ? "ring-2 ring-ink-muted" : ""
          }`}
        />
      ) : (
        <div
          data-status={d.status}
          className={`w-2.5 shrink-0 rounded-sm ${STATUS_DOT[d.status]} ${
            ringed ? "ring-2 ring-ink-muted" : ""
          }`}
          style={{ height: `${(shape.heightPct / 100) * BAR_MAX_PX}px` }}
        />
      )}
    </div>
  );
}

export function WeekStrip({
  days,
  selectedDate,
  hrefForDay,
  marks = "dots",
}: Props) {
  if (!days || days.length === 0) return null;
  const today = localYmd(new Date());
  const maxMins = weekMaxMins(days);

  return (
    // gap-x-2 is load-bearing since the 12px floor: at 10px the day labels
    // cleared each other under justify-between alone, at 12px they collide
    // into "MOTUWETHFRSASU" whenever the strip is squeezed.
    //
    // min-w-fit is the other half of that: the day columns cannot shrink
    // below their labels, so a container narrower than the strip's
    // min-content used to leave the seven days rendering OUTSIDE this
    // bordered bubble — at 1024px Today's week row squeezed it to a 42px
    // pill with 173px of days spilling across it. Refusing to go below
    // fit-content keeps the border around the days it is drawn for; a
    // container too narrow for that now overflows visibly instead of
    // silently drawing the bubble through its own contents.
    <div className="flex min-w-fit items-center justify-between gap-x-2 rounded-[2rem] border border-hairline bg-surface-raised px-5 py-4">
      {days.map((d, i) => {
        const weekday = WEEKDAY_NAMES[weekdayIndex(d.date)] ?? "";
        const shape = dayShape(d, maxMins);
        const label = accessibleLabel(weekday, d, shape);
        // I2, final whole-branch review: these used to collapse onto one
        // `highlightDate` (selectedDate ?? today), so on Train — which
        // always passes selectedDate — the ring meant "open" and never
        // "today" (the spec: "Today's bar carries the existing focus
        // ring"). Two independent concepts now get two independent marks:
        // `isToday` keeps the pre-existing ring on the mark itself (dot or
        // bar), unaffected by whichever day is open; `isOpen` puts a
        // background pill on the whole column. Neither is a new hue —
        // STATUS_DOT still owns colour in this strip — and both can be
        // true on the same day at once (the open day IS today), which is
        // the case the third I2 test below pins.
        const isToday = d.date === today;
        const isOpen = selectedDate != null && d.date === selectedDate;

        const content = (
          <>
            <span className="text-label font-bold uppercase text-ink-muted">
              {WEEKDAY_NARROW[i] ?? ""}
            </span>
            {marks === "bars" ? (
              <BarMark day={d} shape={shape} ringed={isToday} />
            ) : (
              <DotMark day={d} ringed={isToday} />
            )}
          </>
        );

        // The open day's own mark: a filled pill behind the whole column,
        // legible alongside today's ring (a ring drawn inside a filled
        // pill) rather than competing with it for the same visual slot.
        const columnClassName = `flex flex-col items-center gap-2 rounded-2xl px-1.5 py-1 ${
          isOpen ? "bg-surface-overlay" : ""
        }`;

        return hrefForDay ? (
          // next/link, not a raw anchor tag: a raw anchor here does a full
          // document reload on every tap (I1) — this repo already fixed
          // the identical bug on "Set next week's availability" (see
          // page.tsx's comment on that Link) so a client-side transition
          // survives the switcher instance and every open Collapsible
          // instead of resetting them.
          <Link
            key={d.date}
            data-date={d.date}
            data-open={isOpen ? "true" : undefined}
            href={hrefForDay(d.date)}
            title={label}
            aria-label={label}
            aria-current={isOpen ? "true" : undefined}
            className={columnClassName}
          >
            {content}
          </Link>
        ) : (
          // role="group" is load-bearing, not decorative: a bare <div>'s
          // implicit role is "generic", and WAI-ARIA 1.2 PROHIBITS an
          // accessible name on "generic" — conformant tools drop
          // aria-label entirely and most screen readers ignore it too.
          // Without this, Today's week row (the only caller that reaches
          // this branch) had no accessible name for any of its seven days.
          <div
            key={d.date}
            data-date={d.date}
            role="group"
            title={label}
            aria-label={label}
            className={columnClassName}
          >
            {content}
          </div>
        );
      })}
    </div>
  );
}
