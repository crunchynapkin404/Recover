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
   * row passes neither, so no day is ever marked current there and the
   * "today" ring below falls back to the real calendar date instead.
   */
  selectedDate?: string | null;
  /**
   * Present only on Train, where each day is a real destination. Absent
   * here means Today's week row: every day renders as a plain, unlinked
   * column rather than an anchor to nowhere — see the ruling in this
   * slice's progress ledger (pre-Task 3).
   */
  hrefForDay?: (date: string) => string;
}

function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * The same two channels a sighted athlete reads from a bar's height and its
 * notch, folded into one sentence — a bar chart is not itself an accessible
 * name. Race and rest days fall outside that height/notch language
 * entirely, so they get their own short forms instead of "0 minutes".
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
 * The day's mark: a duration bar for a real session, an explicit glyph for
 * a day with none. Colour still comes from STATUS_DOT — this never invents
 * a second colour channel for intensity, it only adds a notch above hard
 * bars and a flat glyph in place of a hairline-thin one. `aria-hidden`
 * throughout: the wrapping link/div already carries the accessible name.
 */
function DayMark({
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
    <div className="flex h-8 w-2.5 flex-col items-center justify-end gap-0.5">
      {/* The notch: a small mark above the bar on a hard day only. Shape
          and position carry the meaning, not a colour — COLOUR IS NOT
          AVAILABLE FOR INTENSITY, STATUS_DOT already owns it. */}
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
          className={`h-[3px] w-3 rounded-full ${STATUS_DOT[d.status]} ${
            ringed ? "ring-2 ring-ink-muted" : ""
          }`}
        />
      ) : (
        <div
          data-status={d.status}
          className={`w-2.5 rounded-sm ${STATUS_DOT[d.status]} ${
            ringed ? "ring-2 ring-ink-muted" : ""
          }`}
          style={{ height: `${shape.heightPct}%` }}
        />
      )}
    </div>
  );
}

export function WeekStrip({ days, selectedDate, hrefForDay }: Props) {
  if (!days || days.length === 0) return null;
  const today = localYmd(new Date());
  // Falls back to the real calendar date when nothing is explicitly
  // selected, which is exactly Today's case: it never passes selectedDate,
  // so this keeps ringing whichever day is actually today, as before.
  const highlightDate = selectedDate ?? today;
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
        const ringed = d.date === highlightDate;
        const isSelected = selectedDate != null && d.date === selectedDate;

        const content = (
          <>
            <span className="text-label font-bold uppercase text-ink-muted">
              {WEEKDAY_NARROW[i] ?? ""}
            </span>
            <DayMark day={d} shape={shape} ringed={ringed} />
          </>
        );

        return hrefForDay ? (
          <a
            key={d.date}
            href={hrefForDay(d.date)}
            title={label}
            aria-label={label}
            aria-current={isSelected ? "true" : undefined}
            className="flex flex-col items-center gap-2"
          >
            {content}
          </a>
        ) : (
          <div
            key={d.date}
            title={label}
            aria-label={label}
            className="flex flex-col items-center gap-2"
          >
            {content}
          </div>
        );
      })}
    </div>
  );
}
