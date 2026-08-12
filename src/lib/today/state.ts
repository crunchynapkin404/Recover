/**
 * Which moment Today leads with (v0.99 slice 1).
 *
 * Same route, same blocks, same numbers — only the order changes. The
 * blocks a state does not lead with still render below it, so no state can
 * make anything unreachable.
 */
export type TodayState = "morning" | "post-session" | "evening";

/** Local hour from which the day is closing rather than starting. */
export const EVENING_HOUR = 18;

/**
 * How long after a session ends Today keeps leading with it. Elapsed time,
 * deliberately not "landed today" — a calendar-day test puts a cliff at
 * midnight, where a ride that ended twenty minutes ago would stop being the
 * thing the athlete opened the app to see.
 */
export const POST_SESSION_WINDOW_MS = 4 * 60 * 60 * 1000;

export interface TodayStateInput {
  /** Now, in the athlete's local timezone (the container's TZ). */
  now: Date;
  /**
   * When the most recent session ENDED, or null when none is recent. End,
   * not start: a three-hour ride starting at 15:00 has only just finished
   * at 18:00, and a window measured from the start would already be half
   * spent before the athlete got off the bike.
   */
  lastSessionEndedAt: Date | null;
  /** Whether the athlete has self-reported today. See hasDayLog below. */
  hasDayLog: boolean;
}

export function resolveTodayState({
  now,
  lastSessionEndedAt,
  hasDayLog,
}: TodayStateInput): TodayState {
  // Both halves are load-bearing. The hour alone would make post-session
  // unreachable for anyone who trains after work; the log alone says
  // nothing about where in the day the athlete is.
  if (now.getHours() >= EVENING_HOUR && hasDayLog) return "evening";

  if (lastSessionEndedAt != null) {
    const elapsed = now.getTime() - lastSessionEndedAt.getTime();
    // elapsed >= 0 rejects a future-dated session: clock skew or a
    // mis-stored timestamp must not make a ride that has not happened
    // read as one that just landed.
    if (elapsed >= 0 && elapsed <= POST_SESSION_WINDOW_MS)
      return "post-session";
  }

  // The default is the state Today was in before this slice, so any missing
  // or unreadable input degrades to the behaviour that already shipped.
  return "morning";
}

/** The self-reported columns of a `wellness_daily` row. */
export interface DayLogFields {
  energy1_10: number | null;
  soreness1_10: number | null;
  stress1_10: number | null;
  notes: string | null;
  tags: string[] | null;
}

/**
 * Whether the athlete actually logged the day.
 *
 * NOT "a wellness row exists". The intervals.icu wellness endpoint emits a
 * row for every calendar day back to account creation, most of them empty,
 * so row existence is evidence of nothing. Only a field the athlete could
 * have typed counts — and a zero counts, because 0 stress is an answer.
 */
export function hasDayLog(row: DayLogFields | null | undefined): boolean {
  if (!row) return false;
  return (
    row.energy1_10 != null ||
    row.soreness1_10 != null ||
    row.stress1_10 != null ||
    (row.notes != null && row.notes.trim() !== "") ||
    (row.tags != null && row.tags.length > 0)
  );
}

const STATES: readonly TodayState[] = ["morning", "post-session", "evening"];

/**
 * `?state=` override, for screenshots and local design work.
 *
 * Hard-gated to non-production: the capture script has to be able to reach
 * all three states on demand, and a real athlete must never be able to
 * reorder their own Today by typing a query string. Reordering is all it
 * can do — no data is faked, so a state with nothing to lead on simply
 * shows an honestly empty lead.
 */
export function previewStateFrom(param: string | undefined): TodayState | null {
  if (process.env.NODE_ENV === "production") return null;
  if (param == null) return null;
  return STATES.includes(param as TodayState) ? (param as TodayState) : null;
}
