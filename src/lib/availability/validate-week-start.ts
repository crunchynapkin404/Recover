// Pure: no DB, no clock reads.

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True when `value` is a genuine calendar date in YYYY-MM-DD form that
 * falls on a Monday — the only shape `submitAvailability`'s optional
 * `weekStart` field may target, since every stored week and every
 * projected week starts on a Monday.
 *
 * Rejects both malformed strings and dates that don't round-trip through
 * the Date constructor unchanged (e.g. "2027-02-30", which JS quietly
 * rolls into March) rather than trusting the shape check alone.
 * `submitAvailability` is a "use server" export — a directly reachable
 * RPC endpoint, not just whatever the week switcher UI happens to send —
 * so a bogus value here must be refused, not silently coerced into
 * writing overrides on the wrong date.
 */
export function isMondayYmd(value: string): boolean {
  if (!YMD_RE.test(value)) return false;
  const [y, m, day] = value.split("-").map(Number);
  const d = new Date(value + "T00:00:00");
  if (d.getFullYear() !== y || d.getMonth() !== m - 1 || d.getDate() !== day) {
    return false;
  }
  return d.getDay() === 1;
}

/** What `submitAvailability` should actually do with an already-Monday-shaped `weekStart`. */
export type WeekStartResolution =
  | { kind: "current" }
  | { kind: "future"; weekStart: string }
  | { kind: "rejected"; reason: "past" };

/**
 * Final-review Finding 1: a `weekStart` naming a real Monday is not, by
 * itself, a FUTURE Monday — it names a week, and `submitAvailability` must
 * compare it against the week that is ACTUALLY open rather than trusting
 * "present" to mean "future". Pure and DB-free so this decision has
 * CI-visible coverage independent of `tests/submit-availability-week.test.ts`,
 * which is DB-gated and does not run in CI (no `DATABASE_URL` there).
 *
 * - No requested value at all: always the current week.
 * - A requested value equal to the open week's own `weekStart`: also the
 *   current week, despite `weekStart` being present. This is what actually
 *   happens at the Sunday→Monday rollover boundary — the week switcher's
 *   hidden `weekStart` is baked in at page-render time, so a tab left open
 *   across the rollover submits a value that, by the time this action
 *   runs, IS the now-open week's Monday. Also covers a direct caller of
 *   this "use server" export naming the open week outright.
 * - A requested value strictly before the open week's `weekStart`: a past
 *   week. There is no plan left there to replan and nothing meaningful for
 *   an override to do once the week is over, so this is rejected rather
 *   than silently written — the same honesty the non-Monday case already
 *   gets.
 * - Anything else — strictly after the open week's `weekStart`, or any
 *   Monday at all when there is no open week to compare against — is a
 *   genuine future week, unchanged from before this fix.
 *
 * `openWeekStart` is `null` when the athlete has no open week at all (no
 * active plan, or one that hasn't rolled over yet) — there is nothing to
 * compare against, so every requested Monday is treated as future, exactly
 * as it always was.
 */
export function resolveWeekStartTarget(
  requestedWeekStart: string | null,
  openWeekStart: string | null
): WeekStartResolution {
  if (requestedWeekStart === null) return { kind: "current" };
  if (openWeekStart === null) {
    return { kind: "future", weekStart: requestedWeekStart };
  }
  if (requestedWeekStart === openWeekStart) return { kind: "current" };
  if (requestedWeekStart < openWeekStart)
    return { kind: "rejected", reason: "past" };
  return { kind: "future", weekStart: requestedWeekStart };
}
