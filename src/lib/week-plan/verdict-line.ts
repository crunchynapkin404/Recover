import type { DaySlot } from "./types";
import type { Band } from "@/lib/readiness";
import type { Purpose } from "@/lib/availability/types";
import { WEEKDAY_NAMES, weekdayIndex } from "@/lib/weekdays";

/**
 * The verdict headline above Week's readiness chip — the one sentence that
 * turns "54 · amber" into something an athlete reads without translating it
 * themselves.
 *
 * This is generated prose about the athlete's state, which this codebase
 * treats as the most dangerous kind of copy it carries: every branch below
 * says only what the engine can support, never more. In particular:
 *
 * - `band === "calibrating"` means readiness could not be computed at all
 *   (see readiness.ts's own comment). The sentence then describes the
 *   SESSION only — never the athlete's body, never a stand-in claim like
 *   "you're ready for it" dressed down.
 * - `amber` and `red` are stated as plain facts, not encouragement. Neither
 *   pretends the athlete is "ready" — that phrase is reserved for green.
 * - AN EMPTY DAY (`workouts.length === 0`, not a race) IS NOT ONE STORY.
 *   `types.ts`'s own `restIntent` doc explains why `status: "rest"` cannot
 *   be trusted alone: `materializeWeek` starts every day there before
 *   placing anything, and both the drop rung and `moveWorkout`
 *   (service.ts) stamp a day back to `"rest"` when its last session
 *   leaves — none of those are the plan asking for rest. Three different
 *   claims, three different sentences (see `sessionBase`):
 *     - `status === "missed"`: a planned session did not happen. Says
 *       exactly that — never "rest" (the athlete didn't choose this) and
 *       never "nothing happened" (Recover tracks `unplannedLoad`
 *       precisely because a missed plan and an idle day are not the same
 *       fact).
 *     - `restIntent != null`: the ONLY marker for a day the engine
 *       deliberately left empty (`types.ts:44-64`). Only this earns
 *       "that's the plan".
 *     - everything else empty (dropped, moved off, or simply never
 *       filled): the weaker, true statement — nothing is planned, with no
 *       claim that this was a choice.
 * - A race day is likewise never mistaken for a rest day: materializeWeek
 *   always clears `workouts` on a race day (see materialize.ts), so
 *   `workouts.length === 0` alone cannot tell "nothing planned" apart from
 *   "the plan is a race today" — `status` is what tells them apart. Checked
 *   FIRST in `sessionBase`, ahead of the workouts check, so that is a
 *   structural guarantee rather than an accident this file happens to rely
 *   on staying true.
 * - THE READINESS CLAUSE IS A CLAIM ABOUT THE ATHLETE'S BODY RIGHT NOW, so
 *   it only ever attaches when the open day (Task 4's `?day=`, which is
 *   usually NOT today — that's the whole point of the day strip) IS today,
 *   AND the figure being quoted is itself today's. `readiness`/`band` are
 *   read off `readinessMetric` (page.tsx), which falls back up to 7 days
 *   looking for a non-null readiness — the same staleness gap
 *   today-hero.tsx's own `staleLabel` exists to cover, which Week's chip has
 *   no marker for. Off-today, or on a stale figure, the sentence describes
 *   only the session — the same shape the calibrating case already used,
 *   extended to a second reason a claim isn't safe to make.
 * - TENSE IS DERIVED FROM THE DATE, NOT THE STATUS (I3 fix, final
 *   whole-branch review). A past day is described in the past tense
 *   ("Monday was your long one") whether or not the daily adaptation has
 *   gotten around to stamping it: `adapt-day.ts`'s `handleMissedYesterday`
 *   only ever looks at yesterday, so a day three days gone can still carry
 *   `status: "planned"` forever, and a past RACE day keeps `status: "race"`
 *   forever too — nothing ever re-stamps a race day after the fact. Both
 *   read in the past tense off the date, not off a status that was never
 *   going to change. A `missed` day needs no separate tense flag: "was
 *   missed" is already the only tense a session that didn't happen can
 *   honestly take.
 *
 * Deliberately does NOT call `dayShape` (day-shape.ts): that function's
 * `rest` flag is just `workouts.length === 0` restated, and its `hard` flag
 * conflates threshold+vo2max into one boolean with no session identity left
 * to name — neither is a fit for prose that has to say WHICH session this
 * is. This reads `openDay.workouts` directly instead, the same source
 * `dayShape` itself reads from.
 */

/**
 * One session's name in prose, keyed by the engine's own taxonomy
 * (`purpose`) rather than the display string `type` — day-shape.ts's own
 * HARD_PURPOSES comment is the precedent: match the taxonomy the engine
 * reasons in, not a human-readable label that is free to reword.
 */
const SESSION_PHRASE: Record<Purpose, string> = {
  long: "your long one",
  threshold: "a threshold session",
  vo2max: "an interval session",
  recovery: "an easy one",
  aerobic_base: "an endurance session",
  brick: "a brick",
  strength: "a strength session",
};

/**
 * Plain-language translation of a band, for the days it is safe to state at
 * all (never on an empty day, never off-today, never on a stale figure —
 * see the module comment). `calibrating` has no entry: the caller checks
 * for it before reaching this map, because there is no honest phrase for a
 * score that was never computed.
 *
 * `green` is the one phrase this task's spec pins verbatim
 * ("you're ready for it"). `amber`/`red` deliberately do not borrow that
 * construction — Today's hero (today-hero.tsx's BAND_WORD) already
 * translates amber/red to "Moderate"/"Low" elsewhere in this app; these
 * mirror that plain word rather than inventing new, more enthusiastic
 * vocabulary the engine's own confidence does not support.
 */
const READINESS_CLAIM: Record<"green" | "amber" | "red", string> = {
  green: "you're ready for it",
  amber: "readiness is moderate today",
  red: "readiness is low today",
};

/**
 * The sentence's subject and session description — no readiness claim
 * lives here at all (see `readinessClaim` for that).
 *
 * `isToday` only changes the DELIBERATE-REST branch's subject word.
 * `isPast` only changes the RACE and SESSION branches' verb (was/is,
 * had/has) — neither ever changes which branch fires.
 */
function sessionBase(
  weekday: string,
  day: DaySlot,
  isToday: boolean,
  isPast: boolean
): string {
  // Checked first, not merely because a race day happens to carry no
  // workouts today (see the module comment) — status is the authority.
  //
  // Tensed off `isPast` like the workouts branch below: a race day's
  // status is always "race", never "completed", so a past race would
  // otherwise read in the present tense forever (I3 fix).
  if (day.status === "race") {
    return `${weekday} ${isPast ? "was" : "is"} race day`;
  }
  if (day.workouts.length > 0) {
    if (day.workouts.length === 1) {
      const phrase = SESSION_PHRASE[day.workouts[0].purpose] ?? "a session";
      return `${weekday} ${isPast ? "was" : "is"} ${phrase}`;
    }
    // M3 fix: "Thursday is 2 sessions" reads as an equation, not a
    // schedule. A count of sessions takes "has"/"had", not "is"/"was".
    return `${weekday} ${isPast ? "had" : "has"} ${day.workouts.length} sessions`;
  }
  // Empty. WHICH kind of empty is the whole question — see the module
  // comment's `restIntent` section.
  //
  // A planned session that did not happen — adapt-day.ts's
  // handleMissedYesterday empties `workouts` in the same stamp that sets
  // this status, so there is no session left to name, only the fact that
  // one was missed. Already the only tense this can honestly take: a
  // missed day cannot be "still ahead".
  if (day.status === "missed") {
    return `${weekday}'s planned session was missed`;
  }
  // The ONLY marker for a day the engine deliberately left empty
  // (types.ts:44-64) — `status: "rest"` alone cannot mean this, since
  // materializeWeek starts every day there and the drop/move rungs
  // (service.ts) both restamp a day "rest" when its last session leaves,
  // none of which is the plan choosing rest.
  if (day.restIntent != null) {
    return isToday
      ? "Nothing planned today — that's the plan"
      : `${weekday} is a rest day — that's the plan`;
  }
  // Everything else empty: dropped, moved off, or simply never filled.
  // The weaker, true statement — nothing is planned, with no claim that
  // this was a choice.
  return isToday ? "Nothing planned today" : `Nothing planned for ${weekday}`;
}

/**
 * `null` whenever there is no claim it is safe to make:
 *
 * - `!isCurrent` (the open day isn't today, or today's figure isn't in
 *   yet) — checked first and unconditionally, because a claim about a
 *   different day's body is not a claim this module can back at all,
 *   regardless of what the band says.
 * - `band === "calibrating"` — its own switch arm, deliberately not folded
 *   into the `readiness == null` check below it: `calibrating` and a null
 *   figure coincide on every real row (readiness.ts's computeReadiness
 *   never produces one without the other), so a single merged guard would
 *   make this arm's own correctness unobservable — a mutation that made
 *   `"calibrating"` fall through to a confident sentence would still pass
 *   every test, caught for the wrong reason by the null guard. Kept
 *   separate so each has its own test.
 * - a band claiming confidence with no number behind it (`readiness ==
 *   null` on green/amber/red) — not a state computeReadiness itself ever
 *   produces, but not one this module should trust blindly either.
 */
function readinessClaim(
  band: Band,
  readiness: number | null,
  isCurrent: boolean
): string | null {
  if (!isCurrent) return null;
  switch (band) {
    case "calibrating":
      return null;
    case "green":
    case "amber":
    case "red":
      return readiness == null ? null : READINESS_CLAIM[band];
  }
}

export function verdictLine(input: {
  openDay: DaySlot;
  band: Band;
  readiness: number | null;
  /** Local Ymd (page.tsx's `todayYmd`) — the open day is only "today" when it matches this. */
  todayYmd: string;
  /**
   * The date `band`/`readiness` actually describe — `readinessMetric`'s own
   * `.date` (page.tsx), or `null` when there is no metric row at all. May
   * be up to 7 days behind `todayYmd`; see the module comment.
   */
  readinessDate: string | null;
}): { text: string; emphasis: string | null } | null {
  const { openDay, band, readiness, todayYmd, readinessDate } = input;
  const weekday = WEEKDAY_NAMES[weekdayIndex(openDay.date)];
  const isToday = openDay.date === todayYmd;
  // I3, final whole-branch review: date-derived, not status-derived. A
  // past RACE day keeps `status: "race"` forever (nothing ever re-stamps
  // it), and adapt-day.ts's `handleMissedYesterday` only ever looks at
  // yesterday — a day three days gone can still read `status: "planned"`.
  // Both `openDay.date` and `todayYmd` are YYYY-MM-DD, so a plain string
  // comparison is already a correct chronological one.
  const isPast =
    openDay.date < todayYmd ||
    openDay.status === "completed" ||
    openDay.status === "missed";
  // No session to pace, whatever the reason (missed, deliberately rested,
  // or simply empty) — `sessionBase` tells the three apart in the text;
  // none of them earns a claim about the athlete's body.
  const isEmptyDay = openDay.status !== "race" && openDay.workouts.length === 0;
  // `!isPast` here (not just `isToday`) is what keeps a readiness claim off
  // a day already marked "completed" today (mark-done-button.tsx →
  // markDayDone → service.ts stamps this same-day, before `isPast`'s own
  // date check would ever flip): "you're ready for it" is a claim about a
  // session still ahead, and one the athlete has already finished is not
  // that, whatever the clock says. `isPast` already carries the
  // completed/missed union above, so this reuses it rather than
  // re-deriving the same status check a second time.
  const isCurrent = isToday && !isPast && readinessDate === todayYmd;

  const base = sessionBase(weekday, openDay, isToday, isPast);
  const claim = isEmptyDay ? null : readinessClaim(band, readiness, isCurrent);

  return {
    text: claim ? `${base} — ${claim}.` : `${base}.`,
    emphasis: claim,
  };
}
