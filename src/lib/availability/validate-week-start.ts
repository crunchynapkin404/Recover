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
