// The replan ladder. Unlike materializeWeek this never regenerates the
// week: it recomputes each day's availability, then walks only the
// sessions that no longer fit — move, compress, substitute, drop — one
// rung at a time, leaving every other day byte-identical.
import { blockMins, type AvailabilityBlock } from "@/lib/availability/types";
import type { PlannedWorkout } from "@/lib/training-plan";
import { admits, buildSlots, fitToBlock, slotKey, type Slot } from "./slots";
import { blockIdxOf, blockPlacement, isAthleteChosen } from "./placement";
import { fillWeek, type FillOptions } from "./fill";
import type {
  AdjustmentRecord,
  DaySlot,
  ScheduledWorkout,
  WeekState,
} from "./types";
import { dayMins } from "./types";

function locked(d: DaySlot): boolean {
  return (
    d.status === "completed" || d.status === "missed" || d.status === "race"
  );
}

export function replanWeek(
  week: WeekState,
  resolved: Map<string, AvailabilityBlock[]>,
  /**
   * The athlete's local calendar day (YYYY-MM-DD). Days before it can never
   * RECEIVE a moved session — required rather than optional so a caller
   * cannot silently reintroduce the defect described at rung 1.
   */
  today: string,
  /**
   * The fill rung's inputs, or null to disable it.
   *
   * Required rather than optional-defaulting-null, for the same reason
   * `today` above is required: a caller must not be able to change this
   * function's behaviour by omission. `FillOptions | null` rather than a
   * boolean because the target travels with it — a boolean would admit an
   * "enabled but no target" state that has no meaning.
   *
   * Exactly one caller passes a non-null value: `applyAvailability`, which
   * `applyResolvedAvailability` also routes through. Fill must never run on
   * a readiness or wellness path.
   */
  fill: FillOptions | null
): { week: WeekState; adjustments: AdjustmentRecord[] } {
  const adjustments: AdjustmentRecord[] = [];

  // 1. Apply the new availability, keeping locked days exactly as they are.
  const days: DaySlot[] = week.days.map((d) => {
    if (locked(d)) return d;
    const availableBlocks = resolved.get(d.date) ?? d.availableBlocks;
    return {
      ...d,
      availableBlocks,
      availableMins: dayMins({ availableBlocks }),
    };
  });

  // 2. Find displaced sessions: those whose OWN block no longer holds
  // them — shrunk below their duration, or gone entirely (index now out of
  // range). A session is judged against the specific block it occupies,
  // never against a roomier sibling block elsewhere on the same day: the
  // day's biggest block excusing every session on it is exactly the defect
  // this replaces (a shrunk 30→5min morning block left standing because
  // the day also holds an untouched 90min evening block). This is a full
  // pre-pass over the whole week before any ladder rung runs, so every
  // displaced session is known — and removed from its day — before rung 1
  // goes looking for somewhere else to put any of them. Every kept
  // session's block is marked taken here too, so the ladder can never
  // double-book a block a kept session already occupies.
  const displaced: {
    dayIdx: number;
    workout: PlannedWorkout;
    before: DaySlot;
  }[] = [];
  const taken = new Set<string>();
  days.forEach((d, dayIdx) => {
    if (locked(d)) return;
    const keep: ScheduledWorkout[] = [];
    for (const w of d.workouts) {
      // The athlete's own pick occupies no availability block, so the
      // displacement test below — "does its block still hold it?" — has no
      // answer for it and would hand every one of them to the drop rung.
      // The engine reads these sessions and never writes them.
      if (isAthleteChosen(w)) {
        keep.push(w);
        continue;
      }
      const wBlockIdx = blockIdxOf(w.placement);
      const block =
        wBlockIdx == null ? undefined : d.availableBlocks[wBlockIdx];
      const slot: Slot | null =
        block != null && wBlockIdx != null
          ? {
              dayIdx,
              blockIdx: wBlockIdx,
              mins: blockMins(block),
              energy: block.energy,
              sports: block.sports,
            }
          : null;
      // admits() reads day.workouts.length (the per-day cap) and
      // day.workouts.some(isQuality) (same-day/adjacency), both of which
      // still include THIS session at this point — check against a copy
      // of this day with it removed, or it rejects itself.
      const daysForCheck = slot
        ? days.map((dd, i) =>
            i === dayIdx
              ? { ...dd, workouts: dd.workouts.filter((x) => x !== w) }
              : dd
          )
        : days;
      if (slot && admits(slot, w, daysForCheck, taken)) {
        keep.push(w);
        taken.add(slotKey(slot));
      } else {
        displaced.push({
          dayIdx,
          workout: w,
          before: { ...d, workouts: [...d.workouts] },
        });
      }
    }
    if (keep.length !== d.workouts.length) {
      days[dayIdx] = {
        ...d,
        workouts: keep,
        status: keep.length > 0 ? d.status : "rest",
      };
    }
  });

  if (displaced.length === 0) return finish(week, days, adjustments, fill);

  // 3. Walk each displaced session down the ladder, in day order, so a
  // later day's search always sees the final outcome of every earlier
  // day's placement — including a compress that kept an earlier day
  // quality, which a later move must not land next to.
  for (const { dayIdx, workout, before } of displaced) {
    const fromDate = days[dayIdx].date;

    // Rung 1 — move. Candidates include slots on the session's OWN day, not
    // just other days: its original block is why it was displaced (shrunk
    // below its duration, or gone), so admits() rejects that specific block
    // on size alone, without any special case — but a free sibling block on
    // the same day is exactly as legitimate a target as one on any other
    // day, and the distance sort below already puts it first (distance
    // zero). Excluding the whole day here was the bug: it let a session be
    // dropped even when an untouched sibling block on its own day would
    // have fit it whole. "Nearest" is the smallest absolute day distance
    // from the original date; ties break toward the earlier day, then the
    // earlier block. Only days with real room under the *new* availability
    // are ever candidates (buildSlots only emits slots for blocks that
    // exist, and admits() rejects anything too small), so a session is
    // never pushed onto a day the athlete has marked unavailable.
    const candidates = buildSlots(days)
      .filter((s) => !locked(days[s.dayIdx]))
      // Never move a session into a day that has already happened. A past
      // day is not locked (a quiet rest day earlier this week is just
      // "rest"), it often has the most room left, and the distance sort
      // below breaks ties TOWARD the earlier day — so zeroing today sent
      // the session to yesterday, where the next daily adaptation marked it
      // missed and dissolved it into the remaining days. The athlete
      // silently lost a session while the log said "moved to <yesterday>,
      // which fits it whole".
      .filter((s) => days[s.dayIdx].date >= today)
      .filter((s) => admits(s, workout, days, taken))
      .sort(
        (a, b) =>
          Math.abs(a.dayIdx - dayIdx) - Math.abs(b.dayIdx - dayIdx) ||
          a.dayIdx - b.dayIdx ||
          a.blockIdx - b.blockIdx
      );
    const move = candidates[0];
    if (move) {
      taken.add(slotKey(move));
      const target = days[move.dayIdx];
      // Only the moved-in session's arrival defines the target day's
      // status when the day was otherwise empty. When the target already
      // held a session of its own, that session didn't move — stamping
      // "moved"/movedFrom over the whole day would clobber its own status.
      const targetHadOwnSession = target.workouts.length > 0;
      days[move.dayIdx] = {
        ...target,
        workouts: [
          ...target.workouts,
          { ...workout, placement: blockPlacement(move.blockIdx) },
        ],
        status: targetHadOwnSession ? target.status : "moved",
        movedFrom: targetHadOwnSession ? target.movedFrom : fromDate,
      };
      adjustments.push({
        date: fromDate,
        trigger: "availability_change",
        action: "moved",
        before: [before],
        after: [{ ...days[move.dayIdx] }],
        reason: `no time on ${fromDate} — moved to ${days[move.dayIdx].date}, which fits it whole`,
      });
      continue;
    }

    // Rungs 2 and 3 — shorten within the purpose, or substitute the
    // nearest lesser stimulus that works at that length, without ever
    // reimplementing that rule here: fitToBlock is the single shared
    // fitting function materializeWeek also uses, so a fresh week and a
    // replan can never drift apart on what "fits" means.
    //
    // A fitted session stays on its own day, tried against each of that
    // day's blocks roomiest-first (so compression is preferred over
    // substitution whenever both are available). Compression never
    // changes purpose, so the fitted result is often still a quality
    // session — it is validated with the real admission rule against the
    // FITTED workout, not the original, and not an energy check alone.
    // Skipping that check is exactly the defect just fixed in
    // materializeWeek's own fallback path: it let a still-quality fitted
    // session land next to another quality day.
    const homeSlots = buildSlots(days).filter((s) => s.dayIdx === dayIdx);
    let fit: {
      slot: Slot;
      workout: PlannedWorkout;
      how: "compressed" | "substituted";
    } | null = null;
    for (const slot of homeSlots) {
      const fitted = fitToBlock(workout, slot.mins);
      // A "whole" fit here would mean some block on this very day admits
      // the session unchanged — but rung 1 above already searched every
      // block on every unlocked day, including this one, for exactly that,
      // and the nearest-day sort tries same-day blocks first. If a whole
      // fit were legal here, rung 1 would already have placed it. What's
      // left to try on the home day is only ever a squeeze: compress within
      // purpose, or substitute for a lesser stimulus.
      if (!fitted || fitted.how === "whole") continue;
      if (!admits(slot, fitted.workout, days, taken)) continue;
      fit = { slot, workout: fitted.workout, how: fitted.how };
      break;
    }

    if (fit) {
      taken.add(slotKey(fit.slot));
      days[dayIdx] = {
        ...days[dayIdx],
        workouts: [
          ...days[dayIdx].workouts,
          { ...fit.workout, placement: blockPlacement(fit.slot.blockIdx) },
        ],
        status: "adapted",
      };
      adjustments.push({
        date: fromDate,
        trigger: "no_time",
        action: fit.how === "compressed" ? "scaled" : "swapped",
        before: [before],
        after: [{ ...days[dayIdx] }],
        reason:
          fit.how === "compressed"
            ? `${workout.type} shortened from ${workout.durationMins} to ${fit.workout.durationMins}min on ${fromDate} — same session, less of it`
            : `only ${fit.workout.durationMins}min on ${fromDate} — ${workout.type} replaced by ${fit.workout.type}, which still works at that length`,
      });
      continue;
    }

    // Rung 4 — drop. Nothing moved it, nothing fit it in place — either
    // there was no room at all, or the only room that existed would have
    // put a fitted session somewhere the admission rule forbids.
    adjustments.push({
      date: fromDate,
      trigger: "availability_change",
      action: "dropped",
      before: [before],
      after: [{ ...days[dayIdx] }],
      reason: `no time left on ${fromDate} and nowhere else in the week fits — ${workout.type} dropped`,
    });
  }

  return finish(week, days, adjustments, fill);
}

/**
 * Rung 5. Runs on the settled result of rungs 1-4, so fill sees where every
 * displaced session actually landed rather than the layout it started from.
 */
function finish(
  week: WeekState,
  days: DaySlot[],
  adjustments: AdjustmentRecord[],
  fill: FillOptions | null
): { week: WeekState; adjustments: AdjustmentRecord[] } {
  if (!fill) return { week: { ...week, days }, adjustments };
  const filled = fillWeek(days, fill);
  return {
    week: { ...week, days: filled.days },
    adjustments: [...adjustments, ...filled.adjustments],
  };
}
