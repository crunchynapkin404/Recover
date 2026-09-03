import type { Band } from "@/lib/readiness";
import type { LibraryPurpose, LibraryWorkout } from "./types";
import { LIBRARY } from "./library";

/**
 * What the day looks like, as far as choosing a workout for it goes.
 *
 * Every field is something the app already computes. This module derives no
 * new fact about the athlete — it only orders workouts against facts the
 * engine has already established, which is why it can claim no more than
 * they do.
 */
export interface RecommendContext {
  band: Band;
  /** Days since the last quality session. Large when there has been none. */
  daysSinceQuality: number;
  /** The week's planned load so far as a fraction of its target. */
  weekLoadFraction: number;
  /** Families ridden recently, most recent first. */
  recentFamilies: readonly string[];
}

export interface Recommendation {
  workoutId: string;
  /** 0 is the strongest recommendation. Dense, no gaps. */
  rank: number;
  /** One sentence, in the engine's own vocabulary. Never mentions watts. */
  why: string;
}

const QUALITY: ReadonlySet<LibraryPurpose> = new Set(["threshold", "vo2max"]);

/**
 * How much a red band demotes a quality session.
 *
 * Source: Coaching convention — the same judgement adaptDay already makes
 * when it substitutes a recovery session on a red band. This module claims
 * nothing that rung does not.
 * What would raise it: a controlled comparison of outcomes when an athlete
 * trains hard against a red reading versus resting, on this athlete.
 * Confidence: Low.
 */
const RED_QUALITY_PENALTY = 100;

/**
 * How much an amber — or an unreadable — band demotes a quality session.
 *
 * Source: Coaching convention, mirroring adaptDay's amber step-down, which
 * reduces intensity rather than removing it.
 * What would raise it: the same comparison RED_QUALITY_PENALTY needs.
 * Confidence: Low.
 *
 * `calibrating` is scored HERE rather than with green deliberately: it means
 * readiness cannot be read yet, and the permissive reading of "we don't know"
 * is the one that gets an athlete hurt.
 */
const CAUTIOUS_QUALITY_PENALTY = 40;

/**
 * How much a quality session is demoted per day of insufficient recovery.
 *
 * Source: Coaching convention — the engine's own "quality sessions never sit
 * on consecutive days" rule (QUALITY_TYPES in week-plan/types.ts), expressed
 * as a gradient rather than a hard gate because this module ranks and never
 * filters.
 * What would raise it: evidence on this athlete's own recovery between hard
 * sessions. Nothing measures it today.
 * Confidence: Low.
 */
const QUALITY_RECOVERY_PENALTY = 45;

/** Days of separation below which a quality session is discouraged. */
const QUALITY_RECOVERY_DAYS = 2;

/**
 * How much a family ridden recently is demoted.
 *
 * Source: Invented — the library's own rotation rule (family, not id) applied
 * to a manual pick, so browsing does not surface the same shape the engine
 * just prescribed.
 * What would raise it: nothing available. It is a judgement about variety,
 * not a measurable quantity.
 * Confidence: Low.
 */
const RECENT_FAMILY_PENALTY = 30;

/**
 * How much long/quality work is demoted once the week is already over target.
 *
 * Source: Coaching convention — materializeWeek already treats the week's
 * target as a ceiling worth respecting, and this applies the same judgement
 * to a session the athlete adds on top of it.
 * What would raise it: the same evidence the week target itself needs.
 * Confidence: Low.
 */
const OVER_TARGET_PENALTY = 60;

/** Above this fraction of the week's target, extra load is discouraged. */
const OVER_TARGET_FRACTION = 1.0;

/**
 * How much a quality session is PROMOTED on a day that can take one.
 *
 * Without this the green, rested, under-target case scores every workout
 * identically and the order falls out of the id tie-break — which would make
 * "recommended" mean "alphabetically first". The engine's own plans put
 * intensity on exactly these days, so this states no new preference; it
 * mirrors what materializeWeek already does when it places quality.
 *
 * Source: Coaching convention — the engine's own placement rule for quality
 * sessions, applied to a manual pick.
 * What would raise it: evidence that this athlete responds better to
 * intensity on green days than to the alternative. Nothing measures it.
 * Confidence: Low.
 */
const FRESH_QUALITY_BONUS = 50;

function isCautious(band: Band): boolean {
  return band === "amber" || band === "calibrating";
}

function score(w: LibraryWorkout, ctx: RecommendContext): number {
  let s = 0;
  const quality = QUALITY.has(w.purpose);
  const heavy = quality || w.purpose === "long";

  if (quality) {
    if (ctx.band === "red") s -= RED_QUALITY_PENALTY;
    else if (isCautious(ctx.band)) s -= CAUTIOUS_QUALITY_PENALTY;
    if (ctx.daysSinceQuality < QUALITY_RECOVERY_DAYS) {
      s -=
        QUALITY_RECOVERY_PENALTY *
        (QUALITY_RECOVERY_DAYS - ctx.daysSinceQuality);
    }
  }
  if (
    quality &&
    ctx.band === "green" &&
    ctx.daysSinceQuality >= QUALITY_RECOVERY_DAYS &&
    ctx.weekLoadFraction <= OVER_TARGET_FRACTION
  ) {
    s += FRESH_QUALITY_BONUS;
  }
  if (w.purpose === "recovery" && ctx.band === "red") s += RED_QUALITY_PENALTY;
  if (heavy && ctx.weekLoadFraction > OVER_TARGET_FRACTION)
    s -= OVER_TARGET_PENALTY;
  if (ctx.recentFamilies.includes(w.family)) s -= RECENT_FAMILY_PENALTY;
  return s;
}

function why(w: LibraryWorkout, ctx: RecommendContext): string {
  const quality = QUALITY.has(w.purpose);
  if (w.purpose === "recovery" && ctx.band === "red")
    return "Readiness is red today — easy work is what this day is for.";
  if (quality && ctx.band === "red")
    return "Harder than today's red readiness recommends.";
  if (quality && isCautious(ctx.band))
    return ctx.band === "calibrating"
      ? "Readiness is still calibrating, so intensity is not yet advised."
      : "Readiness is amber — intensity is a step above what is advised.";
  if (quality && ctx.daysSinceQuality < QUALITY_RECOVERY_DAYS)
    return "You did quality work yesterday; this needs more recovery first.";
  if (quality) return "You are rested and this week has room for intensity.";
  if (ctx.weekLoadFraction > OVER_TARGET_FRACTION)
    return "This week is already past its target, so keep it easy.";
  if (ctx.recentFamilies.includes(w.family))
    return "Same shape as a session you rode recently.";
  return "Steady aerobic work that fits most days.";
}

/**
 * The whole library, ordered for this day.
 *
 * RANKS AND NEVER FILTERS. Every workout comes back, because the athlete
 * asked for the whole library and a shortlist would be the app deciding for
 * them on the one surface built for them to decide. Recover's opinion travels
 * as the order and the `why`, not as a shorter list.
 *
 * Deterministic: ties break on `id`, which the library guarantees is stable
 * and never renumbered.
 */
export function recommendWorkouts(ctx: RecommendContext): Recommendation[] {
  // A family's Nth-best workout, counted over the library's own id order.
  // Sorting on this AHEAD of id is what stops one family filling the top of
  // the list: every family's best offer is ranked before any family's second.
  //
  // Found by opening the capture, not by a test. With the week over target
  // every endurance workout scored identically, the id tie-break took over,
  // and the recommended five were four near-identical "High Cadence"
  // variants — a list that repeats itself reads as broken however correct
  // each row is. library.ts already states the principle for the engine's own
  // rotation: it "avoids repeating a FAMILY, not merely an id", because
  // purpose and duration alone collapse 100 workouts onto two axes.
  const seen = new Map<string, number>();
  const withRotation = [...LIBRARY]
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((w) => {
      const n = seen.get(w.family) ?? 0;
      seen.set(w.family, n + 1);
      return { w, s: score(w, ctx), nth: n };
    });

  return withRotation
    .sort((a, b) => b.s - a.s || a.nth - b.nth || (a.w.id < b.w.id ? -1 : 1))
    .map(({ w }, i) => ({ workoutId: w.id, rank: i, why: why(w, ctx) }));
}
