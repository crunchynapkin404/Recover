/**
 * Runs the suite as if today were a different day. Inert unless
 * `CLOCK_SHIFT_DAYS` is set, so it costs a normal run nothing.
 *
 * It exists because a fixture that keys on the real calendar can make `ci.yml`
 * — a release gate — fail on one weekday in seven. That is not hypothetical:
 * `fuelling-open-day.test.tsx` picked Saturday of the current week as its
 * "open day" and threw when TODAY was that Saturday, which blocked v0.139.0 on
 * 2026-09-05. Nothing could have caught it except running the suite on a
 * Saturday, which is what this file makes possible on any day.
 *
 * Offset-based, not frozen: time still advances, so timers behave normally.
 * Only the no-argument forms move — `new Date()` and `Date.now()`. Every other
 * constructor form and every static passes straight through, so a fixture
 * naming an absolute date still gets that date, which is the whole point of
 * naming one.
 *
 * Postgres keeps the REAL clock, so a test comparing a JS-made timestamp
 * against a DB-made one (`defaultNow()`, `now()`) sees a gap it would not see
 * on a genuinely different day. Run +7 as a control when reading results: a
 * failure that also appears at +7 is that mismatch, or absolute-date
 * sensitivity, rather than the weekday sensitivity this is hunting.
 */
const days = Number(process.env.CLOCK_SHIFT_DAYS ?? "0");

if (days !== 0) {
  const RealDate = Date;
  const offsetMs = days * 86400000;

  // A Proxy rather than a subclass: `ConstructorParameters<typeof Date>`
  // resolves to the LAST overload alone, so a subclass cannot type the
  // zero-argument branch this file exists for without an escape hatch. The
  // Proxy forwards every other form untouched through Reflect.construct, and
  // instances stay real Dates, so `instanceof`, the prototype and every
  // static keep working.
  globalThis.Date = new Proxy(RealDate, {
    construct(target, args) {
      if (args.length === 0) {
        return Reflect.construct(target, [RealDate.now() + offsetMs]);
      }
      return Reflect.construct(target, args);
    },
    get(target, prop, receiver) {
      if (prop === "now") return () => RealDate.now() + offsetMs;
      return Reflect.get(target, prop, receiver);
    },
  });
}
