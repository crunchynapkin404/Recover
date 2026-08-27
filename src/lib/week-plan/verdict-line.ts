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
 * - A rest day is not "nothing to say" — rest is the plan, so it gets its
 *   own sentence and never carries a readiness claim (there is nothing to
 *   pace on a day with no session).
 * - A race day is likewise never mistaken for a rest day: materializeWeek
 *   always clears `workouts` on a race day (see materialize.ts), so
 *   `workouts.length === 0` alone cannot tell "nothing planned" apart from
 *   "the plan is a race today" — `status` is what tells them apart.
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
 * all (never on a rest day — see the module comment). `calibrating` has no
 * entry: the caller checks for it before reaching this map, because there
 * is no honest phrase for a score that was never computed.
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

function sessionBase(weekday: string, day: DaySlot): string {
  if (day.workouts.length > 0) {
    const phrase =
      day.workouts.length === 1
        ? (SESSION_PHRASE[day.workouts[0].purpose] ?? "a session")
        : `${day.workouts.length} sessions`;
    return `${weekday} is ${phrase}`;
  }
  // materializeWeek always empties `workouts` on a race day (see the module
  // comment) — `status` is the only way to tell "nothing planned" apart
  // from "the plan is a race today".
  if (day.status === "race") {
    return `${weekday} is race day`;
  }
  return "Nothing planned today — that's the plan";
}

/**
 * `null` on a rest day: rest is stated as the plan itself (see
 * `sessionBase`), with no separate claim about the athlete's body to make —
 * there is no session to pace, so there is nothing for a readiness figure
 * to say.
 *
 * The `"calibrating"` case is its own switch arm, deliberately not folded
 * into the `readiness == null` check below it: `calibrating` and a null
 * figure coincide on every real row (readiness.ts's computeReadiness never
 * produces one without the other), so a single merged guard would make
 * this arm's own correctness unobservable — a mutation that made
 * `"calibrating"` fall through to a confident sentence would still pass
 * every test, because the null-figure guard would catch that same input
 * for an unrelated reason. Kept separate so each has its own test: this
 * arm returning `null` unconditionally, and the null-figure guard below
 * catching the case a stored row disagrees with itself (a band claiming
 * confidence with no number behind it — not a state computeReadiness
 * itself ever produces, but not one this module should trust blindly
 * either).
 */
function readinessClaim(band: Band, readiness: number | null): string | null {
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
}): { text: string; emphasis: string | null } | null {
  const { openDay, band, readiness } = input;
  const weekday = WEEKDAY_NAMES[weekdayIndex(openDay.date)];
  const isRestDay = openDay.workouts.length === 0 && openDay.status !== "race";

  const base = sessionBase(weekday, openDay);
  const claim = isRestDay ? null : readinessClaim(band, readiness);

  return {
    text: claim ? `${base} — ${claim}.` : `${base}.`,
    emphasis: claim,
  };
}
