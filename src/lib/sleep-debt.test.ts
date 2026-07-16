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
    // 07:00 − (8h need + 1h capped payback) = 22:00, not 16:00.
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
});
