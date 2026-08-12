import type { TodayState } from "./state";

/**
 * Which blocks Today renders, in which order, for each moment (v0.99 slice 1).
 *
 * Lifted out of `src/app/page.tsx` so the ordering policy is a named unit
 * with its own tests, rather than an object literal buried in a 900-line
 * server component. `page.tsx` maps these keys onto rendered blocks; this
 * file owns only the sequence.
 *
 * THE GOVERNING RULE IS "REORDER, NEVER HIDE": the block that answers the
 * athlete's current moment comes first, and everything else keeps its place
 * below. No state may make content unreachable that another state shows.
 * `block-order.test.ts` enforces that mechanically — see the invariants
 * declared below, which exist so the test can check the rule instead of
 * re-stating a copy of it.
 */
export type TodayBlockKey =
  | "heroFull"
  | "heroCompact"
  | "heroRecap"
  | "calibration"
  | "vitals"
  | "week"
  | "session"
  | "sessionDone"
  | "sessionTomorrow"
  | "justLanded"
  | "dayLog"
  | "bedtime"
  | "debriefChip"
  | "raceChip"
  | "coach";

/**
 * Keys that are alternative renderings of ONE underlying block. A state picks
 * exactly one member of each family — the morning's full hero and the
 * evening's stale recap are the same block at different emphasis, not two
 * different blocks, so "every state shows every block" must be checked
 * against families rather than raw keys.
 */
export const VARIANT_FAMILY: Partial<Record<TodayBlockKey, string>> = {
  heroFull: "hero",
  heroCompact: "hero",
  heroRecap: "hero",
  session: "session",
  sessionDone: "session",
  // sessionTomorrow is deliberately NOT in the session family. It shows a
  // DIFFERENT DAY, so it is its own block, not another emphasis of today's —
  // which is why the evening legitimately renders both, and why grouping
  // them made the "exactly one per family" check fail against correct code.
};

/**
 * Blocks whose subject IS a particular moment, so appearing in one state only
 * is correct rather than a gap.
 *
 * Two members, each with its reason, and the bar for a third is high.
 *
 * `justLanded` — its whole content is "a session ended within the last few
 * hours". Outside that window `page.tsx` does not even assemble its props,
 * so there is nothing for it to render elsewhere.
 *
 * `sessionTomorrow` — "what am I asked to do next" is an evening question.
 * At 09:00 it would compete for attention with today's session, which is the
 * thing the morning exists to answer, and tomorrow's plan stays one tap away
 * on /train either way. This one is a judgement call rather than a structural
 * fact, and it is recorded here so it can be argued with.
 *
 * Contrast `dayLog` and `bedtime`, which were briefly evening-only and were
 * moved into every state — an athlete who logs at 14:00 sits in the morning
 * state, and their own log must not be missing from Today until 18:00.
 */
export const MOMENT_ONLY: ReadonlySet<TodayBlockKey> = new Set([
  "justLanded",
  "sessionTomorrow",
] as const);

/** The concept a key contributes: its family, or the key itself. */
export function blockConcept(key: TodayBlockKey): string {
  return VARIANT_FAMILY[key] ?? key;
}

export const BLOCK_ORDER: Record<TodayState, readonly TodayBlockKey[]> = {
  morning: [
    "heroFull",
    "calibration",
    "vitals",
    "week",
    "session",
    "debriefChip",
    "raceChip",
    "coach",
    // Tail, not lead: an athlete who logs at 14:00 is still in the morning
    // state, and their own log must not be missing from Today until 18:00.
    // Both cards render null when they have nothing, so this costs an
    // unlogged morning nothing.
    "dayLog",
    "bedtime",
  ],
  "post-session": [
    "justLanded",
    "heroCompact",
    "sessionDone",
    "calibration",
    "vitals",
    "week",
    "debriefChip",
    "raceChip",
    "coach",
    "dayLog",
    "bedtime",
  ],
  evening: [
    "dayLog",
    "heroRecap",
    "sessionTomorrow",
    "bedtime",
    "coach",
    "calibration",
    "vitals",
    "week",
    "session",
    "debriefChip",
    "raceChip",
  ],
};

/**
 * The morning layout's left column at lg+ — vitals and the week beside the
 * hero, with the session and the coach on the right. Morning only: the
 * 7fr/5fr split is a morning-shaped layout and cannot survive an arbitrary
 * reorder, so the other two states take one honest column.
 */
export const MORNING_LEFT_COLUMN: ReadonlySet<TodayBlockKey> = new Set([
  "heroFull",
  "calibration",
  "vitals",
  "week",
] as const);
