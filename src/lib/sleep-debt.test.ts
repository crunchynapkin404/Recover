import { describe, expect, it } from "vitest";
import { computeSleepDebt, DEFAULT_SLEEP_NEED_SECS } from "./sleep-debt";

const H = 3600;
/** n nights of exactly `hours` sleep. */
const nights = (hours: number, n: number) =>
  Array.from({ length: n }, () => ({ sleepSecs: hours * H }));

describe("sleep debt (hand-computed fixtures)", () => {
  it("reports null below MIN_DEBT_DAYS of real data", () => {
    const r = computeSleepDebt({
      nights: nights(6, 6),
      sleepNeedSecs: DEFAULT_SLEEP_NEED_SECS,
      wakeTime: "07:00",
    });
    expect(r.debtSecs).toBeNull();
    expect(r.nightsCounted).toBe(6);
    expect(r.bedtime).toBeNull();
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
