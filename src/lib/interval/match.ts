import type { Purpose } from "@/lib/availability/types";
import type { Block, LibraryWorkout, LibraryPurpose } from "./types";
import { resolve } from "./flex";

/**
 * The session facts the matcher reads — a structural subset of
 * `PlannedWorkout`, so a `ScheduledWorkout` satisfies it with no adapter.
 *
 * `sport` is here even though it is deliberately NOT a field on a
 * LibraryWorkout: the module is cycling-only, so the refusal happens once,
 * here, rather than as a constant repeated across 100+ literals.
 */
export interface MatchSession {
  sport: string;
  purpose: Purpose;
  durationMins: number;
}

/**
 * There is no `synthesized` variant. The spec reserved one and nothing in
 * this slice can return it; an unreachable variant is dead code with a type
 * to maintain. It goes in when something actually synthesizes.
 */
export type MatchResult =
  | { kind: "matched"; workout: LibraryWorkout; blocks: Block[] }
  | {
      kind: "refused";
      reason: "not-cycling" | "not-a-library-purpose" | "no-candidate";
    };

/**
 * Keyed by LibraryPurpose so the two cannot drift: adding a member to
 * LibraryPurpose without adding it here is a compile error, and a key that is
 * not a LibraryPurpose is also a compile error. types.ts asks for exactly this
 * — "never a parallel union ... rather than a silent hole".
 */
const LIBRARY_PURPOSE_KEYS: Record<LibraryPurpose, true> = {
  recovery: true,
  aerobic_base: true,
  long: true,
  threshold: true,
  vo2max: true,
};

const LIBRARY_PURPOSES: ReadonlySet<string> = new Set(
  Object.keys(LIBRARY_PURPOSE_KEYS)
);

/**
 * FNV-1a. Deterministic, dependency-free, and well spread over short inputs
 * like a date string.
 *
 * A hash rather than a counter because the seed must be the DAY'S OWN DATE and
 * nothing else: that is what makes a re-render, a re-read, and a projection
 * all pick the same workout, with no state to keep in sync.
 */
function seed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Avalanche the accumulator before anything takes it modulo a small number.
  // NOT optional and not cargo cult: FNV-1a's prime is odd, so its low bit is
  // only a parity of the input's low bits — which makes seed(`${date}|${family}`)
  // a CONSTANT XOR of seed(date), and the in-family draw a constant on exactly
  // the dates that chose that family. Measured before this line: one workout of
  // a two-workout family was picked 0 times in 364 days.
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * The workout this day gets, or an honest refusal.
 *
 * The library is a PARAMETER, not an import, which is what let this be built
 * and tested before slice 2 authored anything.
 *
 * VARIETY IS SPREAD, NOT AVOIDANCE. There is no history argument. Avoiding
 * what a nearby day picked would require knowing it, and the only ways to know
 * are to accept a `recent` list — reintroducing exactly the neighbouring-day
 * dependency the staleness fix removed from the pin — or to store something.
 * Two days a fortnight apart can draw the same workout; nothing promises
 * otherwise, and the promise is not worth the coupling.
 *
 * The pick is FAMILY-FIRST: choose the family, then choose within it. Picking
 * ids uniformly would let a family holding five workouts outvote one holding a
 * single workout, which is the opposite of what `family` is for.
 *
 * Any candidate inside its flex bound is acceptable by construction — that is
 * what bounding the flex is for — so this does not also rank by how little a
 * workout stretches. Ranking that way would collapse variety outright: the
 * nearest-fitting workout would win every time for a given duration.
 */
export function matchWorkout(
  library: readonly LibraryWorkout[],
  session: MatchSession,
  date: string
): MatchResult {
  if (session.sport !== "Bike") {
    return { kind: "refused", reason: "not-cycling" };
  }
  if (!LIBRARY_PURPOSES.has(session.purpose)) {
    return { kind: "refused", reason: "not-a-library-purpose" };
  }

  const candidates: { workout: LibraryWorkout; blocks: Block[] }[] = [];
  for (const w of library) {
    if (w.purpose !== session.purpose) continue;
    const blocks = resolve(w, session.durationMins);
    if (blocks) candidates.push({ workout: w, blocks });
  }
  if (candidates.length === 0) {
    return { kind: "refused", reason: "no-candidate" };
  }

  const families = [...new Set(candidates.map((c) => c.workout.family))].sort();
  const family = families[seed(date) % families.length];
  const inFamily = candidates
    .filter((c) => c.workout.family === family)
    .sort((a, b) => a.workout.id.localeCompare(b.workout.id));
  // A second seed with the family mixed in, so the within-family index is not
  // correlated with the family index.
  const chosen = inFamily[seed(`${date}|${family}`) % inFamily.length];
  return { kind: "matched", workout: chosen.workout, blocks: chosen.blocks };
}
