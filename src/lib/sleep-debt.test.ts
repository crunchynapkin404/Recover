import { describe, expect, it } from "vitest";
import {
  computeSleepDebt,
  sleepDebtFrom,
  DEFAULT_SLEEP_NEED_SECS,
} from "./sleep-debt";

const H = 3600;
/** n nights of exactly `hours` sleep. */
const nights = (hours: number, n: number) =>
  Array.from({ length: n }, () => ({ sleepSecs: hours * H }));

/** `base` minus `n` days, as a YYYY-MM-DD string. Test-only helper. */
function ymdOffset(base: string, n: number): string {
  const d = new Date(`${base}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

describe("sleep debt (hand-computed fixtures)", () => {
  it("reports null below MIN_DEBT_DAYS of real data", () => {
    const r = computeSleepDebt({
      nights: nights(6, 6),
      sleepNeedSecs: DEFAULT_SLEEP_NEED_SECS,
      wakeTime: "07:00",
    });
    expect(r.debtSecs).toBeNull();
    expect(r.nightsCounted).toBe(6);
    expect(r.confidence).toBe("none");
    expect(r.bedtime).toBeNull();
  });

  it("reports low confidence when only 7-9 nights are counted", () => {
    const r = computeSleepDebt({
      nights: nights(8, 9),
      sleepNeedSecs: DEFAULT_SLEEP_NEED_SECS,
      wakeTime: "07:00",
    });
    expect(r.confidence).toBe("low");
  });

  it("reports medium confidence when 10-12 nights are counted", () => {
    const r = computeSleepDebt({
      nights: nights(8, 11),
      sleepNeedSecs: DEFAULT_SLEEP_NEED_SECS,
      wakeTime: "07:00",
    });
    expect(r.confidence).toBe("medium");
  });

  it("reports high confidence when 13-14 nights are counted", () => {
    const r = computeSleepDebt({
      nights: nights(8, 14),
      sleepNeedSecs: DEFAULT_SLEEP_NEED_SECS,
      wakeTime: "07:00",
    });
    expect(r.confidence).toBe("high");
  });

  it("skips missing nights instead of counting them as perfect sleep", () => {
    const r = computeSleepDebt({
      nights: [...nights(8, 7), ...Array(7).fill({ sleepSecs: null })],
      sleepNeedSecs: DEFAULT_SLEEP_NEED_SECS,
      wakeTime: null,
    });
    expect(r.debtSecs).toBe(0);
    expect(r.nightsCounted).toBe(7);
  });

  it("does not let a surplus repay a deficit", () => {
    const r = computeSleepDebt({
      nights: [...nights(10, 6), { sleepSecs: 6 * H }],
      sleepNeedSecs: DEFAULT_SLEEP_NEED_SECS,
      wakeTime: null,
    });
    // Six 2h surpluses are ignored; the one 2h deficit stands.
    expect(r.debtSecs).toBe(2 * H);
  });

  it("only counts the most recent DEBT_WINDOW_DAYS nights", () => {
    const r = computeSleepDebt({
      nights: [...nights(2, 30), ...nights(8, 14)],
      sleepNeedSecs: DEFAULT_SLEEP_NEED_SECS,
      wakeTime: null,
    });
    expect(r.debtSecs).toBe(0);
    expect(r.nightsCounted).toBe(14);
  });

  it("gives no bedtime without a wake time — never a guessed one", () => {
    const r = computeSleepDebt({
      nights: nights(8, 7),
      sleepNeedSecs: DEFAULT_SLEEP_NEED_SECS,
      wakeTime: null,
    });
    expect(r.debtSecs).toBe(0);
    expect(r.bedtime).toBeNull();
  });

  it("subtracts the sleep need from the wake time when there is no debt", () => {
    const r = computeSleepDebt({
      nights: nights(8, 7),
      sleepNeedSecs: DEFAULT_SLEEP_NEED_SECS,
      wakeTime: "07:00",
    });
    expect(r.bedtime).toBe("23:00");
  });

  it("caps payback at one hour rather than recommending the impossible", () => {
    // Six nights at 8h (no debt) + one 2h night → 6h of debt.
    const r = computeSleepDebt({
      nights: [...nights(8, 6), { sleepSecs: 2 * H }],
      sleepNeedSecs: DEFAULT_SLEEP_NEED_SECS,
      wakeTime: "07:00",
    });
    expect(r.debtSecs).toBe(6 * H);
    // 07:00 − (8h need + 1h capped payback) = 22:00, not 17:00.
    expect(r.bedtime).toBe("22:00");
  });

  it("wraps backwards past midnight", () => {
    const r = computeSleepDebt({
      nights: nights(8, 7),
      sleepNeedSecs: DEFAULT_SLEEP_NEED_SECS,
      wakeTime: "05:00",
    });
    expect(r.bedtime).toBe("21:00");
  });

  it("rejects a malformed wake time instead of trusting it", () => {
    const r = computeSleepDebt({
      nights: nights(8, 7),
      sleepNeedSecs: DEFAULT_SLEEP_NEED_SECS,
      wakeTime: "25:99",
    });
    expect(r.bedtime).toBeNull();
  });

  it("always emits a well-formed HH:MM bedtime, even when the debt is not a whole number of minutes", () => {
    // 6 nights at exactly the 8h need (no deficit) + 1 night 45s short.
    // debtSecs = 45; payback = min(45, 3600) = 45.
    // needMinutes = (28800 + 45) / 60 = 480.75
    // wakeMinutes(07:00) - 480.75 = 420 - 480.75 = -60.75
    // -60.75 rounds to -61 minutes -> wraps to 1379 -> 22:59.
    const r = computeSleepDebt({
      nights: [...nights(8, 6), { sleepSecs: 28755 }],
      sleepNeedSecs: DEFAULT_SLEEP_NEED_SECS,
      wakeTime: "07:00",
    });
    expect(r.bedtime).toMatch(/^\d{2}:\d{2}$/);
    expect(r.bedtime).toBe("22:59");
  });

  it("truncates to the most recent DEBT_WINDOW_DAYS before dropping nulls, so older real nights outside the window never count", () => {
    // 6 old real nights (1h each - big deficit if wrongly included) sit
    // OUTSIDE the most-recent-14 window. The most-recent-14 window itself
    // has 4 nulls and 10 real 8h (no-deficit) nights. If the implementation
    // filtered nulls out before truncating to the window, some of the old
    // 1h nights would slide into the counted set. It must not.
    const oldReal = nights(1, 6);
    const recentWindow = [
      { sleepSecs: null },
      { sleepSecs: null },
      { sleepSecs: null },
      { sleepSecs: null },
      ...nights(8, 10),
    ];
    expect(recentWindow.length).toBe(14);

    const r = computeSleepDebt({
      nights: [...oldReal, ...recentWindow],
      sleepNeedSecs: DEFAULT_SLEEP_NEED_SECS,
      wakeTime: null,
    });
    expect(r.nightsCounted).toBe(10);
    expect(r.debtSecs).toBe(0);
  });

  it("v2: anchors bedtime on the median real bedtime when provided", () => {
    // 8 debt-free nights (no payback), habitual bedtime cluster ~23:00.
    const bedtimes = [
      23 * 60,
      23 * 60 + 10,
      22 * 60 + 50,
      23 * 60,
      23 * 60 + 5,
      22 * 60 + 55,
      23 * 60,
    ];
    const r = computeSleepDebt({
      nights: nights(8, 10),
      sleepNeedSecs: DEFAULT_SLEEP_NEED_SECS,
      wakeTime: "07:00",
      bedtimes,
    });
    // Median bedtime is 23:00; no debt → target is the habitual bedtime.
    expect(r.bedtime).toBe("23:00");
  });

  it("v2: handles after-midnight bedtimes without folding to noon", () => {
    const bedtimes = [
      23 * 60 + 30,
      0 * 60 + 30, // 00:30
      23 * 60 + 45,
      0 * 60 + 15, // 00:15
      23 * 60 + 50,
    ];
    const r = computeSleepDebt({
      nights: nights(8, 10),
      sleepNeedSecs: DEFAULT_SLEEP_NEED_SECS,
      wakeTime: null, // no wake time, but real bedtimes still yield a target
      bedtimes,
    });
    // Median of the evening cluster is 23:50, not a noon fold.
    expect(r.bedtime).toBe("23:50");
  });

  it("v2: too few bedtimes falls back to the wake-time anchor", () => {
    const r = computeSleepDebt({
      nights: nights(8, 10),
      sleepNeedSecs: DEFAULT_SLEEP_NEED_SECS,
      wakeTime: "07:00",
      bedtimes: [23 * 60, 23 * 60], // below MIN_BEDTIME_SAMPLES
    });
    // Falls back: 07:00 − 8h = 23:00.
    expect(r.bedtime).toBe("23:00");
  });
});

describe("sleepDebtFrom (the owner: date-window + bedtimes mapping)", () => {
  const TODAY = "2026-08-10";

  it("matches a hand-built computeSleepDebt call over a dense 14-day history", () => {
    // 14 dense daily rows, oldest first (most recent last), each with a real
    // bedStart so the median-anchor path is exercised too.
    const wellness = Array.from({ length: 14 }, (_, i) => {
      const offset = 13 - i; // 13 days ago ... today
      return {
        date: ymdOffset(TODAY, offset),
        sleepSecs: 7 * H, // 1h short every night → real, non-zero debt
        bedStart: new Date(2026, 0, 1, 23, 10), // 23:10 local, every night
      };
    });
    // Deliberately NOT DEFAULT_SLEEP_NEED_SECS: 6h vs the 7h actually slept
    // means zero deficit under this custom need, but a real deficit under
    // the 8h default — so a mutation that ignores prefs.sleepNeedSecs and
    // hardcodes the default would change debtSecs and get caught here.
    const prefs = { sleepNeedSecs: 6 * H, wakeTime: "07:00" };

    const expected = computeSleepDebt({
      nights: wellness.map((w) => ({ sleepSecs: w.sleepSecs })),
      sleepNeedSecs: prefs.sleepNeedSecs,
      wakeTime: prefs.wakeTime,
      bedtimes: wellness.map(
        (w) => w.bedStart.getHours() * 60 + w.bedStart.getMinutes()
      ),
    });

    expect(sleepDebtFrom(wellness, prefs, TODAY)).toEqual(expected);
  });

  it("excludes rows outside the 14-day window", () => {
    // 20 dense daily rows. The oldest 6 (offsets 14-19) are catastrophic
    // (0 sleep) and must not be counted; the recent 14 are debt-free.
    const oldRows = Array.from({ length: 6 }, (_, i) => ({
      date: ymdOffset(TODAY, 19 - i),
      sleepSecs: 0,
      bedStart: null,
    }));
    const recentRows = Array.from({ length: 14 }, (_, i) => ({
      date: ymdOffset(TODAY, 13 - i),
      sleepSecs: DEFAULT_SLEEP_NEED_SECS,
      bedStart: null,
    }));
    const wellness = [...oldRows, ...recentRows];

    const r = sleepDebtFrom(wellness, null, TODAY);
    expect(r.nightsCounted).toBe(14);
    expect(r.debtSecs).toBe(0);
  });

  it("prefs null falls back to DEFAULT_SLEEP_NEED_SECS and a null wakeTime", () => {
    const wellness = Array.from({ length: 8 }, (_, i) => ({
      date: ymdOffset(TODAY, 7 - i),
      sleepSecs: 6 * H, // short of the 8h default → real deficit
      bedStart: null,
    }));

    const r = sleepDebtFrom(wellness, null, TODAY);
    const expected = computeSleepDebt({
      nights: wellness.map((w) => ({ sleepSecs: w.sleepSecs })),
      sleepNeedSecs: DEFAULT_SLEEP_NEED_SECS,
      wakeTime: null,
      bedtimes: [],
    });
    expect(r).toEqual(expected);
    expect(r.bedtime).toBeNull(); // no wakeTime, no bedtimes → no guess
  });

  it("drops null-bedStart rows from bedtimes but still counts them as nights", () => {
    // 10 dense, debt-free nights. Only the first 6 carry a real bedStart
    // (all identical, so the median is unambiguous); the last 4 have none.
    const wellness = Array.from({ length: 10 }, (_, i) => ({
      date: ymdOffset(TODAY, 9 - i),
      sleepSecs: DEFAULT_SLEEP_NEED_SECS,
      bedStart: i < 6 ? new Date(2026, 0, 1, 23, 0) : null,
    }));

    const r = sleepDebtFrom(wellness, null, TODAY);
    expect(r.nightsCounted).toBe(10); // all 10 nights count
    // 6 real bedtimes ≥ MIN_BEDTIME_SAMPLES(5) → median-anchor path, and
    // with no debt the target is exactly the habitual bedtime.
    expect(r.bedtime).toBe("23:00");
  });

  // The window is enforced in two places today: computeSleepDebt's own
  // `slice(-DEBT_WINDOW_DAYS)` (the last 14 *elements*) and, until now, a
  // date filter duplicated at each call site (the last 14 *days*). Those
  // agree only when wellness is dense. This fixture is sparse: 4 rows sit
  // months in the past, so together with the recent rows the array has
  // fewer than 14 elements total — slice(-14) alone would happily reach
  // back and include the old catastrophic nights. sleepDebtFrom must filter
  // by real calendar date first, so the old rows never enter the count.
  it("counts only nights within 14 real days, not the last 14 elements (sparse history)", () => {
    const oldRows = [90, 60, 40, 20].map((offset) => ({
      date: ymdOffset(TODAY, offset),
      sleepSecs: 0, // catastrophic — must not be counted
      bedStart: null,
    }));
    const recentRows = Array.from({ length: 8 }, (_, i) => ({
      date: ymdOffset(TODAY, 7 - i),
      sleepSecs: DEFAULT_SLEEP_NEED_SECS, // debt-free
      bedStart: null,
    }));
    const wellness = [...oldRows, ...recentRows]; // 12 elements total, < 14

    const r = sleepDebtFrom(wellness, null, TODAY);
    expect(r.nightsCounted).toBe(8); // only the recent, in-window nights
    expect(r.debtSecs).toBe(0); // none of the old zero-sleep nights leak in
  });
});
