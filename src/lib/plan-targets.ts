// src/lib/plan-targets.ts — the one read path for "which race is which" on a
// training plan.
//
// `training_plans.raceId`/`raceDate` have always meant the plan's FINAL
// target; migration 0042 added `firstRaceId`/`firstRaceDate`/`firstRaceType`
// to name an EARLIER A-race on a two-race plan, without repurposing the
// existing columns. Every call site that needs to know which race is which
// must go through `planRaceTargets` rather than reading `raceDate` (or
// `firstRaceDate`) directly, or it will silently pick the wrong race on a
// two-race plan.

export interface RaceTarget {
  id: string;
  date: string; // YYYY-MM-DD
  raceType: string;
}

/** `final` is always the plan's end. `first` is null on a single-race plan. */
export function planRaceTargets(plan: {
  raceId: string | null;
  raceDate: string;
  raceType: string;
  firstRaceId: string | null;
  firstRaceDate: string | null;
  firstRaceType: string | null;
}): { first: RaceTarget | null; final: RaceTarget } {
  // Keyed on firstRaceId, never firstRaceDate: ON DELETE SET NULL on
  // first_race_id nulls the id but leaves the denormalized date/type columns
  // behind. A plan whose first race row was deleted must degrade to a
  // single-race plan, not report a half-configured first race.
  const first =
    plan.firstRaceId != null &&
    plan.firstRaceDate != null &&
    plan.firstRaceType != null
      ? {
          id: plan.firstRaceId,
          date: plan.firstRaceDate,
          raceType: plan.firstRaceType,
        }
      : null;

  return {
    first,
    final: {
      // raceId is nullable in the schema (a plan need not link back to a
      // `races` row), but RaceTarget.id is a plain string; "" is the
      // sentinel for "no linked race row" rather than laundering null into
      // a truthy id.
      id: plan.raceId ?? "",
      date: plan.raceDate,
      raceType: plan.raceType,
    },
  };
}
