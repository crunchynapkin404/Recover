import {
  generateWorkouts,
  withPurpose,
  type PlannedWorkout,
} from "@/lib/training-plan";
import type { PlanPhase } from "@/lib/plan-phase";
import {
  raceRecoveryDays,
  raceWeekWorkouts,
  taperFractionForWeek,
  TAPER_FRACTION_RACE_WEEK,
  type RaceContext,
} from "@/lib/race/taper";
import {
  type Band,
  GENERATOR_CAP_SHORTFALL_PCT,
  LOW_ADHERENCE_BUMP,
  LOW_ADHERENCE_PCT,
  MISSED_WEEK_RESTART,
  RAMP_CLAMP_PCT,
  SUPPRESSED_READINESS_DAYS,
  SUPPRESSED_REDUCTION,
  type AdjustmentRecord,
  type DaySlot,
  type WeekState,
  dayMins,
  isQuality,
  QUALITY_TYPES,
  STEP_DOWN,
} from "./types";
import { resolveComebackDecision } from "./comeback";
import { buildSlots, admits, slotKey, fitToBlock, findBlockFor } from "./slots";
import type { AvailabilityBlock } from "@/lib/availability/types";
import { MAX_SESSIONS_PER_DAY } from "@/lib/availability/types";
import { disciplinesOf, type PlanSport } from "@/lib/plan-sport";
import { type PlanStyle } from "@/lib/plan-style/types";
import { resolvePlanStyle } from "@/lib/plan-style/resolve";
import type { ReentryStage, SeasonMode } from "@/lib/season-mode/types";
import { normalizeSeasonState } from "@/lib/season-mode/resolve";
import { applyOffSeasonShaping } from "./off-season";

export interface EffectiveLoadInput {
  skeletonTarget: number;
  prevWeek: { actualLoad: number; adherencePct: number } | null;
  recentBands: Band[];
  /** Last 7 illness flags, oldest first. */
  recentIllFlags?: boolean[];
  /** Taper weeks skip restart/adherence logic and the downward ramp clamp. */
  taperWeek?: boolean;
}

export function effectiveWeekLoad(input: EffectiveLoadInput): {
  load: number;
  reasons: string[];
} {
  const { skeletonTarget, prevWeek, recentBands, taperWeek } = input;
  const reasons: string[] = [];

  if (!taperWeek && prevWeek && prevWeek.actualLoad === 0) {
    const load = Math.round(skeletonTarget * MISSED_WEEK_RESTART);
    reasons.push(
      `last week was fully missed — restarting at ${Math.round(
        MISSED_WEEK_RESTART * 100
      )}% of the skeleton target (${load})`
    );
    return { load, reasons };
  }

  let target = skeletonTarget;

  if (!taperWeek && prevWeek && prevWeek.adherencePct < LOW_ADHERENCE_PCT) {
    target = prevWeek.actualLoad * LOW_ADHERENCE_BUMP;
    reasons.push(
      `adherence was ${Math.round(prevWeek.adherencePct)}% — building on last week's actual load instead of the skeleton`
    );
  }

  const badDays = recentBands.filter(
    (b) => b === "amber" || b === "red"
  ).length;
  if (badDays >= SUPPRESSED_READINESS_DAYS) {
    target *= SUPPRESSED_REDUCTION;
    reasons.push(
      `readiness was amber or worse on ${badDays} of the last 7 days — reduced ${Math.round(
        (1 - SUPPRESSED_REDUCTION) * 100
      )}%`
    );
  }

  if (prevWeek) {
    const lo = prevWeek.actualLoad * (1 - RAMP_CLAMP_PCT);
    const hi = prevWeek.actualLoad * (1 + RAMP_CLAMP_PCT);
    if (target > hi) {
      target = hi;
      reasons.push(
        `ramp guard: week-over-week change clamped to ±${Math.round(
          RAMP_CLAMP_PCT * 100
        )}% of last week's actual load`
      );
    } else if (target < lo) {
      if (taperWeek) {
        reasons.push("taper: ramp guard downward clamp bypassed");
      } else {
        target = lo;
        reasons.push(
          `ramp guard: week-over-week change clamped to ±${Math.round(
            RAMP_CLAMP_PCT * 100
          )}% of last week's actual load`
        );
      }
    }
  }

  return { load: Math.round(target), reasons };
}

export interface MaterializeInput {
  weekStart: string;
  skeleton: {
    weekNumber: number;
    phase: PlanPhase;
    targetLoadTotal: number;
    targetSessions: number;
  };
  /** One entry per day (Mon..Sun); each is that day's list of blocks. */
  availableBlocksPerDay: AvailabilityBlock[][];
  prevWeek: { actualLoad: number; adherencePct: number } | null;
  recentBands: Band[];
  /** Last 7 illness flags, oldest first. */
  recentIllFlags?: boolean[];
  /** The plan's sport. Single value — the race decides it (v0.42). */
  sport: PlanSport;
  hoursPerWeek: number;
  /** Upcoming races, sorted priority A→C then date asc (service does the sort). */
  races?: RaceContext[];
  /** Latest stored CTL — taper base fallback when there is no previous week. */
  currentCtl?: number | null;
  /**
   * The hardest single day the athlete's event demands, from
   * `EventDemand.queenStageHours` — what a long ride should build toward.
   * Null when there is no target race or no FTP, which keeps the
   * pre-existing no-demand bound. Optional so existing callers and test
   * fixtures compile unchanged.
   */
  queenStageHours?: number | null;
  /** Optional style preference; defaults to balanced. */
  planStyle?: PlanStyle;
  /** Optional season mode; defaults to normal. */
  seasonMode?: SeasonMode;
  /** Optional explicit re-entry stage. */
  reentryStage?: ReentryStage;
  /**
   * The most recent A-race before this week, if any — sorted out of the
   * plan's full race list by the caller (`racesForWeek` drops it from
   * `races` the moment its own week passes). Used to suppress a LATER
   * race's taper reshaping while this week still sits inside the earlier
   * race's recovery window. See
   * docs/specs/2026-08-19-multi-a-race-transition-evidence.md §7.
   */
  previousARace?: { date: string; raceType: string } | null;
}

export interface MaterializeResult {
  week: WeekState;
  adjustments: AdjustmentRecord[];
  effectiveLoad: number;
}

function addDays(ymd: string, n: number): string {
  const d = new Date(ymd + "T00:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

// taper.ts has an identical private helper; not exported there, so this
// mirrors it rather than reaching across the module boundary for a
// one-line date subtraction.
function daysBetween(fromYmd: string, toYmd: string): number {
  return Math.round(
    (new Date(toYmd + "T00:00:00").getTime() -
      new Date(fromYmd + "T00:00:00").getTime()) /
      86_400_000
  );
}

function focusPurposesFor(
  phase: PlanPhase,
  weekNumber: number
): Set<PlannedWorkout["purpose"]> {
  if (phase === "base") return new Set(["aerobic_base", "long"]);
  if (phase === "build") {
    return new Set([weekNumber % 2 === 0 ? "vo2max" : "threshold"]);
  }
  if (phase === "peak") {
    return new Set(["threshold", "vo2max", "brick"]);
  }
  return new Set();
}

function orderByStylePreference<T extends { dayIdx: number }>(
  slots: T[],
  workout: PlannedWorkout,
  style: PlanStyle,
  phase: PlanPhase,
  weekNumber: number
): T[] {
  if (style !== "block_lite") return slots;
  if (phase === "recovery" || phase === "taper") return slots;

  const focusPurposes = focusPurposesFor(phase, weekNumber);
  const isFocus = focusPurposes.has(workout.purpose);
  const preferred = slots.filter((s) =>
    isFocus ? s.dayIdx <= 3 : s.dayIdx >= 4
  );
  if (preferred.length === 0) return slots;

  const preferredKeys = new Set(preferred.map((s) => String(s.dayIdx)));
  const nonPreferred = slots.filter(
    (s) => !preferredKeys.has(String(s.dayIdx))
  );
  return [...preferred, ...nonPreferred];
}

export function materializeWeek(input: MaterializeInput): MaterializeResult {
  const adjustments: AdjustmentRecord[] = [];
  const planStyle = resolvePlanStyle(input.planStyle);
  const seasonState = normalizeSeasonState({
    seasonMode: input.seasonMode,
    reentryStage: input.reentryStage,
  });

  const races = input.races ?? [];
  const primary = races[0] ?? null;
  // Priority-agnostic: whether this week sits inside primary's OWN taper
  // window at all, per taper.ts's single ladder authority (Task 4).
  // taperFractionForWeek never reads `priority` — it answers a calendar
  // question, not a decision one — so it's safe to compute unconditionally
  // and only gate its use to A-priority below. The B/C "no taper" note
  // further down reuses this SAME calendar answer, rather than
  // reimplementing the day-count math against a different constant, so the
  // two blocks can never disagree about what "inside the window" means.
  const primaryTaperFraction = primary
    ? taperFractionForWeek(input.weekStart, primary)
    : null;
  // A week inside the PREVIOUS A-race's recovery window is still
  // repairing, and that recovery outranks any LATER race's taper.
  // `racesForWeek` (the caller) drops a race from `races` the moment its
  // own week passes, so without this guard the week right after an A-race
  // gets reshaped as the NEXT race's taper instead — 80% of prior actual
  // load, intensity preserved, openers two days out — on the week the
  // evidence says is still resolving. See
  // docs/specs/2026-08-19-multi-a-race-transition-evidence.md §7. Emitting
  // a "recovery" phase for this week is periodize()'s job, not this
  // function's — WeekState carries no phase field — so this guard only
  // suppresses the taper reshaping, nothing else.
  //
  // The window is bounded BOTH ways. `daysBetween(previousARace.date,
  // weekStart)` is negative for every week that starts BEFORE that race —
  // and the live wiring sites (week-plan/service.ts, week-plan/project.ts)
  // pass `previousARace: targets.first` unconditionally, from plan week 1
  // onward. An unbounded `<` check therefore treated the whole of arc one
  // — including race one's own taper weeks and its own race week — as
  // "inside race one's recovery window" and suppressed race one's own
  // taper. `gap > 0` requires the week to start strictly AFTER that race.
  const gap = input.previousARace
    ? daysBetween(input.previousARace.date, input.weekStart)
    : null;
  const inRecoveryWindow =
    gap != null &&
    gap > 0 &&
    gap < raceRecoveryDays(input.previousARace!.raceType);
  const taperFraction =
    !inRecoveryWindow && primary && primary.priority === "A"
      ? primaryTaperFraction
      : null;
  const hasActualLoad = !!input.prevWeek && input.prevWeek.actualLoad > 0;
  const hasCtl = input.currentCtl != null;
  const taperBase = hasActualLoad
    ? input.prevWeek!.actualLoad
    : hasCtl
      ? input.currentCtl! * 7
      : input.skeleton.targetLoadTotal;
  // v0.45 Task 4 review, Finding 2: when NEITHER an actual previous week NOR
  // a measured CTL is available, `taperBase` above falls all the way back to
  // `input.skeleton.targetLoadTotal` — periodize()'s own number for this
  // week. If periodize() itself already placed this week inside its taper
  // phase (`input.skeleton.phase === "taper"`), that number already went
  // through ONE ladder fraction (`taperFractionFromEnd`, keyed on position
  // in the plan). Multiplying it by `taperFraction` below (keyed on the
  // REAL race date, via `taperFractionForWeek`) would apply the ladder a
  // SECOND time and compound it — race week landing at ~0.45×0.45 ≈ 0.20 of
  // the athlete's real load instead of 0.45.
  //
  // Reachability (corrected, Task 4 re-review, Finding 2): this is NOT
  // limited to a brand-new athlete's very first materialized week.
  // `hasActualLoad` is false whenever `prevWeek` is null OR
  // `prevWeek.actualLoad === 0` — i.e. a fully missed week counts as "no
  // actual load" too — and `hasCtl` is false whenever no CTL has ever
  // synced. So this path recurs mid-plan for any athlete with no synced
  // CTL, after a missed week, a rollover, or a race reschedule that moves
  // an A-race's taper window over a week already in flight — exactly the
  // situations where the plan's assumed geometry (`taperFractionFromEnd`)
  // and the real calendar (`taperFractionForWeek`) are most likely to have
  // drifted apart. On this path the plan-position fraction wins outright:
  // periodize()'s already-scaled `targetLoadTotal` is kept as final, and
  // the real-date fraction is NOT reapplied to rescale it.
  //
  // In every OTHER fallback tier this concern does not apply:
  // `prevWeek.actualLoad` and `currentCtl * 7` are both genuine,
  // non-taper-scaled load estimates, so multiplying by `taperFraction`
  // there is the intended, correct behaviour (unchanged by this fix) — as
  // is the common case where the skeleton falls back to
  // `targetLoadTotal` but periodize's OWN phase for this week is NOT
  // "taper" (e.g. the real race date is closer than the plan's geometry
  // assumed): that number is a genuine unscaled estimate too.
  //
  // Which fraction "wins" when only the double-scaled case remains:
  // `taperFractionForWeek` is the more trustworthy number in general — it
  // reads the real race calendar, while `taperFractionFromEnd` only knows
  // the plan's assumed phase geometry — but there is no clean, unscaled
  // anchor left to apply it to (no CTL, no history). Rather than fabricate
  // one, periodize()'s already-computed number is accepted as this week's
  // final load, and `taperFractionForWeek` continues to govern everything
  // ELSE about the week unchanged: whether it counts as a taper week at
  // all, whether it's specifically race week, race-week workout
  // generation, and the ramp-guard bypass below.
  const alreadyLadderScaled =
    !hasActualLoad && !hasCtl && input.skeleton.phase === "taper";
  let skeleton =
    taperFraction != null
      ? {
          ...input.skeleton,
          phase: "taper" as const,
          targetLoadTotal: alreadyLadderScaled
            ? taperBase
            : Math.round(taperBase * taperFraction),
        }
      : input.skeleton;

  if (taperFraction != null) {
    // v0.45 Task 4 re-review, Finding 3: on the `alreadyLadderScaled` path,
    // `skeleton.targetLoadTotal` is `taperBase` passed through UNSCALED —
    // it is not `round(taperBase * taperFraction)`. Saying "set to X% of
    // current load" there would name a percentage that was never applied
    // to produce the number in parentheses. Word that path in terms of
    // what actually happened: periodize()'s own already-scaled ladder
    // output was kept as-is, not rescaled.
    adjustments.push({
      date: input.weekStart,
      trigger: "race",
      action: "scaled",
      before: [],
      after: [],
      reason: alreadyLadderScaled
        ? `taper: ${primary!.name} on ${primary!.date} — no actual load or synced CTL to rescale, so the plan's own taper ladder stands unscaled: week target ${skeleton.targetLoadTotal}`
        : `taper: ${primary!.name} on ${primary!.date} — week target set to ${Math.round(
            taperFraction * 100
          )}% of current load (${skeleton.targetLoadTotal})`,
    });
  }

  // The mirror image of the block above. Only a priority-A race
  // taper-shapes a week; a B or C race sitting inside what would be its
  // own taper window gets no RACE-DRIVEN reduction. That is not the same
  // as "no reduction at all": periodize()'s own end-of-plan taper phase
  // (Task 4's shared ladder) still reduces these weeks, same as before
  // v0.45 — only the decay RATE it uses changed, not whether it runs.
  // What effectiveWeekLoad's pre-existing ramp guard then does to that
  // reduction (clamping it toward last week's actual load) is unchanged
  // by this release too: the old skeleton decay hit the same clamp and
  // landed on the identical number on the project's pinned fixture
  // (463/370 either way). So the athlete gets a partial reduction, not
  // the ladder's intended race-week number, and not "full load" either.
  // This records that gap; it does not fill it — a real B/C mini-taper
  // is v0.47. No load, target, or session count changes as a result of
  // this block: it only pushes an AdjustmentRecord.
  if (primary && primary.priority !== "A" && primaryTaperFraction != null) {
    adjustments.push({
      date: input.weekStart,
      trigger: "race",
      action: "scaled",
      before: [],
      after: [],
      reason:
        `no taper: ${primary.name} on ${primary.date} is priority ` +
        `${primary.priority} — only an A race reshapes a week's volume, ` +
        `so no race taper is applied; the plan's own end-of-plan taper ` +
        `still reduces this week, but only as a partial reduction, not ` +
        `a purpose-built race taper`,
    });
  }

  const suppressedDays = input.recentBands.filter(
    (b) => b === "amber" || b === "red"
  ).length;
  const fatigueHigh = suppressedDays >= SUPPRESSED_READINESS_DAYS;
  const miniTaperMultiplier =
    primary?.priority === "B"
      ? fatigueHigh
        ? 0.85
        : 0.9
      : primary?.priority === "C" && fatigueHigh
        ? 0.95
        : 1;

  if (miniTaperMultiplier < 1) {
    skeleton = {
      ...skeleton,
      targetLoadTotal: Math.round(
        skeleton.targetLoadTotal * miniTaperMultiplier
      ),
    };
    adjustments.push({
      date: input.weekStart,
      trigger: "race",
      action: "scaled",
      before: [],
      after: [],
      reason:
        primary?.priority === "B"
          ? `mini taper: ${primary.name} (${primary.priority}) — week target reduced to ${Math.round(miniTaperMultiplier * 100)}%`
          : `mini taper: ${primary?.name ?? "race"} (${primary?.priority ?? "C"}) with suppressed form — week target reduced to ${Math.round(miniTaperMultiplier * 100)}%`,
    });
  }

  const { load, reasons } = effectiveWeekLoad({
    skeletonTarget: skeleton.targetLoadTotal,
    prevWeek: input.prevWeek,
    recentBands: input.recentBands,
    taperWeek: taperFraction != null,
  });

  const dates = Array.from({ length: 7 }, (_, i) =>
    addDays(input.weekStart, i)
  );

  const days: DaySlot[] = dates.map((date, i) => {
    const availableBlocks = input.availableBlocksPerDay[i] ?? [];
    return {
      date,
      availableBlocks,
      workouts: [],
      availableMins: dayMins({ availableBlocks }),
      status: "rest",
    };
  });

  const hoursBudget = days.reduce((s, d) => s + dayMins(d), 0) / 60;
  const usableDays = days.filter((d) => d.availableBlocks.length > 0).length;
  const sessions = Math.min(
    skeleton.targetSessions,
    usableDays * MAX_SESSIONS_PER_DAY
  );
  const neededHours =
    input.hoursPerWeek * (load / Math.max(1, skeleton.targetLoadTotal));
  let effectiveLoad = load;

  const comeback = resolveComebackDecision({
    recentBands: input.recentBands,
    recentIllFlags: input.recentIllFlags ?? [],
    recentLoadDisruption:
      (input.prevWeek?.actualLoad ?? 0) === 0 ||
      (input.prevWeek?.adherencePct ?? 100) < LOW_ADHERENCE_PCT,
  });

  if (
    comeback.mode !== "none" &&
    suppressedDays === 0 &&
    (input.recentIllFlags ?? []).some(Boolean)
  ) {
    adjustments.push({
      date: input.weekStart,
      trigger: "weekly_rollover",
      action: "scaled",
      before: [],
      after: [],
      reason:
        "contradictory signals: form looked stable, but illness was present — safety-first comeback mode applied",
      reasonCode: "safety_precedence_illness_over_form",
      context: {
        suppressedDays,
        illDays: (input.recentIllFlags ?? []).filter(Boolean).length,
      },
    });
  }

  if (comeback.mode !== "none") {
    const cap = Math.round(
      skeleton.targetLoadTotal * comeback.loadCapMultiplier
    );
    if (effectiveLoad > cap) {
      effectiveLoad = cap;
      if (comeback.reason) {
        adjustments.push({
          date: input.weekStart,
          trigger: "weekly_rollover",
          action: "scaled",
          before: [],
          after: [],
          reason: `${comeback.reason}; week load capped at ${effectiveLoad}`,
          reasonCode: "comeback_load_cap",
          context: {
            comebackMode: comeback.mode,
            capMultiplier: comeback.loadCapMultiplier,
            effectiveLoad,
          },
        });
      }
    }
  }

  if (neededHours > 0 && hoursBudget < neededHours) {
    effectiveLoad = Math.round(load * (hoursBudget / neededHours));
    adjustments.push({
      date: input.weekStart,
      trigger: "weekly_rollover",
      action: "redistributed",
      before: [],
      after: [],
      reason: `${hoursBudget.toFixed(1)}h available instead of ${neededHours.toFixed(
        1
      )}h — week load lowered to ${effectiveLoad}`,
    });
  }
  if (reasons.length > 0) {
    adjustments.push({
      date: input.weekStart,
      trigger: "weekly_rollover",
      action: "scaled",
      before: [],
      after: [],
      reason: reasons.join("; "),
    });
  }

  const raceIdx = primary ? dates.indexOf(primary.date) : -1;
  const isRaceWeek = taperFraction === TAPER_FRACTION_RACE_WEEK && raceIdx >= 0;

  if (isRaceWeek) {
    const taken = new Set<string>();
    // raceWeekWorkouts stamps its argument onto each workout's `.sport`,
    // which `admits()` then matches against a block's `sports` restriction
    // list — so this MUST be a real PlanDiscipline, never the PlanSport
    // itself. "Triathlon" is not a discipline; a block restricted to e.g.
    // Swim would never admit a workout stamped "Triathlon", silently
    // dropping the triathlete's pre-race session and openers. Using the
    // sport's first discipline (Swim for Triathlon) exactly reproduces the
    // pre-v0.42 behaviour, where this argument was `input.sports[0]`. That
    // is not a considered answer to "which discipline should race-week
    // openers be" — it's just what shipped before; revisit if that product
    // question ever gets a real answer.
    const raceWeekDiscipline = disciplinesOf(input.sport)[0];
    for (const w of raceWeekWorkouts(raceWeekDiscipline, raceIdx)) {
      // Which block on this day actually admits the session — never a
      // hardcoded blockIdx 0, and never dayMins' summed-across-blocks
      // question of whether the day has room at all.
      const blockIdx = findBlockFor(days, w.day, w, taken);
      if (blockIdx != null) {
        taken.add(
          slotKey({
            dayIdx: w.day,
            blockIdx,
            mins: 0,
            energy: "full",
            sports: null,
          })
        );
        days[w.day] = {
          ...days[w.day],
          workouts: [...days[w.day].workouts, { ...w, blockIdx }],
          status: "planned",
        };
        continue;
      }

      // Nothing admits it whole on its designated pre-race day (energy
      // tier, size, sport, adjacency, or the per-day cap). Race-week
      // sessions are pinned to a specific day relative to the race, so —
      // unlike the main loop below — only that day's own blocks are
      // candidates; try the same fitting rule a replan uses before giving
      // up, and only drop, with a logged reason, when nothing does.
      const candidates = buildSlots(days).filter(
        (s) =>
          s.dayIdx === w.day &&
          !taken.has(slotKey(s)) &&
          days[s.dayIdx].workouts.length < MAX_SESSIONS_PER_DAY &&
          (s.sports === null || s.sports.includes(w.sport))
      );
      let placed = false;
      for (const candidate of candidates) {
        const fitted = fitToBlock(w, candidate.mins);
        if (!fitted) continue;
        if (!admits(candidate, fitted.workout, days, taken)) continue;

        taken.add(slotKey(candidate));
        const target = days[candidate.dayIdx];
        days[candidate.dayIdx] = {
          ...target,
          workouts: [
            ...target.workouts,
            { ...fitted.workout, blockIdx: candidate.blockIdx },
          ],
          status: "planned",
        };
        adjustments.push({
          date: target.date,
          trigger: "no_time",
          action: fitted.how === "compressed" ? "scaled" : "swapped",
          before: [],
          after: [],
          reason:
            fitted.how === "compressed"
              ? `no block fits ${w.durationMins}min — ${w.type} shortened to ${fitted.workout.durationMins}min`
              : `no block fits ${w.type} — replaced by ${fitted.workout.type}, which works in ${fitted.workout.durationMins}min`,
        });
        placed = true;
        break;
      }
      if (placed) continue;

      adjustments.push({
        date: days[w.day].date,
        trigger: "no_time",
        action: "dropped",
        before: [],
        after: [],
        reason: `no block on ${days[w.day].date} fits a ${w.durationMins}min ${w.type} — race-week session dropped`,
      });
    }
  } else if (sessions > 0) {
    const effectiveHours = Math.min(hoursBudget, neededHours);
    let workouts: ReturnType<typeof generateWorkouts> = [];
    try {
      workouts = generateWorkouts(
        sessions,
        effectiveHours,
        skeleton.phase,
        input.sport,
        input.queenStageHours ?? null
      )
        .sort((a, b) => b.durationMins - a.durationMins)
        .slice(0, sessions);
    } catch (_err) {
      // Failure-safe: on generation errors, land a recovery-biased week rather
      // than an aggressive or empty one.
      const fallbackSport =
        input.sport === "Run"
          ? "Run"
          : input.sport === "Triathlon"
            ? "Swim"
            : "Bike";
      const fallbackDays = days
        .map((d, i) => ({ i, mins: d.availableMins }))
        .filter((x) => x.mins > 0)
        .slice(0, Math.max(1, sessions));
      workouts = fallbackDays.map((x) =>
        withPurpose({
          day: x.i,
          sport: fallbackSport,
          type: "Recovery",
          durationMins: Math.min(30, x.mins),
          intensity: "Recovery",
          description: "Fallback recovery session",
        })
      );
      adjustments.push({
        date: input.weekStart,
        trigger: "weekly_rollover",
        action: "scaled",
        before: [],
        after: [],
        reason:
          "generation fallback: dependencies failed, so a recovery-biased safe week was materialized",
        reasonCode: "safe_fallback_generation_error",
        context: {
          fallbackSessions: workouts.length,
          targetSessions: sessions,
        },
      });
    }

    if (comeback.mode !== "none") {
      const downgraded = workouts.map((w) => {
        if (w.type !== "Intervals") return w;
        return withPurpose({
          ...w,
          type: "Tempo",
          intensity: "Z3",
          description: `Illness comeback cap: ${w.description}`,
        });
      });
      if (downgraded.some((w, i) => w.type !== workouts[i].type)) {
        adjustments.push({
          date: input.weekStart,
          trigger: "weekly_rollover",
          action: "scaled",
          before: [],
          after: [],
          reason: "illness comeback: intensity above tempo removed",
          reasonCode: "comeback_intensity_cap",
          context: { comebackMode: comeback.mode },
        });
      }
      workouts = downgraded;
    }

    const shaped = applyOffSeasonShaping({
      workouts,
      seasonMode: seasonState.seasonMode,
      reentryStage: seasonState.reentryStage,
      targetSessions: sessions,
    });
    workouts = shaped.workouts.slice(
      0,
      Math.min(shaped.targetSessions, shaped.workouts.length)
    );

    // For cycling, the long ride and every Endurance filler are capped at
    // longRideBoundMins(queenStageHours) — event-derived when the athlete's
    // race gives us a queen stage, the old flat 240-minute ceiling when it
    // doesn't — and whatever that cap removes is redistributed onto
    // whichever of those sessions still has headroom rather than discarded
    // (generateCyclingWorkouts' distributeRemainder call). A shortfall below
    // can still legitimately occur when there is nowhere left to put the
    // remainder — every capped session already at its bound (few sessions,
    // a small queen stage) — and running/triathlon weeks have no such
    // redistribution at all, so their hard caps still discard outright.
    // Say so rather than let WeekRationale print an unexplained deficit.
    const generatedHours =
      workouts.reduce((s, w) => s + w.durationMins, 0) / 60;
    if (
      effectiveHours > 0 &&
      generatedHours < effectiveHours * (1 - GENERATOR_CAP_SHORTFALL_PCT)
    ) {
      adjustments.push({
        date: input.weekStart,
        trigger: "weekly_rollover",
        action: "scaled",
        before: [],
        after: [],
        reason: `session limits cap this week at ${generatedHours.toFixed(
          1
        )}h against a ${effectiveHours.toFixed(1)}h target`,
      });
    }

    const taken = new Set<string>();

    for (const w of workouts) {
      const slots = buildSlots(days); // rebuilt: earlier placements change admission
      const admittingSlots = slots.filter((s) => admits(s, w, days, taken));
      let slot = orderByStylePreference(
        admittingSlots,
        w,
        planStyle,
        skeleton.phase,
        skeleton.weekNumber
      )[0];
      let workout = w;

      if (!slot && isQuality(w)) {
        // No admitting slot for a quality session: step it down until it is
        // no longer quality, exactly as the previous engine did.
        let steppedType = w.type;
        while ((QUALITY_TYPES as readonly string[]).includes(steppedType)) {
          steppedType = STEP_DOWN[steppedType] ?? "Endurance";
        }
        const stepped = withPurpose({
          ...w,
          type: steppedType,
          intensity: "Z1-Z2",
        });
        const steppedAdmitting = buildSlots(days).filter((s) =>
          admits(s, stepped, days, taken)
        );
        const steppedSlot = orderByStylePreference(
          steppedAdmitting,
          stepped,
          planStyle,
          skeleton.phase,
          skeleton.weekNumber
        )[0];
        if (steppedSlot) {
          slot = steppedSlot;
          workout = stepped;
          adjustments.push({
            date: days[steppedSlot.dayIdx].date,
            trigger: "weekly_rollover",
            action: "scaled",
            before: [],
            after: [],
            reason: `no admitting slot for ${w.type} — stepped down to ${stepped.type}`,
          });
        }
      }

      if (!slot) {
        // Nothing admits it whole. Rather than drop it silently, try the
        // same fitting rule a replan uses — but a fitted (shortened or
        // substituted) session still needs to be *safe* to place, so every
        // candidate is checked with the real admission rule, roomiest
        // first, until one passes or none do.
        const candidates = buildSlots(days).filter(
          (s) =>
            !taken.has(slotKey(s)) &&
            days[s.dayIdx].workouts.length < MAX_SESSIONS_PER_DAY &&
            (s.sports === null || s.sports.includes(workout.sport))
        );
        const orderedCandidates = orderByStylePreference(
          candidates,
          workout,
          planStyle,
          skeleton.phase,
          skeleton.weekNumber
        );
        let placed = false;
        for (const candidate of orderedCandidates) {
          const fitted = fitToBlock(workout, candidate.mins);
          if (!fitted) continue;
          if (!admits(candidate, fitted.workout, days, taken)) continue;

          taken.add(slotKey(candidate));
          const target = days[candidate.dayIdx];
          days[candidate.dayIdx] = {
            ...target,
            workouts: [
              ...target.workouts,
              { ...fitted.workout, blockIdx: candidate.blockIdx },
            ],
            status: "planned",
          };
          adjustments.push({
            date: target.date,
            trigger: "no_time",
            action: fitted.how === "compressed" ? "scaled" : "swapped",
            before: [],
            after: [],
            reason:
              fitted.how === "compressed"
                ? `no block fits ${workout.durationMins}min — ${workout.type} shortened to ${fitted.workout.durationMins}min`
                : `no block fits ${workout.type} — replaced by ${fitted.workout.type}, which works in ${fitted.workout.durationMins}min`,
          });
          placed = true;
          break;
        }
        if (placed) continue;
        adjustments.push({
          date: input.weekStart,
          trigger: "no_time",
          action: "dropped",
          before: [],
          after: [],
          reason: `no block in the week fits a ${workout.durationMins}min ${workout.type} — session dropped`,
        });
        continue;
      }
      taken.add(slotKey(slot));
      const target = days[slot.dayIdx];
      days[slot.dayIdx] = {
        ...target,
        workouts: [...target.workouts, { ...workout, blockIdx: slot.blockIdx }],
        status: "planned",
      };
    }
  }

  for (const race of races) {
    const idx = dates.indexOf(race.date);
    if (idx === -1) continue;
    if (days[idx].workouts.length > 0) {
      adjustments.push({
        date: race.date,
        trigger: "race",
        action: "swapped",
        before: [
          { ...days[idx], workouts: days[idx].workouts.map((w) => ({ ...w })) },
        ],
        after: [],
        reason: `race day: ${race.name} replaces the planned workout`,
      });
    }
    days[idx] = {
      ...days[idx],
      workouts: [],
      status: "race",
      raceName: race.name,
    };
  }

  // A/B protection around the primary race.
  if (primary && primary.priority === "A") {
    const idx = dates.indexOf(primary.date);
    // Guard against clobbering a day that the race loop above already
    // turned into its OWN race day (e.g. a C-priority shakeout race that
    // happens to fall the day before the primary). That day must keep its
    // "race" status and raceName, not get overwritten into a stale "rest"
    // day — it is not the kind of empty day restIntent describes.
    if (idx >= 1 && days[idx - 1].status !== "race") {
      // `before` is only built when the day held sessions — that's the
      // signal for whether a "dropped" adjustment record is warranted. The
      // strip-and-stamp below is unconditional: an A-priority race's
      // pre-race day is never populated in the first place (raceWeekWorkouts
      // places nothing at raceIdx-1), so restIntent must still land there
      // even though there is nothing to strip and no adjustment to log.
      let before: DaySlot | null = null;
      if (days[idx - 1].workouts.length > 0) {
        before = {
          ...days[idx - 1],
          workouts: days[idx - 1].workouts.map((w) => ({ ...w })),
        };
      }
      days[idx - 1] = {
        ...days[idx - 1],
        workouts: [],
        status: "rest",
        restIntent: "pre_race",
      };
      if (before) {
        adjustments.push({
          date: before.date,
          trigger: "race",
          action: "dropped",
          before: [before],
          after: [{ ...days[idx - 1] }],
          reason: `rest before ${primary.name}`,
        });
      }
    }
    if (
      !isRaceWeek &&
      idx >= 2 &&
      days[idx - 2].workouts.some((w) => isQuality(w))
    ) {
      const before = {
        ...days[idx - 2],
        workouts: days[idx - 2].workouts.map((w) => ({ ...w })),
      };
      // Step down every quality session on the day, keeping any
      // non-quality sibling exactly as it was — never rebuilding the day
      // as a one-element array, which silently dropped a second session.
      days[idx - 2] = {
        ...days[idx - 2],
        workouts: days[idx - 2].workouts.map((w) =>
          isQuality(w)
            ? withPurpose({ ...w, type: "Endurance", intensity: "Z1-Z2" })
            : w
        ),
        status: "planned",
      };
      adjustments.push({
        date: before.date,
        trigger: "race",
        action: "scaled",
        before: [before],
        after: [{ ...days[idx - 2] }],
        reason: `no quality 2 days before ${primary.name} — stepped down to Endurance`,
      });
    }
  } else if (primary && primary.priority === "B") {
    const idx = dates.indexOf(primary.date);

    if (idx >= 1 && days[idx - 1].status !== "race") {
      const before = {
        ...days[idx - 1],
        workouts: days[idx - 1].workouts.map((w) => ({ ...w })),
      };

      if (fatigueHigh || days[idx - 1].availableMins < 20) {
        days[idx - 1] = {
          ...days[idx - 1],
          workouts: [],
          status: "rest",
          restIntent: "pre_race",
        };
        adjustments.push({
          date: before.date,
          trigger: "race",
          action: "dropped",
          before: [before],
          after: [{ ...days[idx - 1] }],
          reason: `B-race pre-day set to rest before ${primary.name}`,
        });
      } else {
        const opener = withPurpose({
          day: idx - 1,
          sport: disciplinesOf(input.sport)[0],
          type: "Endurance",
          durationMins: Math.min(30, days[idx - 1].availableMins),
          intensity: "Z1-Z2",
          description: `Pre-race opener for ${primary.name}`,
        });
        const openerBlockIdx = findBlockFor(days, idx - 1, opener, new Set());
        if (openerBlockIdx == null) {
          days[idx - 1] = {
            ...days[idx - 1],
            workouts: [],
            status: "rest",
            restIntent: "pre_race",
          };
          adjustments.push({
            date: before.date,
            trigger: "race",
            action: "dropped",
            before: [before],
            after: [{ ...days[idx - 1] }],
            reason: `B-race pre-day set to rest before ${primary.name}`,
          });
        } else {
          days[idx - 1] = {
            ...days[idx - 1],
            workouts: [{ ...opener, blockIdx: openerBlockIdx }],
            status: "planned",
            restIntent: undefined,
          };
          adjustments.push({
            date: before.date,
            trigger: "race",
            action: "scaled",
            before: [before],
            after: [{ ...days[idx - 1] }],
            reason: `B-race pre-day opener placed before ${primary.name}`,
          });
        }
      }
    }

    if (idx >= 2 && days[idx - 2].workouts.some((w) => isQuality(w))) {
      const before = {
        ...days[idx - 2],
        workouts: days[idx - 2].workouts.map((w) => ({ ...w })),
      };

      days[idx - 2] = {
        ...days[idx - 2],
        workouts: days[idx - 2].workouts.map((w) => {
          if (w.type === "Intervals") {
            return withPurpose({ ...w, type: "Tempo", intensity: "Z3" });
          }
          if (w.type === "Tempo" || w.type === "Brick") {
            return withPurpose({ ...w, type: "Endurance", intensity: "Z1-Z2" });
          }
          return w;
        }),
        status: "planned",
      };

      adjustments.push({
        date: before.date,
        trigger: "race",
        action: "scaled",
        before: [before],
        after: [{ ...days[idx - 2] }],
        reason: `B-race tune: lowered intensity 2 days before ${primary.name}`,
      });
    }
  }

  return {
    week: {
      weekStart: input.weekStart,
      skeletonWeek: skeleton.weekNumber,
      days,
    },
    adjustments,
    effectiveLoad,
  };
}
