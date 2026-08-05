// The fill rung. Unlike every other rung in the ladder, this one ADDS: it
// grows a session whose block gained room, then places at most one new
// session, stopping the moment the week reaches the live target.
//
// Pure — no I/O, no clock. The target and the event's queen stage are
// resolved by the caller and passed in.
import {
  PURPOSE_FLOORS,
  blockMins,
  type Purpose,
} from "@/lib/availability/types";
import {
  EASY_RUN_CAP_MINS,
  longRideBoundMins,
  withPurpose,
} from "@/lib/training-plan";
import { TYPE_BY_PURPOSE, admits, buildSlots } from "./slots";
import type { AdjustmentRecord, DaySlot } from "./types";

/**
 * How long fill may make a session of this purpose, in this sport — or null
 * when fill must not touch it at all.
 *
 * One function, shared by both sub-steps, so growing and placing can never
 * disagree about what a session is allowed to be.
 *
 * Every bound here is one the generator already applies for that sport.
 * Fill invents no constant of its own: an unjustified duration cap is
 * precisely the defect v0.30.0 existed to remove.
 */
export function fillCeilingMins(
  purpose: Purpose,
  sport: string,
  queenStageHours: number | null
): number | null {
  // Endurance only. v0.30.0 settled this: stretching a VO2max block changes
  // what it is, so intensity is never grown and never added.
  if (purpose !== "aerobic_base" && purpose !== "long") return null;

  if (sport === "Bike") {
    // generateCyclingWorkouts bounds BOTH its long ride and its easy rides
    // by this, so fill matches the generator exactly.
    return longRideBoundMins(queenStageHours);
  }

  if (sport === "Run") {
    // Running's single-session rule is athlete-relative — exceeding your own
    // recent longest run by 10-30% raises injury risk 64% — and no such
    // model exists in this codebase yet. So fill will grow an easy run, and
    // will never create or grow a long one.
    return purpose === "aerobic_base" ? EASY_RUN_CAP_MINS : null;
  }

  // Swim, and anything else. There is no swim duration bound anywhere in
  // this codebase, and borrowing the cycling figure would be inventing one.
  return null;
}

/**
 * Every planned minute in the week, locked days included.
 *
 * A completed Monday is training the week actually contains; excluding it
 * would make fill re-add what the athlete has already done.
 */
export function plannedMins(days: DaySlot[]): number {
  return days.reduce(
    (total, d) => total + d.workouts.reduce((s, x) => s + x.durationMins, 0),
    0
  );
}

/**
 * The sport a new session should be in: the one holding the most endurance
 * minutes this week, among sports fill can actually bound.
 *
 * A race's `PlanSport` doesn't settle this either: `disciplinesOf("Triathlon")`
 * (plan-sport.ts) returns three disciplines, unranked, so "the plan's
 * primary sport" is not a well-defined thing to reach for. The week itself
 * is the evidence. When it holds no bounded endurance session at all there
 * is no evidence, and fill adds nothing rather than guessing.
 *
 * Ties break toward the first sport encountered in day order, which is
 * deterministic for a given week.
 */
export function fillSport(
  days: DaySlot[],
  queenStageHours: number | null
): string | null {
  const minsBySport = new Map<string, number>();
  for (const d of days) {
    for (const x of d.workouts) {
      if (fillCeilingMins(x.purpose, x.sport, queenStageHours) == null)
        continue;
      minsBySport.set(
        x.sport,
        (minsBySport.get(x.sport) ?? 0) + x.durationMins
      );
    }
  }

  let best: string | null = null;
  let bestMins = 0;
  for (const [sport, mins] of minsBySport) {
    if (mins > bestMins) {
      best = sport;
      bestMins = mins;
    }
  }
  return best;
}

export interface FillOptions {
  /** The live target, in MINUTES — assembleWeeklyTarget's target.hours × 60. */
  targetMins: number;
  /** The hardest single day the athlete's event demands. Null when unknown. */
  queenStageHours: number | null;
  /** The athlete's local calendar day (YYYY-MM-DD). */
  today: string;
}

/**
 * Whether fill may run this week at all, decided from inputs the caller has
 * already resolved (plan lookup, live target, taper fraction) — kept
 * separate from that I/O so the DECISION itself is pure and directly
 * testable, rather than only reachable through a DB-backed integration test
 * that skips in CI.
 *
 * Declines outright (returns null), never a phase-aware ceiling, in two
 * cases:
 *  - `hasActivePlan` is false — there is nothing to grow toward.
 *  - `taperFraction` is non-null — this week is a taper or race week.
 *    `materializeWeek` deliberately shrinks such a week
 *    (`taperFractionForWeek`), but neither `fillCeilingMins` nor the live
 *    target it fills toward has any notion of phase or race proximity.
 *    Freeing up time during a taper must not undo it. This is the same
 *    "decline rather than invent an unjustified bound" reasoning fill
 *    already applies to swimming and to long runs — fill has no defensible
 *    taper bound of its own, so refusing the whole week is the honest
 *    answer, not a partial one.
 *
 * Otherwise returns the `FillOptions` fill should use, converting the live
 * target from HOURS to MINUTES (the only unit conversion this function
 * does — never through `loadPerHour`, which does not apply here).
 */
export function resolveFillOptions(input: {
  hasActivePlan: boolean;
  taperFraction: number | null;
  targetHours: number;
  queenStageHours: number | null;
  today: string;
}): FillOptions | null {
  if (!input.hasActivePlan) return null;
  if (input.taperFraction != null) return null;
  return {
    targetMins: Math.round(input.targetHours * 60),
    queenStageHours: input.queenStageHours,
    today: input.today,
  };
}

/** Completed, missed and race days are never touched, exactly as in replan.ts. */
function locked(d: DaySlot): boolean {
  return (
    d.status === "completed" || d.status === "missed" || d.status === "race"
  );
}

/**
 * The fill rung. Grows sessions into room their own blocks gained, then (in
 * the next task) places at most one new session. Stops the moment the week
 * reaches `targetMins`.
 *
 * Returns a NEW days array; the input is never mutated.
 */
export function fillWeek(
  days: DaySlot[],
  opts: FillOptions
): { days: DaySlot[]; adjustments: AdjustmentRecord[] } {
  const adjustments: AdjustmentRecord[] = [];
  // `const` — the array is never reassigned, only its entries replaced.
  // `let` here trips the repo's prefer-const lint rule.
  const out = days.map((d) => ({ ...d, workouts: [...d.workouts] }));
  let planned = plannedMins(out);

  // ── 1a. Grow in place ────────────────────────────────────────────────
  // Each session is judged against THE BLOCK IT OCCUPIES, never a roomier
  // sibling — the rule the whole ladder enforces, and whose violation is the
  // defect replanWeek was written to replace.
  for (let i = 0; i < out.length && planned < opts.targetMins; i++) {
    const day = out[i];
    if (locked(day)) continue;

    for (let j = 0; j < day.workouts.length && planned < opts.targetMins; j++) {
      const workout = day.workouts[j];
      const ceiling = fillCeilingMins(
        workout.purpose,
        workout.sport,
        opts.queenStageHours
      );
      if (ceiling == null) continue;

      const block = day.availableBlocks[workout.blockIdx];
      if (!block) continue;

      const grown = Math.min(
        blockMins(block),
        ceiling,
        workout.durationMins + (opts.targetMins - planned)
      );
      if (grown <= workout.durationMins) continue;

      const before = { ...day, workouts: day.workouts.map((x) => ({ ...x })) };
      day.workouts[j] = { ...workout, durationMins: grown };
      out[i] = { ...day, workouts: day.workouts };
      planned += grown - workout.durationMins;

      adjustments.push({
        date: day.date,
        trigger: "availability_change",
        action: "added",
        before: [before],
        after: [
          { ...out[i], workouts: out[i].workouts.map((x) => ({ ...x })) },
        ],
        reason: `more time on ${day.date} — ${workout.type} extended from ${workout.durationMins} to ${grown}min`,
      });
    }
  }

  // ── 1b. Add one ──────────────────────────────────────────────────────
  // At most ONE new session per call. An athlete making three availability
  // edits gets at most three sessions, each bounded by the target — rather
  // than one edit conjuring a whole week.
  if (planned < opts.targetMins) {
    const sport = fillSport(out, opts.queenStageHours);
    if (sport) {
      const hasLong = out.some((d) =>
        d.workouts.some((x) => x.purpose === "long")
      );
      // A long session only when the week holds none yet and the sport can
      // actually be bounded for it — which excludes running by design.
      const purposes: Purpose[] = hasLong
        ? ["aerobic_base"]
        : ["long", "aerobic_base"];

      // Blocks already occupied by a session must never be double-booked.
      // Built as `${dayIdx}:${blockIdx}` to match slotKey's format exactly —
      // admits() checks taken.has(slotKey(slot)) internally, so this literal
      // must stay in lockstep with slotKey or the double-booking guard goes
      // silently inert.
      const taken = new Set<string>();
      out.forEach((d, dayIdx) =>
        d.workouts.forEach((x) => taken.add(`${dayIdx}:${x.blockIdx}`))
      );

      const todayIdx = Math.max(
        0,
        out.findIndex((d) => d.date >= opts.today)
      );

      const slots = buildSlots(out)
        .filter((s) => !locked(out[s.dayIdx]))
        .filter((s) => out[s.dayIdx].restIntent == null)
        .filter((s) => out[s.dayIdx].date >= opts.today)
        .sort(
          (a, b) =>
            Math.abs(a.dayIdx - todayIdx) - Math.abs(b.dayIdx - todayIdx) ||
            a.dayIdx - b.dayIdx ||
            a.blockIdx - b.blockIdx
        );

      outer: for (const slot of slots) {
        for (const purpose of purposes) {
          const ceiling = fillCeilingMins(purpose, sport, opts.queenStageHours);
          if (ceiling == null) continue;

          const mins = Math.min(slot.mins, ceiling, opts.targetMins - planned);
          if (mins < PURPOSE_FLOORS[purpose]) continue;

          const label = TYPE_BY_PURPOSE[purpose];
          const candidate = withPurpose({
            day: slot.dayIdx,
            sport,
            type: label.type,
            durationMins: mins,
            intensity: label.intensity,
            description: `${label.type} — added from newly available time`,
          });
          if (!admits(slot, candidate, out, taken)) continue;

          const day = out[slot.dayIdx];
          const before = {
            ...day,
            workouts: day.workouts.map((x) => ({ ...x })),
          };
          out[slot.dayIdx] = {
            ...day,
            workouts: [
              ...day.workouts,
              { ...candidate, blockIdx: slot.blockIdx },
            ],
            status: day.workouts.length > 0 ? day.status : "planned",
          };
          planned += mins;

          adjustments.push({
            date: day.date,
            trigger: "availability_change",
            action: "added",
            before: [before],
            after: [
              {
                ...out[slot.dayIdx],
                workouts: out[slot.dayIdx].workouts.map((x) => ({ ...x })),
              },
            ],
            reason: `${day.date} is now free — ${label.type} ${mins}min added; ${(planned / 60).toFixed(1)}h planned against a ${(opts.targetMins / 60).toFixed(1)}h target`,
          });
          break outer;
        }
      }
    }
  }

  return { days: out, adjustments };
}
